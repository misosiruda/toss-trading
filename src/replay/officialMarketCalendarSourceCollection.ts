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
const exceptionCoverageRoleSchema = z.enum([
  "holiday_schedule",
  "session_hours_exception_schedule",
  "special_closure_schedule"
]);
const REQUIRED_EXCEPTION_COVERAGE_CONTRACTS = {
  KRX: {
    contractVersion: "krx_exception_coverage.v1",
    roles: [
      "holiday_schedule",
      "session_hours_exception_schedule",
      "special_closure_schedule"
    ]
  },
  NYSE: {
    contractVersion: "nyse_exception_coverage.v1",
    roles: [
      "holiday_schedule",
      "session_hours_exception_schedule",
      "special_closure_schedule"
    ]
  }
} as const;
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, "calendar date must be valid");
const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "local time must use HH:mm");
const identifierSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "identifier must use the registered ASCII grammar"
  );

const regularSessionHoursSchema = z
  .object({
    openLocalTime: localTimeSchema,
    closeLocalTime: localTimeSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (minutes(value.openLocalTime) >= minutes(value.closeLocalTime)) {
      issue(
        context,
        ["closeLocalTime"],
        "document regular session open must be before close"
      );
    }
  });

const documentScheduleCoverageIntervalSchema = z
  .object({
    coverageRole: exceptionCoverageRoleSchema,
    startDate: calendarDateSchema,
    endDate: calendarDateSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startDate > value.endDate) {
      issue(
        context,
        ["endDate"],
        "document schedule coverage start must not follow end"
      );
    }
  });

export const officialMarketCalendarSourceCollectionDocumentSchema = z
  .object({
    documentId: identifierSchema,
    metadataHash: sha256HashSchema,
    sourceDocumentHash: sha256HashSchema,
    evidenceRoles: z.array(evidenceRoleSchema).min(1),
    regularSessionHours: regularSessionHoursSchema.nullable(),
    scheduleCoverageIntervals: z.array(
      documentScheduleCoverageIntervalSchema
    ),
    applicabilityStartDate: calendarDateSchema.nullable(),
    applicabilityEndDate: calendarDateSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    validateCanonicalStrings(value.evidenceRoles, context, ["evidenceRoles"]);
    let previousKey: string | null = null;
    const previousEndByRole = new Map<string, string>();
    for (const [index, interval] of value.scheduleCoverageIntervals.entries()) {
      const key = `${interval.coverageRole}:${interval.startDate}:${interval.endDate}`;
      if (previousKey !== null && compareCanonicalText(previousKey, key) >= 0) {
        issue(
          context,
          ["scheduleCoverageIntervals", index],
          "document schedule coverage must use canonical role and date order"
        );
      }
      previousKey = key;
      if (!value.evidenceRoles.includes(interval.coverageRole)) {
        issue(
          context,
          ["scheduleCoverageIntervals", index, "coverageRole"],
          "document schedule coverage role must be declared in evidenceRoles"
        );
      }
      const previousEnd = previousEndByRole.get(interval.coverageRole);
      if (
        previousEnd !== undefined &&
        interval.startDate <= nextCalendarDate(previousEnd)
      ) {
        issue(
          context,
          ["scheduleCoverageIntervals", index],
          "same-role document schedule coverage intervals must be merged"
        );
      }
      previousEndByRole.set(interval.coverageRole, interval.endDate);
    }
    if (
      value.evidenceRoles.includes("session_hours") !==
      (value.regularSessionHours !== null)
    ) {
      issue(
        context,
        ["regularSessionHours"],
        "session_hours evidence and parsed regular session hours must coexist"
      );
    }
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
    coverageRole: exceptionCoverageRoleSchema,
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
    documents: z.array(officialMarketCalendarSourceCollectionDocumentSchema).min(1),
    requiredExceptionCoverageRoles: z
      .object({
        contractVersion: identifierSchema,
        roles: z
          .array(exceptionCoverageRoleSchema)
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
export type OfficialMarketCalendarSourceCollectionDocument = z.infer<
  typeof officialMarketCalendarSourceCollectionDocumentSchema
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
  const requiredContract = REQUIRED_EXCEPTION_COVERAGE_CONTRACTS[value.exchange];
  if (
    value.requiredExceptionCoverageRoles.contractVersion !==
      requiredContract.contractVersion ||
    value.requiredExceptionCoverageRoles.roles.length !==
      requiredContract.roles.length ||
    requiredContract.roles.some(
      (role, index) =>
        value.requiredExceptionCoverageRoles.roles[index] !== role
    )
  ) {
    issue(
      context,
      ["requiredExceptionCoverageRoles"],
      "required exception coverage contract does not match exchange registry"
    );
  }

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
    if (previousKey !== null && compareCanonicalText(previousKey, key) >= 0) {
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
    const sourceCoverage = interval.documentIds.flatMap((documentId) =>
      (documents.get(documentId)?.scheduleCoverageIntervals ?? [])
        .filter(
          (documentInterval) =>
            documentInterval.coverageRole === interval.coverageRole
        )
        .map((documentInterval) => ({
          startDate: documentInterval.startDate,
          endDate: documentInterval.endDate
        }))
    );
    if (!coversDateRange(sourceCoverage, interval.startDate, interval.endDate)) {
      issue(
        context,
        ["exceptionScheduleIntervals", index, "documentIds"],
        "exception interval exceeds referenced document role coverage"
      );
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
      if (
        document.regularSessionHours === null ||
        document.regularSessionHours.openLocalTime !== regime.openLocalTime ||
        document.regularSessionHours.closeLocalTime !== regime.closeLocalTime
      ) {
        issue(
          context,
          ["regularSessionRegimes", index, "documentIds"],
          "regime hours must match every referenced session_hours document"
        );
      }
      if (document.applicabilityStartDate === null) {
        issue(context, ["regularSessionRegimes", index, "documentIds"], "regime document must declare applicability start");
        continue;
      }
      applicabilityIntervals.push({
        startDate:
          document.applicabilityStartDate < value.coverageStartDate
            ? value.coverageStartDate
            : document.applicabilityStartDate,
        endDate: resolveApplicabilityEnd(
          documentId,
          document.applicabilityEndDate,
          value,
          index,
          context
        )
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
  const ordered = [...intervals].sort((left, right) =>
    compareCanonicalText(left.startDate, right.startDate)
  );
  let expectedStart = regimeStart;
  for (const interval of ordered) {
    if (interval.startDate < regimeStart || interval.endDate > regimeEnd) {
      issue(
        context,
        ["regularSessionRegimes", regimeIndex, "documentIds"],
        "regime document applicability extends outside regime without supersession"
      );
    }
    if (interval.endDate < expectedStart) {
      continue;
    }
    if (interval.startDate > expectedStart) {
      issue(
        context,
        ["regularSessionRegimes", regimeIndex, "documentIds"],
        "regime document applicability union must cover the regime without gaps"
      );
    }
    const nextStart = nextCalendarDate(interval.endDate);
    if (nextStart > expectedStart) {
      expectedStart = nextStart;
    }
  }
  if (ordered.length === 0 || expectedStart !== nextCalendarDate(regimeEnd)) {
    issue(
      context,
      ["regularSessionRegimes", regimeIndex, "documentIds"],
      "regime document applicability must cover the regime interval"
    );
  }
}

function resolveApplicabilityEnd(
  documentId: string,
  declaredEnd: string | null,
  value: OfficialMarketCalendarSourceCollectionPayload,
  regimeIndex: number,
  context: z.RefinementCtx
): string {
  if (declaredEnd !== null) {
    return declaredEnd > value.coverageEndDate
      ? value.coverageEndDate
      : declaredEnd;
  }
  const supersessions = value.regularSessionSupersessions.filter(
    (supersession) =>
      supersession.supersededDocumentIds.includes(documentId)
  );
  if (supersessions.length > 1) {
    issue(
      context,
      ["regularSessionRegimes", regimeIndex, "documentIds"],
      "open-ended regime document has ambiguous supersessions"
    );
    return value.coverageEndDate;
  }
  return supersessions[0]?.derivedSupersededEndDate ?? value.coverageEndDate;
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
    if (
      ids.has(supersession.supersessionId) ||
      (previousId !== null &&
        compareCanonicalText(previousId, supersession.supersessionId) >= 0)
    ) {
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
    for (const documentId of supersession.supersededDocumentIds) {
      if (
        !documentCoversDate(
          documents.get(documentId),
          supersession.derivedSupersededEndDate
        )
      ) {
        issue(
          context,
          ["regularSessionSupersessions", index, "supersededDocumentIds"],
          "superseded documents must cover the derived boundary date"
        );
      }
    }
    for (const documentId of supersession.replacementDocumentIds) {
      if (
        !documentCoversDate(
          documents.get(documentId),
          supersession.replacementEffectiveStartDate
        )
      ) {
        issue(
          context,
          ["regularSessionSupersessions", index, "replacementDocumentIds"],
          "replacement documents must cover the effective start date"
        );
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

function documentCoversDate(
  document:
    | OfficialMarketCalendarSourceCollectionPayload["documents"][number]
    | undefined,
  date: string
): boolean {
  return (
    document?.applicabilityStartDate !== null &&
    document?.applicabilityStartDate !== undefined &&
    document.applicabilityStartDate <= date &&
    (document.applicabilityEndDate === null ||
      document.applicabilityEndDate >= date)
  );
}

function coversDateRange(
  intervals: Array<{ startDate: string; endDate: string }>,
  targetStart: string,
  targetEnd: string
): boolean {
  let expectedStart = targetStart;
  const ordered = [...intervals].sort((left, right) =>
    compareCanonicalText(left.startDate, right.startDate)
  );
  for (const interval of ordered) {
    if (interval.endDate < expectedStart || interval.startDate > targetEnd) {
      continue;
    }
    if (interval.startDate > expectedStart) {
      return false;
    }
    if (interval.endDate >= targetEnd) {
      return true;
    }
    const next = nextCalendarDate(interval.endDate);
    if (next > expectedStart) {
      expectedStart = next;
    }
  }
  return false;
}

function validateCanonicalStrings(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[]
): void {
  const canonical = [...new Set(values)].sort(compareCanonicalText);
  if (canonical.length !== values.length || canonical.some((value, index) => value !== values[index])) {
    issue(context, path, "values must be unique and use canonical lexical order");
  }
}

function compareCanonicalText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
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
