import assert from "node:assert/strict";
import test from "node:test";

import {
  PAPER_SIMULATION_ID_PATTERN,
  paperSimulationObservationEventSchema,
  parsePaperSimulationObservation
} from "./paperSimulationObservation.js";

const simulationRunId = "paper_sim_20261002120000000_fixture";
const otherRunId = "paper_sim_20261002120000000_other";
const acceptedAt = "2026-10-02T12:00:00.000Z";
const observedAt = "2026-10-02T12:00:01.000Z";
const accepted = {
  schemaVersion: "paper_simulation_observation.v1",
  simulationRunId, batchId: simulationRunId, acceptedAt, event: "accepted"
};
const failed = { ...accepted, event: "runner_failed", observedAt, reasonCode: "runner_rejected" };
const jsonl = (...events: unknown[]) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";

test("accepted evidence has an unknown outcome and does not imply runner success", () => {
  assert.deepEqual(parsePaperSimulationObservation(jsonl(accepted), simulationRunId), {
    status: "available", schemaVersion: accepted.schemaVersion,
    simulationRunId, batchId: simulationRunId, acceptedAt,
    outcome: "unknown", runnerFailure: null
  });
});

test("a complete accepted then runner_failed log exposes only structured failure evidence", () => {
  assert.deepEqual(parsePaperSimulationObservation(jsonl(accepted, failed), simulationRunId), {
    status: "available", schemaVersion: accepted.schemaVersion,
    simulationRunId, batchId: simulationRunId, acceptedAt,
    outcome: "runner_failed", runnerFailure: { observedAt, reasonCode: "runner_rejected" }
  });
  assert.equal(parsePaperSimulationObservation(jsonl(accepted, { ...failed, observedAt: acceptedAt }), simulationRunId).status, "available");
});

const invalidLogs: [string, string][] = [
  ["empty file", ""],
  ["blank file", "\n"],
  ["torn acceptance", JSON.stringify(accepted)],
  ["torn failure", jsonl(accepted) + JSON.stringify(failed)],
  ["corrupt suffix", jsonl(accepted) + '{"event":\n'],
  ["corrupt prefix", "not-json\n" + jsonl(accepted)],
  ["blank prefix", "\n" + jsonl(accepted)],
  ["blank suffix", jsonl(accepted) + "\n"],
  ["blank middle", jsonl(accepted) + "\n" + jsonl(failed)],
  ["failure without acceptance", jsonl(failed)],
  ["failure before acceptance", jsonl(failed, accepted)],
  ["duplicate acceptance", jsonl(accepted, accepted)],
  ["duplicate failure", jsonl(accepted, failed, failed)],
  ["third record", jsonl(accepted, failed, accepted)],
  ["wrong requested identity", jsonl({ ...accepted, simulationRunId: otherRunId, batchId: otherRunId })],
  ["wrong acceptance batch identity", jsonl({ ...accepted, batchId: otherRunId })],
  ["wrong failure simulation identity", jsonl(accepted, { ...failed, simulationRunId: otherRunId, batchId: otherRunId })],
  ["wrong failure batch identity", jsonl(accepted, { ...failed, batchId: otherRunId })],
  ["changed acceptance time", jsonl(accepted, { ...failed, acceptedAt: "2026-10-02T11:59:59.000Z" })],
  ["backwards observation clock", jsonl(accepted, { ...failed, observedAt: "2026-10-02T11:59:59.999Z" })],
  ["invalid acceptance time", jsonl({ ...accepted, acceptedAt: "yesterday" })],
  ["invalid observation time", jsonl(accepted, { ...failed, observedAt: "2026-02-30T12:00:00.000Z" })],
  ["unknown schema", jsonl({ ...accepted, schemaVersion: "paper_simulation_observation.v2" })],
  ["unknown event", jsonl(accepted, { ...failed, event: "runner_succeeded" })],
  ["unknown reason", jsonl(accepted, { ...failed, reasonCode: "provider_credentials_invalid" })],
  ["extra acceptance field", jsonl({ ...accepted, observedAt })],
  ["raw runner error field", jsonl(accepted, { ...failed, error: "synthetic-private-error" })],
  ["raw runner stack field", jsonl(accepted, { ...failed, stack: "synthetic-private-stack" })],
  ["missing failure reason", jsonl(accepted, { ...failed, reasonCode: undefined })],
  ["null record", jsonl(accepted, null)],
  ["array record", jsonl([accepted])]
];

for (const [name, raw] of invalidLogs) {
  test(`whole observation log fails closed for ${name}`, () => {
    assert.deepEqual(parsePaperSimulationObservation(raw, simulationRunId), { status: "invalid", simulationRunId });
  });
}

test("observation identities reject traversal, alternate namespaces and malformed tokens", () => {
  for (const id of ["", "../escape", "/absolute", `${simulationRunId}/child`, `${simulationRunId}\\child`,
    "paper_sim_2026100212000000_short", "paper_sim_202610021200000000_long", "paper_sim_20261002120000000_",
    `paper_sim_20261002120000000_${"a".repeat(33)}`, "live_sim_20261002120000000_fixture", `${simulationRunId}\n`]) {
    assert.equal(PAPER_SIMULATION_ID_PATTERN.test(id), false, id);
    assert.equal(paperSimulationObservationEventSchema.safeParse({ ...accepted, simulationRunId: id, batchId: id }).success, false, id);
  }
  assert.equal(paperSimulationObservationEventSchema.safeParse(accepted).success, true);
  assert.equal(paperSimulationObservationEventSchema.safeParse(failed).success, true);
});
