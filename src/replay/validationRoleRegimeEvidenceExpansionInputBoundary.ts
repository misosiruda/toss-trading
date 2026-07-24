import { z } from "zod";

import { virtualPortfolioSchema } from "../domain/schemas.js";
import {
  officialMarketCalendarEvidenceArtifactSchema
} from "./officialMarketCalendarEvidence.js";
import {
  evidenceExpansionPreflightBlockerSchema,
  type EvidenceExpansionPreflightBlocker
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

const requiredInputSourceSchema = z
  .unknown()
  .refine(isNonEmptyStructuredSource, {
    message: "required input source must be a non-empty object or array"
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
    officialCalendarArtifact:
      officialMarketCalendarEvidenceArtifactSchema.optional(),
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
  "returnsamplecount",
  "meanreturnratio",
  "volatilityratio",
  "skewness",
  "excesskurtosis",
  "initialnetworthkrw",
  "finalnetworthkrw",
  "virtualnetworthkrw",
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
  "samplesharpe",
  "samplesharpestatus",
  "samplesharpevalue",
  "loadjustedsharpe",
  "loadjustedsharpestatus",
  "probabilisticsharperatio",
  "probabilisticsharperatiostatus",
  "probabilisticsharperatioprobability",
  "deflatedsharperatio",
  "deflatedsharperatiostatus",
  "deflatedsharperatioprobability",
  "benchmarksharperatio",
  "trialsharperatiostandarddeviation",
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
  "selectedbymetric",
  "candidaterank",
  "selectedrank",
  "selectedcandidatekey",
  "trainmetric",
  "testmetric",
  "trainreturnsamplecount",
  "testreturnsamplecount",
  "selectedtrainmetric",
  "selectedtestmetric",
  "testrankpercentile",
  "tiebreakapplied",
  "selectedtrainaveragetotalreturnratio",
  "selectedaveragetotalreturnratio",
  "mediancandidateaveragetotalreturnratio",
  "bestaveragetotalreturnratio",
  "holdoutdegradation",
  "holdoutdegradationcount",
  "degradationfromtrainratio",
  "selectedbelowmedian",
  "tradecount",
  "aidecisionfailurecount",
  "rejectedcount",
  "meaningfulrejectcount",
  "dustrejectcount",
  "skipreason",
  "reportpath",
  "selected",
  "selectedby",
  "selectedat",
  "selectionreason",
  "airationale",
  "recommendation",
  "action",
  "actions"
]);

const FORBIDDEN_RESULT_INPUT_KEY_SUFFIXES = [
  "aidecisionfailurecount",
  "rejectedcount",
  "meaningfulrejectcount",
  "dustrejectcount"
] as const;

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

  if (virtualPortfolioSchema.safeParse(value).success) {
    paths.push(path);
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (isForbiddenResultInputKey(key)) {
      paths.push(entryPath);
    }
    collectForbiddenResultInputPaths(entry, entryPath, paths, visited);
  }
}

function isForbiddenResultInputKey(value: string): boolean {
  const normalized = normalizeInputKey(value);
  return (
    FORBIDDEN_RESULT_INPUT_KEYS.has(normalized) ||
    FORBIDDEN_RESULT_INPUT_KEY_SUFFIXES.some((suffix) =>
      normalized.endsWith(suffix)
    )
  );
}

function normalizeInputKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isNonEmptyStructuredSource(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length > 0
  );
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
