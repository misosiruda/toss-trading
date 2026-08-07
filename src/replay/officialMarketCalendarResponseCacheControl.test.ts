import assert from "node:assert/strict";
import test from "node:test";

import { parseOfficialMarketCalendarResponseCacheControl } from "./officialMarketCalendarResponseCacheControl.js";

test("calendar response Cache-Control preserves absence as null", () => {
  assert.deepEqual(
    parseOfficialMarketCalendarResponseCacheControl({
      cacheControlHeaderValues: []
    }),
    { responseCacheControl: null }
  );
});

test("calendar response Cache-Control canonicalizes field lines", () => {
  assert.deepEqual(
    parseOfficialMarketCalendarResponseCacheControl({
      cacheControlHeaderValues: [
        " Public, max-age = 60 ",
        'no-cache="Set-Cookie, Authorization"'
      ]
    }),
    {
      responseCacheControl: [
        "max-age=60",
        'no-cache="Set-Cookie, Authorization"',
        "public"
      ]
    }
  );
});

test("calendar response Cache-Control canonicalizes quoted escapes", () => {
  assert.deepEqual(
    parseOfficialMarketCalendarResponseCacheControl({
      cacheControlHeaderValues: ['private="field\\\"name\\\\suffix"']
    }),
    {
      responseCacheControl: ['private="field\\\"name\\\\suffix"']
    }
  );
});

test("calendar response Cache-Control rejects duplicate directives", () => {
  for (const cacheControlHeaderValues of [
    ["public, PUBLIC"],
    ["max-age=60", "Max-Age=120"]
  ]) {
    assert.throws(
      () =>
        parseOfficialMarketCalendarResponseCacheControl({
          cacheControlHeaderValues
        }),
      /duplicate directives/
    );
  }
});

test("calendar response Cache-Control rejects malformed directive lists", () => {
  for (const header of [
    "",
    " ",
    ",public",
    "public,",
    "public,,max-age=60",
    "max-age=",
    "max-age = 60 extra",
    'private="unterminated',
    'private="bad\rvalue"',
    "bad name=value"
  ]) {
    assert.throws(
      () =>
        parseOfficialMarketCalendarResponseCacheControl({
          cacheControlHeaderValues: [header]
        }),
      /valid directive syntax/
    );
  }
});

test("calendar response Cache-Control rejects invalid types and unknown fields", () => {
  assert.throws(() =>
    parseOfficialMarketCalendarResponseCacheControl({
      cacheControlHeaderValues: [1]
    })
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarResponseCacheControl({
        cacheControlHeaderValues: [],
        responseCacheControl: null
      }),
    /Unrecognized key/
  );
});
