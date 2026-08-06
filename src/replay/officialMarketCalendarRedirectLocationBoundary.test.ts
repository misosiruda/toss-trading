import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarRedirectLocationBoundary } from "./officialMarketCalendarRedirectLocationBoundary.js";

test("calendar redirect Location boundary accepts canonical redirect links", () => {
  const boundary = redirects();

  assert.deepEqual(
    verifyOfficialMarketCalendarRedirectLocationBoundary(boundary),
    boundary
  );
});

test("calendar redirect Location boundary requires one header value", () => {
  for (const locationHeaderValues of [[], ["/one", "/two"]]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectLocationBoundary(
          redirects({
            redirectHops: [hop({ locationHeaderValues })]
          })
        ),
      /exactly one Location header/
    );
  }
});

test("calendar redirect Location boundary rejects next URL mismatch", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectLocationBoundary(
        redirects({
          redirectHops: [
            hop({ nextEffectiveRequestUrl: "https://official.example/other" })
          ]
        })
      ),
    /must match next effective request URL/
  );
});

test("calendar redirect Location boundary strips Location fragments", () => {
  const boundary = redirects({
    redirectHops: [hop({ locationHeaderValues: ["/download#section"] })]
  });

  assert.deepEqual(
    verifyOfficialMarketCalendarRedirectLocationBoundary(boundary),
    boundary
  );
});

test("calendar redirect Location boundary rejects fragments in effective URLs", () => {
  for (const redirectHop of [
    hop({ responseUrl: "https://official.example/source#section" }),
    hop({
      locationHeaderValues: ["/download#section"],
      nextEffectiveRequestUrl: "https://official.example/download#section"
    })
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectLocationBoundary(
          redirects({ redirectHops: [redirectHop] })
        ),
      /must not contain a fragment/
    );
  }
});

test("calendar redirect Location boundary rejects disconnected hops", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectLocationBoundary(
        redirects({
          redirectHops: [
            hop(),
            hop({
              responseUrl: "https://unrelated.example/source",
              locationHeaderValues: ["/final"],
              nextEffectiveRequestUrl: "https://unrelated.example/final"
            })
          ]
        })
      ),
    /must form one continuous URL chain/
  );
});

test("calendar redirect Location boundary rejects insecure and userinfo URLs", () => {
  for (const nextEffectiveRequestUrl of [
    "http://official.example/download",
    "https://user@official.example/download"
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarRedirectLocationBoundary(
        redirects({
          redirectHops: [
            hop({
              locationHeaderValues: [nextEffectiveRequestUrl],
              nextEffectiveRequestUrl
            })
          ]
        })
      )
    );
  }
});

test("calendar redirect Location boundary rejects parser-normalized URLs", () => {
  for (const redirectHop of [
    hop({ responseUrl: " https://official.example/source" }),
    hop({ locationHeaderValues: [""] }),
    hop({
      locationHeaderValues: ["https://OFFICIAL.EXAMPLE/download"]
    }),
    hop({ locationHeaderValues: ["//OFFICIAL.EXAMPLE/download"] }),
    hop({ locationHeaderValues: ["//official.example:443/download"] }),
    hop({ locationHeaderValues: [" /download"] }),
    hop({ locationHeaderValues: ["\\download"] })
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarRedirectLocationBoundary(
        redirects({ redirectHops: [redirectHop] })
      )
    );
  }
});

test("calendar redirect Location boundary rejects invalid shape and fields", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectLocationBoundary(
      redirects({ redirectHops: [] })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectLocationBoundary({
        ...redirects(),
        resolvedByClient: true
      }),
    /Unrecognized key/
  );
});

function redirects(
  overrides: Partial<{
    redirectHops: ReturnType<typeof hop>[];
  }> = {}
) {
  return {
    redirectHops: [
      hop(),
      hop({
        responseUrl: "https://official.example/download",
        locationHeaderValues: ["//official.example/final"],
        nextEffectiveRequestUrl: "https://official.example/final"
      }),
      hop({
        responseUrl: "https://official.example/final",
        locationHeaderValues: ["https://official.example/archive"],
        nextEffectiveRequestUrl: "https://official.example/archive"
      })
    ],
    ...overrides
  };
}

function hop(
  overrides: Partial<{
    responseUrl: string;
    locationHeaderValues: string[];
    nextEffectiveRequestUrl: string;
  }> = {}
) {
  return {
    responseUrl: "https://official.example/source",
    locationHeaderValues: ["/download"],
    nextEffectiveRequestUrl: "https://official.example/download",
    ...overrides
  };
}
