import assert from "node:assert/strict";
import { tmpdir } from "node:os";
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
import {
  createOfficialMarketCalendarSourceDocumentEnvelope,
  parseOfficialMarketCalendarSourceDocumentEnvelope
} from "./officialMarketCalendarSourceDocumentEnvelope.js";
import {
  createOfficialMarketCalendarSourceDocumentMetadata,
  parseOfficialMarketCalendarSourceDocumentMetadata
} from "./officialMarketCalendarSourceDocumentMetadata.js";
import {
  OFFICIAL_MARKET_CALENDAR_SOURCE_COLLECTION_SCHEMA_VERSION
} from "./officialMarketCalendarSourceCollection.js";
import {
  createOfficialMarketCalendarEvidenceArtifactV2Hash,
  createOfficialMarketCalendarEvidenceArtifactV2,
  parseOfficialMarketCalendarEvidenceArtifactV2
} from "./officialMarketCalendarEvidenceArtifactV2.js";
import {
  createOfficialMarketCalendarPublicationReaderFreshnessHash,
  evaluateOfficialMarketCalendarPublicationReaderFreshness,
  parseOfficialMarketCalendarPublicationReaderFreshness,
  requireOfficialMarketCalendarPublicationReaderHandle
} from "./officialMarketCalendarPublicationReaderFreshness.js";
import {
  assertOfficialMarketCalendarPublicationActivationPermitted,
  evaluateOfficialMarketCalendarPublicationActivationPreflight,
  parseOfficialMarketCalendarPublicationActivationPreflight
} from "./officialMarketCalendarPublicationActivationPreflight.js";
import {
  inspectOfficialMarketCalendarPublicationFilesystem
} from "./officialMarketCalendarPublicationFilesystemPreflight.js";
import {
  createOfficialMarketCalendarPublicationPackagePlan,
  parseOfficialMarketCalendarPublicationPackagePlan
} from "./officialMarketCalendarPublicationPackagePlan.js";
import {
  createOfficialMarketCalendarSourceCollectionAssembly,
  parseOfficialMarketCalendarSourceCollectionAssembly
} from "./officialMarketCalendarSourceCollectionAssembly.js";
import {
  createOfficialMarketCalendarSourceCollectionDocumentProjection,
  parseOfficialMarketCalendarSourceCollectionDocumentProjection
} from "./officialMarketCalendarSourceCollectionDocumentProjection.js";
import {
  createOfficialMarketCalendarSourceDocumentAcquisitionMetadata,
  parseOfficialMarketCalendarSourceDocumentAcquisitionMetadata
} from "./officialMarketCalendarSourceDocumentAcquisitionMetadata.js";
import {
  OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_CONTRACT_DEFINITION_SCHEMA_VERSION,
  createOfficialMarketCalendarSourceParserContractHash
} from "./officialMarketCalendarSourceParserContract.js";
import {
  bindOfficialMarketCalendarSourceParserInput,
  openOfficialMarketCalendarSourceParserInputBinding
} from "./officialMarketCalendarSourceParserInputBinding.js";
import {
  createOfficialMarketCalendarSourceParserResult,
  parseOfficialMarketCalendarSourceParserResult
} from "./officialMarketCalendarSourceParserResult.js";
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
        responseRepresentationHeaders: {
          contentTypeHeaderValues: ["application/pdf"],
          contentEncodingHeaderValues: [],
          contentType: "application/pdf",
          contentEncoding: null
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

test("calendar redirect chain boundary rejects representation request header names without recorded values", () => {
  for (const [missingValueRequestIndex, headerNameRequests] of [
    [
      headerNameRequest({
        requestHeaderNames: [
          "accept",
          "cache-control",
          "content-type",
          "pragma"
        ]
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
          "accept-language",
          "cache-control",
          "pragma"
        ]
      })
    ]
  ].entries()) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ headerNameRequests })
        ),
      new RegExp(
        `representation request header names must have recorded values at effective request ${missingValueRequestIndex}`
      )
    );
  }
});

test("calendar redirect chain boundary rejects non-representation header categories in representation values", () => {
  for (const [headerName, requestIndex] of [
    ["cache-control", 0],
    ["pragma", 1],
    ["content-type", 0]
  ] as const) {
    const representationHeaderRequests = [
      representationHeaderRequest(),
      representationHeaderRequest()
    ];
    representationHeaderRequests[requestIndex] = representationHeaderRequest({
      representationHeaders: { [headerName]: "recorded-value" }
    });

    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ representationHeaderRequests })
        ),
      new RegExp(
        `representation header keys must belong to the representation category at effective request ${requestIndex}`
      )
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

test("calendar source document envelope binds exact bytes to verified acquisition", () => {
  const sourceBytes = new Uint8Array(100).fill(65);
  const envelope = createOfficialMarketCalendarSourceDocumentEnvelope(
    {
      documentId: "krx.calendar.2026",
      sourceBytes,
      acquisitionBoundary: {
        redirectChainBoundary: chain(),
        freshnessPolicySelectorMetadata: policySelectorMetadata()
      }
    },
    policyRegistry()
  );

  assert.equal(envelope.exchange, "KRX");
  assert.equal(envelope.contentLength, 100);
  assert.match(envelope.sourceDocumentHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(envelope.envelopeHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal("sourceBytes" in envelope, false);
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.acquisitionBoundary), true);
  assert.deepEqual(
    parseOfficialMarketCalendarSourceDocumentEnvelope(
      envelope,
      {
        freshnessPolicyRegistry: policyRegistry(),
        sourceBytes
      }
    ),
    envelope
  );

  const sourceDocumentHash = envelope.sourceDocumentHash;
  sourceBytes.fill(66);
  assert.equal(envelope.sourceDocumentHash, sourceDocumentHash);
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceDocumentEnvelope(envelope, {
        freshnessPolicyRegistry: policyRegistry(),
        sourceBytes
      }),
    /bytes do not match the envelope/
  );
});

test("calendar source document envelope rejects byte length mismatch", () => {
  assert.throws(
    () =>
      createOfficialMarketCalendarSourceDocumentEnvelope(
        {
          documentId: "krx.calendar.truncated",
          sourceBytes: new Uint8Array(99),
          acquisitionBoundary: {
            redirectChainBoundary: chain(),
            freshnessPolicySelectorMetadata: policySelectorMetadata()
          }
        },
        policyRegistry()
      ),
    /length must match verified transfer completion/
  );
});

test("calendar source document envelope rejects envelope and boundary tamper", () => {
  const envelope = createOfficialMarketCalendarSourceDocumentEnvelope(
    {
      documentId: "krx.calendar.tamper",
      sourceBytes: new Uint8Array(100),
      acquisitionBoundary: {
        redirectChainBoundary: chain(),
        freshnessPolicySelectorMetadata: policySelectorMetadata()
      }
    },
    policyRegistry()
  );

  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceDocumentEnvelope(
        { ...envelope, envelopeHash: hash("f") },
        {
          freshnessPolicyRegistry: policyRegistry(),
          sourceBytes: new Uint8Array(100)
        }
      ),
    /envelope hash mismatch/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceDocumentEnvelope(
        { ...envelope, sourceDocumentHash: hash("e") },
        {
          freshnessPolicyRegistry: policyRegistry(),
          sourceBytes: new Uint8Array(100)
        }
      ),
    /bytes do not match the envelope/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceDocumentEnvelope(
        { ...envelope, exchange: "NYSE" },
        {
          freshnessPolicyRegistry: policyRegistry(),
          sourceBytes: new Uint8Array(100)
        }
      ),
    /exchange must match acquisition boundary/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceDocumentEnvelope(
        { ...envelope, contentLength: 99 },
        {
          freshnessPolicyRegistry: policyRegistry(),
          sourceBytes: new Uint8Array(100)
        }
      ),
    /length must match acquisition boundary/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceDocumentEnvelope(
        {
          ...envelope,
          acquisitionBoundary: {
            ...envelope.acquisitionBoundary,
            currentTime: "2025-07-01T12:00:00.000Z"
          }
        },
        {
          freshnessPolicyRegistry: policyRegistry(),
          sourceBytes: new Uint8Array(100)
        }
      ),
    /Unrecognized key/
  );
});

test("calendar source document envelope keeps unverified metadata and shape-loose input closed", () => {
  const base = {
    documentId: "krx.calendar.strict",
    sourceBytes: new Uint8Array(100),
    acquisitionBoundary: {
      redirectChainBoundary: chain(),
      freshnessPolicySelectorMetadata: policySelectorMetadata()
    }
  };

  assert.throws(
    () =>
      createOfficialMarketCalendarSourceDocumentEnvelope(
        { ...base, contentEncoding: null },
        policyRegistry()
      ),
    /Unrecognized key/
  );
  assert.throws(
    () =>
      createOfficialMarketCalendarSourceDocumentEnvelope(
        { ...base, credential: "not-allowed" },
        policyRegistry()
      ),
    /Unrecognized key/
  );
});

test("calendar source document acquisition metadata keeps policy coverage as expected selectors", () => {
  const sourceBytes = new Uint8Array(100).fill(65);
  const sourceDocumentEnvelope =
    createOfficialMarketCalendarSourceDocumentEnvelope(
      {
        documentId: "krx.calendar.metadata",
        sourceBytes,
        acquisitionBoundary: {
          redirectChainBoundary: chain(),
          freshnessPolicySelectorMetadata: policySelectorMetadata()
        }
      },
      policyRegistry()
    );
  const metadata = createOfficialMarketCalendarSourceDocumentAcquisitionMetadata(
    { sourceDocumentEnvelope },
    {
      freshnessPolicyRegistry: policyRegistry(),
      sourceBytes
    }
  );

  assert.equal(metadata.exchange, "KRX");
  assert.equal(metadata.publisher, "KRX");
  assert.equal(metadata.requestMethod, "POST");
  assert.equal(metadata.requestedUrl, KRX_REQUESTED_URL);
  assert.equal(metadata.finalUrl, KRX_REDIRECTED_URL);
  assert.equal(
    metadata.cacheRequestPolicyVersion,
    OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION
  );
  assert.deepEqual(
    metadata.redirectChain,
    verifyOfficialMarketCalendarRedirectChainBoundary(chain())
  );
  assert.equal(metadata.retrievedAt, "2025-07-01T12:00:10.000Z");
  assert.equal(metadata.staleAfter, "2025-07-02T12:00:00.000Z");
  assert.equal(metadata.contentType, "application/pdf");
  assert.equal(metadata.contentEncoding, null);
  assert.equal(metadata.contentLength, 100);
  assert.equal(metadata.sourceDocumentHash, sourceDocumentEnvelope.sourceDocumentHash);
  assert.deepEqual(metadata.expectedEvidenceRoles, [
    "holiday_rows",
    "holiday_schedule"
  ]);
  assert.equal(
    metadata.expectedParserContractVersion,
    "krx_calendar_pdf.v1"
  );
  assert.equal(metadata.parserResultBound, false);
  assert.equal("evidenceRoles" in metadata, false);
  assert.equal("rowCoverageStartDate" in metadata, false);
  assert.equal("metadataHash" in metadata, false);
  assert.match(metadata.acquisitionMetadataHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(metadata), true);
  assert.equal(Object.isFrozen(metadata.sourceDocumentEnvelope), true);
  assert.deepEqual(
    parseOfficialMarketCalendarSourceDocumentAcquisitionMetadata(metadata, {
      freshnessPolicyRegistry: policyRegistry(),
      sourceBytes
    }),
    metadata
  );
});

test("calendar source document acquisition metadata rejects derived-field and byte tamper", () => {
  const sourceBytes = new Uint8Array(100).fill(65);
  const sourceDocumentEnvelope =
    createOfficialMarketCalendarSourceDocumentEnvelope(
      {
        documentId: "krx.calendar.metadata-tamper",
        sourceBytes,
        acquisitionBoundary: {
          redirectChainBoundary: chain(),
          freshnessPolicySelectorMetadata: policySelectorMetadata()
        }
      },
      policyRegistry()
    );
  const metadata = createOfficialMarketCalendarSourceDocumentAcquisitionMetadata(
    { sourceDocumentEnvelope },
    {
      freshnessPolicyRegistry: policyRegistry(),
      sourceBytes
    }
  );
  const parse = (value: unknown, bytes: Uint8Array = sourceBytes) =>
    parseOfficialMarketCalendarSourceDocumentAcquisitionMetadata(value, {
      freshnessPolicyRegistry: policyRegistry(),
      sourceBytes: bytes
    });

  assert.throws(
    () => parse({ ...metadata, publisher: "NYSE" }),
    /does not match verified envelope/
  );
  assert.throws(
    () => parse({ ...metadata, contentType: "text/plain" }),
    /does not match verified envelope/
  );
  assert.throws(
    () =>
      parse({
        ...metadata,
        redirectChain: { ...metadata.redirectChain, unverifiedHop: {} }
      }),
    /does not match verified envelope/
  );
  assert.throws(
    () =>
      parse({
        ...metadata,
        cacheRequestPolicyVersion: "caller-cache-policy.v1"
      }),
    /does not match verified envelope/
  );
  assert.throws(
    () => parse({ ...metadata, acquisitionMetadataHash: hash("f") }),
    /does not match verified envelope/
  );
  assert.throws(
    () => parse(metadata, new Uint8Array(100).fill(66)),
    /bytes do not match the envelope/
  );
  assert.throws(
    () =>
      createOfficialMarketCalendarSourceDocumentAcquisitionMetadata(
        { sourceDocumentEnvelope, publisher: "caller" },
        {
          freshnessPolicyRegistry: policyRegistry(),
          sourceBytes
        }
      ),
    /Unrecognized key/
  );
});

test("calendar source parser input binds verified acquisition to decoded bytes", () => {
  const sourceBytes = new Uint8Array(100).fill(65);
  const sourceDocumentEnvelope =
    createOfficialMarketCalendarSourceDocumentEnvelope(
      {
        documentId: "krx.calendar.parser-input",
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
  const bound = bindOfficialMarketCalendarSourceParserInput(
    { sourceDocumentAcquisitionMetadata, parserContractEntry },
    options
  );

  assert.equal(bound.parserInputBinding.documentId, "krx.calendar.parser-input");
  assert.equal(bound.parserInputBinding.exchange, "KRX");
  assert.equal(
    bound.parserInputBinding.sourceDocumentHash,
    sourceDocumentAcquisitionMetadata.sourceDocumentHash
  );
  assert.equal(
    bound.parserInputBinding.parserOutputSchemaVersion,
    "calendar_parser_output.v1"
  );
  assert.equal(bound.parserInputBinding.parserResultBound, false);
  assert.deepEqual(bound.decodedBytes, sourceBytes);
  assert.equal(Object.isFrozen(bound.parserInputBinding), true);
  assert.deepEqual(
    openOfficialMarketCalendarSourceParserInputBinding(
      bound.parserInputBinding,
      options
    ),
    bound
  );
});

test("calendar source parser input rejects selector, representation and byte mismatch", () => {
  const sourceBytes = new Uint8Array(100).fill(65);
  const sourceDocumentEnvelope =
    createOfficialMarketCalendarSourceDocumentEnvelope(
      {
        documentId: "krx.calendar.parser-input-mismatch",
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
  const bind = (entry: ReturnType<typeof sourceParserContractEntry>) =>
    bindOfficialMarketCalendarSourceParserInput(
      { sourceDocumentAcquisitionMetadata, parserContractEntry: entry },
      {
        sourceBytes,
        freshnessPolicyRegistry: policyRegistry(),
        parserContractRegistry: [entry]
      }
    );

  assert.throws(
    () => bind(sourceParserContractEntry({ parserContractVersion: "other.v1" })),
    /does not match acquisition selector/
  );
  assert.throws(
    () => bind(sourceParserContractEntry({ acceptedContentTypes: ["text/csv"] })),
    /content type is not accepted/
  );
  const bound = bind(parserContractEntry);
  assert.throws(
    () =>
      openOfficialMarketCalendarSourceParserInputBinding(
        { ...bound.parserInputBinding, decodedContentLength: 101 },
        {
          sourceBytes,
          freshnessPolicyRegistry: policyRegistry(),
          parserContractRegistry: [parserContractEntry]
        }
      ),
    /does not match verified acquisition/
  );
  assert.throws(
    () =>
      openOfficialMarketCalendarSourceParserInputBinding(
        bound.parserInputBinding,
        {
          sourceBytes: new Uint8Array(100).fill(66),
          freshnessPolicyRegistry: policyRegistry(),
          parserContractRegistry: [parserContractEntry]
        }
      ),
    /bytes do not match the envelope/
  );
});

test("calendar source parser result derives canonical claims from parsed output", () => {
  const fixture = sourceParserInputFixture("krx.calendar.parser-result");
  const parserOutput = sourceParserOutput();
  const result = createOfficialMarketCalendarSourceParserResult(
    { parserInputBinding: fixture.bound.parserInputBinding, parserOutput },
    fixture.options
  );

  assert.deepEqual(result.evidenceRoles, [
    "holiday_rows",
    "holiday_schedule"
  ]);
  assert.equal(result.rowCoverageStartDate, "2026-01-01");
  assert.equal(result.rowCoverageEndDate, "2026-12-31");
  assert.equal(result.parserResultBound, true);
  assert.match(result.parserOutputHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(
    parseOfficialMarketCalendarSourceParserResult(result, fixture.options),
    result
  );
});

test("calendar source parser result rejects noncanonical rows and selector mismatch", () => {
  const fixture = sourceParserInputFixture("krx.calendar.parser-result-invalid");
  const create = (parserOutput: unknown) =>
    createOfficialMarketCalendarSourceParserResult(
      { parserInputBinding: fixture.bound.parserInputBinding, parserOutput },
      fixture.options
    );

  assert.throws(
    () =>
      create({
        ...sourceParserOutput(),
        parsedRows: [
          sourceParserOutput().parsedRows[1],
          sourceParserOutput().parsedRows[0]
        ]
      }),
    /unique ascending exchange dates/
  );
  assert.throws(
    () =>
      create({
        ...sourceParserOutput(),
        parsedRows: [sourceParserOutput().parsedRows[0]]
      }),
    /claims do not match acquisition selector/
  );
  assert.throws(
    () =>
      create({
        ...sourceParserOutput(),
        schemaVersion: "calendar_parser_output.v2"
      }),
    /does not match parser contract/
  );
  assert.throws(
    () =>
      create({
        ...sourceParserOutput(),
        parsedRows: [
          {
            ...sourceParserOutput().parsedRows[0],
            fields: { z: "last", a: "first" }
          },
          sourceParserOutput().parsedRows[1]
        ]
      }),
    /canonical key order/
  );
  assert.throws(
    () =>
      create({
        ...sourceParserOutput(),
        parsedRows: [
          {
            ...sourceParserOutput().parsedRows[0],
            evidenceRoles: ["session_hours"]
          },
          sourceParserOutput().parsedRows[1]
        ]
      }),
    /require parsed regular session hours/
  );
  assert.throws(
    () =>
      create({
        ...sourceParserOutput(),
        scheduleCoverageIntervals: [
          {
            coverageRole: "holiday_schedule",
            startDate: "2026-01-01",
            endDate: "2026-06-30"
          },
          {
            coverageRole: "holiday_schedule",
            startDate: "2026-07-01",
            endDate: "2026-12-31"
          }
        ]
      }),
    /same-role schedule coverage intervals must be merged/
  );
});

test("calendar source parser result rejects stored result and source byte tamper", () => {
  const fixture = sourceParserInputFixture("krx.calendar.parser-result-tamper");
  const result = createOfficialMarketCalendarSourceParserResult(
    {
      parserInputBinding: fixture.bound.parserInputBinding,
      parserOutput: sourceParserOutput()
    },
    fixture.options
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceParserResult(
        { ...result, rowCoverageEndDate: "2026-12-30" },
        fixture.options
      ),
    /does not match verified parser input/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceParserResult(result, {
        ...fixture.options,
        sourceBytes: new Uint8Array(100).fill(66)
      }),
    /bytes do not match the envelope/
  );
});

test("calendar source document metadata promotes verified parser result", () => {
  const fixture = sourceParserInputFixture("krx.calendar.final-metadata");
  const sourceParserResult = createOfficialMarketCalendarSourceParserResult(
    {
      parserInputBinding: fixture.bound.parserInputBinding,
      parserOutput: sourceParserOutput()
    },
    fixture.options
  );
  const metadata = createOfficialMarketCalendarSourceDocumentMetadata(
    { sourceParserResult },
    fixture.options
  );

  assert.equal(metadata.documentId, "krx.calendar.final-metadata");
  assert.equal(metadata.publisher, "KRX");
  assert.equal(metadata.parserResultBound, true);
  assert.deepEqual(metadata.evidenceRoles, [
    "holiday_rows",
    "holiday_schedule"
  ]);
  assert.equal(metadata.rowCoverageStartDate, "2026-01-01");
  assert.equal(metadata.rowCoverageEndDate, "2026-12-31");
  assert.equal(metadata.parserResultHash, sourceParserResult.parserResultHash);
  assert.match(metadata.metadataHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal("expectedEvidenceRoles" in metadata, false);
  assert.equal(Object.isFrozen(metadata), true);
  assert.deepEqual(
    parseOfficialMarketCalendarSourceDocumentMetadata(metadata, fixture.options),
    metadata
  );
});

test("calendar source document metadata rejects projection and byte tamper", () => {
  const fixture = sourceParserInputFixture("krx.calendar.final-metadata-tamper");
  const sourceParserResult = createOfficialMarketCalendarSourceParserResult(
    {
      parserInputBinding: fixture.bound.parserInputBinding,
      parserOutput: sourceParserOutput()
    },
    fixture.options
  );
  const metadata = createOfficialMarketCalendarSourceDocumentMetadata(
    { sourceParserResult },
    fixture.options
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceDocumentMetadata(
        { ...metadata, publisher: "NYSE" },
        fixture.options
      ),
    /does not match verified parser result/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceDocumentMetadata(metadata, {
        ...fixture.options,
        sourceBytes: new Uint8Array(100).fill(66)
      }),
    /bytes do not match the envelope/
  );
});

test("calendar source collection document projection preserves final metadata identity", () => {
  const fixture = sourceParserInputFixture("krx.calendar.collection-projection");
  const sourceParserResult = createOfficialMarketCalendarSourceParserResult(
    {
      parserInputBinding: fixture.bound.parserInputBinding,
      parserOutput: sourceParserOutput()
    },
    fixture.options
  );
  const sourceDocumentMetadata =
    createOfficialMarketCalendarSourceDocumentMetadata(
      { sourceParserResult },
      fixture.options
    );
  const projection =
    createOfficialMarketCalendarSourceCollectionDocumentProjection(
      { sourceDocumentMetadata },
      fixture.options
    );

  assert.equal(projection.exchange, "KRX");
  assert.equal(
    projection.collectionDocument.metadataHash,
    sourceDocumentMetadata.metadataHash
  );
  assert.equal(
    projection.collectionDocument.sourceDocumentHash,
    sourceDocumentMetadata.sourceDocumentHash
  );
  assert.match(projection.projectionHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    parseOfficialMarketCalendarSourceCollectionDocumentProjection(
      projection,
      fixture.options
    ),
    projection
  );
});

test("calendar source collection document projection rejects field and byte tamper", () => {
  const fixture = sourceParserInputFixture("krx.calendar.collection-projection-tamper");
  const sourceParserResult = createOfficialMarketCalendarSourceParserResult(
    {
      parserInputBinding: fixture.bound.parserInputBinding,
      parserOutput: sourceParserOutput()
    },
    fixture.options
  );
  const sourceDocumentMetadata =
    createOfficialMarketCalendarSourceDocumentMetadata(
      { sourceParserResult },
      fixture.options
    );
  const projection =
    createOfficialMarketCalendarSourceCollectionDocumentProjection(
      { sourceDocumentMetadata },
      fixture.options
    );
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceCollectionDocumentProjection(
        {
          ...projection,
          collectionDocument: {
            ...projection.collectionDocument,
            metadataHash: hash("f")
          }
        },
        fixture.options
      ),
    /does not match verified metadata/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceCollectionDocumentProjection(
        projection,
        {
          ...fixture.options,
          sourceBytes: new Uint8Array(100).fill(66)
        }
      ),
    /bytes do not match the envelope/
  );
});

test("calendar source collection assembly binds verified projections to collection hash", () => {
  const fixture = sourceCollectionAssemblyFixture();
  const assembly = createOfficialMarketCalendarSourceCollectionAssembly(
    {
      collectionPlan: fixture.collectionPlan,
      documentProjections: [fixture.projection]
    },
    fixture.options
  );

  assert.equal(assembly.sourceCollection.exchange, "KRX");
  assert.deepEqual(
    assembly.sourceCollection.documents,
    [fixture.projection.collectionDocument]
  );
  assert.match(assembly.sourceCollection.collectionHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(assembly.assemblyHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    parseOfficialMarketCalendarSourceCollectionAssembly(
      assembly,
      fixture.options
    ),
    assembly
  );
});

test("calendar source collection assembly rejects plan, byte and projection divergence", () => {
  const fixture = sourceCollectionAssemblyFixture();
  const create = (
    collectionPlan: Record<string, unknown> = fixture.collectionPlan,
    options: {
      sourceBytesByDocumentId: Record<string, Uint8Array>;
      freshnessPolicyRegistry: unknown;
      parserContractRegistry: unknown;
    } = fixture.options
  ) =>
    createOfficialMarketCalendarSourceCollectionAssembly(
      { collectionPlan, documentProjections: [fixture.projection] },
      options
    );

  assert.throws(
    () => create({ ...fixture.collectionPlan, documents: [] }),
    /must not supply documents/
  );
  const { schemaVersion: _schemaVersion, ...unversionedPlan } =
    fixture.collectionPlan;
  assert.throws(
    () => create(unversionedPlan),
    /schemaVersion/
  );
  assert.throws(
    () =>
      create(fixture.collectionPlan, {
        ...fixture.options,
        sourceBytesByDocumentId: {
          ...fixture.options.sourceBytesByDocumentId,
          extra: new Uint8Array([1])
        }
      }),
    /must exactly cover projected documents/
  );
  assert.throws(
    () =>
      create({
        ...fixture.collectionPlan,
        exchange: "NYSE",
        requiredExceptionCoverageRoles: {
          contractVersion: "nyse_exception_coverage.v1",
          roles: fixture.collectionPlan.requiredExceptionCoverageRoles.roles
        }
      }),
    /must match collection exchange/
  );
  const assembly = create();
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceCollectionAssembly(
        { ...assembly, assemblyHash: hash("f") },
        fixture.options
      ),
    /does not match verified projections/
  );
});

test("calendar evidence v2 binds collection assemblies, sessions and archive refs", () => {
  const fixture = evidenceArtifactV2Fixture();
  const artifact = createOfficialMarketCalendarEvidenceArtifactV2(
    fixture.input,
    fixture.options
  );

  assert.equal(artifact.schemaVersion, "official_market_calendar_evidence.v2");
  assert.equal(artifact.mode, "paper_only");
  assert.deepEqual(
    artifact.sourceCollectionAssemblies.map(
      ({ sourceCollection }) => sourceCollection.exchange
    ),
    ["KRX", "NYSE"]
  );
  assert.equal(artifact.sourceArchiveBindings.length, 2);
  assert.match(artifact.artifactHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    parseOfficialMarketCalendarEvidenceArtifactV2(
      artifact,
      fixture.options
    ),
    artifact
  );
});

test("calendar evidence v2 rejects freshness, coverage and artifact divergence", () => {
  const fixture = evidenceArtifactV2Fixture();
  assert.throws(
    () =>
      createOfficialMarketCalendarEvidenceArtifactV2(
        { ...fixture.input, generatedAt: "2025-07-01T12:00:09.000Z" },
        fixture.options
      ),
    /not yet retrieved/
  );
  assert.throws(
    () =>
      createOfficialMarketCalendarEvidenceArtifactV2(
        { ...fixture.input, generatedAt: "2025-07-02T12:00:00.000Z" },
        fixture.options
      ),
    /stale at generatedAt/
  );
  assert.throws(
    () =>
      createOfficialMarketCalendarEvidenceArtifactV2(
        { ...fixture.input, sourceArchiveBindings: [] },
        fixture.options
      ),
    /Unrecognized key/
  );
  assert.throws(
    () =>
      createOfficialMarketCalendarEvidenceArtifactV2(
        {
          ...fixture.input,
          sourceCollectionAssemblies: [
            fixture.input.sourceCollectionAssemblies[1],
            fixture.input.sourceCollectionAssemblies[0]
          ]
        },
        fixture.options
      ),
    /canonical KRX then NYSE order/
  );
  assert.throws(
    () =>
      createOfficialMarketCalendarEvidenceArtifactV2(
        {
          ...fixture.input,
          sessionProvenances: fixture.input.sessionProvenances.slice(0, 1)
        },
        fixture.options
      ),
    /exactly cover open sessions/
  );
  const artifact = createOfficialMarketCalendarEvidenceArtifactV2(
    fixture.input,
    fixture.options
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarEvidenceArtifactV2(
        { ...artifact, artifactHash: hash("f") },
        fixture.options
      ),
    /does not match verified source evidence/
  );
});

test("calendar publication reader binds an accepted handle to the exact asOf", () => {
  const fixture = evidenceArtifactV2Fixture();
  const artifact = createOfficialMarketCalendarEvidenceArtifactV2(
    fixture.input,
    fixture.options
  );
  const decision = evaluateOfficialMarketCalendarPublicationReaderFreshness({
    artifact,
    asOf: "2025-07-01T21:00:10.000+09:00"
  });

  assert.equal(decision.status, "accepted");
  assert.deepEqual(
    decision.documentEvaluations.map(({ status }) => status),
    ["fresh", "fresh"]
  );
  assert.deepEqual(decision.requiredAuditEvents, []);
  assert.equal(decision.membershipAction, "unchanged");
  assert.equal(decision.handleBinding?.asOf, decision.asOf);
  assert.equal(decision.handleBinding?.artifactHash, artifact.artifactHash);
  assert.deepEqual(
    parseOfficialMarketCalendarPublicationReaderFreshness(decision),
    decision
  );
  assert.deepEqual(
    requireOfficialMarketCalendarPublicationReaderHandle(decision),
    decision.handleBinding
  );
  assert.ok(Object.isFrozen(decision));
  assert.ok(Object.isFrozen(decision.documentEvaluations[0]));
});

test("calendar publication reader rejects future and stale boundaries without changing membership", () => {
  const fixture = evidenceArtifactV2Fixture();
  const artifact = createOfficialMarketCalendarEvidenceArtifactV2(
    fixture.input,
    fixture.options
  );
  const future = evaluateOfficialMarketCalendarPublicationReaderFreshness({
    artifact,
    asOf: "2025-07-01T12:00:09.999Z"
  });
  const stale = evaluateOfficialMarketCalendarPublicationReaderFreshness({
    artifact,
    asOf: "2025-07-02T12:00:00.000Z"
  });

  assert.equal(future.status, "rejected");
  assert.deepEqual(future.requiredAuditEvents, [
    {
      eventType: "source_not_yet_retrieved",
      artifactHash: artifact.artifactHash,
      asOf: future.asOf,
      sourceDocumentRefs: future.documentEvaluations.map(
        ({ sourceDocumentRef }) => sourceDocumentRef
      )
    }
  ]);
  assert.equal(stale.status, "rejected");
  assert.deepEqual(stale.requiredAuditEvents, [
    {
      eventType: "publication_freshness_rejected",
      artifactHash: artifact.artifactHash,
      asOf: stale.asOf,
      sourceDocumentRefs: stale.documentEvaluations.map(
        ({ sourceDocumentRef }) => sourceDocumentRef
      )
    }
  ]);
  for (const decision of [future, stale]) {
    assert.equal(decision.membershipAction, "unchanged");
    assert.equal(decision.handleBinding, null);
    assert.throws(
      () => requireOfficialMarketCalendarPublicationReaderHandle(decision),
      /freshness rejected/
    );
  }
});

test("calendar publication reader decisions are stateless across out-of-order asOf requests", () => {
  const fixture = evidenceArtifactV2Fixture();
  const artifact = createOfficialMarketCalendarEvidenceArtifactV2(
    fixture.input,
    fixture.options
  );
  const validInput = {
    artifact,
    asOf: "2025-07-01T12:00:10.000Z"
  };
  const before = evaluateOfficialMarketCalendarPublicationReaderFreshness(
    validInput
  );
  evaluateOfficialMarketCalendarPublicationReaderFreshness({
    artifact,
    asOf: "2025-07-02T12:00:00.000Z"
  });
  const after = evaluateOfficialMarketCalendarPublicationReaderFreshness(
    validInput
  );

  assert.deepEqual(after, before);
  assert.equal(after.status, "accepted");
});

test("calendar publication reader rejects offsets, artifact membership and decision tampering", () => {
  const fixture = evidenceArtifactV2Fixture();
  const artifact = createOfficialMarketCalendarEvidenceArtifactV2(
    fixture.input,
    fixture.options
  );
  assert.throws(
    () =>
      evaluateOfficialMarketCalendarPublicationReaderFreshness({
        artifact,
        asOf: "2025-07-01T12:00:10.000"
      }),
    /explicit timezone offset/
  );
  assert.throws(
    () =>
      evaluateOfficialMarketCalendarPublicationReaderFreshness({
        artifact: { ...artifact, artifactHash: hash("f") },
        asOf: "2025-07-01T12:00:10.000Z"
      }),
    /artifact hash mismatch/
  );

  const membershipTamper = structuredClone(artifact);
  membershipTamper.sourceArchiveBindings.pop();
  const {
    artifactHash: _membershipTamperHash,
    ...membershipTamperPayload
  } = membershipTamper;
  membershipTamper.artifactHash =
    createOfficialMarketCalendarEvidenceArtifactV2Hash(
      membershipTamperPayload
    );
  assert.throws(
    () =>
      evaluateOfficialMarketCalendarPublicationReaderFreshness({
        artifact: membershipTamper,
        asOf: "2025-07-01T12:00:10.000Z"
      }),
    /must exactly match archive bindings/
  );

  const decision = evaluateOfficialMarketCalendarPublicationReaderFreshness({
    artifact,
    asOf: "2025-07-01T12:00:10.000Z"
  });
  const decisionTamper = structuredClone(decision);
  decisionTamper.asOf = "2025-07-01T12:00:11.000Z";
  const { decisionHash: _decisionHash, ...decisionPayload } = decisionTamper;
  assert.throws(
    () =>
      createOfficialMarketCalendarPublicationReaderFreshnessHash(
        decisionPayload
      ),
    /handle must bind the exact artifact, asOf and sources/
  );
  assert.throws(
    () => parseOfficialMarketCalendarPublicationReaderFreshness(decisionTamper),
    /handle must bind the exact artifact, asOf and sources/
  );
});

test("calendar publication package plan binds artifact bytes and exact sidecars", () => {
  const fixture = evidenceArtifactV2Fixture();
  const artifact = createOfficialMarketCalendarEvidenceArtifactV2(
    fixture.input,
    fixture.options
  );
  const sidecars = artifact.sourceArchiveBindings
    .map(({ archivePath, sourceDocumentRef }) => ({
      archivePath,
      bytes:
        fixture.options.sourceBytesByExchange[sourceDocumentRef.exchange][
          sourceDocumentRef.documentId
        ]
    }))
    .sort((left, right) =>
      left.archivePath < right.archivePath ? -1 : 1
    );
  const prepared = createOfficialMarketCalendarPublicationPackagePlan(
    { artifact, sidecars },
    fixture.options
  );

  assert.equal(prepared.plan.packagePath, prepared.plan.publicationRecord.packagePath);
  assert.equal(prepared.plan.artifactFile.contentLength, prepared.artifactBytes.byteLength);
  assert.equal(prepared.plan.sourceArchiveFiles.length, 2);
  assert.match(prepared.plan.planHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    parseOfficialMarketCalendarPublicationPackagePlan(
      prepared.plan,
      { sidecars },
      fixture.options
    ).plan,
    prepared.plan
  );
  assert.throws(
    () =>
      createOfficialMarketCalendarPublicationPackagePlan(
        {
          artifact,
          sidecars: [
            { ...sidecars[0], bytes: new Uint8Array(100).fill(90) },
            sidecars[1]
          ]
        },
        fixture.options
      ),
    /sidecar hash mismatch/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarPublicationPackagePlan(
        { ...prepared.plan, planHash: hash("f") },
        { sidecars },
        fixture.options
      ),
    /does not match verified artifact and sidecars/
  );
});

test("calendar publication activation preflight blocks mutation and verified-set changes", async () => {
  const fixture = evidenceArtifactV2Fixture();
  const artifact = createOfficialMarketCalendarEvidenceArtifactV2(
    fixture.input,
    fixture.options
  );
  const sidecars = artifact.sourceArchiveBindings
    .map(({ archivePath, sourceDocumentRef }) => ({
      archivePath,
      bytes:
        fixture.options.sourceBytesByExchange[sourceDocumentRef.exchange][
          sourceDocumentRef.documentId
        ]
    }))
    .sort((left, right) =>
      left.archivePath < right.archivePath ? -1 : 1
    );
  const { plan } = createOfficialMarketCalendarPublicationPackagePlan(
    { artifact, sidecars },
    fixture.options
  );
  const filesystemPreflight =
    await inspectOfficialMarketCalendarPublicationFilesystem({
      publicationRoot: tmpdir()
    });
  const decision =
    evaluateOfficialMarketCalendarPublicationActivationPreflight({
      packagePlan: plan,
      sidecars,
      filesystemPreflight
    }, fixture.options);

  assert.equal(decision.status, "blocked");
  assert.equal(decision.artifactHash, artifact.artifactHash);
  assert.equal(decision.packagePlanHash, plan.planHash);
  assert.equal(
    decision.filesystemPreflightHash,
    filesystemPreflight.preflightHash
  );
  assert.deepEqual(decision.blockers, filesystemPreflight.blockers);
  assert.equal(decision.filesystemMutationAction, "none");
  assert.equal(decision.verifiedSetAction, "unchanged");
  assert.ok(Object.isFrozen(decision));
  assert.ok(Object.isFrozen(decision.blockers));
  assert.deepEqual(
    parseOfficialMarketCalendarPublicationActivationPreflight(decision),
    decision
  );
  assert.throws(
    () =>
      assertOfficialMarketCalendarPublicationActivationPermitted(decision),
    /publication activation is blocked/
  );
  assert.throws(
    () =>
      evaluateOfficialMarketCalendarPublicationActivationPreflight({
        packagePlan: { ...plan, planHash: hash("f") },
        sidecars,
        filesystemPreflight
      }, fixture.options),
    /does not match verified artifact and sidecars/
  );
  assert.throws(
    () =>
      evaluateOfficialMarketCalendarPublicationActivationPreflight({
        packagePlan: plan,
        sidecars,
        filesystemPreflight: {
          ...filesystemPreflight,
          preflightHash: hash("f")
        }
      }, fixture.options),
    /filesystem preflight hash mismatch/
  );
  assert.throws(
    () =>
      evaluateOfficialMarketCalendarPublicationActivationPreflight({
        packagePlan: plan,
        sidecars: [
          { ...sidecars[0], bytes: new Uint8Array(100).fill(90) },
          sidecars[1]
        ],
        filesystemPreflight
      }, fixture.options),
    /sidecar hash mismatch/
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

function sourceParserContractEntry(
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

function sourceParserInputFixture(documentId: string) {
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

function sourceParserOutput() {
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

function sourceCollectionAssemblyFixture(
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

function evidenceArtifactV2Fixture() {
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

function policyExpiry(
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
