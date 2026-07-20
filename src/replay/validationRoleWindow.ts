import { parseWithSchema } from "../domain/schemas.js";
import {
  validationSplitAssignmentSchema,
  type ValidationSplitAssignment,
  type ValidationSplitRole
} from "./validationProtocol.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ValidationRoleWindow {
  splitId: string;
  splitIndex: number;
  splitRole: ValidationSplitRole;
  roleStart: string;
  roleEnd: string;
  effectiveRoleEnd: string | null;
}

export function validationRoleWindow(
  value: ValidationSplitAssignment
): ValidationRoleWindow {
  const assignment = parseWithSchema(
    validationSplitAssignmentSchema,
    value,
    "validation split assignment"
  );

  if (assignment.splitRole === "train") {
    return {
      splitId: assignment.splitId,
      splitIndex: assignment.splitIndex,
      splitRole: assignment.splitRole,
      roleStart: assignment.trainStart,
      roleEnd: assignment.trainEnd,
      effectiveRoleEnd: trainEndExcludingEmbargo(assignment)
    };
  }
  if (assignment.splitRole === "validation") {
    return {
      splitId: assignment.splitId,
      splitIndex: assignment.splitIndex,
      splitRole: assignment.splitRole,
      roleStart: assignment.validationStart,
      roleEnd: assignment.validationEnd,
      effectiveRoleEnd: null
    };
  }
  return {
    splitId: assignment.splitId,
    splitIndex: assignment.splitIndex,
    splitRole: assignment.splitRole,
    roleStart: assignment.testStart!,
    roleEnd: assignment.testEnd!,
    effectiveRoleEnd: null
  };
}

function trainEndExcludingEmbargo(
  assignment: ValidationSplitAssignment
): string {
  if (assignment.embargoDurationDays === 0) {
    return assignment.trainEnd;
  }

  const trainStartMs = Date.parse(assignment.trainStart);
  const trainEndMs = Date.parse(assignment.trainEnd);
  const validationStartMs = Date.parse(assignment.validationStart);
  const embargoStartMs =
    validationStartMs - assignment.embargoDurationDays * DAY_MS;
  const effectiveTrainEndMs = Math.min(trainEndMs, embargoStartMs - 1);

  if (effectiveTrainEndMs < trainStartMs) {
    throw new Error(
      "validation split train window has no non-embargo replay range"
    );
  }

  return new Date(effectiveTrainEndMs).toISOString();
}
