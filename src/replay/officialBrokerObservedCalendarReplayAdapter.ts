import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { isoDateTimeSchema, sha256HashSchema } from "../domain/schemas.js";
import {
  officialBrokerObservedCalendarEvidenceSchema,
  verifyOfficialBrokerObservedCalendarEvidence,
  type OfficialBrokerObservedCalendarEvidence
} from "./officialBrokerObservedCalendarEvidence.js";
import {
  BROKER_OBSERVED_CALENDAR_EVIDENCE_TRANSITION_SCHEMA_VERSION,
  brokerObservedCalendarEvidenceTransitionResultSchema,
  evaluateBrokerObservedCalendarEvidenceTransition
} from "./officialBrokerObservedCalendarEvidenceTransition.js";
import type { HistoricalDataAvailabilityCalendarOptions } from "./historicalDataAvailability.js";
import {
  parseMarketCalendarFixtures,
  type MarketCalendarFixture,
  type MarketCalendarTimezone
} from "./marketCalendar.js";

export const OFFICIAL_BROKER_OBSERVED_CALENDAR_REPLAY_INPUT_SCHEMA_VERSION =
  "official_broker_observed_calendar_replay_input.v1";

const BROKER_OBSERVED_CLOSURE_LABEL =
  "Toss broker-observed market closure";

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, "calendar date must be valid");

const canonicalUtcDateTimeSchema = isoDateTimeSchema
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value),
    "date-time must use canonical UTC millisecond format"
  )
  .refine(
    (value) => {
      const timestamp = Date.parse(value);
      return (
        Number.isFinite(timestamp) &&
        new Date(timestamp).toISOString() === value
      );
    },
    "date-time must represent an exact canonical UTC timestamp"
  );

const fixtureBase = {
  calendarId: z.string().min(1),
  exchange: z.enum(["KRX", "NYSE"]),
  market: z.enum(["KR", "US"]),
  timezone: z.enum(["Asia/Seoul", "America/New_York"]),
  sessionDate: calendarDateSchema,
  sourceRefs: z.tuple([z.string().min(1), z.string().min(1)]),
  createdAt: canonicalUtcDateTimeSchema
};

const replayCalendarFixtureSchema = z.discriminatedUnion("isHoliday", [
  z
    .object({
      ...fixtureBase,
      marketOpen: canonicalUtcDateTimeSchema,
      marketClose: canonicalUtcDateTimeSchema,
      isHoliday: z.literal(false)
    })
    .strict(),
  z
    .object({
      ...fixtureBase,
      marketOpen: z.null(),
      marketClose: z.null(),
      isHoliday: z.literal(true),
      holidayName: z.literal(BROKER_OBSERVED_CLOSURE_LABEL)
    })
    .strict()
]);

const calendarValidationSchema = z
  .object({
    rules: z.tuple([
      z
        .object({
          market: z.enum(["KR", "US"]),
          exchange: z.enum(["KRX", "NYSE"]),
          timezone: z.enum(["Asia/Seoul", "America/New_York"])
        })
        .strict()
    ]),
    fixtures: z.tuple([
      replayCalendarFixtureSchema,
      replayCalendarFixtureSchema,
      replayCalendarFixtureSchema
    ])
  })
  .strict();

const replayInputBaseSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_BROKER_OBSERVED_CALENDAR_REPLAY_INPUT_SCHEMA_VERSION
    ),
    mode: z.literal("paper_only"),
    sourceEvidenceClass: z.literal("official_broker_observed"),
    replayEvidenceClass: z.literal("observed_session_only"),
    evidenceArtifactHash: sha256HashSchema,
    transition: brokerObservedCalendarEvidenceTransitionResultSchema,
    evidence: officialBrokerObservedCalendarEvidenceSchema,
    calendarValidation: calendarValidationSchema
  })
  .strict();

export const officialBrokerObservedCalendarReplayInputSchema =
  replayInputBaseSchema.superRefine(validateReplayInputBindings);

const verifierOptionsSchema = z
  .object({ asOf: canonicalUtcDateTimeSchema })
  .strict();

export type OfficialBrokerObservedCalendarReplayInput = z.infer<
  typeof officialBrokerObservedCalendarReplayInputSchema
>;

export interface BuildOfficialBrokerObservedCalendarReplayInputOptions {
  evidence: unknown;
  asOf: string;
  rawResponseBytes: Uint8Array;
}

export interface VerifyOfficialBrokerObservedCalendarReplayInputOptions {
  asOf: string;
  rawResponseBytes: Uint8Array;
}

export function buildOfficialBrokerObservedCalendarReplayInput(
  options: BuildOfficialBrokerObservedCalendarReplayInputOptions
): OfficialBrokerObservedCalendarReplayInput {
  const verifiedEvidence = verifyOfficialBrokerObservedCalendarEvidence(
    options.evidence,
    { asOf: options.asOf, rawResponseBytes: options.rawResponseBytes }
  );
  const transition = verifiedTransition();

  return verifyOfficialBrokerObservedCalendarReplayInput(
    {
      schemaVersion:
        OFFICIAL_BROKER_OBSERVED_CALENDAR_REPLAY_INPUT_SCHEMA_VERSION,
      mode: "paper_only",
      sourceEvidenceClass: "official_broker_observed",
      replayEvidenceClass: "observed_session_only",
      evidenceArtifactHash: verifiedEvidence.artifactHash,
      transition,
      evidence: verifiedEvidence,
      calendarValidation: calendarValidationFor(verifiedEvidence)
    },
    { asOf: options.asOf, rawResponseBytes: options.rawResponseBytes }
  );
}

export function verifyOfficialBrokerObservedCalendarReplayInput(
  value: unknown,
  options: VerifyOfficialBrokerObservedCalendarReplayInputOptions
): OfficialBrokerObservedCalendarReplayInput {
  const parsedOptions = verifierOptionsSchema.parse({ asOf: options.asOf });
  const input = officialBrokerObservedCalendarReplayInputSchema.parse(value);
  verifyOfficialBrokerObservedCalendarEvidence(input.evidence, {
    asOf: parsedOptions.asOf,
    rawResponseBytes: options.rawResponseBytes
  });
  return input;
}

function validateReplayInputBindings(
  value: z.infer<typeof replayInputBaseSchema>,
  context: z.RefinementCtx
): void {
  if (value.evidenceArtifactHash !== value.evidence.artifactHash) {
    issue(
      context,
      ["evidenceArtifactHash"],
      "replay input evidence artifact hash mismatch"
    );
  }

  const expectedTransition = verifiedTransition();
  if (!isDeepStrictEqual(value.transition, expectedTransition)) {
    issue(
      context,
      ["transition"],
      "replay input transition must remain verified and eligible"
    );
  }

  try {
    const expectedCalendarValidation = calendarValidationFor(value.evidence);
    if (
      !isDeepStrictEqual(
        value.calendarValidation,
        expectedCalendarValidation
      )
    ) {
      issue(
        context,
        ["calendarValidation"],
        "replay calendar validation input does not match verified evidence"
      );
    }
  } catch (error) {
    issue(
      context,
      ["calendarValidation"],
      error instanceof Error
        ? error.message
        : "replay calendar validation input is invalid"
    );
  }
}

function verifiedTransition() {
  const transition = evaluateBrokerObservedCalendarEvidenceTransition({
    schemaVersion:
      BROKER_OBSERVED_CALENDAR_EVIDENCE_TRANSITION_SCHEMA_VERSION,
    mode: "paper_only",
    sourceEvidenceClass: "official_broker_observed",
    requestedDateStatus: "supported",
    responseCompleteness: "complete",
    responseSchemaStatus: "verified",
    provenanceStatus: "verified",
    freshnessStatus: "fresh",
    coverageStatus: "verified"
  });
  if (transition.status !== "eligible") {
    throw new Error("verified broker calendar evidence transition is not eligible");
  }
  return transition;
}

function calendarValidationFor(
  evidence: OfficialBrokerObservedCalendarEvidence
): HistoricalDataAvailabilityCalendarOptions {
  const identity = marketIdentity(evidence.market);
  return {
    rules: [
      {
        market: evidence.market,
        exchange: identity.exchange,
        timezone: identity.timezone
      }
    ],
    fixtures: mapEvidenceToFixtures(evidence)
  };
}

function mapEvidenceToFixtures(
  evidence: OfficialBrokerObservedCalendarEvidence
): [MarketCalendarFixture, MarketCalendarFixture, MarketCalendarFixture] {
  const fixtures = evidence.response.days.map((day) =>
    fixtureForDay(evidence, day)
  );
  const parsedFixtures = parseMarketCalendarFixtures(fixtures);
  if (parsedFixtures.length !== 3) {
    throw new Error("broker calendar replay input must contain three fixtures");
  }
  return parsedFixtures as [
    MarketCalendarFixture,
    MarketCalendarFixture,
    MarketCalendarFixture
  ];
}

function fixtureForDay(
  evidence: OfficialBrokerObservedCalendarEvidence,
  day: OfficialBrokerObservedCalendarEvidence["response"]["days"][number]
): MarketCalendarFixture {
  const identity = marketIdentity(evidence.market);
  const base = {
    calendarId: `toss-open-api-observed:${identity.exchange}:${day.marketDate}:${evidence.artifactHash}`,
    exchange: identity.exchange,
    market: evidence.market,
    timezone: identity.timezone,
    sessionDate: day.marketDate,
    sourceRefs: [
      `official_broker_observed_calendar_evidence:${evidence.artifactHash}`,
      `toss_open_api_market_calendar_response:${evidence.source.responseHash}`
    ],
    createdAt: evidence.source.retrievedAt
  };

  if (day.status === "closed") {
    return {
      ...base,
      marketOpen: null,
      marketClose: null,
      isHoliday: true,
      holidayName: BROKER_OBSERVED_CLOSURE_LABEL
    };
  }

  const regularSessions = day.sessions.filter(
    ({ sessionType }) => sessionType === "regular_market"
  );
  if (regularSessions.length !== 1) {
    throw new Error(
      `open broker calendar day must contain one regular session: ${day.marketDate}`
    );
  }
  const regularSession = regularSessions[0]!;
  return {
    ...base,
    marketOpen: regularSession.startAt,
    marketClose: regularSession.endAt,
    isHoliday: false
  };
}

function marketIdentity(market: "KR" | "US"): {
  exchange: "KRX" | "NYSE";
  timezone: MarketCalendarTimezone;
} {
  return market === "KR"
    ? { exchange: "KRX", timezone: "Asia/Seoul" }
    : { exchange: "NYSE", timezone: "America/New_York" };
}

function isValidCalendarDate(value: string): boolean {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function issue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
