import { z } from "zod";

export const PAPER_SIMULATION_ID_PATTERN = /^paper_sim_[0-9]{17}_[A-Za-z0-9_-]{1,32}(?![\s\S])/;
const identity = {
  schemaVersion: z.literal("paper_simulation_observation.v1"),
  simulationRunId: z.string().regex(PAPER_SIMULATION_ID_PATTERN),
  batchId: z.string().regex(PAPER_SIMULATION_ID_PATTERN),
  acceptedAt: z.iso.datetime()
};

export const paperSimulationObservationEventSchema = z.discriminatedUnion("event", [
  z.object({ ...identity, event: z.literal("accepted"), canonicalRequestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional() }).strict(),
  z.object({
    ...identity,
    event: z.literal("runner_failed"),
    observedAt: z.iso.datetime(),
    reasonCode: z.literal("runner_rejected")
  }).strict()
]).refine((event) => event.simulationRunId === event.batchId, "simulation identity mismatch");

export type PaperSimulationObservationEvent = z.infer<typeof paperSimulationObservationEventSchema>;
export type PaperSimulationObservation = {
  status: "available";
  schemaVersion: "paper_simulation_observation.v1";
  simulationRunId: string;
  batchId: string;
  acceptedAt: string;
  outcome: "unknown" | "runner_failed";
  runnerFailure: { observedAt: string; reasonCode: "runner_rejected" } | null;
} | {
  status: "missing" | "invalid" | "unavailable";
  simulationRunId: string;
};

/** The whole log is evidence: never salvage a valid prefix or skip a bad line. */
export function parsePaperSimulationObservation(raw: string, simulationRunId: string): PaperSimulationObservation {
  const invalid = { status: "invalid" as const, simulationRunId };
  if (!raw.endsWith("\n")) return invalid;
  const lines = raw.slice(0, -1).split("\n");
  if (lines.length < 1 || lines.length > 2) return invalid;
  try {
    const events = lines.map((line) => paperSimulationObservationEventSchema.parse(JSON.parse(line)));
    const accepted = events[0]!;
    if (accepted.event !== "accepted" || accepted.simulationRunId !== simulationRunId) return invalid;
    const failed = events[1];
    if (failed && (failed.event !== "runner_failed" || failed.simulationRunId !== simulationRunId ||
      failed.acceptedAt !== accepted.acceptedAt || Date.parse(failed.observedAt) < Date.parse(accepted.acceptedAt))) return invalid;
    return {
      status: "available", schemaVersion: accepted.schemaVersion,
      simulationRunId, batchId: accepted.batchId, acceptedAt: accepted.acceptedAt,
      outcome: failed ? "runner_failed" : "unknown",
      runnerFailure: failed?.event === "runner_failed"
        ? { observedAt: failed.observedAt, reasonCode: failed.reasonCode } : null
    };
  } catch { return invalid; }
}
