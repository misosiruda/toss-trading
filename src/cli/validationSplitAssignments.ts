import "../config/loadEnv.js";

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  buildWalkForwardSplitPlan,
  walkForwardSplitAssignments,
  type WalkForwardSplitPlan
} from "../replay/walkForwardSplit.js";
import type {
  ValidationSplitAssignment,
  ValidationSplitRole
} from "../replay/validationProtocol.js";

const args = process.argv.slice(2);
const testMonths = readOptionalIntegerArg("--test-months");
const stepMonths = readOptionalIntegerArg("--step-months");
const timezoneOffsetMinutes = readOptionalIntegerArg(
  "--timezone-offset-minutes"
);
const embargoDurationDays = readOptionalIntegerArg("--embargo-duration-days");
const outputPath = readOptionalArgValue("--output-path");

const plan = buildWalkForwardSplitPlan({
  rangeStart: readDateArg("--range-start"),
  rangeEnd: readDateArg("--range-end"),
  trainMonths: readIntegerArg("--train-months"),
  validationMonths: readIntegerArg("--validation-months"),
  ...(testMonths === undefined ? {} : { testMonths }),
  ...(stepMonths === undefined ? {} : { stepMonths }),
  ...(timezoneOffsetMinutes === undefined ? {} : { timezoneOffsetMinutes }),
  ...(embargoDurationDays === undefined ? {} : { embargoDurationDays })
});

const assignments = plan.splits.flatMap(walkForwardSplitAssignments);
const artifact = buildArtifact(plan, assignments);
if (outputPath !== undefined) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(artifact, null, 2));

interface ValidationSplitAssignmentArtifact {
  mode: "paper_only";
  schemaVersion: "validation_split_assignment.v1";
  generatedAt: string;
  plan: WalkForwardSplitPlan;
  summary: {
    splitCount: number;
    assignmentCount: number;
    roleCounts: Record<ValidationSplitRole, number>;
  };
  assignments: ValidationSplitAssignment[];
  disclaimer: string;
}

function buildArtifact(
  plan: WalkForwardSplitPlan,
  assignments: ValidationSplitAssignment[]
): ValidationSplitAssignmentArtifact {
  return {
    mode: "paper_only",
    schemaVersion: "validation_split_assignment.v1",
    generatedAt: new Date().toISOString(),
    plan,
    summary: {
      splitCount: plan.splitCount,
      assignmentCount: assignments.length,
      roleCounts: countRoles(assignments)
    },
    assignments,
    disclaimer:
      "Paper-only validation split assignments. This is not investment advice, not a performance guarantee, and not a live trading signal."
  };
}

function countRoles(
  assignments: ValidationSplitAssignment[]
): Record<ValidationSplitRole, number> {
  return assignments.reduce<Record<ValidationSplitRole, number>>(
    (counts, assignment) => ({
      ...counts,
      [assignment.splitRole]: counts[assignment.splitRole] + 1
    }),
    { train: 0, validation: 0, test: 0 }
  );
}

function readDateArg(name: string): Date {
  const raw = readRequiredArgValue(name);
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${name} must be a valid date`);
  }
  return date;
}

function readIntegerArg(name: string): number {
  const raw = readRequiredArgValue(name);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

function readOptionalIntegerArg(name: string): number | undefined {
  const value = readOptionalArgValue(name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

function readOptionalArgValue(name: string): string | undefined {
  const value = readArgValue(name);
  if (value === undefined && args.includes(name)) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function readArgValue(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return undefined;
  }

  return value;
}

function readRequiredArgValue(name: string): string {
  const value = readArgValue(name);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}
