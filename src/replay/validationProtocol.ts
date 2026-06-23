import { z } from "zod";

import { isoDateTimeSchema } from "../domain/schemas.js";

export const validationProtocolSchema = z.enum(["walk_forward"]);

export const validationSplitRoleSchema = z.enum([
  "train",
  "validation",
  "test"
]);

export const validationSplitSchema = z
  .object({
    validationProtocol: validationProtocolSchema,
    splitId: z.string().trim().min(1),
    splitIndex: z.number().int().nonnegative(),
    trainStart: isoDateTimeSchema,
    trainEnd: isoDateTimeSchema,
    validationStart: isoDateTimeSchema,
    validationEnd: isoDateTimeSchema,
    testStart: isoDateTimeSchema.nullable(),
    testEnd: isoDateTimeSchema.nullable(),
    purgeDurationDays: z.number().int().nonnegative(),
    embargoDurationDays: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((value, context) => {
    validateChronologicalRange(
      value.trainStart,
      value.trainEnd,
      "train",
      context
    );
    validateChronologicalRange(
      value.validationStart,
      value.validationEnd,
      "validation",
      context
    );
    if (
      (value.testStart === null && value.testEnd !== null) ||
      (value.testStart !== null && value.testEnd === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "testStart and testEnd must both be null or both be present"
      });
      return;
    }
    if (Date.parse(value.trainEnd) >= Date.parse(value.validationStart)) {
      context.addIssue({
        code: "custom",
        message: "trainEnd must be before validationStart"
      });
    }
    if (value.testStart !== null && value.testEnd !== null) {
      validateChronologicalRange(
        value.testStart,
        value.testEnd,
        "test",
        context
      );
      if (Date.parse(value.validationEnd) >= Date.parse(value.testStart)) {
        context.addIssue({
          code: "custom",
          message: "validationEnd must be before testStart"
        });
      }
    }
  });

export const validationSplitAssignmentSchema = validationSplitSchema
  .safeExtend({
    splitRole: validationSplitRoleSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.splitRole === "test" &&
      (value.testStart === null || value.testEnd === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["splitRole"],
        message: "test splitRole requires testStart and testEnd"
      });
    }
  });

export type ValidationProtocol = z.infer<typeof validationProtocolSchema>;
export type ValidationSplitRole = z.infer<typeof validationSplitRoleSchema>;
export type ValidationSplit = z.infer<typeof validationSplitSchema>;
export type ValidationSplitAssignment = z.infer<
  typeof validationSplitAssignmentSchema
>;

function validateChronologicalRange(
  start: string,
  end: string,
  label: string,
  context: z.RefinementCtx
): void {
  if (Date.parse(start) > Date.parse(end)) {
    context.addIssue({
      code: "custom",
      message: `${label}Start must be before or equal to ${label}End`
    });
  }
}
