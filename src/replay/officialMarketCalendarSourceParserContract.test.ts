import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_CONTRACT_DEFINITION_SCHEMA_VERSION,
  createOfficialMarketCalendarSourceParserContractHash,
  parseOfficialMarketCalendarSourceParserContractDefinition,
  parseOfficialMarketCalendarSourceParserContractRegistry,
  parseOfficialMarketCalendarSourceParserContractRegistryEntry,
  resolveOfficialMarketCalendarSourceParserContractFromRegistry
} from "./officialMarketCalendarSourceParserContract.js";

test("calendar source parser contract binds canonical representation and output schema", () => {
  const definition = parserDefinition();
  const entry = parserEntry();

  assert.deepEqual(
    parseOfficialMarketCalendarSourceParserContractDefinition(definition),
    definition
  );
  assert.match(
    createOfficialMarketCalendarSourceParserContractHash(definition),
    /^sha256:[a-f0-9]{64}$/
  );
  assert.deepEqual(
    resolveOfficialMarketCalendarSourceParserContractFromRegistry(entry, [
      entry
    ]),
    entry
  );
});

test("calendar source parser contract rejects noncanonical content types", () => {
  for (const acceptedContentTypes of [
    [],
    ["text/csv", "application/pdf"],
    ["application/pdf", "application/pdf"],
    ["Application/PDF"],
    ["application/pdf;version=1"]
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarSourceParserContractDefinition(
        parserDefinition({ acceptedContentTypes })
      )
    );
  }
});

test("calendar source parser contract rejects noncanonical content encodings", () => {
  for (const acceptedContentEncodings of [
    [],
    ["gzip", null],
    [null, "gzip", "gzip"],
    [null, "gzip", "br"],
    ["identity"]
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarSourceParserContractDefinition(
        parserDefinition({ acceptedContentEncodings })
      )
    );
  }
});

test("calendar source parser contract rejects unknown fields and hash tamper", () => {
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceParserContractDefinition({
        ...parserDefinition(),
        executablePath: "parser.js"
      }),
    /Unrecognized key/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceParserContractRegistryEntry({
        ...parserEntry(),
        parserContractHash: `sha256:${"f".repeat(64)}`
      }),
    /hash mismatch/
  );
});

test("calendar source parser contract registry rejects duplicate and mismatched entries", () => {
  const entry = parserEntry();
  assert.throws(
    () => parseOfficialMarketCalendarSourceParserContractRegistry([entry, entry]),
    /versions must be unique/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceParserContractFromRegistry(entry, []),
    /version is not registered/
  );
  const changedDefinition = parserDefinition({
    parserOutputSchemaVersion: "calendar_parser_output.v2"
  });
  const changedEntry = {
    ...entry,
    parserContractDefinition: changedDefinition,
    parserContractHash:
      createOfficialMarketCalendarSourceParserContractHash(changedDefinition)
  };
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceParserContractFromRegistry(
        changedEntry,
        [entry]
      ),
    /does not match registry/
  );
});

function parserDefinition(
  overrides: Partial<{
    acceptedContentTypes: unknown[];
    acceptedContentEncodings: unknown[];
    parserOutputSchemaVersion: string;
  }> = {}
) {
  return {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_CONTRACT_DEFINITION_SCHEMA_VERSION,
    exchange: "KRX" as const,
    acceptedContentTypes: overrides.acceptedContentTypes ?? ["application/pdf"],
    acceptedContentEncodings: overrides.acceptedContentEncodings ?? [null, "gzip"],
    parserOutputSchemaVersion:
      overrides.parserOutputSchemaVersion ?? "calendar_parser_output.v1"
  };
}

function parserEntry() {
  const parserContractDefinition = parserDefinition();
  return {
    parserContractVersion: "krx_calendar_pdf.v1",
    parserContractDefinition,
    parserContractHash:
      createOfficialMarketCalendarSourceParserContractHash(
        parserContractDefinition
      )
  };
}
