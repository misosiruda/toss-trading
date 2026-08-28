import { join } from "node:path";

import { z } from "zod";

import { JsonlStore, type JsonlReadResult } from "../storage/jsonlStore.js";
import {
  hashImmutableRecordLineage,
  parseBucketDrawdownSemanticsRecord,
  parseBucketSelectionPolicyRecord,
  parsePortfolioRiskRuleParameterRecord,
  parsePortfolioRiskRuleSetRecord,
  parseScheduleBoundaryRecord,
  parseSessionCalendarRecord,
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
        rawDependencyRecordSchema,
        "bucketSelectionPolicyRecord"
      ).readAll(),
      new JsonlStore(
        this.paths.riskParameters,
        rawDependencyRecordSchema,
        "portfolioRiskRuleParameterRecord"
      ).readAll(),
      new JsonlStore(
        this.paths.riskRuleSets,
        rawDependencyRecordSchema,
        "portfolioRiskRuleSetRecord"
      ).readAll(),
      new JsonlStore(
        this.paths.drawdownSemantics,
        rawDependencyRecordSchema,
        "bucketDrawdownSemanticsRecord"
      ).readAll(),
      new JsonlStore(
        this.paths.sessionCalendars,
        rawDependencyRecordSchema,
        "sessionCalendarRecord"
      ).readAll(),
      new JsonlStore(
        this.paths.scheduleBoundaries,
        rawDependencyRecordSchema,
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

    const migratedSelectionPolicies = selectionPolicies.records.map((record) =>
      migrateRecordLineage(
        record,
        parseBucketSelectionPolicyRecord,
        "selectionPolicyRecordId",
        "selection_policy"
      )
    );
    const migratedRiskParameters = riskParameters.records.map((record) =>
      migrateRecordLineage(
        record,
        parsePortfolioRiskRuleParameterRecord,
        "riskRuleParameterRecordId",
        "risk_parameter"
      )
    );
    const riskParametersById = exactRecordMap(
      migratedRiskParameters,
      (record) => record.riskRuleParameterRecordId,
      "risk parameter"
    );
    const migratedRiskRuleSets = riskRuleSets.records.map((record) =>
      migrateRiskRuleSet(record, riskParametersById)
    );
    const migratedDrawdownSemantics = drawdownSemantics.records.map((record) =>
      migrateRecordLineage(
        record,
        parseBucketDrawdownSemanticsRecord,
        "drawdownSemanticsRecordId",
        "drawdown_semantics"
      )
    );
    const migratedSessionCalendars = sessionCalendars.records.map((record) =>
      migrateRecordLineage(
        record,
        parseSessionCalendarRecord,
        "sessionCalendarRecordId",
        "session_calendar"
      )
    );
    const sessionCalendarsById = exactRecordMap(
      migratedSessionCalendars,
      (record) => record.sessionCalendarRecordId,
      "session calendar"
    );
    const migratedScheduleBoundaries = scheduleBoundaries.records.map((record) =>
      migrateScheduleBoundary(record, sessionCalendarsById)
    );

    const records: ImmutablePolicyDependencyRecords = deepFreeze({
      selectionPolicies: migratedSelectionPolicies,
      riskParameters: migratedRiskParameters,
      riskRuleSets: migratedRiskRuleSets,
      drawdownSemantics: migratedDrawdownSemantics,
      sessionCalendars: migratedSessionCalendars,
      scheduleBoundaries: migratedScheduleBoundaries
    });
    const repository = new ImmutablePolicyDependencyRepository(records);
    return Object.freeze({ records, repository });
  }
}

type DependencyReads = {
  selectionPolicies: JsonlReadResult<unknown>;
  riskParameters: JsonlReadResult<unknown>;
  riskRuleSets: JsonlReadResult<unknown>;
  drawdownSemantics: JsonlReadResult<unknown>;
  sessionCalendars: JsonlReadResult<unknown>;
  scheduleBoundaries: JsonlReadResult<unknown>;
};

const rawDependencyRecordSchema = z.unknown();

function migrateRiskRuleSet(
  value: unknown,
  parameters: ReadonlyMap<string, PortfolioRiskRuleParameterRecord>
): PortfolioRiskRuleSetRecord {
  const record = objectRecord(value, "risk rule set");
  if (Object.hasOwn(record, "lineageHash")) {
    return parsePortfolioRiskRuleSetRecord(value);
  }
  const dependencyLineageHashes: string[] = [];
  const rules = arrayField(record, "rules", "risk rule set").map(
    (ruleValue) => {
      const rule = objectRecord(ruleValue, "risk rule");
      const parameterRef = objectRecord(
        rule.parameterRef,
        "risk rule parameter ref"
      );
      const recordId = stringField(
        parameterRef,
        "riskRuleParameterRecordId",
        "risk rule parameter ref"
      );
      const parameter = parameters.get(recordId);
      if (parameter === undefined) {
        throw new Error("legacy risk rule parameter ref does not resolve");
      }
      if (
        parameter.version !==
          stringField(parameterRef, "version", "risk rule parameter ref") ||
        parameter.hash !==
          stringField(parameterRef, "hash", "risk rule parameter ref")
      ) {
        throw new Error("legacy risk rule parameter ref version/hash mismatch");
      }
      const declaredLineageHash = optionalStringField(
        parameterRef,
        "lineageHash",
        "risk rule parameter ref"
      );
      if (
        declaredLineageHash !== undefined &&
        declaredLineageHash !== parameter.lineageHash
      ) {
        throw new Error("legacy risk rule parameter ref lineage mismatch");
      }
      dependencyLineageHashes.push(parameter.lineageHash);
      return {
        ...rule,
        parameterRef: {
          ...parameterRef,
          lineageHash: parameter.lineageHash
        }
      };
    }
  );
  return migrateRecordLineage(
    { ...record, rules },
    parsePortfolioRiskRuleSetRecord,
    "riskRuleSetRecordId",
    "risk_rule_set",
    dependencyLineageHashes
  );
}

function migrateScheduleBoundary(
  value: unknown,
  calendars: ReadonlyMap<string, SessionCalendarRecord>
): ScheduleBoundaryRecord {
  const record = objectRecord(value, "schedule boundary");
  if (Object.hasOwn(record, "lineageHash")) {
    return parseScheduleBoundaryRecord(value);
  }
  const calendarId = stringField(
    record,
    "sessionCalendarRecordId",
    "schedule boundary"
  );
  const calendar = calendars.get(calendarId);
  if (calendar === undefined) {
    throw new Error("legacy schedule boundary calendar ref does not resolve");
  }
  if (
    calendar.version !==
      stringField(record, "sessionCalendarVersion", "schedule boundary") ||
    calendar.hash !==
      stringField(record, "sessionCalendarHash", "schedule boundary")
  ) {
    throw new Error("legacy schedule boundary calendar ref version/hash mismatch");
  }
  const declaredLineageHash = optionalStringField(
    record,
    "sessionCalendarLineageHash",
    "schedule boundary"
  );
  if (
    declaredLineageHash !== undefined &&
    declaredLineageHash !== calendar.lineageHash
  ) {
    throw new Error("legacy schedule boundary calendar lineage mismatch");
  }
  return migrateRecordLineage(
    {
      ...record,
      sessionCalendarLineageHash: calendar.lineageHash
    },
    parseScheduleBoundaryRecord,
    "scheduleBoundaryRecordId",
    "schedule_boundary",
    [calendar.lineageHash]
  );
}

function migrateRecordLineage<T>(
  value: unknown,
  parse: (record: unknown) => T,
  idKey: string,
  recordType: string,
  dependencyLineageHashes: readonly string[] = []
): T {
  const record = objectRecord(value, recordType);
  if (Object.hasOwn(record, "lineageHash")) {
    return parse(record);
  }
  const recordId = stringField(record, idKey, recordType);
  const semanticHash = stringField(record, "hash", recordType);
  const createdAt = stringField(record, "createdAt", recordType);
  return parse({
    ...record,
    lineageHash: hashImmutableRecordLineage({
      recordType,
      recordId,
      semanticHash,
      createdAt,
      dependencyLineageHashes
    })
  });
}

function exactRecordMap<T>(
  records: readonly T[],
  idFor: (record: T) => string,
  label: string
): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const record of records) {
    const id = idFor(record);
    if (result.has(id)) {
      throw new Error(`${label} record ID must resolve exactly once`);
    }
    result.set(id, record);
  }
  return result;
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} record must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayField(
  record: Record<string, unknown>,
  key: string,
  label: string
): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`${label} ${key} must be an array`);
  }
  return value;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
  label: string
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`${label} ${key} must be a string`);
  }
  return value;
}

function optionalStringField(
  record: Record<string, unknown>,
  key: string,
  label: string
): string | undefined {
  if (!Object.hasOwn(record, key)) {
    return undefined;
  }
  return stringField(record, key, label);
}

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
