import assert from "node:assert/strict";
import test from "node:test";
import {
  brotliCompressSync,
  deflateSync,
  gzipSync
} from "node:zlib";

import {
  OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_CONTRACT_DEFINITION_SCHEMA_VERSION,
  createOfficialMarketCalendarSourceParserContractHash
} from "./officialMarketCalendarSourceParserContract.js";
import {
  OFFICIAL_MARKET_CALENDAR_MAX_DECODED_CONTENT_LENGTH,
  decodeOfficialMarketCalendarSourceRepresentation,
  openOfficialMarketCalendarSourceRepresentationDecodeBoundary
} from "./officialMarketCalendarSourceRepresentationDecodeBoundary.js";

test("calendar source representation decode boundary supports registered encodings", () => {
  const decodedBytes = Buffer.from("official calendar source\n", "utf8");
  for (const [contentEncoding, sourceBytes] of [
    [null, decodedBytes],
    ["br", brotliCompressSync(decodedBytes)],
    ["deflate", deflateSync(decodedBytes)],
    ["gzip", gzipSync(decodedBytes)]
  ] as const) {
    const parserContractEntry = contractEntry();
    const result = decodeOfficialMarketCalendarSourceRepresentation(
      {
        sourceBytes,
        contentType: "application/pdf",
        contentEncoding,
        parserContractEntry
      },
      [parserContractEntry]
    );

    assert.deepEqual(result.decodedBytes, Uint8Array.from(decodedBytes));
    assert.equal(
      result.representationDecodeBoundary.contentEncoding,
      contentEncoding
    );
    assert.equal(
      result.representationDecodeBoundary.encodedContentLength,
      sourceBytes.byteLength
    );
    assert.equal(
      result.representationDecodeBoundary.decodedContentLength,
      decodedBytes.byteLength
    );
    assert.equal(
      result.representationDecodeBoundary.parserResultBound,
      false
    );
  }
});

test("calendar source representation decode boundary reopens exact bytes", () => {
  const sourceBytes = gzipSync(Buffer.from("calendar"));
  const parserContractEntry = contractEntry();
  const created = decodeOfficialMarketCalendarSourceRepresentation(
    {
      sourceBytes,
      contentType: "application/pdf",
      contentEncoding: "gzip",
      parserContractEntry
    },
    [parserContractEntry]
  );

  assert.deepEqual(
    openOfficialMarketCalendarSourceRepresentationDecodeBoundary(
      created.representationDecodeBoundary,
      { sourceBytes, parserContractRegistry: [parserContractEntry] }
    ),
    created
  );
});

test("calendar source representation decode boundary rejects contract mismatches", () => {
  const sourceBytes = Buffer.from("calendar");
  const parserContractEntry = contractEntry();
  assert.throws(
    () =>
      decodeOfficialMarketCalendarSourceRepresentation(
        {
          sourceBytes,
          contentType: "text/csv",
          contentEncoding: null,
          parserContractEntry
        },
        [parserContractEntry]
      ),
    /content type is not accepted/
  );
  const identityOnlyContract = contractEntry([null]);
  assert.throws(
    () =>
      decodeOfficialMarketCalendarSourceRepresentation(
        {
          sourceBytes: brotliCompressSync(sourceBytes),
          contentType: "application/pdf",
          contentEncoding: "br",
          parserContractEntry: identityOnlyContract
        },
        [identityOnlyContract]
      ),
    /content encoding is not accepted/
  );
  assert.throws(
    () =>
      decodeOfficialMarketCalendarSourceRepresentation(
        {
          sourceBytes,
          contentType: "application/pdf",
          contentEncoding: null,
          parserContractEntry
        },
        []
      ),
    /not registered/
  );
});

test("calendar source representation decode boundary rejects corruption and tamper", () => {
  const sourceBytes = gzipSync(Buffer.from("calendar"));
  const parserContractEntry = contractEntry();
  const created = decodeOfficialMarketCalendarSourceRepresentation(
    {
      sourceBytes,
      contentType: "application/pdf",
      contentEncoding: "gzip",
      parserContractEntry
    },
    [parserContractEntry]
  );
  assert.throws(
    () =>
      decodeOfficialMarketCalendarSourceRepresentation(
        {
          sourceBytes: Uint8Array.from([1, 2, 3]),
          contentType: "application/pdf",
          contentEncoding: "gzip",
          parserContractEntry
        },
        [parserContractEntry]
      ),
    /decode failed/
  );
  assert.throws(
    () =>
      openOfficialMarketCalendarSourceRepresentationDecodeBoundary(
        {
          ...created.representationDecodeBoundary,
          decodedContentLength:
            created.representationDecodeBoundary.decodedContentLength + 1
        },
        { sourceBytes, parserContractRegistry: [parserContractEntry] }
      ),
    /does not match exact source bytes/
  );
  assert.throws(
    () =>
      openOfficialMarketCalendarSourceRepresentationDecodeBoundary(
        created.representationDecodeBoundary,
        {
          sourceBytes: gzipSync(Buffer.from("different")),
          parserContractRegistry: [parserContractEntry]
        }
      ),
    /does not match exact source bytes/
  );
});

test("calendar source representation decode boundary rejects trailing compressed bytes", () => {
  const decodedBytes = Buffer.from("calendar");
  const parserContractEntry = contractEntry();
  for (const [contentEncoding, sourceBytes] of [
    ["br", brotliCompressSync(decodedBytes)],
    ["deflate", deflateSync(decodedBytes)],
    ["gzip", gzipSync(decodedBytes)]
  ] as const) {
    assert.throws(
      () =>
        decodeOfficialMarketCalendarSourceRepresentation(
          {
            sourceBytes: Buffer.concat([sourceBytes, Buffer.from([1, 2, 3])]),
            contentType: "application/pdf",
            contentEncoding,
            parserContractEntry
          },
          [parserContractEntry]
        ),
      /decode failed or exceeded/
    );
  }
});

test("calendar source representation decode boundary caps expanded content", () => {
  const expanded = Buffer.alloc(
    OFFICIAL_MARKET_CALENDAR_MAX_DECODED_CONTENT_LENGTH + 1,
    0x61
  );
  const sourceBytes = gzipSync(expanded);
  const parserContractEntry = contractEntry();
  assert.throws(
    () =>
      decodeOfficialMarketCalendarSourceRepresentation(
        {
          sourceBytes,
          contentType: "application/pdf",
          contentEncoding: "gzip",
          parserContractEntry
        },
        [parserContractEntry]
      ),
    /decode failed or exceeded/
  );
});

function contractEntry(
  acceptedContentEncodings: Array<null | "br" | "deflate" | "gzip"> = [
    null,
    "br",
    "deflate",
    "gzip"
  ]
) {
  const parserContractDefinition = {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_CONTRACT_DEFINITION_SCHEMA_VERSION,
    exchange: "KRX" as const,
    acceptedContentTypes: ["application/pdf"],
    acceptedContentEncodings,
    parserOutputSchemaVersion: "calendar_parser_output.v1"
  };
  return {
    parserContractVersion: "krx_calendar_pdf.v1",
    parserContractDefinition,
    parserContractHash:
      createOfficialMarketCalendarSourceParserContractHash(
        parserContractDefinition
      )
  };
}
