import { z } from "zod";

import {
  isoDateTimeSchema,
  sha256HashSchema,
  strategyBucketSchema,
  type StrategyBucket
} from "../domain/schemas.js";
import { safeArtifactPathPart } from "../storage/artifactPaths.js";
import { JsonlStore } from "../storage/jsonlStore.js";
import { FileAuditLog, createStoragePaths } from "../storage/repositories.js";
import type { LocalOperationsServerOptions } from "./localOperationsTypes.js";
import {
  StrategyBucketTestValidationRequestError,
  parseStrategyBucketTestValidationCandidate,
  validateStrategyBucketTestCandidate,
  type StrategyBucketTestValidationCandidate,
  type StrategyBucketTestValidationIssue
} from "./strategyBucketTestValidation.js";

export const STRATEGY_BUCKET_TEST_CREATE_ROUTE =
  "/paper/simulations/strategy-bucket-tests";
export const STRATEGY_BUCKET_TEST_CREATE_OPERATION =
  "paper-strategy-bucket-test-create";
export const STRATEGY_BUCKET_TEST_CREATE_HEADER_NAME =
  "x-toss-trading-operation";

export type StrategyBucketTestStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

const strategyBucketTestProgressSchema = z
  .object({
    phase: z.literal("queued"),
    progressRatio: z.null(),
    completedPacketCount: z.literal(0),
    totalPacketCount: z.null(),
    decisionCount: z.literal(0),
    riskApprovedCount: z.literal(0),
    riskRejectedCount: z.literal(0),
    simulatedTradeCount: z.literal(0),
    providerFailureCount: z.literal(0),
    latestMessage: z.string(),
    latestAuditEventRef: z.string().min(1).nullable(),
    updatedAt: isoDateTimeSchema
  })
  .strict();

const strategyBucketTestRecordSchema = z
  .object({
    mode: z.literal("paper_only"),
    recordType: z.literal("strategy_bucket_test_record"),
    testId: z.string().min(1),
    requestId: z.string().min(1).max(120).nullable(),
    bucket: strategyBucketSchema,
    status: z.literal("queued"),
    createdAt: isoDateTimeSchema,
    startedAt: z.null(),
    completedAt: z.null(),
    runId: z.null(),
    policyId: z.string().min(1),
    policyHash: z.string().min(1),
    configHash: sha256HashSchema,
    sourceDataDir: z.string().min(1),
    validationSplitRole: z.enum(["train", "validation", "test"]),
    decisionProviderMode: z.enum(["dry_run_fixture", "codex_paper_only"]),
    progress: strategyBucketTestProgressSchema,
    heartbeat: z
      .object({
        status: z.literal("fresh"),
        lastSeenAt: isoDateTimeSchema,
        staleAfterSeconds: z.number().int().positive()
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

export type StrategyBucketTestRecord = z.infer<
  typeof strategyBucketTestRecordSchema
>;

export interface StrategyBucketTestCreateResponse {
  mode: "paper_only";
  mutation: "strategy_bucket_test_create";
  status: "queued";
  testId: string;
  bucket: StrategyBucket;
  configHash: string;
  recordPath: string;
  storageMutationEnabled: true;
  liveTradingEnabled: false;
  orderPlacementEnabled: false;
  replayRunnerStarted: false;
  disclaimer: string;
}

export class StrategyBucketTestCreateRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly issues?: StrategyBucketTestValidationIssue[]
  ) {
    super(message);
  }
}

export async function createStrategyBucketTestRun(
  body: unknown,
  options: LocalOperationsServerOptions
): Promise<StrategyBucketTestCreateResponse> {
  const createdAt = options.now?.() ?? new Date();
  const candidate = parseCreateCandidate(body);
  const validation = validateStrategyBucketTestCandidate(
    candidate,
    createdAt,
    options.env ?? process.env
  );
  if (!validation.validatedForStrategyBucketTestConfig) {
    throw new StrategyBucketTestCreateRequestError(
      "strategy bucket test config must pass validation before a test record can be created",
      400,
      "invalid_strategy_bucket_test_config",
      validation.issues
    );
  }

  const paths = createStoragePaths(options.storageBaseDir);
  const testId = strategyBucketTestIdFor(candidate, createdAt);
  const auditEventId = `audit_${testId}_queued`;
  const record: StrategyBucketTestRecord = {
    mode: "paper_only",
    recordType: "strategy_bucket_test_record",
    testId,
    requestId: candidate.requestId ?? null,
    bucket: candidate.bucket,
    status: "queued",
    createdAt: createdAt.toISOString(),
    startedAt: null,
    completedAt: null,
    runId: null,
    policyId: validation.policyId,
    policyHash: validation.policyHash,
    configHash: validation.configHash,
    sourceDataDir: candidate.testConfig.sourceDataDir,
    validationSplitRole: candidate.testConfig.validationSplitRole,
    decisionProviderMode: candidate.testConfig.decisionProvider.mode,
    progress: {
      phase: "queued",
      progressRatio: null,
      completedPacketCount: 0,
      totalPacketCount: null,
      decisionCount: 0,
      riskApprovedCount: 0,
      riskRejectedCount: 0,
      simulatedTradeCount: 0,
      providerFailureCount: 0,
      latestMessage: "Strategy bucket test record queued; replay runner not started.",
      latestAuditEventRef: auditEventId,
      updatedAt: createdAt.toISOString()
    },
    heartbeat: {
      status: "fresh",
      lastSeenAt: createdAt.toISOString(),
      staleAfterSeconds: 120
    },
    safety: {
      storageMutationEnabled: true,
      liveTradingEnabled: false,
      orderPlacementEnabled: false,
      replayRunnerStarted: false
    }
  };

  await new JsonlStore(
    paths.strategyBucketTestRecordsPath,
    strategyBucketTestRecordSchema,
    "strategyBucketTestRecord"
  ).append(record);
  await new FileAuditLog(paths.auditLogPath).append({
    eventId: auditEventId,
    eventType: "STRATEGY_BUCKET_TEST_QUEUED",
    actor: "system",
    summary: `${candidate.bucket} strategy bucket test ${testId} queued with config ${validation.configHash}; replay runner not started.`,
    maskedRefs: [validation.configHash],
    createdAt: createdAt.toISOString()
  });

  return {
    mode: "paper_only",
    mutation: "strategy_bucket_test_create",
    status: "queued",
    testId,
    bucket: candidate.bucket,
    configHash: validation.configHash,
    recordPath: paths.strategyBucketTestRecordsPath,
    storageMutationEnabled: true,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false,
    disclaimer:
      "Paper-only strategy bucket test record queued. This cannot place live orders and does not start a replay runner in this step."
  };
}

function parseCreateCandidate(
  body: unknown
): StrategyBucketTestValidationCandidate {
  try {
    return parseStrategyBucketTestValidationCandidate(body);
  } catch (error) {
    if (error instanceof StrategyBucketTestValidationRequestError) {
      throw new StrategyBucketTestCreateRequestError(
        error.message,
        error.statusCode,
        error.code
      );
    }
    throw error;
  }
}

function strategyBucketTestIdFor(
  candidate: StrategyBucketTestValidationCandidate,
  createdAt: Date
): string {
  const timestamp = createdAt
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 17);
  const requestPart = safeArtifactPathPart(
    candidate.requestId ?? candidate.testConfig.window.seed,
    "request"
  ).slice(0, 48);
  return safeArtifactPathPart(
    `strategy_bucket_test_${timestamp}_${candidate.bucket}_${requestPart}`,
    "strategy_bucket_test"
  );
}
