import assert from "node:assert/strict";
import test from "node:test";
import {
  verifyOfficialMarketCalendarAcquisitionFreshnessPolicyBoundary
} from "./officialMarketCalendarAcquisitionFreshnessPolicyBoundary.js";
import { OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION } from "./officialMarketCalendarCacheRequestPolicy.js";
import { OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS } from "./officialMarketCalendarRequestHeaderPolicyRegistry.js";
import {
  verifyOfficialMarketCalendarRedirectChainBoundary as verifyOfficialMarketCalendarRedirectChainBoundaryWithRegistry
} from "./officialMarketCalendarRedirectChainBoundary.js";
import {
  createOfficialMarketCalendarSourceDocumentEnvelope,
  parseOfficialMarketCalendarSourceDocumentEnvelope
} from "./officialMarketCalendarSourceDocumentEnvelope.js";
import {
  createOfficialMarketCalendarSourceDocumentMetadata,
  parseOfficialMarketCalendarSourceDocumentMetadata
} from "./officialMarketCalendarSourceDocumentMetadata.js";
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
  bindOfficialMarketCalendarSourceParserInput,
  openOfficialMarketCalendarSourceParserInputBinding
} from "./officialMarketCalendarSourceParserInputBinding.js";
import {
  createOfficialMarketCalendarSourceParserResult,
  parseOfficialMarketCalendarSourceParserResult
} from "./officialMarketCalendarSourceParserResult.js";
import {
  KRX_REQUESTED_URL,
  KRX_REDIRECTED_URL,
  NYSE_REQUESTED_URL,
  NYSE_REDIRECTED_URL,
  chain,
  sourceParserContractEntry,
  sourceParserInputFixture,
  sourceParserOutput,
  sourceCollectionAssemblyFixture,
  evidenceArtifactV2Fixture,
  policyExpiry,
  verifyOfficialMarketCalendarRedirectChainBoundary,
  policyRegistry,
  policySelectorMetadata,
  transferCompletion,
  cacheRequest,
  rangeRequest,
  parameterRequest,
  headerNameRequest,
  representationHeaderRequest,
  credentialRequest,
  locationHop,
  secondLocationHop,
  methodTransition,
  secondMethodTransition,
  hash
} from "./officialMarketCalendarBoundaryTestFixtures.js";



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
