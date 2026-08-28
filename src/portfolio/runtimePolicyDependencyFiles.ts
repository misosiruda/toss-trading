import { join } from "node:path";

import { JsonlStore, type JsonlReadResult } from "../storage/jsonlStore.js";
import {
  bucketDrawdownSemanticsRecordSchema,
  bucketSelectionPolicyRecordSchema,
  portfolioRiskRuleParameterRecordSchema,
  portfolioRiskRuleSetRecordSchema,
  scheduleBoundaryRecordSchema,
  sessionCalendarRecordSchema,
  type BucketDrawdownSemanticsRecord,
  type BucketSelectionPolicyRecord,
  type ImmutablePolicyDependencyRecords,
  type PortfolioRiskRuleParameterRecord,
  type PortfolioRiskRuleSetRecord,
  type ScheduleBoundaryRecord,
  type SessionCalendarRecord
} from "./runtimePolicyContracts.js";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";

export const IMMUTABLE_POLICY_DEPENDENCY_FILE_NAMES = {
  selectionPolicies: "bucket-selection-policy-records.jsonl",
  riskParameters: "portfolio-risk-rule-parameter-records.jsonl",
  riskRuleSets: "portfolio-risk-rule-set-records.jsonl",
  drawdownSemantics: "bucket-drawdown-semantics-records.jsonl",
  sessionCalendars: "session-calendar-records.jsonl",
  scheduleBoundaries: "schedule-boundary-records.jsonl"
} as const;

export type ImmutablePolicyDependencyKind =
  keyof typeof IMMUTABLE_POLICY_DEPENDENCY_FILE_NAMES;

export type ImmutablePolicyDependencyPaths = Record<
  ImmutablePolicyDependencyKind,
  string
>;

export interface LoadedImmutablePolicyDependencies {
  records: ImmutablePolicyDependencyRecords;
  repository: ImmutablePolicyDependencyRepository;
}

export function createImmutablePolicyDependencyPaths(
  baseDir: string
): ImmutablePolicyDependencyPaths {
  return {
    selectionPolicies: join(
      baseDir,
      IMMUTABLE_POLICY_DEPENDENCY_FILE_NAMES.selectionPolicies
    ),
    riskParameters: join(
      baseDir,
      IMMUTABLE_POLICY_DEPENDENCY_FILE_NAMES.riskParameters
    ),
    riskRuleSets: join(
      baseDir,
      IMMUTABLE_POLICY_DEPENDENCY_FILE_NAMES.riskRuleSets
    ),
    drawdownSemantics: join(
      baseDir,
      IMMUTABLE_POLICY_DEPENDENCY_FILE_NAMES.drawdownSemantics
    ),
    sessionCalendars: join(
      baseDir,
      IMMUTABLE_POLICY_DEPENDENCY_FILE_NAMES.sessionCalendars
    ),
    scheduleBoundaries: join(
      baseDir,
      IMMUTABLE_POLICY_DEPENDENCY_FILE_NAMES.scheduleBoundaries
    )
  };
}

/**
 * Read-only filesystem adapter for immutable runtime policy dependencies.
 *
 * JsonlStore can count and omit malformed lines for observational readers, but
 * policy activation cannot safely continue with a partial dependency set. This
 * loader rejects any corrupt line and then delegates independent rehash and
 * duplicate-ID checks to ImmutablePolicyDependencyRepository.
 */
export class ImmutablePolicyDependencyFileLoader {
  private readonly paths: ImmutablePolicyDependencyPaths;

  constructor(baseDir: string) {
    this.paths = createImmutablePolicyDependencyPaths(baseDir);
  }

  async load(): Promise<LoadedImmutablePolicyDependencies> {
    const [
      selectionPolicies,
      riskParameters,
      riskRuleSets,
      drawdownSemantics,
      sessionCalendars,
      scheduleBoundaries
    ] = await Promise.all([
      new JsonlStore(
        this.paths.selectionPolicies,
        bucketSelectionPolicyRecordSchema,
        "bucketSelectionPolicyRecord"
      ).readAll(),
      new JsonlStore(
        this.paths.riskParameters,
        portfolioRiskRuleParameterRecordSchema,
        "portfolioRiskRuleParameterRecord"
      ).readAll(),
      new JsonlStore(
        this.paths.riskRuleSets,
        portfolioRiskRuleSetRecordSchema,
        "portfolioRiskRuleSetRecord"
      ).readAll(),
      new JsonlStore(
        this.paths.drawdownSemantics,
        bucketDrawdownSemanticsRecordSchema,
        "bucketDrawdownSemanticsRecord"
      ).readAll(),
      new JsonlStore(
        this.paths.sessionCalendars,
        sessionCalendarRecordSchema,
        "sessionCalendarRecord"
      ).readAll(),
      new JsonlStore(
        this.paths.scheduleBoundaries,
        scheduleBoundaryRecordSchema,
        "scheduleBoundaryRecord"
      ).readAll()
    ]);

    const reads = {
      selectionPolicies,
      riskParameters,
      riskRuleSets,
      drawdownSemantics,
      sessionCalendars,
      scheduleBoundaries
    };
    assertNoCorruptDependencyLines(reads);

    const records: ImmutablePolicyDependencyRecords = deepFreeze({
      selectionPolicies: selectionPolicies.records,
      riskParameters: riskParameters.records,
      riskRuleSets: riskRuleSets.records,
      drawdownSemantics: drawdownSemantics.records,
      sessionCalendars: sessionCalendars.records,
      scheduleBoundaries: scheduleBoundaries.records
    });
    const repository = new ImmutablePolicyDependencyRepository(records);
    return Object.freeze({ records, repository });
  }
}

type DependencyReads = {
  selectionPolicies: JsonlReadResult<BucketSelectionPolicyRecord>;
  riskParameters: JsonlReadResult<PortfolioRiskRuleParameterRecord>;
  riskRuleSets: JsonlReadResult<PortfolioRiskRuleSetRecord>;
  drawdownSemantics: JsonlReadResult<BucketDrawdownSemanticsRecord>;
  sessionCalendars: JsonlReadResult<SessionCalendarRecord>;
  scheduleBoundaries: JsonlReadResult<ScheduleBoundaryRecord>;
};

function assertNoCorruptDependencyLines(reads: DependencyReads): void {
  const corrupt = Object.entries(reads)
    .filter(([, result]) => result.corruptLineCount > 0)
    .map(([kind, result]) => `${kind}:${result.corruptLineCount}`);
  if (corrupt.length > 0) {
    throw new Error(
      `immutable policy dependency files contain corrupt lines: ${corrupt.join(
        ","
      )}`
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
