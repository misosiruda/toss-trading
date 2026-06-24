import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

import { strategyBucketSchema, type StrategyBucket } from "../domain/schemas.js";
import {
  parsePaperPolicyValidationCandidate,
  PaperPolicyValidationRequestError,
  validatePaperPolicyCandidate,
  type PaperPolicyValidationCandidate
} from "./paperPolicyValidation.js";

export const STRATEGY_BUCKET_TEST_VALIDATION_ROUTE =
  "/paper/simulations/strategy-bucket-tests/validate";
export const STRATEGY_BUCKET_TEST_VALIDATION_OPERATION =
  "paper-strategy-bucket-test-validate";
export const STRATEGY_BUCKET_TEST_VALIDATION_HEADER_NAME =
  "x-toss-trading-operation";

const MAX_DECISION_CALLS = 100;
const MAX_CODEX_CALLS_PER_RUN = 31;

const strategyBucketTestValidationCandidateSchema = z
  .object({
    mode: z.literal("paper_only"),
    requestId: z.string().min(1).max(120).optional(),
    bucket: strategyBucketSchema,
    policy: z.unknown(),
    testConfig: z
      .object({
        sourceDataDir: z.string().min(1).max(240),
        universe: z
          .object({
            preset: z.string().min(1).max(80),
            market: z.enum(["mixed_global", "kr", "us"])
          })
          .strict(),
        validationSplitRole: z.enum(["train", "validation", "test"]),
        window: z
          .object({
            seed: z.string().min(1).max(120),
            startAt: z.string().min(1).max(80),
            endAt: z.string().min(1).max(80),
            windowMonths: z.number().int().min(1).max(12)
          })
          .strict(),
        samplingPolicy: z
          .object({
            decisionFrequency: z.enum([
              "every_tick",
              "once_per_day",
              "once_per_week"
            ]),
            stepSeconds: z.number().int().min(60).max(2_592_000),
            maxDecisionCalls: z.number().int().min(1).max(MAX_DECISION_CALLS),
            maxCodexCallsPerRun: z
              .number()
              .int()
              .min(0)
              .max(MAX_CODEX_CALLS_PER_RUN)
          })
          .strict(),
        capital: z
          .object({
            initialCashKrw: z.number().int().min(100_000).max(10_000_000_000)
          })
          .strict(),
        decisionProvider: z
          .object({
            mode: z.enum(["dry_run_fixture", "codex_paper_only"]),
            modelId: z.string().min(1).max(120),
            outputSchema: z.literal("schemas/virtual-decision.schema.json")
          })
          .strict()
      })
      .strict()
  })
  .strict();

export type StrategyBucketTestValidationCandidate = z.infer<
  typeof strategyBucketTestValidationCandidateSchema
>;

export interface StrategyBucketTestValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: "error";
}

export interface StrategyBucketTestValidationResponse {
  mode: "paper_only";
  validation: "strategy_bucket_test";
  readOnly: true;
  storageMutationEnabled: false;
  liveTradingEnabled: false;
  orderPlacementEnabled: false;
  replayRunnerStarted: false;
  status: "valid" | "invalid";
  validatedForStrategyBucketTestConfig: boolean;
  bucket: StrategyBucket;
  policyId: string;
  policyHash: string;
  configHash: string;
  issueCount: number;
  issues: StrategyBucketTestValidationIssue[];
  summary: {
    sourceDataDir: string;
    market: "mixed_global" | "kr" | "us";
    validationSplitRole: "train" | "validation" | "test";
    bucketTargetWeightRatio: number;
    decisionFrequency: "every_tick" | "once_per_day" | "once_per_week";
    backendValidationRequired: true;
  };
  validatedAt: string;
}

export class StrategyBucketTestValidationRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string
  ) {
    super(message);
  }
}

export function parseStrategyBucketTestValidationCandidate(
  value: unknown
): StrategyBucketTestValidationCandidate {
  const result = strategyBucketTestValidationCandidateSchema.safeParse(value);
  if (!result.success) {
    throw new StrategyBucketTestValidationRequestError(
      formatSchemaIssues(result.error.issues),
      400,
      "invalid_strategy_bucket_test_candidate"
    );
  }
  return result.data;
}

export function validateStrategyBucketTestCandidate(
  value: unknown,
  validatedAt = new Date()
): StrategyBucketTestValidationResponse {
  const candidate = parseStrategyBucketTestValidationCandidate(value);
  const policy = parsePolicyCandidate(candidate.policy);
  const policyValidation = validatePaperPolicyCandidate(policy, validatedAt);
  const issues: StrategyBucketTestValidationIssue[] = [];

  if (policyValidation.status !== "valid") {
    issues.push({
      code: "POLICY_INVALID",
      path: "policy",
      message:
        "Policy candidate must pass backend policy validation before isolated bucket test validation.",
      severity: "error"
    });
  }

  validateTestConfig(candidate, policy, issues);

  const bucketPolicy = policy.strategyBuckets.find(
    (bucket) => bucket.bucket === candidate.bucket
  );
  const bucketTargetWeightRatio = bucketPolicy?.targetWeightRatio ?? 0;
  const status = issues.length === 0 ? "valid" : "invalid";

  return {
    mode: "paper_only",
    validation: "strategy_bucket_test",
    readOnly: true,
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false,
    status,
    validatedForStrategyBucketTestConfig: status === "valid",
    bucket: candidate.bucket,
    policyId: policy.policyId,
    policyHash: policyValidation.policyHash,
    configHash: configHash(candidate),
    issueCount: issues.length,
    issues,
    summary: {
      sourceDataDir: candidate.testConfig.sourceDataDir,
      market: candidate.testConfig.universe.market,
      validationSplitRole: candidate.testConfig.validationSplitRole,
      bucketTargetWeightRatio,
      decisionFrequency: candidate.testConfig.samplingPolicy.decisionFrequency,
      backendValidationRequired: true
    },
    validatedAt: validatedAt.toISOString()
  };
}

function parsePolicyCandidate(value: unknown): PaperPolicyValidationCandidate {
  try {
    return parsePaperPolicyValidationCandidate(value);
  } catch (error) {
    if (error instanceof PaperPolicyValidationRequestError) {
      throw new StrategyBucketTestValidationRequestError(
        error.message,
        error.statusCode,
        "invalid_policy_candidate"
      );
    }
    throw error;
  }
}

function validateTestConfig(
  candidate: StrategyBucketTestValidationCandidate,
  policy: PaperPolicyValidationCandidate,
  issues: StrategyBucketTestValidationIssue[]
): void {
  validateSafeDataDir(candidate.testConfig.sourceDataDir, issues);
  validateWindow(candidate, issues);
  validateDecisionProvider(candidate, issues);
  validateSelectedBucket(candidate, policy, issues);
}

function validateSafeDataDir(
  value: string,
  issues: StrategyBucketTestValidationIssue[]
): void {
  if (isAbsolute(value) || value.includes("\0")) {
    issues.push({
      code: "INVALID_SOURCE_DATA_DIR",
      path: "testConfig.sourceDataDir",
      message: "sourceDataDir must be a relative data path.",
      severity: "error"
    });
    return;
  }

  const cwd = resolve(process.cwd());
  const dataRoot = resolve(cwd, "data");
  const target = resolve(cwd, value);
  const path = relative(dataRoot, target);
  if (path === "" || (!!path && !path.startsWith("..") && !isAbsolute(path))) {
    return;
  }

  issues.push({
    code: "INVALID_SOURCE_DATA_DIR",
    path: "testConfig.sourceDataDir",
    message: "sourceDataDir must stay under the project data directory.",
    severity: "error"
  });
}

function validateWindow(
  candidate: StrategyBucketTestValidationCandidate,
  issues: StrategyBucketTestValidationIssue[]
): void {
  const start = parseReplayDate(candidate.testConfig.window.startAt, false);
  const end = parseReplayDate(candidate.testConfig.window.endAt, true);
  if (start === null) {
    issues.push({
      code: "INVALID_WINDOW_DATE",
      path: "testConfig.window.startAt",
      message: "window.startAt must be an ISO-compatible date.",
      severity: "error"
    });
  }
  if (end === null) {
    issues.push({
      code: "INVALID_WINDOW_DATE",
      path: "testConfig.window.endAt",
      message: "window.endAt must be an ISO-compatible date.",
      severity: "error"
    });
  }
  if (start !== null && end !== null && start.getTime() > end.getTime()) {
    issues.push({
      code: "INVALID_WINDOW_RANGE",
      path: "testConfig.window",
      message: "window.startAt must be before or equal to window.endAt.",
      severity: "error"
    });
  }
}

function validateDecisionProvider(
  candidate: StrategyBucketTestValidationCandidate,
  issues: StrategyBucketTestValidationIssue[]
): void {
  if (
    candidate.testConfig.decisionProvider.mode === "codex_paper_only" &&
    candidate.testConfig.samplingPolicy.maxCodexCallsPerRun <= 0
  ) {
    issues.push({
      code: "CODEX_CALL_LIMIT_INVALID",
      path: "testConfig.samplingPolicy.maxCodexCallsPerRun",
      message:
        "Codex paper-only provider requires maxCodexCallsPerRun greater than 0.",
      severity: "error"
    });
  }
}

function validateSelectedBucket(
  candidate: StrategyBucketTestValidationCandidate,
  policy: PaperPolicyValidationCandidate,
  issues: StrategyBucketTestValidationIssue[]
): void {
  const bucketPolicy = policy.strategyBuckets.find(
    (bucket) => bucket.bucket === candidate.bucket
  );
  if (bucketPolicy === undefined) {
    issues.push({
      code: "BUCKET_POLICY_MISSING",
      path: "bucket",
      message: `${candidate.bucket} bucket must exist in policy before isolated bucket test validation.`,
      severity: "error"
    });
    return;
  }

  if (bucketPolicy.targetWeightRatio <= 0) {
    issues.push({
      code: "BUCKET_DISABLED",
      path: "policy.strategyBuckets",
      message: `${candidate.bucket} bucket target must be greater than 0% before isolated bucket test validation.`,
      severity: "error"
    });
  }

  if (
    candidate.bucket === "hedge" &&
    (!policy.hedgePolicy.hedgeEnabled ||
      policy.hedgePolicy.hedgeTargetRatio <= 0)
  ) {
    issues.push({
      code: "HEDGE_POLICY_REQUIRED",
      path: "policy.hedgePolicy",
      message:
        "hedge bucket test requires hedge policy to be enabled with a positive hedge target.",
      severity: "error"
    });
  }
}

function parseReplayDate(value: string, endOfDay: boolean): Date | null {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+09:00`
    : value;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date;
}

function configHash(candidate: StrategyBucketTestValidationCandidate): string {
  return createHash("sha256")
    .update(JSON.stringify(candidate))
    .digest("hex");
}

function formatSchemaIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>
): string {
  return issues.map(formatSchemaIssue).join("; ");
}

function formatSchemaIssue(issue: {
  path: PropertyKey[];
  message: string;
}): string {
  const path = issue.path.map(String).join(".") || "strategyBucketTest";
  return `${path}: ${issue.message}`;
}
