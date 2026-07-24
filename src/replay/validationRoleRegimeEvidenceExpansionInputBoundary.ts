import { z } from "zod";

import {
  evidenceExpansionPreflightBlockerSchema,
  type EvidenceExpansionPreflightBlocker
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

const requiredInputSourceSchema = z
  .unknown()
  .refine((value) => value !== undefined, {
    message: "required input source is missing"
  });

const baselineInputSchema = z
  .object({
    feasibilityArtifact: requiredInputSourceSchema,
    planArtifact: requiredInputSourceSchema,
    readinessArtifact: requiredInputSourceSchema,
    validationSplitSource: requiredInputSourceSchema
  })
  .strict();

const expansionInputSchema = z
  .object({
    snapshots: requiredInputSourceSchema,
    universe: requiredInputSourceSchema,
    coverage: requiredInputSourceSchema,
    validationSplitSource: requiredInputSourceSchema
  })
  .strict();

export const validationRoleRegimeEvidenceExpansionInputSchema = z
  .object({
    baseline: baselineInputSchema,
    expansion: expansionInputSchema,
    calendarValidation: requiredInputSourceSchema,
    officialCalendarArtifact: z.unknown().optional(),
    marketRegimeClassifier: requiredInputSourceSchema,
    targetMatrix: requiredInputSourceSchema,
    dependencyDiagnosticPolicy: requiredInputSourceSchema
  })
  .strict();

export type ValidationRoleRegimeEvidenceExpansionInput = z.infer<
  typeof validationRoleRegimeEvidenceExpansionInputSchema
>;

export type ValidationRoleRegimeEvidenceExpansionInputBoundaryResult =
  | {
      status: "accepted";
      input: ValidationRoleRegimeEvidenceExpansionInput;
      forbiddenPaths: [];
      blockers: [];
    }
  | {
      status: "invalid";
      input: null;
      forbiddenPaths: string[];
      blockers: [EvidenceExpansionPreflightBlocker];
    };

const FORBIDDEN_RESULT_INPUT_KEYS = new Set([
  "historicalreplayrunreport",
  "historicalreplayreport",
  "batchaggregateresearchreport",
  "strategybucketresult",
  "strategycomparisonreport",
  "virtualdecision",
  "virtualtrade",
  "virtualportfolio",
  "return",
  "returns",
  "returnratio",
  "initialnetworthkrw",
  "finalnetworthkrw",
  "finalvirtualnetworthkrw",
  "averagefinalvirtualnetworthkrw",
  "totalreturnratio",
  "averagetotalreturnratio",
  "mediantotalreturnratio",
  "mintotalreturnratio",
  "maxtotalreturnratio",
  "grosstotalreturnratio",
  "costadjustedtotalreturnratio",
  "costdragratio",
  "cagrratio",
  "maxdrawdownratio",
  "calmarratio",
  "exposureadjustedreturnratio",
  "pnl",
  "realizedpnlkrw",
  "unrealizedpnlkrw",
  "sharpe",
  "sharperatio",
  "psr",
  "dsr",
  "pbo",
  "pbolikescore",
  "pboprobability",
  "hitrate",
  "hitratio",
  "winrate",
  "targetreturnhitrates",
  "profitfactor",
  "averagewinratio",
  "averagelossratio",
  "taillossratio",
  "drawdown",
  "selectionmetric",
  "candidaterank",
  "selectedrank",
  "selectedcandidatekey",
  "selectedtrainmetric",
  "selectedtestmetric",
  "testrankpercentile",
  "tiebreakapplied",
  "selectedtrainaveragetotalreturnratio",
  "selectedaveragetotalreturnratio",
  "mediancandidateaveragetotalreturnratio",
  "bestaveragetotalreturnratio",
  "degradationfromtrainratio",
  "selectedbelowmedian",
  "airationale",
  "recommendation",
  "action",
  "actions"
]);

export function validateValidationRoleRegimeEvidenceExpansionInputBoundary(
  value: unknown
): ValidationRoleRegimeEvidenceExpansionInputBoundaryResult {
  const forbiddenPaths = findForbiddenResultInputPaths(value);
  if (forbiddenPaths.length > 0) {
    const blocker = evidenceExpansionPreflightBlockerSchema.parse({
      code: "RESULT_METRIC_INPUT_FORBIDDEN",
      message: `forbidden result input detected: ${forbiddenPaths.join(", ")}`,
      splitRole: null,
      targetRegime: null
    });
    return {
      status: "invalid",
      input: null,
      forbiddenPaths,
      blockers: [blocker]
    };
  }

  return {
    status: "accepted",
    input: validationRoleRegimeEvidenceExpansionInputSchema.parse(value),
    forbiddenPaths: [],
    blockers: []
  };
}

function findForbiddenResultInputPaths(value: unknown): string[] {
  const paths: string[] = [];
  collectForbiddenResultInputPaths(value, "$", paths, new WeakSet<object>());
  return paths.sort(compareStrings);
}

function collectForbiddenResultInputPaths(
  value: unknown,
  path: string,
  paths: string[],
  visited: WeakSet<object>
): void {
  if (typeof value !== "object" || value === null || visited.has(value)) {
    return;
  }
  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectForbiddenResultInputPaths(
        entry,
        `${path}[${index}]`,
        paths,
        visited
      );
    });
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (FORBIDDEN_RESULT_INPUT_KEYS.has(normalizeInputKey(key))) {
      paths.push(entryPath);
    }
    collectForbiddenResultInputPaths(entry, entryPath, paths, visited);
  }
}

function normalizeInputKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
