import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual, TextDecoder } from "node:util";

import {
  DEFAULT_TOSS_OPEN_API_BASE_URL,
  type TossOpenApiAuthConfig
} from "../config/tossOpenApiAuthConfig.js";
import {
  createOfficialBrokerObservedCalendarEphemeralObservation,
  type OfficialBrokerObservedCalendarEphemeralObservation
} from "../replay/officialBrokerObservedCalendarEphemeralObservation.js";
import { createOfficialBrokerObservedCalendarEvidenceV2 } from "../replay/officialBrokerObservedCalendarEvidenceV2.js";
import { verifyOfficialTossOpenApiCalendarCompatibility } from "../replay/officialBrokerObservedCalendarOpenApiCompatibility.js";
import { resolveOfficialMarketCalendarNetworkResponseFreshness } from "../replay/officialMarketCalendarNetworkResponseFreshness.js";
import { verifyOfficialMarketCalendarTransferCompletion } from "../replay/officialMarketCalendarTransferCompletion.js";
import {
  TossOpenApiAuthClient,
  type TossOpenApiAuthClientOptions,
  type TossOpenApiTokenIssuer
} from "./tossOpenApiAuthClient.js";
import {
  createTestOnlyTossOpenApiCalendarNetworkTransport,
  createTossOpenApiCalendarNetworkTransport,
  type TestOnlyTossOpenApiCalendarSocketConnector,
  type TossOpenApiCalendarMarket,
  type TossOpenApiCalendarNetworkClient,
  type TossOpenApiCalendarNetworkObservation
} from "./tossOpenApiCalendarNetworkTransport.js";
import { createTossOpenApiTokenIssuerNetworkTransport } from "./tossOpenApiTokenIssuerNetworkTransport.js";

const PINNED_OPENAPI_SNAPSHOT_URL = new URL(
  "../../src/replay/officialTossCalendarOpenApi-1.2.14.json",
  import.meta.url
);
const CALENDAR_PATHS = {
  KR: "/api/v1/market-calendar/KR",
  US: "/api/v1/market-calendar/US"
} as const;
const PINNED_COMPATIBILITY_EXAMPLES = {
  KR: {
    requestedDate: "2026-03-25",
    exampleName: "businessDay"
  },
  US: {
    requestedDate: "2026-03-25",
    exampleName: "businessDay"
  }
} as const;

export interface TossOpenApiCalendarAcquisitionRequest {
  market: TossOpenApiCalendarMarket;
  date: string;
}

export interface TossOpenApiCalendarAcquisitionClient {
  acquireCalendarObservation(
    request: TossOpenApiCalendarAcquisitionRequest
  ): Promise<OfficialBrokerObservedCalendarEphemeralObservation>;
}

export interface TestOnlyTossOpenApiCalendarAcquisitionDependencies {
  tokenIssuer: TossOpenApiTokenIssuer;
  calendarConnector: TestOnlyTossOpenApiCalendarSocketConnector;
  authClientOptions?: TossOpenApiAuthClientOptions;
}

export type TossOpenApiCalendarAcquisitionErrorCode =
  | "TOSS_OPEN_API_CALENDAR_ACQUISITION_DISABLED"
  | "TOSS_OPEN_API_CALENDAR_ACQUISITION_INVALID_CONFIG"
  | "TOSS_OPEN_API_CALENDAR_ACQUISITION_INVALID_REQUEST"
  | "TOSS_OPEN_API_CALENDAR_ACQUISITION_INVALID_OBSERVATION"
  | "TOSS_OPEN_API_CALENDAR_ACQUISITION_COMPATIBILITY_REJECTED"
  | "TOSS_OPEN_API_CALENDAR_ACQUISITION_EVIDENCE_REJECTED";

export class TossOpenApiCalendarAcquisitionError extends Error {
  constructor(
    readonly code: TossOpenApiCalendarAcquisitionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TossOpenApiCalendarAcquisitionError";
  }
}

class TossOpenApiCalendarAcquisitionCoordinator
  implements TossOpenApiCalendarAcquisitionClient
{
  constructor(
    private readonly config: TossOpenApiAuthConfig,
    private readonly calendarClient: TossOpenApiCalendarNetworkClient
  ) {}

  async acquireCalendarObservation(
    input: TossOpenApiCalendarAcquisitionRequest
  ): Promise<OfficialBrokerObservedCalendarEphemeralObservation> {
    this.assertReadyConfig();
    const request = parseAcquisitionRequest(input);
    const networkObservation = await this.calendarClient.getCalendar(request);
    const rawResponseBytes = captureRawResponseBytes(networkObservation);

    try {
      const observation = verifyNetworkObservation(
        networkObservation,
        rawResponseBytes,
        request
      );
      let compatibilityResult: ReturnType<
        typeof verifyOfficialTossOpenApiCalendarCompatibility
      >;
      try {
        const rawOpenApiDocumentBytes = readPinnedOpenApiSnapshotBytes();
        const pinnedExample = readPinnedCompatibilityExample(
          rawOpenApiDocumentBytes,
          request.market
        );
        compatibilityResult = verifyOfficialTossOpenApiCalendarCompatibility({
          market: request.market,
          requestedDate: pinnedExample.requestedDate,
          rawOpenApiDocumentBytes,
          rawResponseBytes: pinnedExample.rawResponseBytes
        });
      } catch {
        throw new TossOpenApiCalendarAcquisitionError(
          "TOSS_OPEN_API_CALENDAR_ACQUISITION_COMPATIBILITY_REJECTED",
          "Toss Open API calendar response compatibility was rejected."
        );
      }

      try {
        const evidence = createOfficialBrokerObservedCalendarEvidenceV2({
          compatibilityResult,
          requestedDate: request.date,
          completedAt: observation.completedAt,
          responseDelayMilliseconds: observation.responseDelayMilliseconds,
          responseCacheHeaders: freshnessResponseCacheHeaders(
            observation.responseFreshness.freshness
          ),
          responseCacheControl: freshnessResponseCacheControl(
            observation.responseFreshness.freshness.responseCacheControl
          ),
          rawResponseBytes
        });
        return createOfficialBrokerObservedCalendarEphemeralObservation({
          evidence,
          rawResponseBytes
        });
      } catch (error) {
        if (error instanceof TossOpenApiCalendarAcquisitionError) {
          throw error;
        }
        throw new TossOpenApiCalendarAcquisitionError(
          "TOSS_OPEN_API_CALENDAR_ACQUISITION_EVIDENCE_REJECTED",
          "Toss Open API calendar evidence composition was rejected."
        );
      }
    } finally {
      zeroizeBytes(rawResponseBytes);
    }
  }

  private assertReadyConfig(): void {
    if (!this.config.enabled) {
      throw new TossOpenApiCalendarAcquisitionError(
        "TOSS_OPEN_API_CALENDAR_ACQUISITION_DISABLED",
        "Toss Open API calendar acquisition is disabled."
      );
    }
    if (
      this.config.status !== "ready" ||
      this.config.baseUrl !== DEFAULT_TOSS_OPEN_API_BASE_URL ||
      typeof this.config.clientId !== "string" ||
      this.config.clientId.trim().length === 0 ||
      typeof this.config.clientSecret !== "string" ||
      this.config.clientSecret.trim().length === 0
    ) {
      throw new TossOpenApiCalendarAcquisitionError(
        "TOSS_OPEN_API_CALENDAR_ACQUISITION_INVALID_CONFIG",
        "Toss Open API calendar acquisition config is invalid."
      );
    }
  }
}

export function createTossOpenApiCalendarAcquisitionCoordinator(
  config: TossOpenApiAuthConfig
): TossOpenApiCalendarAcquisitionClient {
  const issuer = createTossOpenApiTokenIssuerNetworkTransport(config);
  const authClient = new TossOpenApiAuthClient(config, issuer);
  const calendarClient = createTossOpenApiCalendarNetworkTransport(
    config,
    authClient
  );
  return new TossOpenApiCalendarAcquisitionCoordinator(config, calendarClient);
}

export function createTestOnlyTossOpenApiCalendarAcquisitionCoordinator(
  config: TossOpenApiAuthConfig,
  dependencies: TestOnlyTossOpenApiCalendarAcquisitionDependencies
): TossOpenApiCalendarAcquisitionClient {
  assertTestOnlyDependencies(dependencies);
  const authClient = new TossOpenApiAuthClient(
    config,
    dependencies.tokenIssuer,
    dependencies.authClientOptions
  );
  const calendarClient = createTestOnlyTossOpenApiCalendarNetworkTransport(
    config,
    authClient,
    dependencies.calendarConnector
  );
  return new TossOpenApiCalendarAcquisitionCoordinator(config, calendarClient);
}

function parseAcquisitionRequest(
  value: unknown
): TossOpenApiCalendarAcquisitionRequest {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !isDeepStrictEqual(Object.keys(value).sort(), ["date", "market"])
  ) {
    throwInvalidRequest();
  }
  const candidate = value as Record<string, unknown>;
  const market = candidate.market;
  const date = candidate.date;
  if (
    (market !== "KR" && market !== "US") ||
    typeof date !== "string" ||
    !isCanonicalDate(date)
  ) {
    throwInvalidRequest();
  }
  return Object.freeze({ market, date });
}

function verifyNetworkObservation(
  value: TossOpenApiCalendarNetworkObservation,
  rawResponseBytes: Uint8Array,
  request: TossOpenApiCalendarAcquisitionRequest
): TossOpenApiCalendarNetworkObservation {
  try {
    const expectedRequestUrl = `${DEFAULT_TOSS_OPEN_API_BASE_URL}${CALENDAR_PATHS[request.market]}?date=${request.date}`;
    if (
      value.market !== request.market ||
      value.date !== request.date ||
      value.requestUrl !== expectedRequestUrl ||
      value.httpStatus !== 200 ||
      (value.httpProtocolVersion !== "http_1_0" &&
        value.httpProtocolVersion !== "http_1_1") ||
      value.responseByteLength !== rawResponseBytes.byteLength ||
      value.responseSha256 !== sha256(rawResponseBytes)
    ) {
      throw new Error("calendar observation identity mismatch");
    }
    const transferCompletion = verifyOfficialMarketCalendarTransferCompletion(
      value.transferCompletion
    );
    if (
      transferCompletion.httpProtocolVersion !== value.httpProtocolVersion ||
      transferCompletion.contentLength !== rawResponseBytes.byteLength
    ) {
      throw new Error("calendar transfer completion mismatch");
    }
    if (!isDeepStrictEqual(parseJsonBytes(rawResponseBytes), value.parsedBody)) {
      throw new Error("calendar parsed body mismatch");
    }
    const responseFreshness =
      resolveOfficialMarketCalendarNetworkResponseFreshness(
        value.responseFreshness.freshness
      );
    if (
      !isDeepStrictEqual(responseFreshness, value.responseFreshness) ||
      responseFreshness.freshness.completedAt !== value.completedAt ||
      responseFreshness.freshness.responseDelayMilliseconds !==
        value.responseDelayMilliseconds
    ) {
      throw new Error("calendar response freshness mismatch");
    }
    return value;
  } catch {
    throw new TossOpenApiCalendarAcquisitionError(
      "TOSS_OPEN_API_CALENDAR_ACQUISITION_INVALID_OBSERVATION",
      "Toss Open API calendar network observation is invalid."
    );
  }
}

function captureRawResponseBytes(
  value: TossOpenApiCalendarNetworkObservation
): Uint8Array {
  const rawResponseBytes: unknown = value?.responseBytes;
  if (!(rawResponseBytes instanceof Uint8Array)) {
    throw new TossOpenApiCalendarAcquisitionError(
      "TOSS_OPEN_API_CALENDAR_ACQUISITION_INVALID_OBSERVATION",
      "Toss Open API calendar network observation is invalid."
    );
  }
  return rawResponseBytes;
}

function freshnessResponseCacheHeaders(value: {
  responseDate: string;
  responseAgeSeconds: number | null;
  responseExpires: string | null;
}) {
  return {
    dateHeaderValues: [toHttpDate(value.responseDate)],
    ageHeaderValues:
      value.responseAgeSeconds === null
        ? []
        : [String(value.responseAgeSeconds)],
    expiresHeaderValues:
      value.responseExpires === null
        ? []
        : [toHttpDate(value.responseExpires)]
  };
}

function freshnessResponseCacheControl(value: string[] | null) {
  return {
    cacheControlHeaderValues: value === null ? [] : [value.join(", ")]
  };
}

function toHttpDate(value: string): string {
  return new Date(value).toUTCString();
}

function readPinnedOpenApiSnapshotBytes(): Buffer {
  return Buffer.from(
    readFileSync(PINNED_OPENAPI_SNAPSHOT_URL, "utf8").replaceAll(
      "\r\n",
      "\n"
    ),
    "utf8"
  );
}

function readPinnedCompatibilityExample(
  rawOpenApiDocumentBytes: Uint8Array,
  market: TossOpenApiCalendarMarket
): { requestedDate: string; rawResponseBytes: Buffer } {
  const exampleSelection = PINNED_COMPATIBILITY_EXAMPLES[market];
  const document = parseJsonBytes(rawOpenApiDocumentBytes) as {
    paths?: Record<
      string,
      {
        get?: {
          responses?: {
            "200"?: {
              content?: {
                "application/json"?: {
                  examples?: Record<string, { value?: unknown }>;
                };
              };
            };
          };
        };
      }
    >;
  };
  const value =
    document.paths?.[CALENDAR_PATHS[market]]?.get?.responses?.["200"]
      ?.content?.["application/json"]?.examples?.[
      exampleSelection.exampleName
    ]?.value;
  if (value === undefined) {
    throw new Error("pinned calendar compatibility example is missing");
  }
  return {
    requestedDate: exampleSelection.requestedDate,
    rawResponseBytes: Buffer.from(JSON.stringify(value), "utf8")
  };
}

function parseJsonBytes(value: Uint8Array): unknown {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(value);
  return JSON.parse(text) as unknown;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function zeroizeBytes(value: Uint8Array): void {
  Uint8Array.prototype.fill.call(value, 0);
}

function assertTestOnlyDependencies(
  value: TestOnlyTossOpenApiCalendarAcquisitionDependencies
): void {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof value.tokenIssuer?.issueToken !== "function" ||
    value.calendarConnector === null ||
    typeof value.calendarConnector !== "object"
  ) {
    throw new TossOpenApiCalendarAcquisitionError(
      "TOSS_OPEN_API_CALENDAR_ACQUISITION_INVALID_CONFIG",
      "Toss Open API test-only calendar acquisition dependencies are invalid."
    );
  }
}

function throwInvalidRequest(): never {
  throw new TossOpenApiCalendarAcquisitionError(
    "TOSS_OPEN_API_CALENDAR_ACQUISITION_INVALID_REQUEST",
    "Toss Open API calendar acquisition request is invalid."
  );
}

function isCanonicalDate(value: string): boolean {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}
