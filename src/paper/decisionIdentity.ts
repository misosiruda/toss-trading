import type { VirtualDecision } from "../domain/schemas.js";

export const VIRTUAL_DECISION_SCHEMA_VERSION =
  "virtual-decision.schema.v1";
export const VIRTUAL_RISK_POLICY_VERSION = "paper-risk-policy.v1";
export const DEFAULT_CODEX_MODEL_ID = "codex-cli-unspecified";
export const STATIC_DECISION_PROMPT_VERSION = "static-fixture-v1";
export const STATIC_DECISION_MODEL_ID = "static-decision-provider";

export const VIRTUAL_DECISION_IDENTITY_FIELDS = [
  "promptVersion",
  "modelId",
  "schemaVersion",
  "policyVersion"
] as const;

export type VirtualDecisionIdentityField =
  (typeof VIRTUAL_DECISION_IDENTITY_FIELDS)[number];

export interface VirtualDecisionIdentityMetadata {
  promptVersion: string;
  modelId: string;
  schemaVersion: string;
  policyVersion: string;
}

export function createDecisionIdentityMetadata(input: {
  promptVersion: string;
  modelId?: string;
  schemaVersion?: string;
  policyVersion?: string;
}): VirtualDecisionIdentityMetadata {
  return {
    promptVersion: input.promptVersion,
    modelId: input.modelId ?? DEFAULT_CODEX_MODEL_ID,
    schemaVersion: input.schemaVersion ?? VIRTUAL_DECISION_SCHEMA_VERSION,
    policyVersion: input.policyVersion ?? VIRTUAL_RISK_POLICY_VERSION
  };
}

export function createStaticDecisionIdentityMetadata(): VirtualDecisionIdentityMetadata {
  return createDecisionIdentityMetadata({
    promptVersion: STATIC_DECISION_PROMPT_VERSION,
    modelId: STATIC_DECISION_MODEL_ID
  });
}

export function bindDecisionIdentityMetadata(
  decision: VirtualDecision,
  metadata: VirtualDecisionIdentityMetadata
): VirtualDecision {
  return {
    ...decision,
    promptVersion: decision.promptVersion ?? metadata.promptVersion,
    modelId: decision.modelId ?? metadata.modelId,
    schemaVersion: decision.schemaVersion ?? metadata.schemaVersion,
    policyVersion: decision.policyVersion ?? metadata.policyVersion
  };
}

export function missingDecisionIdentityFields(
  decision: VirtualDecision
): VirtualDecisionIdentityField[] {
  return VIRTUAL_DECISION_IDENTITY_FIELDS.filter((field) => !decision[field]);
}
