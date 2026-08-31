import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

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

export interface ImmutablePolicyDependencyFileLoaderOptions {
  /** Explicit zone for pre-lineage createdAt values that omitted an offset. */
  legacyOffsetlessCreatedAtOffset?: string;
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
  private readonly legacyOffsetlessCreatedAtOffset: string | undefined;

  constructor(
    baseDir: string,
    options: ImmutablePolicyDependencyFileLoaderOptions = {}
  ) {
    this.paths = createImmutablePolicyDependencyPaths(baseDir);
    this.legacyOffsetlessCreatedAtOffset = parseLegacyTimestampOffset(
      options.legacyOffsetlessCreatedAtOffset
    );
  }

  async load(): Promise<LoadedImmutablePolicyDependencies> {
    return loadConsistentImmutablePolicyDependencies({
      readGeneration: () => this.readAllDependencyFiles(),
      ...(this.legacyOffsetlessCreatedAtOffset === undefined
        ? {}
        : {
            legacyOffsetlessCreatedAtOffset:
              this.legacyOffsetlessCreatedAtOffset
          })
    });
  }

  private async readAllDependencyFiles(): Promise<ImmutablePolicyDependencyRawGeneration> {
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

    return {
      selectionPolicies,
      riskParameters,
      riskRuleSets,
      drawdownSemantics,
      sessionCalendars,
      scheduleBoundaries
    };
  }
}

export interface ImmutablePolicyDependencyRawGeneration {
  selectionPolicies: JsonlReadResult<unknown>;
  riskParameters: JsonlReadResult<unknown>;
  riskRuleSets: JsonlReadResult<unknown>;
  drawdownSemantics: JsonlReadResult<unknown>;
  sessionCalendars: JsonlReadResult<unknown>;
  scheduleBoundaries: JsonlReadResult<unknown>;
}

const rawDependencyRecordSchema = z.unknown();

export async function loadConsistentImmutablePolicyDependencies(input: {
  readGeneration: () => Promise<ImmutablePolicyDependencyRawGeneration>;
  legacyOffsetlessCreatedAtOffset?: string;
}): Promise<LoadedImmutablePolicyDependencies> {
  const reads = await input.readGeneration();
  try {
    return loadDependencyReads(
      reads,
      input.legacyOffsetlessCreatedAtOffset
    );
  } catch (error) {
    const refreshedReads = await input.readGeneration();
    const relation = dependencyReadGenerationRelation(reads, refreshedReads);
    if (relation === "invalid") {
      throw new Error(
        "immutable policy dependency files must be append-only extensions",
        { cause: error }
      );
    }
    if (relation === "same" || hasCorruptDependencyLines(refreshedReads)) {
      throw error;
    }
    return loadDependencyReads(
      refreshedReads,
      input.legacyOffsetlessCreatedAtOffset
    );
  }
}

function loadDependencyReads(
  reads: ImmutablePolicyDependencyRawGeneration,
  legacyOffsetlessCreatedAtOffset: string | undefined
): LoadedImmutablePolicyDependencies {
  assertNoCorruptDependencyLines(reads);
  const migratedSelectionPolicies = reads.selectionPolicies.records.map(
    (record) =>
      migrateRecordLineage(
        record,
        parseBucketSelectionPolicyRecord,
        "selectionPolicyRecordId",
        "selection_policy",
        [],
        legacyOffsetlessCreatedAtOffset
      )
  );
  const migratedRiskParameters = reads.riskParameters.records.map((record) =>
    migrateRecordLineage(
      record,
      parsePortfolioRiskRuleParameterRecord,
      "riskRuleParameterRecordId",
      "risk_parameter",
      [],
      legacyOffsetlessCreatedAtOffset
    )
  );
  const riskParametersById = exactRecordMap(
    migratedRiskParameters,
    (record) => record.riskRuleParameterRecordId,
    "risk parameter"
  );
  const migratedRiskRuleSets = reads.riskRuleSets.records.map((record) =>
    migrateRiskRuleSet(
      record,
      riskParametersById,
      legacyOffsetlessCreatedAtOffset
    )
  );
  const migratedDrawdownSemantics = reads.drawdownSemantics.records.map(
    (record) =>
      migrateRecordLineage(
        record,
        parseBucketDrawdownSemanticsRecord,
        "drawdownSemanticsRecordId",
        "drawdown_semantics",
        [],
        legacyOffsetlessCreatedAtOffset
      )
  );
  const migratedSessionCalendars = reads.sessionCalendars.records.map(
    (record) =>
      migrateRecordLineage(
        record,
        parseSessionCalendarRecord,
        "sessionCalendarRecordId",
        "session_calendar",
        [],
        legacyOffsetlessCreatedAtOffset
      )
  );
  const sessionCalendarsById = exactRecordMap(
    migratedSessionCalendars,
    (record) => record.sessionCalendarRecordId,
    "session calendar"
  );
  const migratedScheduleBoundaries = reads.scheduleBoundaries.records.map(
    (record) =>
      migrateScheduleBoundary(
        record,
        sessionCalendarsById,
        legacyOffsetlessCreatedAtOffset
      )
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

type DependencyReadGenerationRelation = "same" | "extended" | "invalid";

function dependencyReadGenerationRelation(
  left: ImmutablePolicyDependencyRawGeneration,
  right: ImmutablePolicyDependencyRawGeneration
): DependencyReadGenerationRelation {
  const relations: DependencyReadGenerationRelation[] = [
    rawRecordGenerationRelation(
      left.selectionPolicies.records,
      right.selectionPolicies.records
    ),
    rawRecordGenerationRelation(
      left.riskParameters.records,
      right.riskParameters.records
    ),
    rawRecordGenerationRelation(
      left.riskRuleSets.records,
      right.riskRuleSets.records
    ),
    rawRecordGenerationRelation(
      left.drawdownSemantics.records,
      right.drawdownSemantics.records
    ),
    rawRecordGenerationRelation(
      left.sessionCalendars.records,
      right.sessionCalendars.records
    ),
    rawRecordGenerationRelation(
      left.scheduleBoundaries.records,
      right.scheduleBoundaries.records
    )
  ];
  return relations.includes("invalid")
    ? "invalid"
    : relations.includes("extended")
      ? "extended"
      : "same";
}

function rawRecordGenerationRelation(
  left: readonly unknown[],
  right: readonly unknown[]
): DependencyReadGenerationRelation {
  if (
    right.length < left.length ||
    !left.every((record, index) =>
      isDeepStrictEqual(record, right[index])
    )
  ) {
    return "invalid";
  }
  return right.length === left.length ? "same" : "extended";
}

function migrateRiskRuleSet(
  value: unknown,
  parameters: ReadonlyMap<string, PortfolioRiskRuleParameterRecord>,
  legacyOffsetlessCreatedAtOffset: string | undefined
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
      const recordId = canonicalLegacyTextField(
        parameterRef,
        "riskRuleParameterRecordId",
        "risk rule parameter ref"
      );
      const parameterVersion = canonicalLegacyTextField(
        parameterRef,
        "version",
        "risk rule parameter ref"
      );
      const parameter = parameters.get(recordId);
      if (parameter === undefined) {
        throw new Error("legacy risk rule parameter ref does not resolve");
      }
      if (
        parameter.version !== parameterVersion ||
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
          riskRuleParameterRecordId: recordId,
          version: parameterVersion,
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
    dependencyLineageHashes,
    legacyOffsetlessCreatedAtOffset
  );
}

function migrateScheduleBoundary(
  value: unknown,
  calendars: ReadonlyMap<string, SessionCalendarRecord>,
  legacyOffsetlessCreatedAtOffset: string | undefined
): ScheduleBoundaryRecord {
  const record = objectRecord(value, "schedule boundary");
  if (Object.hasOwn(record, "lineageHash")) {
    return parseScheduleBoundaryRecord(value);
  }
  const calendarId = canonicalLegacyTextField(
    record,
    "sessionCalendarRecordId",
    "schedule boundary"
  );
  const calendarVersion = canonicalLegacyTextField(
    record,
    "sessionCalendarVersion",
    "schedule boundary"
  );
  const calendar = calendars.get(calendarId);
  if (calendar === undefined) {
    throw new Error("legacy schedule boundary calendar ref does not resolve");
  }
  if (
    calendar.version !== calendarVersion ||
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
      sessionCalendarRecordId: calendarId,
      sessionCalendarVersion: calendarVersion,
      sessionCalendarLineageHash: calendar.lineageHash
    },
    parseScheduleBoundaryRecord,
    "scheduleBoundaryRecordId",
    "schedule_boundary",
    [calendar.lineageHash],
    legacyOffsetlessCreatedAtOffset
  );
}

function migrateRecordLineage<T>(
  value: unknown,
  parse: (record: unknown) => T,
  idKey: string,
  recordType: string,
  dependencyLineageHashes: readonly string[] = [],
  legacyOffsetlessCreatedAtOffset?: string
): T {
  const record = objectRecord(value, recordType);
  if (Object.hasOwn(record, "lineageHash")) {
    return parse(record);
  }
  const recordId = canonicalLegacyTextField(record, idKey, recordType);
  const semanticHash = stringField(record, "hash", recordType);
  const createdAt = normalizeLegacyCreatedAt(
    stringField(record, "createdAt", recordType),
    legacyOffsetlessCreatedAtOffset
  );
  return parse({
    ...record,
    [idKey]: recordId,
    createdAt,
    lineageHash: hashImmutableRecordLineage({
      recordType,
      recordId,
      semanticHash,
      createdAt,
      dependencyLineageHashes
    })
  });
}

function canonicalLegacyTextField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string
): string {
  return stringField(record, key, label).trim();
}

function parseLegacyTimestampOffset(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.test(value)) {
    throw new Error(
      "legacyOffsetlessCreatedAtOffset must be Z or a numeric offset from -14:00 to +14:00"
    );
  }
  return value;
}

function normalizeLegacyCreatedAt(
  value: string,
  explicitOffset: string | undefined
): string {
  const legacyValue = value.trim();
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      legacyValue
    )
  ) {
    return legacyValue;
  }
  if (hasExplicitLegacyTimeZone(legacyValue)) {
    return canonicalLegacyTimestamp(legacyValue);
  }
  if (explicitOffset === undefined) {
    throw new Error(
      "legacy dependency has offsetless createdAt; set legacyOffsetlessCreatedAtOffset explicitly"
    );
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(legacyValue)) {
    return `${legacyValue}T00:00:00${explicitOffset}`;
  }
  const zoneSuffix =
    explicitOffset === "Z" ? " GMT" : ` ${explicitOffset.replace(":", "")}`;
  if (!legacyValue.includes(":")) {
    return canonicalLegacyTimestamp(`${legacyValue} 00:00:00${zoneSuffix}`);
  }
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(
      legacyValue
    )
  ) {
    return `${legacyValue}${explicitOffset}`;
  }
  return canonicalLegacyTimestamp(`${legacyValue}${zoneSuffix}`);
}

function hasExplicitLegacyTimeZone(value: string): boolean {
  const annotationSuffix = "(?:\\s*(?:\\([^)]*\\))?)?$";
  if (
    new RegExp(
      `(?:z|\\b(?:UT|UTC|GMT)0{1,4}|\\b(?:UT|UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT)\\b)${annotationSuffix}`,
      "i"
    ).test(value)
  ) {
    return true;
  }
  if (!value.includes(":")) {
    return false;
  }
  return new RegExp(
    `(?:GMT)?[+-](?:\\d{1,4}|\\d{1,2}:\\d{2})${annotationSuffix}`,
    "i"
  ).test(value);
}

function canonicalLegacyTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("legacy dependency createdAt cannot be normalized");
  }
  return new Date(timestamp).toISOString();
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

function assertNoCorruptDependencyLines(
  reads: ImmutablePolicyDependencyRawGeneration
): void {
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

function hasCorruptDependencyLines(
  reads: ImmutablePolicyDependencyRawGeneration
): boolean {
  return Object.values(reads).some(
    (result) => result.corruptLineCount > 0
  );
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
