import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_SOURCE_COLLECTION_SCHEMA_VERSION =
  "official_market_calendar_source_collection.v1";

export const OFFICIAL_CALENDAR_SOURCE_EVIDENCE_ROLES = [
  "holiday_rows",
  "holiday_schedule",
  "session_hours",
  "session_hours_exception_schedule",
  "special_closure",
  "special_closure_schedule"
] as const;

const exchangeSchema = z.enum(["KRX", "NYSE"]);
const evidenceRoleSchema = z.enum(OFFICIAL_CALENDAR_SOURCE_EVIDENCE_ROLES);
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, "calendar date must be valid");
const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "local time must use HH:mm");
const identifierSchema = z.string().trim().min(1);

const documentSchema = z
  .object({
    documentId: identifierSchema,
    metadataHash: sha256HashSchema,
    sourceDocumentHash: sha256HashSchema,
    evidenceRoles: z.array(evidenceRoleSchema).min(1),
    applicabilityStartDate: calendarDateSchema.nullable(),
    applicabilityEndDate: calendarDateSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    validateCanonicalStrings(value.evidenceRoles, context, ["evidenceRoles"]);
    if (
      value.applicabilityStartDate !== null &&
      value.applicabilityEndDate !== null &&
      value.applicabilityStartDate > value.applicabilityEndDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["applicabilityEndDate"],
        message: "document applicability start must not follow end"
      });
    }
  });

const exceptionScheduleIntervalSchema = z
  .object({
    coverageRole: z.enum([
      "holiday_schedule",
      "session_hours_exception_schedule",
      "special_closure_schedule"
    ]),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
    documentIds: z.array(identifierSchema).min(1)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startDate > value.endDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "exception schedule interval start must not follow end"
      });
    }
    validateCanonicalStrings(value.documentIds, context, ["documentIds"]);
  });

const regularSessionRegimeSchema = z
  .object({
    regimeId: identifierSchema,
    effectiveStartDate: calendarDateSchema,
    effectiveEndDate: calendarDateSchema.nullable(),
    openLocalTime: localTimeSchema,
    closeLocalTime: localTimeSchema,
    documentIds: z.array(identifierSchema).min(1)
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.effectiveEndDate !== null &&
      value.effectiveStartDate > value.effectiveEndDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectiveEndDate"],
        message: "regular session regime start must not follow end"
      });
    }
    if (minutes(value.openLocalTime) >= minutes(value.closeLocalTime)) {
      context.addIssue({
        code: "custom",
        path: ["closeLocalTime"],
        message: "regular session regime open must be before close"
      });
    }
    validateCanonicalStrings(value.documentIds, context, ["documentIds"]);
  });

const regularSessionSupersessionSchema = z
  .object({
    supersessionId: identifierSchema,
    supersededRegimeId: identifierSchema,
    replacementRegimeId: identifierSchema,
    supersededDocumentIds: z.array(identifierSchema).min(1),
    replacementDocumentIds: z.array(identifierSchema).min(1),
    replacementEffectiveStartDate: calendarDateSchema,
    derivedSupersededEndDate: calendarDateSchema
  })
  .strict()
  .superRefine((value, context) => {
    validateCanonicalStrings(value.supersededDocumentIds, context, [
      "supersededDocumentIds"
    ]);
    validateCanonicalStrings(value.replacementDocumentIds, context, [
      "replacementDocumentIds"
    ]);
    if (
      previousCalendarDate(value.replacementEffectiveStartDate) !==
      value.derivedSupersededEndDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["derivedSupersededEndDate"],
        message:
          "derived superseded end must immediately precede replacement start"
      });
    }
  });

const sourceCollectionBaseSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SOURCE_COLLECTION_SCHEMA_VERSION
    ),
    collectionId: identifierSchema,
    exchange: exchangeSchema,
    coverageStartDate: calendarDateSchema,
    coverageEndDate: calendarDateSchema,
    documents: z.array(documentSchema).min(1),
    requiredExceptionCoverageRoles: z
      .object({
        contractVersion: identifierSchema,
        roles: z
          .array(
            z.enum([
              "holiday_schedule",
              "session_hours_exception_schedule",
              "special_closure_schedule"
            ])
          )
          .min(1)
      })
      .strict(),
    exceptionScheduleIntervals: z.array(exceptionScheduleIntervalSchema),
    regularSessionRegimes: z.array(regularSessionRegimeSchema).min(1),
    regularSessionSupersessions: z.array(
      regularSessionSupersessionSchema
    )
  })
  .strict()
  .superRefine(validateCollection);

export const officialMarketCalendarSourceCollectionSchema =
  sourceCollectionBaseSchema
    .safeExtend({ collectionHash: sha256HashSchema })
    .strict();

export type OfficialMarketCalendarSourceCollectionPayload = z.infer<
  typeof sourceCollectionBaseSchema
>;
export type OfficialMarketCalendarSourceCollection = z.infer<
  typeof officialMarketCalendarSourceCollectionSchema
>;

export function createOfficialMarketCalendarSourceCollectionHash(
  value: OfficialMarketCalendarSourceCollectionPayload
): Sha256Hash {
  return createReplayResearchHash(sourceCollectionBaseSchema.parse(value));
}

export function parseOfficialMarketCalendarSourceCollection(
  value: unknown
): OfficialMarketCalendarSourceCollection {
  const collection = officialMarketCalendarSourceCollectionSchema.parse(value);
  const { collectionHash, ...payload } = collection;
  if (
    collectionHash !== createOfficialMarketCalendarSourceCollectionHash(payload)
  ) {
    throw new Error("official market calendar source collection hash mismatch");
  }
  return collection;
}

function validateCollection(
  value: OfficialMarketCalendarSourceCollectionPayload,
  context: z.RefinementCtx
): void {
  if (value.coverageStartDate > value.coverageEndDate) {
    issue(context, ["coverageEndDate"], "collection coverage start must not follow end");
  }

  validateCanonicalStrings(
    value.documents.map((document) => document.documentId),
    context,
    ["documents"]
  );
  validateCanonicalStrings(
    value.requiredExceptionCoverageRoles.roles,
    context,
    ["requiredExceptionCoverageRoles", "roles"]
  );

  const documents = new Map(
    value.documents.map((document) => [document.documentId, document])
  );
  validateExceptionIntervals(value, documents, context);
  validateRegimes(value, documents, context);
  validateSupersessions(value, documents, context);
}

function validateExceptionIntervals(
  value: OfficialMarketCalendarSourceCollectionPayload,
  documents: Map<string, OfficialMarketCalendarSourceCollectionPayload["documents"][number]>,
  context: z.RefinementCtx
): void {
  let previousKey: string | null = null;
  const previousEndByRole = new Map<string, string>();
  for (const [index, interval] of value.exceptionScheduleIntervals.entries()) {
    const key = `${interval.coverageRole}:${interval.startDate}:${interval.endDate}`;
    if (previousKey !== null && previousKey.localeCompare(key) >= 0) {
      issue(context, ["exceptionScheduleIntervals", index], "exception schedule intervals must use canonical role and date order");
    }
    previousKey = key;
    if (
      interval.startDate < value.coverageStartDate ||
      interval.endDate > value.coverageEndDate
    ) {
      issue(context, ["exceptionScheduleIntervals", index], "exception schedule interval must remain inside collection coverage");
    }
    const previousEnd = previousEndByRole.get(interval.coverageRole);
    if (
      previousEnd !== undefined &&
      interval.startDate <= nextCalendarDate(previousEnd)
    ) {
      issue(context, ["exceptionScheduleIntervals", index], "same-role exception schedule intervals must be merged");
    }
    previousEndByRole.set(interval.coverageRole, interval.endDate);
    for (const documentId of interval.documentIds) {
      const document = documents.get(documentId);
      if (document === undefined || !document.evidenceRoles.includes(interval.coverageRole)) {
        issue(context, ["exceptionScheduleIntervals", index, "documentIds"], "exception interval document must exist and declare its coverage role");
      }
    }
  }

  for (const role of value.requiredExceptionCoverageRoles.roles) {
    const intervals = value.exceptionScheduleIntervals.filter(
      (interval) => interval.coverageRole === role
    );
    let expectedStart = value.coverageStartDate;
    for (const interval of intervals) {
      if (interval.startDate !== expectedStart) {
        issue(
          context,
          ["exceptionScheduleIntervals"],
          `required exception role has a coverage gap: ${role}`
        );
      }
      expectedStart = nextCalendarDate(interval.endDate);
    }
    if (intervals.length === 0 || expectedStart !== nextCalendarDate(value.coverageEndDate)) {
      issue(context, ["exceptionScheduleIntervals"], `required exception role lacks full coverage: ${role}`);
    }
  }
}

function validateRegimes(
  value: OfficialMarketCalendarSourceCollectionPayload,
  documents: Map<string, OfficialMarketCalendarSourceCollectionPayload["documents"][number]>,
  context: z.RefinementCtx
): void {
  const regimeIds = new Set<string>();
  let previousEnd: string | null = null;
  for (const [index, regime] of value.regularSessionRegimes.entries()) {
    if (regimeIds.has(regime.regimeId)) {
      issue(context, ["regularSessionRegimes", index, "regimeId"], "regular session regimeId values must be unique");
    }
    regimeIds.add(regime.regimeId);
    const effectiveEnd = regime.effectiveEndDate ?? value.coverageEndDate;
    if (regime.effectiveStartDate < value.coverageStartDate || effectiveEnd > value.coverageEndDate) {
      issue(context, ["regularSessionRegimes", index], "regular session regime must remain inside collection coverage");
    }
    const expectedStart = previousEnd === null ? value.coverageStartDate : nextCalendarDate(previousEnd);
    if (regime.effectiveStartDate !== expectedStart) {
      issue(context, ["regularSessionRegimes", index], "regular session regimes must cover collection without gaps or overlap");
    }
    previousEnd = effectiveEnd;
    const applicabilityIntervals: Array<{ startDate: string; endDate: string }> = [];
    for (const documentId of regime.documentIds) {
      const document = documents.get(documentId);
      if (document === undefined || !document.evidenceRoles.includes("session_hours")) {
        issue(context, ["regularSessionRegimes", index, "documentIds"], "regime document must exist and declare session_hours evidence");
        continue;
      }
      if (document.applicabilityStartDate === null) {
        issue(context, ["regularSessionRegimes", index, "documentIds"], "regime document must declare applicability start");
        continue;
      }
      applicabilityIntervals.push({
        startDate: document.applicabilityStartDate,
        endDate: document.applicabilityEndDate ?? effectiveEnd
      });
    }
    validateRegimeApplicability(
      applicabilityIntervals,
      regime.effectiveStartDate,
      effectiveEnd,
      index,
      context
    );
  }
  if (previousEnd !== value.coverageEndDate) {
    issue(context, ["regularSessionRegimes"], "regular session regimes must cover collection end");
  }
}

function validateRegimeApplicability(
  intervals: Array<{ startDate: string; endDate: string }>,
  regimeStart: string,
  regimeEnd: string,
  regimeIndex: number,
  context: z.RefinementCtx
): void {
  const ordered = intervals
    .map((interval) => ({
      startDate: interval.startDate < regimeStart ? regimeStart : interval.startDate,
      endDate: interval.endDate > regimeEnd ? regimeEnd : interval.endDate
    }))
    .filter((interval) => interval.startDate <= interval.endDate)
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
  let expectedStart = regimeStart;
  for (const interval of ordered) {
    if (interval.startDate !== expectedStart) {
      issue(
        context,
        ["regularSessionRegimes", regimeIndex, "documentIds"],
        "regime document applicability must cover the regime without gaps or overlap"
      );
    }
    expectedStart = nextCalendarDate(interval.endDate);
  }
  if (ordered.length === 0 || expectedStart !== nextCalendarDate(regimeEnd)) {
    issue(
      context,
      ["regularSessionRegimes", regimeIndex, "documentIds"],
      "regime document applicability must cover the regime interval"
    );
  }
}

function validateSupersessions(
  value: OfficialMarketCalendarSourceCollectionPayload,
  documents: Map<string, OfficialMarketCalendarSourceCollectionPayload["documents"][number]>,
  context: z.RefinementCtx
): void {
  const regimes = new Map(
    value.regularSessionRegimes.map((regime) => [regime.regimeId, regime])
  );
  const ids = new Set<string>();
  let previousId: string | null = null;
  for (const [index, supersession] of value.regularSessionSupersessions.entries()) {
    if (ids.has(supersession.supersessionId) || (previousId !== null && previousId.localeCompare(supersession.supersessionId) >= 0)) {
      issue(context, ["regularSessionSupersessions", index, "supersessionId"], "supersessions must have unique canonical IDs");
    }
    ids.add(supersession.supersessionId);
    previousId = supersession.supersessionId;
    const superseded = regimes.get(supersession.supersededRegimeId);
    const replacement = regimes.get(supersession.replacementRegimeId);
    if (
      superseded?.effectiveEndDate !== supersession.derivedSupersededEndDate ||
      replacement?.effectiveStartDate !== supersession.replacementEffectiveStartDate
    ) {
      issue(context, ["regularSessionSupersessions", index], "supersession boundary must match referenced regimes");
    }
    for (const documentId of [...supersession.supersededDocumentIds, ...supersession.replacementDocumentIds]) {
      if (!documents.get(documentId)?.evidenceRoles.includes("session_hours")) {
        issue(context, ["regularSessionSupersessions", index], "supersession documents must exist and declare session_hours evidence");
      }
    }
    if (
      superseded === undefined ||
      supersession.supersededDocumentIds.some(
        (documentId) => !superseded.documentIds.includes(documentId)
      ) ||
      replacement === undefined ||
      supersession.replacementDocumentIds.some(
        (documentId) => !replacement.documentIds.includes(documentId)
      )
    ) {
      issue(
        context,
        ["regularSessionSupersessions", index],
        "supersession documents must belong to their referenced regimes"
      );
    }
  }
}

function validateCanonicalStrings(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[]
): void {
  const canonical = [...new Set(values)].sort((left, right) => left.localeCompare(right));
  if (canonical.length !== values.length || canonical.some((value, index) => value !== values[index])) {
    issue(context, path, "values must be unique and use canonical lexical order");
  }
}

function issue(context: z.RefinementCtx, path: PropertyKey[], message: string): void {
  context.addIssue({ code: "custom", path, message });
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour! * 60 + minute!;
}

function nextCalendarDate(value: string): string {
  return shiftCalendarDate(value, 1);
}

function previousCalendarDate(value: string): string {
  return shiftCalendarDate(value, -1);
}

function shiftCalendarDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isValidCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
