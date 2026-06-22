import { createHash } from "node:crypto";

import {
  parseWithSchema,
  replayResearchManifestSchema,
  type ReplayResearchManifest,
  type Sha256Hash
} from "../domain/schemas.js";

export const REPLAY_RESEARCH_MANIFEST_VERSION =
  "replay_research_manifest.v1";
export const REPLAY_RESEARCH_HASH_ALGORITHM = "sha256";

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

export interface CreateReplayResearchManifestInput {
  runId: string;
  batchId?: string | null | undefined;
  createdAt: Date | string;
  config: unknown;
  dataSnapshot: unknown;
  universe: unknown;
  coverage: unknown;
  prompt: unknown;
  schema: unknown;
  riskPolicy: unknown;
  costModel: unknown;
  executionModelVersion: string;
  warnings?: string[] | undefined;
}

export function createReplayResearchHash(value: unknown): Sha256Hash {
  return `${REPLAY_RESEARCH_HASH_ALGORITHM}:${createHash(
    REPLAY_RESEARCH_HASH_ALGORITHM
  )
    .update(stableStringifyResearchInput(value))
    .digest("hex")}`;
}

export function stableStringifyResearchInput(value: unknown): string {
  return JSON.stringify(toCanonicalJsonValue(value, "$"));
}

export function createReplayResearchManifest(
  input: CreateReplayResearchManifestInput
): ReplayResearchManifest {
  return parseWithSchema(
    replayResearchManifestSchema,
    {
      manifestVersion: REPLAY_RESEARCH_MANIFEST_VERSION,
      mode: "paper_only",
      runId: input.runId,
      batchId: input.batchId ?? null,
      createdAt: createdAtIsoString(input.createdAt),
      configHash: createReplayResearchHash(input.config),
      dataSnapshotHash: createReplayResearchHash(input.dataSnapshot),
      universeHash: createReplayResearchHash(input.universe),
      coverageHash: createReplayResearchHash(input.coverage),
      promptHash: createReplayResearchHash(input.prompt),
      schemaHash: createReplayResearchHash(input.schema),
      riskPolicyHash: createReplayResearchHash(input.riskPolicy),
      costModelHash: createReplayResearchHash(input.costModel),
      executionModelVersion: input.executionModelVersion,
      warnings: input.warnings ?? []
    },
    "replayResearchManifest"
  );
}

function createdAtIsoString(value: Date | string): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new Error("createdAt must be a valid date");
    }
    return value.toISOString();
  }

  return value;
}

function toCanonicalJsonValue(value: unknown, path: string): CanonicalJsonValue {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new Error(`Research hash input contains invalid Date at ${path}`);
    }
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return canonicalArrayValue(value, path);
  }

  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(
          `Research hash input contains non-finite number at ${path}`
        );
      }
      return value;
    case "object":
      return canonicalPlainObject(value, path);
    case "bigint":
    case "function":
    case "symbol":
    case "undefined":
      throw new Error(
        `Research hash input must be JSON-compatible plain data at ${path}`
      );
  }

  throw new Error(`Research hash input is not supported at ${path}`);
}

function canonicalArrayValue(
  value: unknown[],
  path: string
): CanonicalJsonValue[] {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`Research hash input contains symbol keys at ${path}`);
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    if (key !== "length" && !isArrayIndexKey(key, value.length)) {
      throw new Error(
        `Research hash input contains non-index array key at ${path}`
      );
    }
  }

  const output: CanonicalJsonValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(
        `Research hash input contains sparse array hole at ${path}[${index}]`
      );
    }
    output.push(toCanonicalJsonValue(value[index], `${path}[${index}]`));
  }

  return output;
}

function canonicalPlainObject(
  value: object,
  path: string
): { [key: string]: CanonicalJsonValue } {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(
      `Research hash input must be JSON-compatible plain data at ${path}`
    );
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`Research hash input contains symbol keys at ${path}`);
  }

  const output = Object.create(null) as { [key: string]: CanonicalJsonValue };
  for (const [key, entry] of Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    output[key] = toCanonicalJsonValue(entry, `${path}.${key}`);
  }

  return output;
}

function isArrayIndexKey(key: string, length: number): boolean {
  const index = Number(key);
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < length &&
    String(index) === key
  );
}
