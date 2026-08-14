import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import { z } from "zod";

import {
  OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION,
  officialBrokerObservedCalendarResponseParserOptionsSchema,
  officialBrokerObservedCalendarResponseSchema,
  parseOfficialBrokerObservedCalendarResponse
} from "./officialBrokerObservedCalendarResponse.js";

export const OFFICIAL_TOSS_OPEN_API_CALENDAR_COMPATIBILITY_SCHEMA_VERSION =
  "official_toss_open_api_calendar_compatibility.v1";
export const OFFICIAL_TOSS_OPEN_API_CALENDAR_API_CONTRACT_VERSION = "1.2.14";
export const OFFICIAL_TOSS_OPEN_API_CALENDAR_OPENAPI_VERSION = "3.1.0";
export const OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_URL =
  "https://openapi.tossinvest.com/openapi-docs/latest/openapi.json";
export const OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_SHA256 =
  "sha256:d29f9079a557c0b6affcec330aa131f93b09fd49932354668e3dc4524cd42180";
export const OFFICIAL_TOSS_OPEN_API_CALENDAR_SNAPSHOT_SHA256 =
  "sha256:a112d11d3933653f6cefb34b647ed6e6f763a55a1bf0266c7fc086fc02223e63";
export const OFFICIAL_TOSS_OPEN_API_CALENDAR_SERVER_ORIGIN =
  "https://openapi.tossinvest.com";

const rawResponseBytesSchema = z
  .instanceof(Uint8Array)
  .refine(
    (value) => value.byteLength > 0,
    "calendar compatibility raw response bytes must be non-empty"
  );

const compatibilityInputSchema =
  officialBrokerObservedCalendarResponseParserOptionsSchema
    .safeExtend({
      rawOpenApiDocumentBytes: rawResponseBytesSchema,
      rawResponseBytes: rawResponseBytesSchema
    })
    .strict();

const operationSchema = z.discriminatedUnion("market", [
  z
    .object({
      market: z.literal("KR"),
      method: z.literal("GET"),
      path: z.literal("/api/v1/market-calendar/KR"),
      operationId: z.literal("getKrMarketCalendar"),
      responseSchemaRef: z.literal(
        "#/components/schemas/KrMarketCalendarResponse"
      )
    })
    .strict(),
  z
    .object({
      market: z.literal("US"),
      method: z.literal("GET"),
      path: z.literal("/api/v1/market-calendar/US"),
      operationId: z.literal("getUsMarketCalendar"),
      responseSchemaRef: z.literal(
        "#/components/schemas/UsMarketCalendarResponse"
      )
    })
    .strict()
]);

const apiContractSchema = z
  .object({
    apiContractVersion: z.literal(
      OFFICIAL_TOSS_OPEN_API_CALENDAR_API_CONTRACT_VERSION
    ),
    openApiVersion: z.literal(OFFICIAL_TOSS_OPEN_API_CALENDAR_OPENAPI_VERSION),
    documentUrl: z.literal(OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_URL),
    documentSha256: z.literal(
      OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_SHA256
    ),
    serverOrigin: z.literal(OFFICIAL_TOSS_OPEN_API_CALENDAR_SERVER_ORIGIN),
    responseParserContractVersion: z.literal(
      OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION
    ),
    operation: operationSchema
  })
  .strict();

export const officialTossOpenApiCalendarCompatibilityResultSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_TOSS_OPEN_API_CALENDAR_COMPATIBILITY_SCHEMA_VERSION
    ),
    mode: z.literal("paper_only"),
    sourceEvidenceClass: z.literal("official_broker_observed"),
    replayEvidenceClass: z.literal("observed_session_only"),
    compatibilityStatus: z.literal("compatible"),
    compatibilityScope: z.literal("pinned_document_examples_only"),
    evidenceHandoffStatus: z.literal(
      "blocked_pending_version_aware_evidence"
    ),
    providerDeploymentVersion: z.literal("not_claimed"),
    requestedDate: officialBrokerObservedCalendarResponseParserOptionsSchema.shape
      .requestedDate,
    apiContract: apiContractSchema,
    response: officialBrokerObservedCalendarResponseSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.response.market !== value.apiContract.operation.market ||
      value.response.requestedDate !== value.requestedDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["response"],
        message:
          "calendar compatibility response must match operation market and requested date"
      });
    }
  });

export type OfficialTossOpenApiCalendarCompatibilityResult = z.infer<
  typeof officialTossOpenApiCalendarCompatibilityResultSchema
>;

const OPERATION_BY_MARKET = {
  KR: {
    market: "KR",
    method: "GET",
    path: "/api/v1/market-calendar/KR",
    operationId: "getKrMarketCalendar",
    responseSchemaRef: "#/components/schemas/KrMarketCalendarResponse"
  },
  US: {
    market: "US",
    method: "GET",
    path: "/api/v1/market-calendar/US",
    operationId: "getUsMarketCalendar",
    responseSchemaRef: "#/components/schemas/UsMarketCalendarResponse"
  }
} as const;

export function verifyOfficialTossOpenApiCalendarCompatibility(
  value: unknown
): OfficialTossOpenApiCalendarCompatibilityResult {
  const input = compatibilityInputSchema.parse(value);
  const rawResponse = parseRawResponseBytes(input.rawResponseBytes);
  verifyPinnedOpenApiDocument(
    input.rawOpenApiDocumentBytes,
    input.market,
    rawResponse
  );
  const response = parseOfficialBrokerObservedCalendarResponse(rawResponse, {
    market: input.market,
    requestedDate: input.requestedDate
  });

  return officialTossOpenApiCalendarCompatibilityResultSchema.parse({
    schemaVersion: OFFICIAL_TOSS_OPEN_API_CALENDAR_COMPATIBILITY_SCHEMA_VERSION,
    mode: "paper_only",
    sourceEvidenceClass: "official_broker_observed",
    replayEvidenceClass: "observed_session_only",
    compatibilityStatus: "compatible",
    compatibilityScope: "pinned_document_examples_only",
    evidenceHandoffStatus: "blocked_pending_version_aware_evidence",
    providerDeploymentVersion: "not_claimed",
    requestedDate: input.requestedDate,
    apiContract: {
      apiContractVersion: OFFICIAL_TOSS_OPEN_API_CALENDAR_API_CONTRACT_VERSION,
      openApiVersion: OFFICIAL_TOSS_OPEN_API_CALENDAR_OPENAPI_VERSION,
      documentUrl: OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_URL,
      documentSha256: OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_SHA256,
      serverOrigin: OFFICIAL_TOSS_OPEN_API_CALENDAR_SERVER_ORIGIN,
      responseParserContractVersion:
        OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION,
      operation: OPERATION_BY_MARKET[input.market]
    },
    response
  });
}

function parseRawResponseBytes(rawResponseBytes: Uint8Array): unknown {
  return parseJsonBytes(rawResponseBytes, "raw response");
}

function verifyPinnedOpenApiDocument(
  rawDocumentBytes: Uint8Array,
  market: "KR" | "US",
  rawResponse: unknown
): void {
  const documentSha256 = `sha256:${createHash("sha256")
    .update(rawDocumentBytes)
    .digest("hex")}`;
  if (documentSha256 !== OFFICIAL_TOSS_OPEN_API_CALENDAR_SNAPSHOT_SHA256) {
    throw new Error("calendar compatibility OpenAPI snapshot hash mismatch");
  }

  const document = pinnedOpenApiDocumentSchema.parse(
    parseJsonBytes(rawDocumentBytes, "OpenAPI document")
  );
  const paths = document.paths as Record<
    string,
    {
      get?: {
        operationId?: string;
        responses?: Record<
          string,
          {
            content?: Record<
              string,
              {
                schema?: {
                  allOf?: Array<{
                    properties?: { result?: { $ref?: string } };
                  }>;
                };
                examples?: Record<string, unknown>;
              }
            >;
          }
        >;
      };
    }
  >;
  for (const operation of Object.values(OPERATION_BY_MARKET)) {
    const get = paths[operation.path]?.get;
    if (
      get?.operationId !== operation.operationId ||
      get.responses?.["200"]?.content?.["application/json"]?.schema?.allOf?.[1]
        ?.properties?.result?.$ref !== operation.responseSchemaRef ||
      Object.keys(
        get.responses?.["200"]?.content?.["application/json"]?.examples ?? {}
      ).length === 0
    ) {
      throw new Error(
        `calendar compatibility OpenAPI operation binding mismatch: ${operation.market}`
      );
    }
  }

  const operation = OPERATION_BY_MARKET[market];
  const examples =
    paths[operation.path]?.get?.responses?.["200"]?.content?.[
      "application/json"
    ]?.examples ?? {};
  const matchesPinnedExample = Object.values(examples).some(
    (example) =>
      isExampleValue(example) &&
      JSON.stringify(example.value) === JSON.stringify(rawResponse)
  );
  if (!matchesPinnedExample) {
    throw new Error(
      `calendar compatibility response must match a pinned ${market} example`
    );
  }
}

function isExampleValue(value: unknown): value is { value: unknown } {
  return typeof value === "object" && value !== null && "value" in value;
}

const pinnedOpenApiDocumentSchema = z
  .object({
    snapshotSchemaVersion: z.literal(
      "official_toss_open_api_calendar_snapshot.v1"
    ),
    sourceDocumentSha256: z.literal(
      OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_SHA256
    ),
    openapi: z.literal(OFFICIAL_TOSS_OPEN_API_CALENDAR_OPENAPI_VERSION),
    info: z
      .object({
        version: z.literal(
          OFFICIAL_TOSS_OPEN_API_CALENDAR_API_CONTRACT_VERSION
        )
      })
      .passthrough(),
    servers: z
      .array(
        z
          .object({
            url: z.literal(OFFICIAL_TOSS_OPEN_API_CALENDAR_SERVER_ORIGIN)
          })
          .passthrough()
      )
      .min(1),
    paths: z.record(z.string(), z.unknown())
  })
  .passthrough();

function parseJsonBytes(rawBytes: Uint8Array, label: string): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
  } catch {
    throw new Error(`calendar compatibility ${label} bytes must be valid UTF-8`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`calendar compatibility ${label} bytes must be valid JSON`);
  }
}
