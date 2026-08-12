import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { isoDateTimeSchema, sha256HashSchema } from "../domain/schemas.js";
import {
  OFFICIAL_BROKER_OBSERVED_CALENDAR_MAXIMUM_AGE_SECONDS,
  officialBrokerObservedCalendarEvidenceSchema,
  verifyOfficialBrokerObservedCalendarEvidence,
  type OfficialBrokerObservedCalendarEvidence
} from "./officialBrokerObservedCalendarEvidence.js";
import { brokerObservedCalendarEvidenceTransitionRejectionCodeSchema } from "./officialBrokerObservedCalendarEvidenceTransition.js";
import { buildOfficialBrokerObservedCalendarReplayInput } from "./officialBrokerObservedCalendarReplayAdapter.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_PLAN_SCHEMA_VERSION =
  "official_broker_observed_calendar_coverage_probe_plan.v1";
export const OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_REPORT_SCHEMA_VERSION =
  "official_broker_observed_calendar_coverage_probe_report.v1";
export const OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_POLICY =
  "every_calendar_date.v1";
export const OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_MAXIMUM_DAYS =
  10_000;

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

const probePlanPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_PLAN_SCHEMA_VERSION
    ),
    mode: z.literal("paper_only"),
    sourceEvidenceClass: z.literal("official_broker_observed"),
    replayEvidenceClass: z.literal("observed_session_only"),
    probePolicy: z.literal(
      OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_POLICY
    ),
    market: z.enum(["KR", "US"]),
    rangeStartDate: calendarDateSchema,
    rangeEndDate: calendarDateSchema,
    requestedDates: z
      .array(calendarDateSchema)
      .min(1)
      .max(OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_MAXIMUM_DAYS),
    historicalCompletenessClaim: z.literal("not_claimed"),
    officialExchangeReadiness: z.literal("not_established")
  })
  .strict()
  .superRefine(validateProbePlanPayload);

export const officialBrokerObservedCalendarCoverageProbePlanSchema =
  probePlanPayloadSchema
    .safeExtend({ planHash: sha256HashSchema })
    .strict()
    .superRefine((value, context) => {
      const { planHash, ...payload } = value;
      if (planHash !== createReplayResearchHash(payload)) {
        issue(context, ["planHash"], "calendar coverage probe plan hash mismatch");
      }
    });

const verifiedObservationInputSchema = z
  .object({
    status: z.literal("verified"),
    requestedDate: calendarDateSchema,
    evidence: z.unknown(),
    rawResponseBytes: z.instanceof(Uint8Array)
  })
  .strict();

const rejectedObservationInputSchema = z
  .object({
    status: z.literal("rejected"),
    requestedDate: calendarDateSchema,
    rejectionCode:
      brokerObservedCalendarEvidenceTransitionRejectionCodeSchema
  })
  .strict();

const observationInputSchema = z.discriminatedUnion("status", [
  verifiedObservationInputSchema,
  rejectedObservationInputSchema
]);

const returnedDateRangeSchema = z
  .object({
    startDate: calendarDateSchema,
    endDate: calendarDateSchema
  })
  .strict();

const returnedSessionRangeSchema = z
  .object({
    startAt: canonicalUtcDateTimeSchema,
    endAt: canonicalUtcDateTimeSchema
  })
  .strict();

const verifiedProbeResultSchema = z
  .object({
    requestedDate: calendarDateSchema,
    status: z.literal("verified"),
    evidenceArtifactHash: sha256HashSchema,
    responseHash: sha256HashSchema,
    responseByteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    retrievedAt: canonicalUtcDateTimeSchema,
    staleAfter: canonicalUtcDateTimeSchema,
    returnedDates: z.tuple([
      calendarDateSchema,
      calendarDateSchema,
      calendarDateSchema
    ]),
    returnedDateRange: returnedDateRangeSchema,
    returnedSessionCount: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    returnedSessionRange: returnedSessionRangeSchema.nullable(),
    rejectionCode: z.null()
  })
  .strict();

const rejectedProbeResultSchema = z.discriminatedUnion("rejectionStage", [
  z
    .object({
      requestedDate: calendarDateSchema,
      status: z.literal("rejected"),
      rejectionStage: z.literal("acquisition"),
      evidenceArtifactHash: z.null(),
      rejectionCode:
        brokerObservedCalendarEvidenceTransitionRejectionCodeSchema
    })
    .strict(),
  z
    .object({
      requestedDate: calendarDateSchema,
      status: z.literal("rejected"),
      rejectionStage: z.literal("replay_adapter"),
      evidenceArtifactHash: sha256HashSchema,
      rejectionCode: z.literal(
        "OFFICIAL_BROKER_CALENDAR_COVERAGE_AMBIGUOUS"
      )
    })
    .strict()
]);

const missingProbeResultSchema = z
  .object({
    requestedDate: calendarDateSchema,
    status: z.literal("missing"),
    evidenceArtifactHash: z.null(),
    rejectionCode: z.literal(
      "OFFICIAL_BROKER_CALENDAR_PROBE_NOT_OBSERVED"
    )
  })
  .strict();

const probeResultSchema = z.union([
  verifiedProbeResultSchema,
  rejectedProbeResultSchema,
  missingProbeResultSchema
]);

const returnedDateConflictSchema = z
  .object({
    marketDate: calendarDateSchema,
    evidenceArtifactHashes: z.array(sha256HashSchema).min(2)
  })
  .strict()
  .superRefine((value, context) => {
    validateCanonicalUniqueStrings(
      value.evidenceArtifactHashes,
      context,
      ["evidenceArtifactHashes"]
    );
  });

const probeIssueCodeSchema = z.enum([
  "OFFICIAL_BROKER_CALENDAR_PROBE_NOT_OBSERVED",
  "OFFICIAL_BROKER_CALENDAR_PROBE_REJECTED",
  "OFFICIAL_BROKER_CALENDAR_RETURNED_DATE_CONFLICT"
]);

type ProbeResult = z.infer<typeof probeResultSchema>;
type ReturnedDateConflict = z.infer<typeof returnedDateConflictSchema>;

const probeReportPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_REPORT_SCHEMA_VERSION
    ),
    mode: z.literal("paper_only"),
    sourceEvidenceClass: z.literal("official_broker_observed"),
    replayEvidenceClass: z.literal("observed_session_only"),
    evaluatedAt: canonicalUtcDateTimeSchema,
    plan: officialBrokerObservedCalendarCoverageProbePlanSchema,
    status: z.enum(["verified", "insufficient"]),
    coverageStatus: z.enum(["verified", "ambiguous"]),
    observedReplayEligibility: z.enum(["eligible", "rejected"]),
    historicalCompletenessClaim: z.literal("not_claimed"),
    officialExchangeReadiness: z.literal("not_established"),
    summary: z
      .object({
        plannedDateCount: z.number().int().positive(),
        verifiedDateCount: z.number().int().nonnegative(),
        rejectedDateCount: z.number().int().nonnegative(),
        missingDateCount: z.number().int().nonnegative(),
        conflictDateCount: z.number().int().nonnegative()
      })
      .strict(),
    results: z.array(probeResultSchema).min(1),
    returnedDateConflicts: z.array(returnedDateConflictSchema),
    issueCodes: z.array(probeIssueCodeSchema)
  })
  .strict()
  .superRefine(validateProbeReportPayload);

export const officialBrokerObservedCalendarCoverageProbeReportSchema =
  probeReportPayloadSchema
    .safeExtend({ reportHash: sha256HashSchema })
    .strict()
    .superRefine((value, context) => {
      const { reportHash, ...payload } = value;
      if (reportHash !== createReplayResearchHash(payload)) {
        issue(
          context,
          ["reportHash"],
          "calendar coverage probe report hash mismatch"
        );
      }
    });

const createPlanInputSchema = z
  .object({
    market: z.enum(["KR", "US"]),
    rangeStartDate: calendarDateSchema,
    rangeEndDate: calendarDateSchema
  })
  .strict();

const reportOptionsMetadataSchema = z
  .object({ evaluatedAt: canonicalUtcDateTimeSchema })
  .strict();

export type OfficialBrokerObservedCalendarCoverageProbePlan = z.infer<
  typeof officialBrokerObservedCalendarCoverageProbePlanSchema
>;
export type OfficialBrokerObservedCalendarCoverageProbeReport = z.infer<
  typeof officialBrokerObservedCalendarCoverageProbeReportSchema
>;
export type OfficialBrokerObservedCalendarCoverageProbeObservation = z.infer<
  typeof observationInputSchema
>;

export interface BuildOfficialBrokerObservedCalendarCoverageProbeReportOptions {
  plan: unknown;
  evaluatedAt: string;
  observations: unknown[];
}

export function createOfficialBrokerObservedCalendarCoverageProbePlan(
  input: unknown
): OfficialBrokerObservedCalendarCoverageProbePlan {
  const parsed = createPlanInputSchema.parse(input);
  const requestedDates = enumerateCalendarDates(
    parsed.rangeStartDate,
    parsed.rangeEndDate
  );
  const payload = probePlanPayloadSchema.parse({
    schemaVersion:
      OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_PLAN_SCHEMA_VERSION,
    mode: "paper_only",
    sourceEvidenceClass: "official_broker_observed",
    replayEvidenceClass: "observed_session_only",
    probePolicy: OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_POLICY,
    market: parsed.market,
    rangeStartDate: parsed.rangeStartDate,
    rangeEndDate: parsed.rangeEndDate,
    requestedDates,
    historicalCompletenessClaim: "not_claimed",
    officialExchangeReadiness: "not_established"
  });
  return officialBrokerObservedCalendarCoverageProbePlanSchema.parse({
    ...payload,
    planHash: createReplayResearchHash(payload)
  });
}

export function parseOfficialBrokerObservedCalendarCoverageProbePlan(
  value: unknown
): OfficialBrokerObservedCalendarCoverageProbePlan {
  return officialBrokerObservedCalendarCoverageProbePlanSchema.parse(value);
}

export function buildOfficialBrokerObservedCalendarCoverageProbeReport(
  options: BuildOfficialBrokerObservedCalendarCoverageProbeReportOptions
): OfficialBrokerObservedCalendarCoverageProbeReport {
  const metadata = reportOptionsMetadataSchema.parse({
    evaluatedAt: options.evaluatedAt
  });
  const plan = parseOfficialBrokerObservedCalendarCoverageProbePlan(
    options.plan
  );
  const observations = z.array(observationInputSchema).parse(options.observations);
  const payload = buildReportPayload(plan, metadata.evaluatedAt, observations);
  return officialBrokerObservedCalendarCoverageProbeReportSchema.parse({
    ...payload,
    reportHash: createReplayResearchHash(payload)
  });
}

export function parseOfficialBrokerObservedCalendarCoverageProbeReport(
  value: unknown
): OfficialBrokerObservedCalendarCoverageProbeReport {
  return officialBrokerObservedCalendarCoverageProbeReportSchema.parse(value);
}

function buildReportPayload(
  plan: OfficialBrokerObservedCalendarCoverageProbePlan,
  evaluatedAt: string,
  observations: OfficialBrokerObservedCalendarCoverageProbeObservation[]
) {
  const observationsByDate = new Map<
    string,
    OfficialBrokerObservedCalendarCoverageProbeObservation
  >();
  const plannedDates = new Set(plan.requestedDates);
  for (const observation of observations) {
    if (!plannedDates.has(observation.requestedDate)) {
      throw new Error(
        `calendar coverage probe observation is outside plan: ${observation.requestedDate}`
      );
    }
    if (observationsByDate.has(observation.requestedDate)) {
      throw new Error(
        `duplicate calendar coverage probe observation: ${observation.requestedDate}`
      );
    }
    observationsByDate.set(observation.requestedDate, observation);
  }

  const verifiedEvidence: OfficialBrokerObservedCalendarEvidence[] = [];
  const results = plan.requestedDates.map((requestedDate) => {
    const observation = observationsByDate.get(requestedDate);
    if (observation === undefined) {
      return {
        requestedDate,
        status: "missing" as const,
        evidenceArtifactHash: null,
        rejectionCode: "OFFICIAL_BROKER_CALENDAR_PROBE_NOT_OBSERVED" as const
      };
    }
    if (observation.status === "rejected") {
      return {
        requestedDate,
        status: "rejected" as const,
        rejectionStage: "acquisition" as const,
        evidenceArtifactHash: null,
        rejectionCode: observation.rejectionCode
      };
    }

    const evidence = verifyOfficialBrokerObservedCalendarEvidence(
      observation.evidence,
      {
        asOf: evaluatedAt,
        rawResponseBytes: observation.rawResponseBytes
      }
    );
    if (
      evidence.market !== plan.market ||
      evidence.requestedDate !== requestedDate
    ) {
      throw new Error(
        `calendar coverage probe evidence does not match plan: ${requestedDate}`
      );
    }
    verifiedEvidence.push(evidence);
    try {
      buildOfficialBrokerObservedCalendarReplayInput({
        evidence,
        asOf: evaluatedAt,
        rawResponseBytes: observation.rawResponseBytes
      });
    } catch {
      return {
        requestedDate,
        status: "rejected" as const,
        rejectionStage: "replay_adapter" as const,
        evidenceArtifactHash: evidence.artifactHash,
        rejectionCode:
          "OFFICIAL_BROKER_CALENDAR_COVERAGE_AMBIGUOUS" as const
      };
    }
    return verifiedResult(evidence);
  });

  const returnedDateConflicts = findReturnedDateConflicts(verifiedEvidence);
  const verifiedDateCount = results.filter(
    ({ status }) => status === "verified"
  ).length;
  const rejectedDateCount = results.filter(
    ({ status }) => status === "rejected"
  ).length;
  const missingDateCount = results.filter(
    ({ status }) => status === "missing"
  ).length;
  const issueCodes = [
    ...(missingDateCount > 0
      ? (["OFFICIAL_BROKER_CALENDAR_PROBE_NOT_OBSERVED"] as const)
      : []),
    ...(rejectedDateCount > 0
      ? (["OFFICIAL_BROKER_CALENDAR_PROBE_REJECTED"] as const)
      : []),
    ...(returnedDateConflicts.length > 0
      ? (["OFFICIAL_BROKER_CALENDAR_RETURNED_DATE_CONFLICT"] as const)
      : [])
  ];
  const coverageVerified =
    verifiedDateCount === plan.requestedDates.length &&
    returnedDateConflicts.length === 0;

  return probeReportPayloadSchema.parse({
    schemaVersion:
      OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_REPORT_SCHEMA_VERSION,
    mode: "paper_only",
    sourceEvidenceClass: "official_broker_observed",
    replayEvidenceClass: "observed_session_only",
    evaluatedAt,
    plan,
    status: coverageVerified ? "verified" : "insufficient",
    coverageStatus: coverageVerified ? "verified" : "ambiguous",
    observedReplayEligibility: coverageVerified ? "eligible" : "rejected",
    historicalCompletenessClaim: "not_claimed",
    officialExchangeReadiness: "not_established",
    summary: {
      plannedDateCount: plan.requestedDates.length,
      verifiedDateCount,
      rejectedDateCount,
      missingDateCount,
      conflictDateCount: returnedDateConflicts.length
    },
    results,
    returnedDateConflicts,
    issueCodes
  });
}

function verifiedResult(evidence: OfficialBrokerObservedCalendarEvidence) {
  return {
    requestedDate: evidence.requestedDate,
    status: "verified" as const,
    evidenceArtifactHash: evidence.artifactHash,
    responseHash: evidence.source.responseHash,
    responseByteLength: evidence.source.responseByteLength,
    retrievedAt: evidence.source.retrievedAt,
    staleAfter: evidence.source.staleAfter,
    returnedDates: evidence.coverage.returnedDates,
    returnedDateRange: evidence.coverage.returnedDateRange,
    returnedSessionCount: evidence.coverage.returnedSessionCount,
    returnedSessionRange: evidence.coverage.returnedSessionRange,
    rejectionCode: null
  };
}

function findReturnedDateConflicts(
  evidenceItems: OfficialBrokerObservedCalendarEvidence[]
) {
  const observationsByDate = new Map<
    string,
    Array<{
      artifactHash: OfficialBrokerObservedCalendarEvidence["artifactHash"];
      day: OfficialBrokerObservedCalendarEvidence["response"]["days"][number];
    }>
  >();
  for (const evidence of evidenceItems) {
    for (const day of evidence.response.days) {
      const existing = observationsByDate.get(day.marketDate) ?? [];
      existing.push({ artifactHash: evidence.artifactHash, day });
      observationsByDate.set(day.marketDate, existing);
    }
  }

  const conflicts = [];
  for (const [marketDate, observations] of observationsByDate) {
    if (
      observations.length < 2 ||
      observations.every(({ day }) =>
        isDeepStrictEqual(dayContent(day), dayContent(observations[0]!.day))
      )
    ) {
      continue;
    }
    conflicts.push({
      marketDate,
      evidenceArtifactHashes: [
        ...new Set(observations.map(({ artifactHash }) => artifactHash))
      ].sort(compareText)
    });
  }
  return conflicts.sort((left, right) => compareText(left.marketDate, right.marketDate));
}

function dayContent(
  day: OfficialBrokerObservedCalendarEvidence["response"]["days"][number]
) {
  return {
    marketDate: day.marketDate,
    status: day.status,
    sessions: day.sessions
  };
}

function validateProbePlanPayload(
  value: {
    rangeStartDate: string;
    rangeEndDate: string;
    requestedDates: string[];
  },
  context: z.RefinementCtx
): void {
  if (value.rangeStartDate > value.rangeEndDate) {
    issue(
      context,
      ["rangeEndDate"],
      "calendar coverage probe range start must not follow end"
    );
    return;
  }
  let expectedDates: string[];
  try {
    expectedDates = enumerateCalendarDates(
      value.rangeStartDate,
      value.rangeEndDate
    );
  } catch (error) {
    issue(
      context,
      ["requestedDates"],
      error instanceof Error
        ? error.message
        : "calendar coverage probe date range is invalid"
    );
    return;
  }
  if (!isDeepStrictEqual(value.requestedDates, expectedDates)) {
    issue(
      context,
      ["requestedDates"],
      "calendar coverage probe must request every calendar date in range"
    );
  }
}

function validateProbeReportPayload(
  value: {
    evaluatedAt: string;
    plan: { requestedDates: string[] };
    status: "verified" | "insufficient";
    coverageStatus: "verified" | "ambiguous";
    observedReplayEligibility: "eligible" | "rejected";
    summary: {
      plannedDateCount: number;
      verifiedDateCount: number;
      rejectedDateCount: number;
      missingDateCount: number;
      conflictDateCount: number;
    };
    results: ProbeResult[];
    returnedDateConflicts: ReturnedDateConflict[];
    issueCodes: string[];
  },
  context: z.RefinementCtx
): void {
  if (
    value.results.length !== value.plan.requestedDates.length ||
    value.results.some(
      (result, index) =>
        result.requestedDate !== value.plan.requestedDates[index]
    )
  ) {
    issue(
      context,
      ["results"],
      "calendar coverage probe results must match every planned date in order"
    );
  }

  const counts = {
    plannedDateCount: value.plan.requestedDates.length,
    verifiedDateCount: value.results.filter(
      ({ status }) => status === "verified"
    ).length,
    rejectedDateCount: value.results.filter(
      ({ status }) => status === "rejected"
    ).length,
    missingDateCount: value.results.filter(
      ({ status }) => status === "missing"
    ).length,
    conflictDateCount: value.returnedDateConflicts.length
  };
  if (!isDeepStrictEqual(value.summary, counts)) {
    issue(
      context,
      ["summary"],
      "calendar coverage probe summary does not match results"
    );
  }

  const expectedIssueCodes = [
    ...(counts.missingDateCount > 0
      ? (["OFFICIAL_BROKER_CALENDAR_PROBE_NOT_OBSERVED"] as const)
      : []),
    ...(counts.rejectedDateCount > 0
      ? (["OFFICIAL_BROKER_CALENDAR_PROBE_REJECTED"] as const)
      : []),
    ...(counts.conflictDateCount > 0
      ? (["OFFICIAL_BROKER_CALENDAR_RETURNED_DATE_CONFLICT"] as const)
      : [])
  ];
  if (!isDeepStrictEqual(value.issueCodes, expectedIssueCodes)) {
    issue(
      context,
      ["issueCodes"],
      "calendar coverage probe issue codes do not match results"
    );
  }

  validateCanonicalConflicts(value.returnedDateConflicts, context);
  validateVerifiedResultMetadata(value, context);
  validateUniqueResultArtifactHashes(value.results, context);
  validateConflictArtifactReferences(value, context);
  const verified =
    counts.verifiedDateCount === counts.plannedDateCount &&
    counts.conflictDateCount === 0;
  if (
    value.status !== (verified ? "verified" : "insufficient") ||
    value.coverageStatus !== (verified ? "verified" : "ambiguous") ||
    value.observedReplayEligibility !== (verified ? "eligible" : "rejected")
  ) {
    issue(
      context,
      ["status"],
      "calendar coverage probe status must fail closed for gaps or conflicts"
    );
  }
}

function validateVerifiedResultMetadata(
  value: {
    evaluatedAt: string;
    results: ProbeResult[];
  },
  context: z.RefinementCtx
): void {
  const evaluatedAt = Date.parse(value.evaluatedAt);
  for (const [index, result] of value.results.entries()) {
    if (result.status !== "verified") {
      continue;
    }
    const verified = verifiedProbeResultSchema.parse(result);
    if (
      evaluatedAt < Date.parse(verified.retrievedAt) ||
      evaluatedAt >= Date.parse(verified.staleAfter)
    ) {
      issue(
        context,
        ["results", index, "staleAfter"],
        "verified calendar coverage probe result must be fresh at evaluatedAt"
      );
    }
    if (
      Date.parse(verified.staleAfter) - Date.parse(verified.retrievedAt) !==
      OFFICIAL_BROKER_OBSERVED_CALENDAR_MAXIMUM_AGE_SECONDS * 1_000
    ) {
      issue(
        context,
        ["results", index, "staleAfter"],
        "verified calendar coverage probe stale time must match evidence freshness policy"
      );
    }
    if (
      verified.returnedDates[0] >= verified.returnedDates[1] ||
      verified.returnedDates[1] >= verified.returnedDates[2] ||
      verified.returnedDates[1] !== verified.requestedDate
    ) {
      issue(
        context,
        ["results", index, "returnedDates"],
        "verified calendar coverage probe returned dates must bind requested date"
      );
    }
    if (
      verified.returnedDateRange.startDate !== verified.returnedDates[0] ||
      verified.returnedDateRange.endDate !== verified.returnedDates[2]
    ) {
      issue(
        context,
        ["results", index, "returnedDateRange"],
        "verified calendar coverage probe returned date range mismatch"
      );
    }
    const range = verified.returnedSessionRange;
    if (
      (verified.returnedSessionCount === 0) !== (range === null) ||
      (range !== null && Date.parse(range.startAt) >= Date.parse(range.endAt))
    ) {
      issue(
        context,
        ["results", index, "returnedSessionRange"],
        "verified calendar coverage probe session count and range mismatch"
      );
    }
  }
}

function validateUniqueResultArtifactHashes(
  results: ProbeResult[],
  context: z.RefinementCtx
): void {
  const seen = new Set<string>();
  for (const [index, result] of results.entries()) {
    const hash = result.evidenceArtifactHash;
    if (hash === null) {
      continue;
    }
    if (seen.has(hash)) {
      issue(
        context,
        ["results", index, "evidenceArtifactHash"],
        "calendar coverage probe evidence artifact hashes must be unique across requested dates"
      );
    }
    seen.add(hash);
  }
}

function validateConflictArtifactReferences(
  value: {
    results: ProbeResult[];
    returnedDateConflicts: ReturnedDateConflict[];
  },
  context: z.RefinementCtx
): void {
  const resultHashes = new Set(
    value.results.flatMap(({ evidenceArtifactHash }) =>
      typeof evidenceArtifactHash === "string" ? [evidenceArtifactHash] : []
    )
  );
  for (const [conflictIndex, conflict] of
    value.returnedDateConflicts.entries()) {
    for (const [hashIndex, hash] of
      conflict.evidenceArtifactHashes.entries()) {
      if (!resultHashes.has(hash)) {
        issue(
          context,
          [
            "returnedDateConflicts",
            conflictIndex,
            "evidenceArtifactHashes",
            hashIndex
          ],
          "calendar coverage probe conflict hash must reference a result"
        );
      }
    }
  }
}

function validateCanonicalConflicts(
  conflicts: Array<{ marketDate: string; evidenceArtifactHashes: string[] }>,
  context: z.RefinementCtx
): void {
  const dates = conflicts.map(({ marketDate }) => marketDate);
  validateCanonicalUniqueStrings(dates, context, ["returnedDateConflicts"]);
}

function validateCanonicalUniqueStrings(
  values: string[],
  context: z.RefinementCtx,
  path: PropertyKey[]
): void {
  const canonical = [...new Set(values)].sort(compareText);
  if (!isDeepStrictEqual(values, canonical)) {
    issue(context, path, "values must be unique and use canonical order");
  }
}

function enumerateCalendarDates(startDate: string, endDate: string): string[] {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    throw new Error("calendar coverage probe date range is invalid");
  }
  const dayCount = Math.floor((end - start) / 86_400_000) + 1;
  if (dayCount > OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_MAXIMUM_DAYS) {
    throw new Error(
      `calendar coverage probe exceeds ${OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_MAXIMUM_DAYS} days`
    );
  }
  return Array.from({ length: dayCount }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10)
  );
}

function isValidCalendarDate(value: string): boolean {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function issue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
