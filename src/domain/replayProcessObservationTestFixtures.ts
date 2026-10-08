import { admissionMappingFixture } from "./replayAdmissionTestFixtures.js";
import { createReplayAdmissionLineage } from "./replayAdmissionMapping.js";
import { durableAdmissionLineageReference } from "./replayAdmissionLineage.js";
import { createReplayProcessObservation, type ReplayProcessObservationEvidence } from "./replayProcessObservation.js";

/** Data-only fixture: deliberately incapable of issuing an actual runner process context. */
export function processObservationFixture() {
  const fixture = admissionMappingFixture();
  const b = createReplayAdmissionLineage(fixture.evidence, fixture.actual, fixture.initial, fixture.settings);
  const admission = durableAdmissionLineageReference(b);
  const evidence: ReplayProcessObservationEvidence = {
    binding: { identity: { ...b.identity }, startedAt: b.startedAt },
    process: { status: "recorded", nodeVersion: "v24.19.0", platform: "linux", architecture: "x64",
      costModelVersion: "paper_cost_model.v5", executionModelVersion: "execution_simulator.v4" }
  };
  return { ...fixture, b, admission, processEvidence: evidence, record: createReplayProcessObservation({ admission, evidence }) };
}
