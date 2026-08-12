import { z } from "zod";

export const CALENDAR_SOURCE_EVIDENCE_CLASSES = [
  "official_broker_observed",
  "official_exchange"
] as const;

export const calendarSourceEvidenceClassSchema = z.enum(
  CALENDAR_SOURCE_EVIDENCE_CLASSES
);

export const REPLAY_CALENDAR_EVIDENCE_CLASS =
  "observed_session_only" as const;

export const replayCalendarEvidenceClassSchema = z.literal(
  REPLAY_CALENDAR_EVIDENCE_CLASS
);

export const BROKER_OBSERVED_CALENDAR_EVIDENCE_TRANSITION_SCHEMA_VERSION =
  "broker_observed_calendar_evidence_transition.v1";

export const brokerObservedCalendarEvidenceTransitionRejectionCodeSchema =
  z.enum([
    "OFFICIAL_BROKER_CALENDAR_UNSUPPORTED_DATE",
    "OFFICIAL_BROKER_CALENDAR_PARTIAL_RESPONSE",
    "OFFICIAL_BROKER_CALENDAR_SCHEMA_MISMATCH",
    "OFFICIAL_BROKER_CALENDAR_PROVENANCE_MISSING",
    "OFFICIAL_BROKER_CALENDAR_SOURCE_STALE",
    "OFFICIAL_BROKER_CALENDAR_COVERAGE_AMBIGUOUS"
  ]);

export const brokerObservedCalendarEvidenceTransitionInputSchema = z
  .object({
    schemaVersion: z.literal(
      BROKER_OBSERVED_CALENDAR_EVIDENCE_TRANSITION_SCHEMA_VERSION
    ),
    mode: z.literal("paper_only"),
    sourceEvidenceClass: z.literal("official_broker_observed"),
    requestedDateStatus: z.enum(["supported", "unsupported"]),
    responseCompleteness: z.enum(["complete", "partial"]),
    responseSchemaStatus: z.enum(["verified", "mismatch"]),
    provenanceStatus: z.enum(["verified", "missing"]),
    freshnessStatus: z.enum(["fresh", "stale"]),
    coverageStatus: z.enum(["verified", "ambiguous"])
  })
  .strict();

const brokerObservedCalendarEvidenceTransitionResultBase = {
  schemaVersion: z.literal(
    BROKER_OBSERVED_CALENDAR_EVIDENCE_TRANSITION_SCHEMA_VERSION
  ),
  mode: z.literal("paper_only"),
  sourceEvidenceClass: z.literal("official_broker_observed"),
  historicalCompletenessClaim: z.literal("not_claimed")
};

export const brokerObservedCalendarEvidenceTransitionResultSchema =
  z.discriminatedUnion("status", [
    z
      .object({
        ...brokerObservedCalendarEvidenceTransitionResultBase,
        status: z.literal("eligible"),
        replayEvidenceClass: replayCalendarEvidenceClassSchema,
        rejectionCode: z.null()
      })
      .strict(),
    z
      .object({
        ...brokerObservedCalendarEvidenceTransitionResultBase,
        status: z.literal("rejected"),
        replayEvidenceClass: z.null(),
        rejectionCode:
          brokerObservedCalendarEvidenceTransitionRejectionCodeSchema
      })
      .strict()
  ]);

export type CalendarSourceEvidenceClass = z.infer<
  typeof calendarSourceEvidenceClassSchema
>;
export type ReplayCalendarEvidenceClass = z.infer<
  typeof replayCalendarEvidenceClassSchema
>;
export type BrokerObservedCalendarEvidenceTransitionInput = z.infer<
  typeof brokerObservedCalendarEvidenceTransitionInputSchema
>;
export type BrokerObservedCalendarEvidenceTransitionRejectionCode = z.infer<
  typeof brokerObservedCalendarEvidenceTransitionRejectionCodeSchema
>;
export type BrokerObservedCalendarEvidenceTransitionResult = z.infer<
  typeof brokerObservedCalendarEvidenceTransitionResultSchema
>;

export function evaluateBrokerObservedCalendarEvidenceTransition(
  value: unknown
): BrokerObservedCalendarEvidenceTransitionResult {
  const input =
    brokerObservedCalendarEvidenceTransitionInputSchema.parse(value);
  const rejectionCode = transitionRejectionCode(input);

  return brokerObservedCalendarEvidenceTransitionResultSchema.parse({
    schemaVersion:
      BROKER_OBSERVED_CALENDAR_EVIDENCE_TRANSITION_SCHEMA_VERSION,
    mode: "paper_only",
    sourceEvidenceClass: "official_broker_observed",
    historicalCompletenessClaim: "not_claimed",
    status: rejectionCode === null ? "eligible" : "rejected",
    replayEvidenceClass:
      rejectionCode === null ? REPLAY_CALENDAR_EVIDENCE_CLASS : null,
    rejectionCode
  });
}

function transitionRejectionCode(
  input: BrokerObservedCalendarEvidenceTransitionInput
): BrokerObservedCalendarEvidenceTransitionRejectionCode | null {
  if (input.requestedDateStatus === "unsupported") {
    return "OFFICIAL_BROKER_CALENDAR_UNSUPPORTED_DATE";
  }
  if (input.responseCompleteness === "partial") {
    return "OFFICIAL_BROKER_CALENDAR_PARTIAL_RESPONSE";
  }
  if (input.responseSchemaStatus === "mismatch") {
    return "OFFICIAL_BROKER_CALENDAR_SCHEMA_MISMATCH";
  }
  if (input.provenanceStatus === "missing") {
    return "OFFICIAL_BROKER_CALENDAR_PROVENANCE_MISSING";
  }
  if (input.freshnessStatus === "stale") {
    return "OFFICIAL_BROKER_CALENDAR_SOURCE_STALE";
  }
  if (input.coverageStatus === "ambiguous") {
    return "OFFICIAL_BROKER_CALENDAR_COVERAGE_AMBIGUOUS";
  }
  return null;
}
