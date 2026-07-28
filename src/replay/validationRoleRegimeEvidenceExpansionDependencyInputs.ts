import {
  buildEvidenceExpansionDependencyCandidateEvidence,
  type EvidenceExpansionDependencyCandidateIntervalInput
} from "./validationRoleRegimeEvidenceExpansionDependencyCandidateInterval.js";
import {
  buildEvidenceExpansionPairwiseDependencyFromEvidence
} from "./validationRoleRegimeEvidenceExpansionPairwiseDependency.js";
import {
  compareEvidenceExpansionDependencyCandidateIntervals,
  evidenceExpansionCompleteDependencyInputsSchema,
  type EvidenceExpansionDependencyInputs
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

export interface EvidenceExpansionDependencyInputsInput {
  groups: EvidenceExpansionDependencyCandidateIntervalInput["group"][];
  source: EvidenceExpansionDependencyCandidateIntervalInput["source"];
  calendarClassifier:
    EvidenceExpansionDependencyCandidateIntervalInput["calendarClassifier"];
}

export function buildEvidenceExpansionDependencyInputs(
  input: EvidenceExpansionDependencyInputsInput
): EvidenceExpansionDependencyInputs {
  const officialCalendarArtifact =
    input.calendarClassifier.officialCalendarArtifact;
  if (officialCalendarArtifact === null) {
    throw new Error(
      "dependency inputs require official calendar evidence"
    );
  }
  const evidenceByHash = new Map<
    string,
    ReturnType<typeof buildEvidenceExpansionDependencyCandidateEvidence>
  >();
  for (const group of input.groups) {
    const evidence = buildEvidenceExpansionDependencyCandidateEvidence({
      group,
      source: input.source,
      calendarClassifier: input.calendarClassifier
    });
    if (evidenceByHash.has(evidence.interval.evidenceGroupHash)) {
      throw new Error(
        "dependency inputs require unique evidence groups"
      );
    }
    evidenceByHash.set(evidence.interval.evidenceGroupHash, evidence);
  }

  const evidenceByCandidateOrder = [...evidenceByHash.values()].sort(
    (left, right) =>
      compareEvidenceExpansionDependencyCandidateIntervals(
        left.interval,
        right.interval
      )
  );
  const evidenceByHashOrder = [...evidenceByHash.values()].sort(
    (left, right) =>
      left.interval.evidenceGroupHash.localeCompare(
        right.interval.evidenceGroupHash
      )
  );
  const pairwise = [];
  for (
    let leftIndex = 0;
    leftIndex < evidenceByHashOrder.length;
    leftIndex += 1
  ) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < evidenceByHashOrder.length;
      rightIndex += 1
    ) {
      pairwise.push(
        buildEvidenceExpansionPairwiseDependencyFromEvidence({
          left: evidenceByHashOrder[leftIndex]!,
          right: evidenceByHashOrder[rightIndex]!
        })
      );
    }
  }

  return evidenceExpansionCompleteDependencyInputsSchema.parse({
    candidateIntervals: evidenceByCandidateOrder.map(
      (evidence) => evidence.interval
    ),
    pairwise
  });
}
