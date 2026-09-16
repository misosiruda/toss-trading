import { OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION } from "./officialMarketCalendarCacheRequestPolicy.js";
import { OFFICIAL_MARKET_CALENDAR_CREDENTIAL_FREE_CLIENT_POLICY_VERSION } from "./officialMarketCalendarCredentialFreeClientPolicy.js";
import { OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION } from "./officialMarketCalendarDomainAllowlist.js";
import {
  OFFICIAL_MARKET_CALENDAR_FRESHNESS_POLICY_DEFINITION_VERSION,
  createOfficialMarketCalendarFreshnessPolicyHash
} from "./officialMarketCalendarFreshnessPolicy.js";
import { OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS } from "./officialMarketCalendarRequestHeaderPolicyRegistry.js";
import {
  verifyOfficialMarketCalendarRedirectChainBoundary as verifyOfficialMarketCalendarRedirectChainBoundaryWithRegistry
} from "./officialMarketCalendarRedirectChainBoundary.js";
import { OFFICIAL_MARKET_CALENDAR_REDIRECT_POLICY_VERSION } from "./officialMarketCalendarRedirectClientPolicy.js";
import { createOfficialMarketCalendarSourceDocumentEnvelope } from "./officialMarketCalendarSourceDocumentEnvelope.js";
import { createOfficialMarketCalendarSourceDocumentMetadata } from "./officialMarketCalendarSourceDocumentMetadata.js";
import { OFFICIAL_MARKET_CALENDAR_SOURCE_COLLECTION_SCHEMA_VERSION } from "./officialMarketCalendarSourceCollection.js";
import { createOfficialMarketCalendarSourceCollectionAssembly } from "./officialMarketCalendarSourceCollectionAssembly.js";
import {
  createOfficialMarketCalendarSourceCollectionDocumentProjection
} from "./officialMarketCalendarSourceCollectionDocumentProjection.js";
import {
  createOfficialMarketCalendarSourceDocumentAcquisitionMetadata
} from "./officialMarketCalendarSourceDocumentAcquisitionMetadata.js";
import {
  OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_CONTRACT_DEFINITION_SCHEMA_VERSION,
  createOfficialMarketCalendarSourceParserContractHash
} from "./officialMarketCalendarSourceParserContract.js";
import { bindOfficialMarketCalendarSourceParserInput } from "./officialMarketCalendarSourceParserInputBinding.js";
import { createOfficialMarketCalendarSourceParserResult } from "./officialMarketCalendarSourceParserResult.js";
import { OFFICIAL_MARKET_CALENDAR_TLS_CLIENT_POLICY_VERSION } from "./officialMarketCalendarTlsClientPolicy.js";

export interface MethodTransition {
  responseStatus: number;
  requestMethod: string;
  requestBodyContentType: string | null;
  requestBodyHash: string | null;
  nextRequestMethod: string;
  nextRequestBodyContentType: null;
  nextRequestBodyHash: null;
}

export const KRX_REQUESTED_URL =
  "https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp";

export const KRX_REDIRECTED_URL = `${KRX_REQUESTED_URL}?download=1`;

export const KRX_FINAL_URL = `${KRX_REQUESTED_URL}?download=2`;

export const NYSE_REQUESTED_URL =
  "https://www.nyse.com/trade/hours-calendars";

export const NYSE_REDIRECTED_URL = `${NYSE_REQUESTED_URL}?download=1`;

export function chain(
  overrides: Partial<{
    cacheRequests: ReturnType<typeof cacheRequest>[];
    credentialProviderConfigured: boolean;
    credentialRequests: ReturnType<typeof credentialRequest>[];
    domainUrls: string[];
    exchange: "KRX" | "NYSE";
    effectiveRequestUrls: string[];
    finalCacheControlHeaderValues: string[];
    finalHttpStatus: number;
    finalDateHeaderValues: string[];
    finalEffectiveResponseAt: string;
    finalResponseProtocol: "http_1_0" | "http_1_1" | "http_2" | "http_3";
    finalResponseUrl: string;
    freshnessPolicyExpiry: ReturnType<typeof policyExpiry>;
    insecureTlsBypassEnabled: boolean;
    headerNameRequests: ReturnType<typeof headerNameRequest>[];
    parameterRequests: ReturnType<typeof parameterRequest>[];
    rangeRequests: ReturnType<typeof rangeRequest>[];
    requestHeaderPolicyVersion: string;
    representationHeaderRequests: ReturnType<
      typeof representationHeaderRequest
    >[];
    automaticRedirectFollowEnabled: boolean;
    responseStatuses: number[];
    transferCompleted: boolean;
    redirectHops: ReturnType<typeof locationHop>[];
    transitions: MethodTransition[];
  }> = {}
) {
  const effectiveRequestUrls = overrides.effectiveRequestUrls ?? [
    KRX_REQUESTED_URL,
    KRX_REDIRECTED_URL
  ];
  return {
    cacheRequestPolicies: overrides.cacheRequests ?? [
      cacheRequest(),
      cacheRequest()
    ],
    credentialFreeClientPolicy: {
      credentialFreeClientPolicyVersion:
        OFFICIAL_MARKET_CALENDAR_CREDENTIAL_FREE_CLIENT_POLICY_VERSION,
      credentialProviderConfigured:
        overrides.credentialProviderConfigured ?? false,
      proxyCredentialConfigured: false,
      httpAuthHandlerConfigured: false,
      cookieJarConfigured: false
    },
    credentialHeaderBoundary: {
      effectiveRequests: overrides.credentialRequests ?? [
        credentialRequest(),
        credentialRequest()
      ]
    },
    domainAllowlistBoundary: {
      exchange: overrides.exchange ?? "KRX",
      domainAllowlistPolicyVersion:
        OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION,
      urls: overrides.domainUrls ?? effectiveRequestUrls
    },
    finalResponseBoundary: {
      responseUrl:
        overrides.finalResponseUrl ??
        effectiveRequestUrls[effectiveRequestUrls.length - 1],
      httpStatus: overrides.finalHttpStatus ?? 200,
      httpProtocolVersion: overrides.finalResponseProtocol ?? "http_1_1",
      contentRangeHeaderValues: [],
      contentRange: null,
      responseCacheHeaders: {
        dateHeaderValues: overrides.finalDateHeaderValues ?? [
          "Tue, 01 Jul 2025 12:00:00 GMT"
        ],
        ageHeaderValues: []
      },
      responseCacheControl: {
        cacheControlHeaderValues:
          overrides.finalCacheControlHeaderValues ?? []
      },
      responseRepresentationHeaders: {
        contentTypeHeaderValues: ["application/pdf"],
        contentEncodingHeaderValues: []
      },
      responseFreshness: {
        retrievedAt: "2025-07-01T12:00:10.000Z",
        effectiveResponseAt:
          overrides.finalEffectiveResponseAt ?? "2025-07-01T12:00:00.000Z"
      },
      freshnessPolicyExpiry:
        overrides.freshnessPolicyExpiry ?? policyExpiry(),
      transferCompletion: transferCompletion({
        transferCompleted: overrides.transferCompleted ?? true
      })
    },
    httpsUrlBoundary: {
      requestedUrl: effectiveRequestUrls[0],
      effectiveRequestUrls,
      finalUrl: effectiveRequestUrls[effectiveRequestUrls.length - 1]
    },
    rangeRequestBoundaries: overrides.rangeRequests ?? [
      rangeRequest(),
      rangeRequest()
    ],
    requestHeaderPolicyVersion:
      overrides.requestHeaderPolicyVersion ??
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_MARKET_CLOSING_HOLIDAY,
    requestHeaderNamesBoundary: {
      effectiveRequests: overrides.headerNameRequests ?? [
        headerNameRequest({
          requestHeaderNames: ["cache-control", "content-type", "pragma"]
        }),
        headerNameRequest()
      ]
    },
    requestParametersBoundary: {
      effectiveRequests: overrides.parameterRequests ?? [
        parameterRequest(),
        parameterRequest()
      ]
    },
    representationHeadersBoundary: {
      effectiveRequests: overrides.representationHeaderRequests ?? [
        representationHeaderRequest(),
        representationHeaderRequest()
      ]
    },
    redirectClientPolicy: {
      redirectPolicyVersion: OFFICIAL_MARKET_CALENDAR_REDIRECT_POLICY_VERSION,
      automaticRedirectFollowEnabled:
        overrides.automaticRedirectFollowEnabled ?? false,
      responsePerHopObservationRequired: true,
      effectiveRequestPerHopObservationRequired: true
    },
    statusBoundary: {
      responseStatuses: overrides.responseStatuses ?? [302]
    },
    locationBoundary: {
      redirectHops: overrides.redirectHops ?? [locationHop()]
    },
    methodBoundary: {
      transitions: overrides.transitions ?? [methodTransition()]
    },
    tlsClientPolicy: {
      tlsClientPolicyVersion: OFFICIAL_MARKET_CALENDAR_TLS_CLIENT_POLICY_VERSION,
      trustStore: "platform_default",
      certificateChainVerification: "required",
      hostnameVerification: "required",
      insecureTlsBypassEnabled: overrides.insecureTlsBypassEnabled ?? false,
      clientCertificateConfigured: false
    }
  };
}

export function sourceParserContractEntry(
  overrides: Partial<{
    exchange: "KRX" | "NYSE";
    parserContractVersion: string;
    acceptedContentTypes: string[];
  }> = {}
) {
  const parserContractDefinition = {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_CONTRACT_DEFINITION_SCHEMA_VERSION,
    exchange: overrides.exchange ?? ("KRX" as const),
    acceptedContentTypes: overrides.acceptedContentTypes ?? ["application/pdf"],
    acceptedContentEncodings: [null] as null[],
    parserOutputSchemaVersion: "calendar_parser_output.v1"
  };
  return {
    parserContractVersion:
      overrides.parserContractVersion ?? "krx_calendar_pdf.v1",
    parserContractDefinition,
    parserContractHash:
      createOfficialMarketCalendarSourceParserContractHash(
        parserContractDefinition
      )
  };
}

export function sourceParserInputFixture(documentId: string) {
  const sourceBytes = new Uint8Array(100).fill(65);
  const sourceDocumentEnvelope =
    createOfficialMarketCalendarSourceDocumentEnvelope(
      {
        documentId,
        sourceBytes,
        acquisitionBoundary: {
          redirectChainBoundary: chain(),
          freshnessPolicySelectorMetadata: policySelectorMetadata()
        }
      },
      policyRegistry()
    );
  const sourceDocumentAcquisitionMetadata =
    createOfficialMarketCalendarSourceDocumentAcquisitionMetadata(
      { sourceDocumentEnvelope },
      { freshnessPolicyRegistry: policyRegistry(), sourceBytes }
    );
  const parserContractEntry = sourceParserContractEntry();
  const options = {
    sourceBytes,
    freshnessPolicyRegistry: policyRegistry(),
    parserContractRegistry: [parserContractEntry]
  };
  return {
    options,
    bound: bindOfficialMarketCalendarSourceParserInput(
      { sourceDocumentAcquisitionMetadata, parserContractEntry },
      options
    )
  };
}

export function sourceParserOutput() {
  return {
    schemaVersion: "calendar_parser_output.v1",
    parsedRows: [
      {
        exchangeDate: "2026-01-01",
        evidenceRoles: ["holiday_rows"],
        fields: { label: "New Year" }
      },
      {
        exchangeDate: "2026-12-31",
        evidenceRoles: ["holiday_rows"],
        fields: { label: "Year End" }
      }
    ],
    regularSessionHours: null,
    scheduleCoverageIntervals: [
      {
        coverageRole: "holiday_schedule",
        startDate: "2026-01-01",
        endDate: "2026-12-31"
      }
    ],
    applicabilityStartDate: null,
    applicabilityEndDate: null
  };
}

export function sourceCollectionAssemblyFixture(
  overrides: Partial<{
    exchange: "KRX" | "NYSE";
    coverageStartDate: string;
    coverageEndDate: string;
  }> = {}
) {
  const exchange = overrides.exchange ?? "KRX";
  const exchangeKey = exchange.toLowerCase();
  const coverageStartDate = overrides.coverageStartDate ?? "2026-01-01";
  const coverageEndDate = overrides.coverageEndDate ?? "2026-12-31";
  const isKrx = exchange === "KRX";
  const documentId = `${exchangeKey}.calendar.collection-assembly`;
  const parserContractVersion = `${exchangeKey}_calendar_pdf.v1`;
  const requestedUrl = isKrx ? KRX_REQUESTED_URL : NYSE_REQUESTED_URL;
  const redirectedUrl = isKrx ? KRX_REDIRECTED_URL : NYSE_REDIRECTED_URL;
  const coverageSelector = {
    evidenceRoles: [
      "holiday_rows",
      "holiday_schedule",
      "session_hours",
      "session_hours_exception_schedule",
      "special_closure",
      "special_closure_schedule"
    ] as const,
    rowCoverageStartDate: coverageStartDate,
    rowCoverageEndDate: coverageEndDate,
    scheduleCoverageIntervals: [
      {
        coverageRole: "holiday_schedule" as const,
        startDate: coverageStartDate,
        endDate: coverageEndDate
      },
      {
        coverageRole: "session_hours_exception_schedule" as const,
        startDate: coverageStartDate,
        endDate: coverageEndDate
      },
      {
        coverageRole: "special_closure_schedule" as const,
        startDate: coverageStartDate,
        endDate: coverageEndDate
      }
    ],
    applicabilityStartDate: coverageStartDate,
    applicabilityEndDate: coverageEndDate
  };
  const freshness = policyExpiry({
    exchange,
    requestMethod: isKrx ? "POST" : "GET",
    requestedUrl,
    requestBodyContentType: isKrx
      ? "application/x-www-form-urlencoded"
      : null,
    requestBodyHash: isKrx ? hash("a") : null,
    parserContractVersion,
    freshnessPolicyVersion: `${exchangeKey}_calendar_annual.v1`,
    coverageSelector
  });
  const sourceBytes = new Uint8Array(100).fill(isKrx ? 65 : 66);
  const redirectChainBoundary = chain({
    exchange,
    effectiveRequestUrls: [requestedUrl, redirectedUrl],
    domainUrls: [requestedUrl, redirectedUrl],
    freshnessPolicyExpiry: freshness,
    requestHeaderPolicyVersion: isKrx
      ? OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_MARKET_CLOSING_HOLIDAY
      : OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.NYSE_TRADE_HOURS_CALENDARS,
    headerNameRequests: isKrx
      ? [
          headerNameRequest({
            requestHeaderNames: ["cache-control", "content-type", "pragma"]
          }),
          headerNameRequest()
        ]
      : [headerNameRequest(), headerNameRequest()],
    redirectHops: [
      {
        responseUrl: requestedUrl,
        locationHeaderValues: ["?download=1"],
        nextEffectiveRequestUrl: redirectedUrl
      }
    ],
    transitions: [
      isKrx
        ? methodTransition()
        : {
            responseStatus: 302,
            requestMethod: "GET",
            requestBodyContentType: null,
            requestBodyHash: null,
            nextRequestMethod: "GET",
            nextRequestBodyContentType: null,
            nextRequestBodyHash: null
          }
    ]
  });
  const envelope = createOfficialMarketCalendarSourceDocumentEnvelope(
    {
      documentId,
      sourceBytes,
      acquisitionBoundary: {
        redirectChainBoundary,
        freshnessPolicySelectorMetadata: policySelectorMetadata(freshness)
      }
    },
    policyRegistry(freshness)
  );
  const acquisition = createOfficialMarketCalendarSourceDocumentAcquisitionMetadata(
    { sourceDocumentEnvelope: envelope },
    { sourceBytes, freshnessPolicyRegistry: policyRegistry(freshness) }
  );
  const parserContractEntry = sourceParserContractEntry({
    exchange,
    parserContractVersion
  });
  const parserOptions = {
    sourceBytes,
    freshnessPolicyRegistry: policyRegistry(freshness),
    parserContractRegistry: [parserContractEntry]
  };
  const binding = bindOfficialMarketCalendarSourceParserInput(
    { sourceDocumentAcquisitionMetadata: acquisition, parserContractEntry },
    parserOptions
  );
  const parsedRows = [
    {
      exchangeDate: coverageStartDate,
      evidenceRoles: ["holiday_rows", "session_hours", "special_closure"],
      fields: { label: "first" }
    },
    ...(coverageEndDate === coverageStartDate
      ? []
      : [
          {
            exchangeDate: coverageEndDate,
            evidenceRoles: [
              "holiday_rows",
              "session_hours",
              "special_closure"
            ],
            fields: { label: "last" }
          }
        ])
  ];
  const regularSessionHours = isKrx
    ? { openLocalTime: "09:00", closeLocalTime: "15:30" }
    : { openLocalTime: "09:30", closeLocalTime: "16:00" };
  const parserOutput = {
    schemaVersion: "calendar_parser_output.v1",
    parsedRows,
    regularSessionHours,
    scheduleCoverageIntervals: coverageSelector.scheduleCoverageIntervals,
    applicabilityStartDate: coverageStartDate,
    applicabilityEndDate: coverageEndDate
  };
  const result = createOfficialMarketCalendarSourceParserResult(
    { parserInputBinding: binding.parserInputBinding, parserOutput },
    parserOptions
  );
  const metadata = createOfficialMarketCalendarSourceDocumentMetadata(
    { sourceParserResult: result },
    parserOptions
  );
  const projection = createOfficialMarketCalendarSourceCollectionDocumentProjection(
    { sourceDocumentMetadata: metadata },
    parserOptions
  );
  const intervalRoles = coverageSelector.scheduleCoverageIntervals.map(
    ({ coverageRole }) => ({
      coverageRole,
      startDate: coverageStartDate,
      endDate: coverageEndDate,
      documentIds: [documentId]
    })
  );
  return {
    projection,
    options: {
      sourceBytesByDocumentId: { [documentId]: sourceBytes },
      freshnessPolicyRegistry: policyRegistry(freshness),
      parserContractRegistry: [parserContractEntry]
    },
    collectionPlan: {
      schemaVersion: OFFICIAL_MARKET_CALENDAR_SOURCE_COLLECTION_SCHEMA_VERSION,
      collectionId: `${exchangeKey}.collection.2026`,
      exchange,
      coverageStartDate,
      coverageEndDate,
      requiredExceptionCoverageRoles: {
        contractVersion: `${exchangeKey}_exception_coverage.v1`,
        roles: [
          "holiday_schedule",
          "session_hours_exception_schedule",
          "special_closure_schedule"
        ]
      },
      exceptionScheduleIntervals: intervalRoles,
      regularSessionRegimes: [
        {
          regimeId: `${exchangeKey}.regular.2026`,
          effectiveStartDate: coverageStartDate,
          effectiveEndDate: coverageEndDate,
          ...regularSessionHours,
          documentIds: [documentId]
        }
      ],
      regularSessionSupersessions: []
    }
  };
}

export function evidenceArtifactV2Fixture() {
  const coverageStartDate = "2026-01-02";
  const coverageEndDate = coverageStartDate;
  const krx = sourceCollectionAssemblyFixture({
    exchange: "KRX",
    coverageStartDate,
    coverageEndDate
  });
  const nyse = sourceCollectionAssemblyFixture({
    exchange: "NYSE",
    coverageStartDate,
    coverageEndDate
  });
  const krxAssembly = createOfficialMarketCalendarSourceCollectionAssembly(
    {
      collectionPlan: krx.collectionPlan,
      documentProjections: [krx.projection]
    },
    krx.options
  );
  const nyseAssembly = createOfficialMarketCalendarSourceCollectionAssembly(
    {
      collectionPlan: nyse.collectionPlan,
      documentProjections: [nyse.projection]
    },
    nyse.options
  );
  const krxCollection = krxAssembly.sourceCollection;
  const nyseCollection = nyseAssembly.sourceCollection;
  const krxRef = {
    exchange: "KRX" as const,
    collectionId: krxCollection.collectionId,
    documentId: krxCollection.documents[0]!.documentId
  };
  const nyseRef = {
    exchange: "NYSE" as const,
    collectionId: nyseCollection.collectionId,
    documentId: nyseCollection.documents[0]!.documentId
  };
  const sessionProvenances = [
    {
      schemaVersion: "official_market_calendar_session_provenance.v1",
      sessionId: "krx.2026-01-02",
      exchange: "KRX" as const,
      sessionDate: coverageStartDate,
      sourceDocumentRefs: [krxRef],
      regularSessionRegimeId: krxCollection.regularSessionRegimes[0]!.regimeId
    },
    {
      schemaVersion: "official_market_calendar_session_provenance.v1",
      sessionId: "nyse.2026-01-02",
      exchange: "NYSE" as const,
      sessionDate: coverageStartDate,
      sourceDocumentRefs: [nyseRef],
      regularSessionRegimeId: nyseCollection.regularSessionRegimes[0]!.regimeId
    }
  ];
  const sessionSet = {
    schemaVersion: "official_market_calendar_session_set.v1",
    coverage: {
      startDate: coverageStartDate,
      endDate: coverageEndDate,
      exchanges: ["KRX", "NYSE"] as const
    },
    sourceCollections: [
      {
        exchange: "KRX" as const,
        collectionId: krxCollection.collectionId,
        collectionHash: krxCollection.collectionHash
      },
      {
        exchange: "NYSE" as const,
        collectionId: nyseCollection.collectionId,
        collectionHash: nyseCollection.collectionHash
      }
    ] as const,
    openSessions: [
      {
        schemaVersion: "official_market_calendar_open_session.v1",
        sessionId: "krx.2026-01-02",
        exchange: "KRX" as const,
        sessionDate: coverageStartDate,
        sessionType: "regular" as const,
        openLocalTime: "09:00",
        closeLocalTime: "15:30",
        sourceDocumentRefs: [krxRef],
        regularSessionRegimeId:
          krxCollection.regularSessionRegimes[0]!.regimeId,
        sessionHoursExceptionId: null
      },
      {
        schemaVersion: "official_market_calendar_open_session.v1",
        sessionId: "nyse.2026-01-02",
        exchange: "NYSE" as const,
        sessionDate: coverageStartDate,
        sessionType: "regular" as const,
        openLocalTime: "09:30",
        closeLocalTime: "16:00",
        sourceDocumentRefs: [nyseRef],
        regularSessionRegimeId:
          nyseCollection.regularSessionRegimes[0]!.regimeId,
        sessionHoursExceptionId: null
      }
    ],
    sourceBackedClosures: [],
    weekendSessions: []
  };
  return {
    input: {
      generatedAt: "2025-07-01T12:00:11.000Z",
      sourceCollectionAssemblies: [krxAssembly, nyseAssembly] as const,
      sessionSet,
      sessionProvenances,
      sessionHoursExceptions: []
    },
    options: {
      sourceBytesByExchange: {
        KRX: krx.options.sourceBytesByDocumentId,
        NYSE: nyse.options.sourceBytesByDocumentId
      },
      freshnessPolicyRegistry: [
        ...krx.options.freshnessPolicyRegistry,
        ...nyse.options.freshnessPolicyRegistry
      ],
      parserContractRegistry: [
        ...krx.options.parserContractRegistry,
        ...nyse.options.parserContractRegistry
      ]
    }
  };
}

export function policyExpiry(
  overrides: Partial<{
    exchange: "KRX" | "NYSE";
    freshnessPolicyVersion: string;
    parserContractVersion: string;
    requestMethod: "GET" | "POST";
    requestParameters: Record<string, unknown>;
    representationHeaders: Record<string, unknown>;
    requestedUrl: string;
    requestBodyContentType: string | null;
    requestBodyHash: string | null;
    coverageSelector: {
      evidenceRoles: readonly (
        | "holiday_rows"
        | "holiday_schedule"
        | "session_hours"
        | "session_hours_exception_schedule"
        | "special_closure"
        | "special_closure_schedule"
      )[];
      rowCoverageStartDate: string | null;
      rowCoverageEndDate: string | null;
      scheduleCoverageIntervals: readonly {
        coverageRole:
          | "holiday_schedule"
          | "session_hours_exception_schedule"
          | "special_closure_schedule";
        startDate: string;
        endDate: string;
      }[];
      applicabilityStartDate: string | null;
      applicabilityEndDate: string | null;
    };
  }> = {}
) {
  const definition = {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_FRESHNESS_POLICY_DEFINITION_VERSION,
    sourceSelector: {
      exchange: overrides.exchange ?? ("KRX" as const),
      requestMethod: overrides.requestMethod ?? ("POST" as const),
      requestedUrl:
        overrides.requestedUrl ?? KRX_REQUESTED_URL,
      requestParameters: overrides.requestParameters ?? {},
      requestBodyContentType:
        overrides.requestBodyContentType === undefined
          ? "application/x-www-form-urlencoded"
          : overrides.requestBodyContentType,
      requestBodyHash:
        overrides.requestBodyHash === undefined
          ? hash("a")
          : overrides.requestBodyHash,
      representationHeaders: overrides.representationHeaders ?? {},
      parserContractVersion:
        overrides.parserContractVersion ?? "krx_calendar_pdf.v1"
    },
    coverageSelector: overrides.coverageSelector ?? {
      evidenceRoles: ["holiday_rows", "holiday_schedule"] as const,
      rowCoverageStartDate: "2026-01-01",
      rowCoverageEndDate: "2026-12-31",
      scheduleCoverageIntervals: [
        {
          coverageRole: "holiday_schedule" as const,
          startDate: "2026-01-01",
          endDate: "2026-12-31"
        }
      ],
      applicabilityStartDate: null,
      applicabilityEndDate: null
    },
    expiryRule: {
      type: "fixed_duration_from_effective_response" as const,
      durationSeconds: 86_400
    }
  };
  return {
    freshnessPolicyEntry: {
      freshnessPolicyVersion:
        overrides.freshnessPolicyVersion ?? "krx_calendar_annual.v1",
      freshnessPolicyDefinition: definition,
      freshnessPolicyHash:
        createOfficialMarketCalendarFreshnessPolicyHash(definition)
    },
    staleAfter: "2025-07-02T12:00:00.000Z"
  };
}

export function verifyOfficialMarketCalendarRedirectChainBoundary(value: unknown) {
  return verifyOfficialMarketCalendarRedirectChainBoundaryWithRegistry(
    value,
    policyRegistry()
  );
}

export function policyRegistry(
  freshnessPolicyExpiry = policyExpiry()
) {
  return [freshnessPolicyExpiry.freshnessPolicyEntry];
}

export function policySelectorMetadata(
  freshnessPolicyExpiry = policyExpiry()
) {
  const definition = freshnessPolicyExpiry.freshnessPolicyEntry
    .freshnessPolicyDefinition;
  return {
    ...definition.sourceSelector,
    ...definition.coverageSelector
  };
}

export function transferCompletion(
  overrides: Partial<{
    transferCompleted: boolean;
  }> = {}
) {
  return {
    httpProtocolVersion: "http_1_1" as const,
    transferFraming: "content_length" as const,
    transferCompleted: true,
    declaredContentLength: 100,
    contentLength: 100,
    ...overrides
  };
}

export function cacheRequest(
  overrides: Partial<{
    cacheControlHeaderValues: string[];
    pragmaHeaderValues: string[];
    ifNoneMatchHeaderValues: string[];
    ifModifiedSinceHeaderValues: string[];
  }> = {}
) {
  return {
    cacheRequestPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION,
    cacheControlHeaderValues: ["no-cache, no-store, max-age=0"],
    pragmaHeaderValues: ["no-cache"],
    ifNoneMatchHeaderValues: [],
    ifModifiedSinceHeaderValues: [],
    ...overrides
  };
}

export function rangeRequest(
  overrides: Partial<{
    rangeHeaderValues: string[];
    ifRangeHeaderValues: string[];
  }> = {}
) {
  return {
    rangeHeaderValues: [],
    ifRangeHeaderValues: [],
    ...overrides
  };
}

export function parameterRequest(
  overrides: Partial<{
    requestParameters: Record<string, unknown>;
  }> = {}
) {
  return {
    requestParameters: {},
    ...overrides
  };
}

export function headerNameRequest(
  overrides: Partial<{
    requestHeaderNames: string[];
  }> = {}
) {
  return {
    requestHeaderNames: ["cache-control", "pragma"],
    ...overrides
  };
}

export function representationHeaderRequest(
  overrides: Partial<{
    representationHeaders: Record<string, unknown>;
  }> = {}
) {
  return {
    representationHeaders: {},
    ...overrides
  };
}

export function credentialRequest(
  overrides: Partial<{
    authorizationHeaderValues: string[];
    proxyAuthorizationHeaderValues: string[];
    cookieHeaderValues: string[];
  }> = {}
) {
  return {
    authorizationHeaderValues: [],
    proxyAuthorizationHeaderValues: [],
    cookieHeaderValues: [],
    ...overrides
  };
}

export function locationHop() {
  return {
    responseUrl: KRX_REQUESTED_URL,
    locationHeaderValues: ["?download=1"],
    nextEffectiveRequestUrl: KRX_REDIRECTED_URL
  };
}

export function secondLocationHop() {
  return {
    responseUrl: KRX_REDIRECTED_URL,
    locationHeaderValues: ["?download=2"],
    nextEffectiveRequestUrl: KRX_FINAL_URL
  };
}

export function methodTransition(): MethodTransition {
  return {
    responseStatus: 302,
    requestMethod: "POST",
    requestBodyContentType: "application/x-www-form-urlencoded",
    requestBodyHash: hash("a"),
    nextRequestMethod: "GET",
    nextRequestBodyContentType: null,
    nextRequestBodyHash: null
  };
}

export function secondMethodTransition(): MethodTransition {
  return {
    responseStatus: 303,
    requestMethod: "GET",
    requestBodyContentType: null,
    requestBodyHash: null,
    nextRequestMethod: "GET",
    nextRequestBodyContentType: null,
    nextRequestBodyHash: null
  };
}

export function hash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
