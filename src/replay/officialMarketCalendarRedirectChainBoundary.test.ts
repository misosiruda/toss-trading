import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarAcquisitionFreshnessPolicyBoundary } from "./officialMarketCalendarAcquisitionFreshnessPolicyBoundary.js";
import { OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION } from "./officialMarketCalendarCacheRequestPolicy.js";
import { OFFICIAL_MARKET_CALENDAR_CREDENTIAL_FREE_CLIENT_POLICY_VERSION } from "./officialMarketCalendarCredentialFreeClientPolicy.js";
import { OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION } from "./officialMarketCalendarDomainAllowlist.js";
import {
  OFFICIAL_MARKET_CALENDAR_FRESHNESS_POLICY_DEFINITION_VERSION,
  createOfficialMarketCalendarFreshnessPolicyHash
} from "./officialMarketCalendarFreshnessPolicy.js";
import { OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS } from "./officialMarketCalendarRequestHeaderPolicyRegistry.js";
import { verifyOfficialMarketCalendarRedirectChainBoundary as verifyOfficialMarketCalendarRedirectChainBoundaryWithRegistry } from "./officialMarketCalendarRedirectChainBoundary.js";
import { OFFICIAL_MARKET_CALENDAR_REDIRECT_POLICY_VERSION } from "./officialMarketCalendarRedirectClientPolicy.js";
import { OFFICIAL_MARKET_CALENDAR_TLS_CLIENT_POLICY_VERSION } from "./officialMarketCalendarTlsClientPolicy.js";

interface MethodTransition {
  responseStatus: number;
  requestMethod: string;
  requestBodyContentType: string | null;
  requestBodyHash: string | null;
  nextRequestMethod: string;
  nextRequestBodyContentType: null;
  nextRequestBodyHash: null;
}

const KRX_REQUESTED_URL =
  "https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp";
const KRX_REDIRECTED_URL = `${KRX_REQUESTED_URL}?download=1`;
const KRX_FINAL_URL = `${KRX_REQUESTED_URL}?download=2`;
const NYSE_REQUESTED_URL =
  "https://www.nyse.com/trade/hours-calendars";
const NYSE_REDIRECTED_URL = `${NYSE_REQUESTED_URL}?download=1`;

test("calendar redirect chain boundary accepts aligned hop contracts", () => {
  const boundary = chain();

  assert.deepEqual(
    verifyOfficialMarketCalendarRedirectChainBoundary(boundary),
    {
      ...boundary,
      finalResponseBoundary: {
        ...boundary.finalResponseBoundary,
        responseCacheHeaders: {
          responseDate: "2025-07-01T12:00:00Z",
          responseAgeSeconds: null
        },
        responseCacheControl: {
          responseCacheControl: null
        },
        responseFreshness: {
          freshness: {
            retrievedAt: "2025-07-01T12:00:10.000Z",
            effectiveResponseAt: "2025-07-01T12:00:00.000Z",
            responseDate: "2025-07-01T12:00:00Z",
            responseAgeSeconds: null
          },
          apparentAgeSeconds: 10,
          effectiveCacheAgeSeconds: 10
        },
        freshnessPolicyExpiry: {
          freshnessPolicyVersion: "krx_calendar_annual.v1",
          freshnessPolicyHash:
            boundary.finalResponseBoundary.freshnessPolicyExpiry
              .freshnessPolicyEntry.freshnessPolicyHash,
          effectiveResponseAt: "2025-07-01T12:00:00.000Z",
          durationSeconds: 86_400,
          staleAfter: "2025-07-02T12:00:00.000Z"
        }
      }
    }
  );
});

test("calendar acquisition policy boundary binds redirect policy identity to selectors", () => {
  const result =
    verifyOfficialMarketCalendarAcquisitionFreshnessPolicyBoundary(
      {
        redirectChainBoundary: chain(),
        freshnessPolicySelectorMetadata: policySelectorMetadata()
      },
      policyRegistry()
    );
  assert.equal(
    result.redirectChainBoundary.finalResponseBoundary
      .freshnessPolicyExpiry.freshnessPolicyVersion,
    "krx_calendar_annual.v1"
  );
  assert.deepEqual(
    result.freshnessPolicySelectorBinding.selectorMetadata,
    policySelectorMetadata()
  );
});

test("calendar acquisition policy boundary rejects selector mismatch and unknown fields", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarAcquisitionFreshnessPolicyBoundary(
        {
          redirectChainBoundary: chain(),
          freshnessPolicySelectorMetadata: policySelectorMetadata()
        },
        []
      ),
    /version is not registered/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarAcquisitionFreshnessPolicyBoundary(
        {
          redirectChainBoundary: chain(),
          freshnessPolicySelectorMetadata: {
            ...policySelectorMetadata(),
            evidenceRoles: ["holiday_rows"]
          }
        },
        policyRegistry()
      ),
    /do not match acquisition metadata/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarAcquisitionFreshnessPolicyBoundary(
        {
          redirectChainBoundary: chain(),
          freshnessPolicySelectorMetadata: policySelectorMetadata(),
          currentTime: "2025-07-01T12:00:00.000Z"
        },
        policyRegistry()
      ),
    /Unrecognized key/
  );
});

test("calendar acquisition policy boundary binds selectors to the verified initial request", () => {
  const matchingRequestParameters = { locale: "ko", year: "2026" };
  const matchingRepresentationHeaders = {
    accept: "application/pdf",
    "accept-language": "ko-KR"
  };
  const matchingFreshnessPolicyExpiry = policyExpiry({
    requestParameters: matchingRequestParameters,
    representationHeaders: matchingRepresentationHeaders
  });
  assert.doesNotThrow(() =>
    verifyOfficialMarketCalendarAcquisitionFreshnessPolicyBoundary(
      {
        redirectChainBoundary: chain({
          freshnessPolicyExpiry: matchingFreshnessPolicyExpiry,
          parameterRequests: [
            parameterRequest({
              requestParameters: matchingRequestParameters
            }),
            parameterRequest()
          ],
          representationHeaderRequests: [
            representationHeaderRequest({
              representationHeaders: matchingRepresentationHeaders
            }),
            representationHeaderRequest()
          ],
          headerNameRequests: [
            headerNameRequest({
              requestHeaderNames: [
                "accept",
                "accept-language",
                "cache-control",
                "content-type",
                "pragma"
              ]
            }),
            headerNameRequest()
          ]
        }),
        freshnessPolicySelectorMetadata: policySelectorMetadata(
          matchingFreshnessPolicyExpiry
        )
      },
      policyRegistry(matchingFreshnessPolicyExpiry)
    )
  );
  for (const freshnessPolicyExpiry of [
    policyExpiry({ requestedUrl: "https://global.krx.co.kr/calendar" }),
    policyExpiry({
      exchange: "NYSE",
      requestedUrl: "https://www.nyse.com/source"
    }),
    policyExpiry({
      requestMethod: "GET",
      requestBodyContentType: null,
      requestBodyHash: null
    }),
    policyExpiry({ requestParameters: { locale: "en" } }),
    policyExpiry({ requestBodyContentType: "application/json" }),
    policyExpiry({ requestBodyHash: hash("b") }),
    policyExpiry({ representationHeaders: { accept: "text/html" } })
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarAcquisitionFreshnessPolicyBoundary(
          {
            redirectChainBoundary: chain({ freshnessPolicyExpiry }),
            freshnessPolicySelectorMetadata:
              policySelectorMetadata(freshnessPolicyExpiry)
          },
          policyRegistry(freshnessPolicyExpiry)
        ),
      /do not match verified initial request/
    );
  }
});

test("calendar redirect chain boundary rejects mismatched hop counts", () => {
  for (const boundary of [
    chain({ responseStatuses: [302, 303] }),
    chain({ redirectHops: [locationHop(), secondLocationHop()] }),
    chain({ transitions: [methodTransition(), secondMethodTransition()] })
  ]) {
    assert.throws(
      () => verifyOfficialMarketCalendarRedirectChainBoundary(boundary),
      /must contain the same hop count/
    );
  }
});

test("calendar redirect chain boundary rejects status identity mismatch", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({ responseStatuses: [301] })
      ),
    /status must match its method transition/
  );
});

test("calendar redirect chain boundary rejects effective URL mismatch", () => {
  for (const effectiveRequestUrls of [
    ["https://global.krx.co.kr/source"],
    [
      "https://global.krx.co.kr/source",
      "https://global.krx.co.kr/other"
    ]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ effectiveRequestUrls })
        ),
      /Location chain must match effective request URLs/
    );
  }
});

test("calendar redirect chain boundary rejects allowlist URL mismatch", () => {
  for (const domainUrls of [
    ["https://global.krx.co.kr/source"],
    [
      "https://global.krx.co.kr/source",
      "https://global.krx.co.kr/other"
    ]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ domainUrls })
        ),
      /allowlist URLs must match effective request URLs/
    );
  }
});

test("calendar redirect chain boundary rejects credential observation count mismatch", () => {
  for (const credentialRequests of [
    [credentialRequest()],
    [credentialRequest(), credentialRequest(), credentialRequest()]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ credentialRequests })
        ),
      /credential observations must match effective request count/
    );
  }
});

test("calendar redirect chain boundary rejects cache request count mismatch", () => {
  for (const cacheRequests of [
    [cacheRequest()],
    [cacheRequest(), cacheRequest(), cacheRequest()]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ cacheRequests })
        ),
      /cache request observations must match effective request count/
    );
  }
});

test("calendar redirect chain boundary rejects range observation count mismatch", () => {
  for (const rangeRequests of [
    [rangeRequest()],
    [rangeRequest(), rangeRequest(), rangeRequest()]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ rangeRequests })
        ),
      /range observations must match effective request count/
    );
  }
});

test("calendar redirect chain boundary rejects request header name observation count mismatch", () => {
  for (const headerNameRequests of [
    [headerNameRequest()],
    [headerNameRequest(), headerNameRequest(), headerNameRequest()]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ headerNameRequests })
        ),
      /request header name observations must match effective request count/
    );
  }
});

test("calendar redirect chain boundary requires a registered request header policy version", () => {
  const {
    requestHeaderPolicyVersion: _requestHeaderPolicyVersion,
    ...missingVersion
  } = chain();
  assert.throws(
    () => verifyOfficialMarketCalendarRedirectChainBoundary(missingVersion),
    /expected nonoptional/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({
          requestHeaderPolicyVersion: "test.unknown_request_headers.v1"
        })
      ),
    /version is not registered/
  );
});

test("calendar redirect chain boundary binds request header policy to the initial source selector", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({
          requestHeaderPolicyVersion:
            OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_REGULAR_SESSION
        })
      ),
    /source selector must match verified initial request/
  );
});

test("calendar redirect chain boundary rejects header names outside the registered policy", () => {
  const freshnessPolicyExpiry = policyExpiry({
    exchange: "NYSE",
    requestMethod: "GET",
    requestedUrl: NYSE_REQUESTED_URL,
    requestBodyContentType: null,
    requestBodyHash: null
  });
  const boundary = chain({
    exchange: "NYSE",
    requestHeaderPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.NYSE_TRADE_HOURS_CALENDARS,
    effectiveRequestUrls: [NYSE_REQUESTED_URL, NYSE_REDIRECTED_URL],
    freshnessPolicyExpiry,
    headerNameRequests: [
      headerNameRequest({
        requestHeaderNames: [
          "accept",
          "accept-language",
          "cache-control",
          "pragma"
        ]
      }),
      headerNameRequest()
    ],
    redirectHops: [
      {
        responseUrl: NYSE_REQUESTED_URL,
        locationHeaderValues: ["?download=1"],
        nextEffectiveRequestUrl: NYSE_REDIRECTED_URL
      }
    ],
    transitions: [
      {
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

  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundaryWithRegistry(
        boundary,
        policyRegistry(freshnessPolicyExpiry)
      ),
    /must stay within registered policy at effective request 0/
  );
});

test("calendar redirect chain boundary resolves the configured official request header policy by default", () => {
  assert.doesNotThrow(() =>
    verifyOfficialMarketCalendarRedirectChainBoundaryWithRegistry(
      chain(),
      policyRegistry()
    )
  );
});

test("calendar redirect chain boundary rejects cache request header name mismatch", () => {
  for (const requestHeaderNames of [
    ["content-type", "pragma"],
    ["cache-control", "content-type"],
    ["cache-control", "content-type", "if-none-match", "pragma"],
    ["cache-control", "content-type", "if-modified-since", "pragma"]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({
            headerNameRequests: [
              headerNameRequest({ requestHeaderNames }),
              headerNameRequest()
            ]
          })
        ),
      /cache request header names must match verified cache policy/
    );
  }
});

test("calendar redirect chain boundary rejects credential request header name mismatch", () => {
  for (const headerNameRequests of [
    [
      headerNameRequest({
        requestHeaderNames: ["authorization", "cache-control", "pragma"]
      }),
      headerNameRequest()
    ],
    [
      headerNameRequest(),
      headerNameRequest({
        requestHeaderNames: ["cache-control", "cookie", "pragma"]
      })
    ],
    [
      headerNameRequest(),
      headerNameRequest({
        requestHeaderNames: [
          "cache-control",
          "pragma",
          "proxy-authorization"
        ]
      })
    ]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ headerNameRequests })
        ),
      /credential request header names must match verified credential boundary/
    );
  }
});

test("calendar redirect chain boundary rejects range request header name mismatch", () => {
  for (const headerNameRequests of [
    [
      headerNameRequest({
        requestHeaderNames: ["cache-control", "pragma", "range"]
      }),
      headerNameRequest()
    ],
    [
      headerNameRequest(),
      headerNameRequest({
        requestHeaderNames: ["cache-control", "if-range", "pragma"]
      })
    ]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ headerNameRequests })
        ),
      /range request header names must match verified range boundary/
    );
  }
});

test("calendar redirect chain boundary rejects content-type request header name mismatch", () => {
  for (const headerNameRequests of [
    [
      headerNameRequest({
        requestHeaderNames: ["cache-control", "pragma"]
      }),
      headerNameRequest()
    ],
    [
      headerNameRequest({
        requestHeaderNames: [
          "cache-control",
          "content-type",
          "pragma"
        ]
      }),
      headerNameRequest({
        requestHeaderNames: [
          "cache-control",
          "content-type",
          "pragma"
        ]
      })
    ]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ headerNameRequests })
        ),
      /content-type request header name must match verified request body metadata/
    );
  }
});

test("calendar redirect chain boundary rejects parameter observation count mismatch", () => {
  for (const parameterRequests of [
    [parameterRequest()],
    [parameterRequest(), parameterRequest(), parameterRequest()]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ parameterRequests })
        ),
      /parameter observations must match effective request count/
    );
  }
});

test("calendar redirect chain boundary rejects representation header observation count mismatch", () => {
  for (const representationHeaderRequests of [
    [representationHeaderRequest()],
    [
      representationHeaderRequest(),
      representationHeaderRequest(),
      representationHeaderRequest()
    ]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ representationHeaderRequests })
        ),
      /representation header observations must match effective request count/
    );
  }
});

test("calendar redirect chain boundary accepts representation header keys present in request names", () => {
  assert.doesNotThrow(() =>
    verifyOfficialMarketCalendarRedirectChainBoundary(
      chain({
        headerNameRequests: [
          headerNameRequest({
            requestHeaderNames: [
              "accept",
              "cache-control",
              "content-type",
              "pragma"
            ]
          }),
          headerNameRequest({
            requestHeaderNames: [
              "accept-language",
              "cache-control",
              "pragma"
            ]
          })
        ],
        representationHeaderRequests: [
          representationHeaderRequest({
            representationHeaders: { accept: "application/pdf" }
          }),
          representationHeaderRequest({
            representationHeaders: { "accept-language": "ko-KR" }
          })
        ]
      })
    )
  );
});

test("calendar redirect chain boundary rejects representation header keys missing from request names", () => {
  for (const representationHeaderRequests of [
    [
      representationHeaderRequest({
        representationHeaders: { accept: "application/pdf" }
      }),
      representationHeaderRequest()
    ],
    [
      representationHeaderRequest(),
      representationHeaderRequest({
        representationHeaders: { "accept-language": "ko-KR" }
      })
    ]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ representationHeaderRequests })
        ),
      /representation header keys must be present in verified request header names/
    );
  }
});

test("calendar redirect chain boundary derives transfer from final response", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({ finalResponseUrl: "https://global.krx.co.kr/source" })
      ),
    /final response URL must match final URL/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary({
        ...chain(),
        finalTransferCompletion: transferCompletion()
      }),
    /Unrecognized key/
  );
});

test("calendar redirect chain boundary preserves child fail-closed validation", () => {
  const {
    requestHeaderNamesBoundary: _requestHeaderNamesBoundary,
    ...missingRequestHeaderNamesBoundary
  } = chain();
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectChainBoundary(
      missingRequestHeaderNamesBoundary
    )
  );
  const {
    requestParametersBoundary: _requestParametersBoundary,
    ...missingRequestParametersBoundary
  } = chain();
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectChainBoundary(
      missingRequestParametersBoundary
    )
  );
  const {
    representationHeadersBoundary: _representationHeadersBoundary,
    ...missingRepresentationHeadersBoundary
  } = chain();
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectChainBoundary(
      missingRepresentationHeadersBoundary
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundaryWithRegistry(
        chain(),
        []
      ),
    /version is not registered/
  );
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectChainBoundary(
      chain({ responseStatuses: [307] })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary({
        ...chain(),
        followedAutomatically: true
      }),
    /Unrecognized key/
  );
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectChainBoundary(
      chain({ domainUrls: ["https://www.nyse.com/source"] })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({
          credentialRequests: [
            credentialRequest(),
            credentialRequest({ authorizationHeaderValues: ["secret"] })
          ]
        })
      ),
    /must not contain credential headers/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({
          rangeRequests: [
            rangeRequest(),
            rangeRequest({ rangeHeaderValues: ["bytes=0-99"] })
          ]
        })
      ),
    /must not contain Range or If-Range headers/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({
          headerNameRequests: [
            headerNameRequest({
              requestHeaderNames: ["pragma", "cache-control"]
            }),
            headerNameRequest()
          ]
        })
      ),
    /canonical order without duplicates/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({
          parameterRequests: [
            parameterRequest({
              requestParameters: { year: "2026", locale: "en" }
            }),
            parameterRequest()
          ]
        })
      ),
    /must use canonical key order/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({
          representationHeaderRequests: [
            representationHeaderRequest({
              representationHeaders: {
                "accept-language": "ko-KR",
                accept: "application/pdf"
              }
            }),
            representationHeaderRequest()
          ]
        })
      ),
    /must use canonical key order/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({
          cacheRequests: [
            cacheRequest(),
            cacheRequest({ ifNoneMatchHeaderValues: ['"etag"'] })
          ]
        })
      ),
    /must not contain conditional headers/
  );
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectChainBoundary(
      chain({ automaticRedirectFollowEnabled: true })
    )
  );
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectChainBoundary(
      chain({ credentialProviderConfigured: true })
    )
  );
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectChainBoundary(
      chain({ insecureTlsBypassEnabled: true })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({ finalHttpStatus: 206 })
      ),
    /final response status must be exactly 200/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({ transferCompleted: false })
      ),
    /transfer must be complete/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({ finalDateHeaderValues: [] })
      ),
    /exactly one Date/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({ finalEffectiveResponseAt: "2025-07-01T12:00:01.000Z" })
      ),
    /does not match cache age/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({ finalCacheControlHeaderValues: ["max-age =60"] })
      ),
    /valid directive syntax/
  );
});

function chain(
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

function policyExpiry(
  overrides: Partial<{
    exchange: "KRX" | "NYSE";
    requestMethod: "GET" | "POST";
    requestParameters: Record<string, unknown>;
    representationHeaders: Record<string, unknown>;
    requestedUrl: string;
    requestBodyContentType: string | null;
    requestBodyHash: string | null;
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
      parserContractVersion: "krx_calendar_pdf.v1"
    },
    coverageSelector: {
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
      freshnessPolicyVersion: "krx_calendar_annual.v1",
      freshnessPolicyDefinition: definition,
      freshnessPolicyHash:
        createOfficialMarketCalendarFreshnessPolicyHash(definition)
    },
    staleAfter: "2025-07-02T12:00:00.000Z"
  };
}

function verifyOfficialMarketCalendarRedirectChainBoundary(value: unknown) {
  return verifyOfficialMarketCalendarRedirectChainBoundaryWithRegistry(
    value,
    policyRegistry()
  );
}

function policyRegistry(
  freshnessPolicyExpiry = policyExpiry()
) {
  return [freshnessPolicyExpiry.freshnessPolicyEntry];
}

function policySelectorMetadata(
  freshnessPolicyExpiry = policyExpiry()
) {
  const definition = freshnessPolicyExpiry.freshnessPolicyEntry
    .freshnessPolicyDefinition;
  return {
    ...definition.sourceSelector,
    ...definition.coverageSelector
  };
}

function transferCompletion(
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

function cacheRequest(
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

function rangeRequest(
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

function parameterRequest(
  overrides: Partial<{
    requestParameters: Record<string, unknown>;
  }> = {}
) {
  return {
    requestParameters: {},
    ...overrides
  };
}

function headerNameRequest(
  overrides: Partial<{
    requestHeaderNames: string[];
  }> = {}
) {
  return {
    requestHeaderNames: ["cache-control", "pragma"],
    ...overrides
  };
}

function representationHeaderRequest(
  overrides: Partial<{
    representationHeaders: Record<string, unknown>;
  }> = {}
) {
  return {
    representationHeaders: {},
    ...overrides
  };
}

function credentialRequest(
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

function locationHop() {
  return {
    responseUrl: KRX_REQUESTED_URL,
    locationHeaderValues: ["?download=1"],
    nextEffectiveRequestUrl: KRX_REDIRECTED_URL
  };
}

function secondLocationHop() {
  return {
    responseUrl: KRX_REDIRECTED_URL,
    locationHeaderValues: ["?download=2"],
    nextEffectiveRequestUrl: KRX_FINAL_URL
  };
}

function methodTransition(): MethodTransition {
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

function secondMethodTransition(): MethodTransition {
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

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
