import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import {
  officialMarketCalendarCanonicalJsonObjectSchema,
  verifyOfficialMarketCalendarCanonicalJsonObject
} from "./officialMarketCalendarCanonicalJsonObject.js";
import { OFFICIAL_CALENDAR_SOURCE_EVIDENCE_ROLES } from "./officialMarketCalendarSourceCollection.js";
import {
  officialMarketCalendarSourceParserInputBindingSchema,
  openOfficialMarketCalendarSourceParserInputBinding
} from "./officialMarketCalendarSourceParserInputBinding.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_RESULT_SCHEMA_VERSION =
  "official_market_calendar_source_parser_result.v1";

const identifierSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "identifier must use the registered ASCII grammar"
  );
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, "calendar date must be valid");
const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const evidenceRoleSchema = z.enum(OFFICIAL_CALENDAR_SOURCE_EVIDENCE_ROLES);
const rowEvidenceRoleSchema = z.enum([
  "holiday_rows",
  "session_hours",
  "special_closure"
]);
const scheduleCoverageRoleSchema = z.enum([
  "holiday_schedule",
  "session_hours_exception_schedule",
  "special_closure_schedule"
]);
const parsedRowSchema = z
  .object({
    exchangeDate: calendarDateSchema,
    evidenceRoles: z.array(rowEvidenceRoleSchema).min(1),
    fields: officialMarketCalendarCanonicalJsonObjectSchema
  })
  .strict();
const scheduleCoverageIntervalSchema = z
  .object({
    coverageRole: scheduleCoverageRoleSchema,
    startDate: calendarDateSchema,
    endDate: calendarDateSchema
  })
  .strict();
const regularSessionHoursSchema = z
  .object({
    openLocalTime: localTimeSchema,
    closeLocalTime: localTimeSchema
  })
  .strict();

export const officialMarketCalendarSourceParserOutputSchema = z
  .object({
    schemaVersion: identifierSchema,
    parsedRows: z.array(parsedRowSchema),
    regularSessionHours: regularSessionHoursSchema.nullable(),
    scheduleCoverageIntervals: z.array(scheduleCoverageIntervalSchema),
    applicabilityStartDate: calendarDateSchema.nullable(),
    applicabilityEndDate: calendarDateSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    let previousDate: string | null = null;
    for (const [index, row] of value.parsedRows.entries()) {
      if (previousDate !== null && previousDate >= row.exchangeDate) {
        issue(
          context,
          ["parsedRows", index, "exchangeDate"],
          "parsed rows must use unique ascending exchange dates"
        );
      }
      previousDate = row.exchangeDate;
      validateCanonicalStrings(
        row.evidenceRoles,
        context,
        ["parsedRows", index, "evidenceRoles"]
      );
      try {
        verifyOfficialMarketCalendarCanonicalJsonObject(
          row.fields,
          `$.parsedRows[${index}].fields`
        );
      } catch (error) {
        issue(
          context,
          ["parsedRows", index, "fields"],
          error instanceof Error ? error.message : "row fields are not canonical"
        );
      }
    }
    let previousIntervalKey: string | null = null;
    const previousIntervalEndByRole = new Map<string, string>();
    for (const [index, interval] of value.scheduleCoverageIntervals.entries()) {
      if (interval.startDate > interval.endDate) {
        issue(
          context,
          ["scheduleCoverageIntervals", index, "endDate"],
          "schedule coverage start must not follow end"
        );
      }
      const key = `${interval.coverageRole}:${interval.startDate}:${interval.endDate}`;
      if (previousIntervalKey !== null && previousIntervalKey >= key) {
        issue(
          context,
          ["scheduleCoverageIntervals", index],
          "schedule coverage must use canonical role and date order"
        );
      }
      previousIntervalKey = key;
      const previousEnd = previousIntervalEndByRole.get(interval.coverageRole);
      if (
        previousEnd !== undefined &&
        interval.startDate <= nextCalendarDate(previousEnd)
      ) {
        issue(
          context,
          ["scheduleCoverageIntervals", index],
          "same-role schedule coverage intervals must be merged"
        );
      }
      previousIntervalEndByRole.set(interval.coverageRole, interval.endDate);
    }
    if (
      value.applicabilityStartDate === null &&
      value.applicabilityEndDate !== null
    ) {
      issue(
        context,
        ["applicabilityEndDate"],
        "applicability end requires a start"
      );
    }
    if (
      value.applicabilityStartDate !== null &&
      value.applicabilityEndDate !== null &&
      value.applicabilityStartDate > value.applicabilityEndDate
    ) {
      issue(
        context,
        ["applicabilityEndDate"],
        "applicability start must not follow end"
      );
    }
    if (
      value.regularSessionHours !== null &&
      minutes(value.regularSessionHours.openLocalTime) >=
        minutes(value.regularSessionHours.closeLocalTime)
    ) {
      issue(
        context,
        ["regularSessionHours", "closeLocalTime"],
        "regular session open must be before close"
      );
    }
    if (
      value.parsedRows.some((row) =>
        row.evidenceRoles.includes("session_hours")
      ) &&
      value.regularSessionHours === null
    ) {
      issue(
        context,
        ["regularSessionHours"],
        "session_hours rows require parsed regular session hours"
      );
    }
  });

const createSourceParserResultInputSchema = z
  .object({
    parserInputBinding: officialMarketCalendarSourceParserInputBindingSchema,
    parserOutput: officialMarketCalendarSourceParserOutputSchema
  })
  .strict();

const sourceParserResultPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_RESULT_SCHEMA_VERSION
    ),
    parserInputBinding: officialMarketCalendarSourceParserInputBindingSchema,
    parserOutput: officialMarketCalendarSourceParserOutputSchema,
    parserContractVersion: identifierSchema,
    parserContractHash: sha256HashSchema,
    parserOutputSchemaVersion: identifierSchema,
    parserOutputHash: sha256HashSchema,
    evidenceRoles: z.array(evidenceRoleSchema).min(1),
    rowCoverageStartDate: calendarDateSchema.nullable(),
    rowCoverageEndDate: calendarDateSchema.nullable(),
    scheduleCoverageIntervals: z.array(scheduleCoverageIntervalSchema),
    applicabilityStartDate: calendarDateSchema.nullable(),
    applicabilityEndDate: calendarDateSchema.nullable(),
    regularSessionHours: regularSessionHoursSchema.nullable(),
    parserResultBound: z.literal(true)
  })
  .strict();

export const officialMarketCalendarSourceParserResultSchema =
  sourceParserResultPayloadSchema
    .safeExtend({ parserResultHash: sha256HashSchema })
    .strict();

export type OfficialMarketCalendarSourceParserOutput = z.infer<
  typeof officialMarketCalendarSourceParserOutputSchema
>;
export type OfficialMarketCalendarSourceParserResult = z.infer<
  typeof officialMarketCalendarSourceParserResultSchema
>;
export type OfficialMarketCalendarSourceParserResultPayload = z.infer<
  typeof sourceParserResultPayloadSchema
>;

interface SourceParserResultOptions {
  sourceBytes: unknown;
  freshnessPolicyRegistry: unknown;
  parserContractRegistry: unknown;
}

export function createOfficialMarketCalendarSourceParserResult(
  input: unknown,
  options: SourceParserResultOptions
): OfficialMarketCalendarSourceParserResult {
  const parsed = createSourceParserResultInputSchema.parse(input);
  const opened = openOfficialMarketCalendarSourceParserInputBinding(
    parsed.parserInputBinding,
    options
  );
  const binding = opened.parserInputBinding;
  const output = parsed.parserOutput;
  if (output.schemaVersion !== binding.parserOutputSchemaVersion) {
    throw new Error(
      "official calendar parser output schema does not match parser contract"
    );
  }
  const evidenceRoles = deriveEvidenceRoles(output);
  const rowCoverageStartDate = output.parsedRows[0]?.exchangeDate ?? null;
  const rowCoverageEndDate =
    output.parsedRows[output.parsedRows.length - 1]?.exchangeDate ?? null;
  const expected = binding.sourceDocumentAcquisitionMetadata;
  const actualSelector = {
    evidenceRoles,
    rowCoverageStartDate,
    rowCoverageEndDate,
    scheduleCoverageIntervals: output.scheduleCoverageIntervals,
    applicabilityStartDate: output.applicabilityStartDate,
    applicabilityEndDate: output.applicabilityEndDate
  };
  const expectedSelector = {
    evidenceRoles: expected.expectedEvidenceRoles,
    rowCoverageStartDate: expected.expectedRowCoverageStartDate,
    rowCoverageEndDate: expected.expectedRowCoverageEndDate,
    scheduleCoverageIntervals: expected.expectedScheduleCoverageIntervals,
    applicabilityStartDate: expected.expectedApplicabilityStartDate,
    applicabilityEndDate: expected.expectedApplicabilityEndDate
  };
  if (!isDeepStrictEqual(actualSelector, expectedSelector)) {
    throw new Error(
      "official calendar parser output claims do not match acquisition selector"
    );
  }
  const payload = sourceParserResultPayloadSchema.parse({
    schemaVersion: OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_RESULT_SCHEMA_VERSION,
    parserInputBinding: binding,
    parserOutput: output,
    parserContractVersion: binding.parserContractVersion,
    parserContractHash: binding.parserContractHash,
    parserOutputSchemaVersion: binding.parserOutputSchemaVersion,
    parserOutputHash: createReplayResearchHash(output),
    ...actualSelector,
    regularSessionHours: output.regularSessionHours,
    parserResultBound: true
  });
  return deepFreeze({
    ...payload,
    parserResultHash: createOfficialMarketCalendarSourceParserResultHash(payload)
  });
}

export function parseOfficialMarketCalendarSourceParserResult(
  value: unknown,
  options: SourceParserResultOptions
): OfficialMarketCalendarSourceParserResult {
  const result = officialMarketCalendarSourceParserResultSchema.parse(value);
  const expected = createOfficialMarketCalendarSourceParserResult(
    {
      parserInputBinding: result.parserInputBinding,
      parserOutput: result.parserOutput
    },
    options
  );
  if (!isDeepStrictEqual(result, expected)) {
    throw new Error(
      "official calendar source parser result does not match verified parser input"
    );
  }
  return deepFreeze(result);
}

export function createOfficialMarketCalendarSourceParserResultHash(
  value: OfficialMarketCalendarSourceParserResultPayload
): Sha256Hash {
  return createReplayResearchHash(sourceParserResultPayloadSchema.parse(value));
}

function deriveEvidenceRoles(
  output: OfficialMarketCalendarSourceParserOutput
): Array<(typeof OFFICIAL_CALENDAR_SOURCE_EVIDENCE_ROLES)[number]> {
  const roles = new Set<(typeof OFFICIAL_CALENDAR_SOURCE_EVIDENCE_ROLES)[number]>();
  for (const row of output.parsedRows) {
    for (const role of row.evidenceRoles) {
      roles.add(role);
    }
  }
  if (output.regularSessionHours !== null) {
    roles.add("session_hours");
  }
  for (const interval of output.scheduleCoverageIntervals) {
    roles.add(interval.coverageRole);
  }
  return [...roles].sort(compareCanonicalText);
}

function validateCanonicalStrings(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[]
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      issue(context, [...path, index], "values must use unique canonical order");
    }
  }
}

function issue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

function compareCanonicalText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour! * 60 + minute!;
}

function isValidCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nextCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
