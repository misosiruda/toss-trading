import {
  deriveEvidenceExpansionPreflightStatus,
  type EvidenceExpansionPreflightStatus
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  buildEvidenceExpansionPreflightCoreState,
  type EvidenceExpansionPreflightCoreState,
  type EvidenceExpansionPreflightCoreStateInput
} from "./validationRoleRegimeEvidenceExpansionPreflightCoreState.js";

export interface EvidenceExpansionPreflightStatusState
  extends EvidenceExpansionPreflightCoreState {
  status: EvidenceExpansionPreflightStatus;
}

export function buildEvidenceExpansionPreflightStatusState(
  input: EvidenceExpansionPreflightCoreStateInput
): EvidenceExpansionPreflightStatusState {
  const coreState = buildEvidenceExpansionPreflightCoreState(input);

  return {
    ...coreState,
    status: deriveEvidenceExpansionPreflightStatus(coreState.blockers)
  };
}
