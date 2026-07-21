import { access, readFile } from "node:fs/promises";

import type { z } from "zod";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import { parseWithSchema } from "../domain/schemas.js";
import {
  historicalUniverseManifestSchema,
  type HistoricalUniverseManifest
} from "../replay/historicalUniverseCoverage.js";
import {
  parseMarketCalendarFixtures,
  type MarketCalendarFixture
} from "../replay/marketCalendar.js";
import {
  feasibilityCoverageSourceSchema,
  validationSplitSourceSchema
} from "../replay/validationSplitRegimeFeasibility.js";
import type { ValidationSplitAssignment } from "../replay/validationProtocol.js";
import {
  createStoragePaths,
  FileHistoricalMarketSnapshotStore
} from "../storage/repositories.js";

export interface ValidationSplitRegimeFeasibilitySourcePaths {
  sourceDataDir: string;
  universePath: string;
  coveragePath: string;
  validationSplitsPath: string;
  calendarFixturesPath: string;
}

export interface ValidationSplitRegimeFeasibilitySources {
  snapshots: HistoricalMarketSnapshot[];
  universeSource: unknown;
  universe: HistoricalUniverseManifest;
  coverage: z.infer<typeof feasibilityCoverageSourceSchema>;
  validationSplit: z.infer<typeof validationSplitSourceSchema>;
  assignments: ValidationSplitAssignment[];
  calendarFixtures: MarketCalendarFixture[];
}

export async function readValidationSplitRegimeFeasibilitySources(
  paths: ValidationSplitRegimeFeasibilitySourcePaths
): Promise<ValidationSplitRegimeFeasibilitySources> {
  const snapshotPath = createStoragePaths(
    paths.sourceDataDir
  ).historicalMarketSnapshotsPath;
  await access(snapshotPath);

  const [snapshotRead, universeSource, coverageSource, validationSplitSource] =
    await Promise.all([
      new FileHistoricalMarketSnapshotStore(snapshotPath).readAll(),
      readJsonFile(paths.universePath, "historical universe source"),
      readJsonFile(paths.coveragePath, "historical coverage source"),
      readJsonFile(paths.validationSplitsPath, "validation split source")
    ]);
  if (snapshotRead.corruptLineCount > 0) {
    throw new Error(
      `historical snapshot source contains ${snapshotRead.corruptLineCount} corrupt line(s)`
    );
  }
  if (snapshotRead.records.length === 0) {
    throw new Error("historical snapshot source must not be empty");
  }

  const validationSplit = parseWithSchema(
    validationSplitSourceSchema,
    validationSplitSource,
    "validation split source"
  );
  const assignments = Array.isArray(validationSplit)
    ? validationSplit
    : validationSplit.assignments;

  return {
    snapshots: snapshotRead.records,
    universeSource,
    universe: parseWithSchema(
      historicalUniverseManifestSchema,
      universeSource,
      "historical universe source"
    ),
    coverage: parseWithSchema(
      feasibilityCoverageSourceSchema,
      coverageSource,
      "historical coverage source"
    ),
    validationSplit,
    assignments,
    calendarFixtures: await readCalendarFixturesFile(
      paths.calendarFixturesPath
    )
  };
}

async function readJsonFile(path: string, label: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

async function readCalendarFixturesFile(
  path: string
): Promise<MarketCalendarFixture[]> {
  const raw = await readFile(path, "utf8");
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("calendar fixture source must not be empty");
  }

  if (trimmed.startsWith("[")) {
    const parsed = parseJson(trimmed, "calendar fixture source");
    if (!Array.isArray(parsed)) {
      throw new Error("calendar fixture source must contain a fixture array");
    }
    return parseMarketCalendarFixtures(parsed);
  }

  return parseMarketCalendarFixtures(
    trimmed.split(/\r?\n/).map((line, index) =>
      parseJson(line, `calendar fixture JSONL line ${index + 1}`)
    )
  );
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}
