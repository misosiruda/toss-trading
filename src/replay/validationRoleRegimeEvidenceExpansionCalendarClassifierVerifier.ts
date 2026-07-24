import { z } from "zod";

import {
  isoDateTimeSchema,
  marketSchema,
  type Sha256Hash
} from "../domain/schemas.js";
import type {
  HistoricalDataAvailabilityCalendarOptions,
  HistoricalDataAvailabilityCalendarRule
} from "./historicalDataAvailability.js";
import {
  MarketCalendarFixtureIndex,
  parseMarketCalendarFixtures,
  type MarketCalendarFixture
} from "./marketCalendar.js";
import {
  parseOfficialMarketCalendarEvidenceArtifact,
  type OfficialMarketCalendarEvidenceArtifact
} from "./officialMarketCalendarEvidence.js";
import {
  createValidationFeasibilityCalendarHash,
  createValidationFeasibilityClassifierHash,
  marketRegimeClassifierConfigSchema,
  validationFeasibilityCalendarRuleSchema
} from "./validationSplitRegimeFeasibility.js";

const calendarFixtureSchema = z
  .object({
    calendarId: z.string().trim().min(1),
    exchange: z.string().trim().min(1),
    market: marketSchema,
    timezone: z.enum(["Asia/Seoul", "America/New_York"]),
    sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    marketOpen: isoDateTimeSchema.nullable(),
    marketClose: isoDateTimeSchema.nullable(),
    isHoliday: z.boolean(),
    holidayName: z.string().trim().min(1).optional(),
    sourceRefs: z.array(z.string().trim().min(1)).min(1),
    createdAt: isoDateTimeSchema
  })
  .strict();

const calendarValidationSourceSchema = z
  .object({
    rules: z.array(validationFeasibilityCalendarRuleSchema).min(1),
    fixtures: z.array(calendarFixtureSchema).min(1)
  })
  .strict();

type MarketRegimeClassifierConfig = z.infer<
  typeof marketRegimeClassifierConfigSchema
>;

export interface VerifyEvidenceExpansionCalendarClassifierOptions {
  calendarValidation: unknown;
  marketRegimeClassifier: unknown;
  officialCalendarArtifact?: unknown;
  asOf: Date | string;
  baselineCalendarHash: Sha256Hash;
  baselineMarketRegimeClassifierHash: Sha256Hash;
}

export interface VerifiedEvidenceExpansionCalendarClassifier {
  calendarValidation: HistoricalDataAvailabilityCalendarOptions;
  marketRegimeClassifier: MarketRegimeClassifierConfig;
  officialCalendarArtifact: OfficialMarketCalendarEvidenceArtifact | null;
  hashes: {
    calendarHash: Sha256Hash;
    officialCalendarArtifactHash: Sha256Hash | null;
    marketRegimeClassifierHash: Sha256Hash;
  };
}

export function verifyEvidenceExpansionCalendarClassifier(
  options: VerifyEvidenceExpansionCalendarClassifierOptions
): VerifiedEvidenceExpansionCalendarClassifier {
  const calendarValidation = normalizeCalendarValidation(
    options.calendarValidation
  );
  const marketRegimeClassifier = marketRegimeClassifierConfigSchema.parse(
    options.marketRegimeClassifier
  );
  const calendarHash =
    createValidationFeasibilityCalendarHash(calendarValidation);
  const marketRegimeClassifierHash =
    createValidationFeasibilityClassifierHash(marketRegimeClassifier);

  if (calendarHash !== options.baselineCalendarHash) {
    throw new Error("expansion calendar hash does not match baseline");
  }
  if (
    marketRegimeClassifierHash !==
    options.baselineMarketRegimeClassifierHash
  ) {
    throw new Error("expansion classifier hash does not match baseline");
  }

  const officialCalendarArtifact =
    options.officialCalendarArtifact === undefined
      ? null
      : parseOfficialMarketCalendarEvidenceArtifact(
          options.officialCalendarArtifact,
          { asOf: options.asOf }
        );
  if (officialCalendarArtifact !== null) {
    assertCalendarMatchesOfficialEvidence(
      calendarValidation,
      officialCalendarArtifact
    );
  }

  return {
    calendarValidation,
    marketRegimeClassifier,
    officialCalendarArtifact,
    hashes: {
      calendarHash,
      officialCalendarArtifactHash:
        officialCalendarArtifact?.artifactHash ?? null,
      marketRegimeClassifierHash
    }
  };
}

function normalizeCalendarValidation(
  value: unknown
): HistoricalDataAvailabilityCalendarOptions {
  const parsed = calendarValidationSourceSchema.parse(value);
  const rules = parsed.rules
    .map((rule) => validationFeasibilityCalendarRuleSchema.parse(rule))
    .sort(compareCalendarRules);
  assertUniqueCalendarRules(rules);

  const fixtures = parseMarketCalendarFixtures(parsed.fixtures)
    .map((fixture) => ({
      ...fixture,
      sourceRefs: [...fixture.sourceRefs].sort(compareStrings)
    }))
    .sort(compareCalendarFixtures);
  new MarketCalendarFixtureIndex(fixtures);

  return { rules, fixtures };
}

function assertUniqueCalendarRules(
  rules: readonly HistoricalDataAvailabilityCalendarRule[]
): void {
  const markets = new Set<string>();
  for (const rule of rules) {
    if (markets.has(rule.market)) {
      throw new Error(
        `duplicate calendarValidation rule for market: ${rule.market}`
      );
    }
    markets.add(rule.market);
  }
}

function assertCalendarMatchesOfficialEvidence(
  calendarValidation: HistoricalDataAvailabilityCalendarOptions,
  official: OfficialMarketCalendarEvidenceArtifact
): void {
  const rulesByExchange = new Map(
    calendarValidation.rules.map((rule) => [rule.exchange, rule])
  );
  for (const source of official.sources) {
    const rule = rulesByExchange.get(source.exchange);
    if (
      rule === undefined ||
      rule.market !== source.market ||
      rule.timezone !== source.timezone
    ) {
      throw new Error(
        `calendar rule does not match official source: ${source.exchange}`
      );
    }
  }

  const officialSessions = new Map(
    official.sessions.map((session) => [
      `${session.exchange}:${session.sessionDate}`,
      session
    ])
  );
  const fixtureKeys = new Set(
    calendarValidation.fixtures.map(
      (fixture) => `${fixture.exchange}:${fixture.sessionDate}`
    )
  );
  for (const session of official.sessions) {
    const key = `${session.exchange}:${session.sessionDate}`;
    if (!fixtureKeys.has(key)) {
      throw new Error(
        `official session is missing calendar fixture: ${key}`
      );
    }
  }
  for (const fixture of calendarValidation.fixtures) {
    const session = officialSessions.get(
      `${fixture.exchange}:${fixture.sessionDate}`
    );
    if (session === undefined) {
      throw new Error(
        `calendar fixture is missing official session: ${fixture.exchange}:${fixture.sessionDate}`
      );
    }
    const officialClosed =
      session.sessionType === "holiday" ||
      session.sessionType === "special_closure" ||
      session.sessionType === "weekend";
    if (
      fixture.market !== session.market ||
      fixture.timezone !== session.timezone ||
      fixture.isHoliday !== officialClosed ||
      !sameNullableInstant(fixture.marketOpen, session.marketOpen) ||
      !sameNullableInstant(fixture.marketClose, session.marketClose)
    ) {
      throw new Error(
        `calendar fixture does not match official session: ${fixture.exchange}:${fixture.sessionDate}`
      );
    }
  }
}

function sameNullableInstant(
  left: string | null,
  right: string | null
): boolean {
  return left === null || right === null
    ? left === right
    : Date.parse(left) === Date.parse(right);
}

function compareCalendarRules(
  left: HistoricalDataAvailabilityCalendarRule,
  right: HistoricalDataAvailabilityCalendarRule
): number {
  return (
    compareStrings(left.market, right.market) ||
    compareStrings(left.exchange, right.exchange) ||
    compareStrings(left.timezone, right.timezone)
  );
}

function compareCalendarFixtures(
  left: MarketCalendarFixture,
  right: MarketCalendarFixture
): number {
  return (
    compareStrings(left.market, right.market) ||
    compareStrings(left.exchange, right.exchange) ||
    compareStrings(left.sessionDate, right.sessionDate) ||
    compareStrings(left.calendarId, right.calendarId)
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
