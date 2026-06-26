import { z } from "zod";

import { isoDateTimeSchema } from "../domain/schemas.js";
import { safeArtifactPathPart } from "../storage/artifactPaths.js";
import { JsonlStore } from "../storage/jsonlStore.js";
import { FileAuditLog, createStoragePaths } from "../storage/repositories.js";
import type { LocalOperationsServerOptions } from "./localOperationsTypes.js";
import {
  PaperPolicyValidationRequestError,
  paperPolicyValidationCandidateSchema,
  parsePaperPolicyValidationCandidate,
  validatePaperPolicyCandidate,
  type PaperPolicyValidationCandidate,
  type PaperPolicyValidationIssue
} from "./paperPolicyValidation.js";

export const PAPER_POLICY_CREATE_ROUTE = "/paper/policies";
export const PAPER_POLICY_CREATE_OPERATION = "paper-policy-create";
export const PAPER_POLICY_CREATE_HEADER_NAME = "x-toss-trading-operation";

const paperPolicyValidationSummarySchema = z
  .object({
    bucketTargetWeightRatio: z.number(),
    cashTargetRatio: z.number(),
    totalAllocationRatio: z.number(),
    enabledBucketCount: z.number().int().nonnegative(),
    hedgeEnabled: z.boolean(),
    backendValidationRequired: z.literal(true)
  })
  .strict();

const paperPolicyRecordSchema = z
  .object({
    mode: z.literal("paper_only"),
    recordType: z.literal("portfolio_policy_record"),
    policyRecordId: z.string().min(1),
    policyId: z.string().min(1),
    version: z.string().min(1),
    name: z.string().min(1),
    policyHash: z.string().min(1),
    status: z.literal("stored"),
    createdAt: isoDateTimeSchema,
    validationStatus: z.literal("valid"),
    candidate: paperPolicyValidationCandidateSchema,
    validation: z
      .object({
        validatedAt: isoDateTimeSchema,
        issueCount: z.literal(0),
        summary: paperPolicyValidationSummarySchema
      })
      .strict(),
    safety: z
      .object({
        storageMutationEnabled: z.literal(true),
        liveTradingEnabled: z.literal(false),
        orderPlacementEnabled: z.literal(false),
        replayRunnerStarted: z.literal(false)
      })
      .strict()
  })
  .strict();

export type PaperPolicyRecord = z.infer<typeof paperPolicyRecordSchema>;

export interface PaperPolicyCreateResponse {
  mode: "paper_only";
  mutation: "paper_policy_create";
  status: "stored";
  policyRecordId: string;
  policyId: string;
  version: string;
  policyHash: string;
  recordPath: string;
  storageMutationEnabled: true;
  liveTradingEnabled: false;
  orderPlacementEnabled: false;
  replayRunnerStarted: false;
  disclaimer: string;
}

export class PaperPolicyCreateRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly issues?: PaperPolicyValidationIssue[]
  ) {
    super(message);
  }
}

export async function createPaperPolicyRecord(
  body: unknown,
  options: LocalOperationsServerOptions
): Promise<PaperPolicyCreateResponse> {
  const createdAt = options.now?.() ?? new Date();
  const candidate = parseCreateCandidate(body);
  const validation = validatePaperPolicyCandidate(candidate, createdAt);
  if (!validation.validatedForPaperSimulationConfig) {
    throw new PaperPolicyCreateRequestError(
      "paper policy must pass backend validation before it can be stored",
      400,
      "invalid_paper_policy",
      validation.issues
    );
  }

  const paths = createStoragePaths(options.storageBaseDir);
  const policyRecordId = policyRecordIdFor(candidate, createdAt);
  const auditEventId = `audit_${policyRecordId}_stored`;
  const record: PaperPolicyRecord = {
    mode: "paper_only",
    recordType: "portfolio_policy_record",
    policyRecordId,
    policyId: validation.policyId,
    version: validation.version,
    name: candidate.name,
    policyHash: validation.policyHash,
    status: "stored",
    createdAt: createdAt.toISOString(),
    validationStatus: "valid",
    candidate,
    validation: {
      validatedAt: validation.validatedAt,
      issueCount: 0,
      summary: validation.summary
    },
    safety: {
      storageMutationEnabled: true,
      liveTradingEnabled: false,
      orderPlacementEnabled: false,
      replayRunnerStarted: false
    }
  };

  await new JsonlStore(
    paths.portfolioPolicyRecordsPath,
    paperPolicyRecordSchema,
    "portfolioPolicyRecord"
  ).append(record);
  await new FileAuditLog(paths.auditLogPath).append({
    eventId: auditEventId,
    eventType: "PAPER_POLICY_STORED",
    actor: "system",
    summary: `Paper policy ${validation.policyId} stored with hash ${validation.policyHash}; replay runner not started.`,
    maskedRefs: [validation.policyHash],
    createdAt: createdAt.toISOString()
  });

  return {
    mode: "paper_only",
    mutation: "paper_policy_create",
    status: "stored",
    policyRecordId,
    policyId: validation.policyId,
    version: validation.version,
    policyHash: validation.policyHash,
    recordPath: paths.portfolioPolicyRecordsPath,
    storageMutationEnabled: true,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false,
    disclaimer:
      "Paper-only policy artifact stored. This cannot place live orders and does not start a replay runner in this step."
  };
}

function parseCreateCandidate(body: unknown): PaperPolicyValidationCandidate {
  try {
    return parsePaperPolicyValidationCandidate(body);
  } catch (error) {
    if (error instanceof PaperPolicyValidationRequestError) {
      throw new PaperPolicyCreateRequestError(
        error.message,
        error.statusCode,
        error.code
      );
    }
    throw error;
  }
}

function policyRecordIdFor(
  candidate: PaperPolicyValidationCandidate,
  createdAt: Date
): string {
  const timestamp = createdAt
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 17);
  const policyPart = safeArtifactPathPart(candidate.policyId, "policy").slice(
    0,
    48
  );
  return safeArtifactPathPart(
    `portfolio_policy_${timestamp}_${policyPart}`,
    "portfolio_policy"
  );
}
