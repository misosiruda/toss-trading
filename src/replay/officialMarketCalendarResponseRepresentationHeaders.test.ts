import assert from "node:assert/strict";
import test from "node:test";

import { parseOfficialMarketCalendarResponseRepresentationHeaders } from "./officialMarketCalendarResponseRepresentationHeaders.js";

test("calendar response representation headers derive canonical media type and absent encoding", () => {
  assert.deepEqual(
    parseOfficialMarketCalendarResponseRepresentationHeaders({
      contentTypeHeaderValues: ["Application/PDF"],
      contentEncodingHeaderValues: []
    }),
    {
      contentTypeHeaderValues: ["Application/PDF"],
      contentEncodingHeaderValues: [],
      contentType: "application/pdf",
      contentEncoding: null
    }
  );
});

test("calendar response representation headers accept one supported content coding", () => {
  assert.deepEqual(
    parseOfficialMarketCalendarResponseRepresentationHeaders({
      contentTypeHeaderValues: ["text/csv"],
      contentEncodingHeaderValues: ["GZip"]
    }),
    {
      contentTypeHeaderValues: ["text/csv"],
      contentEncodingHeaderValues: ["GZip"],
      contentType: "text/csv",
      contentEncoding: "gzip"
    }
  );
});

test("calendar response representation headers require one parameter-free Content-Type", () => {
  for (const contentTypeHeaderValues of [
    [],
    ["application/pdf", "text/plain"],
    ["application/pdf; charset=utf-8"],
    [" application/pdf"],
    ["application/pdf\t"]
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarResponseRepresentationHeaders({
        contentTypeHeaderValues,
        contentEncodingHeaderValues: []
      })
    );
  }
});

test("calendar response representation headers reject duplicate or unsupported content coding", () => {
  for (const contentEncodingHeaderValues of [
    ["gzip", "br"],
    ["gzip,br"],
    ["identity"],
    ["compress"],
    ["gzip "]
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarResponseRepresentationHeaders({
        contentTypeHeaderValues: ["application/pdf"],
        contentEncodingHeaderValues
      })
    );
  }
});

test("calendar response representation headers reject shape-loose input", () => {
  assert.throws(
    () =>
      parseOfficialMarketCalendarResponseRepresentationHeaders({
        contentTypeHeaderValues: ["application/pdf"],
        contentEncodingHeaderValues: [],
        setCookieHeaderValues: []
      }),
    /Unrecognized key/
  );
  assert.throws(() =>
    parseOfficialMarketCalendarResponseRepresentationHeaders({
      contentTypeHeaderValues: ["application/pdf"],
      contentEncodingHeaderValues: [1]
    })
  );
});
