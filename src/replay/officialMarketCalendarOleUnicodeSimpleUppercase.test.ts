import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_OLE_UNICODE_DATA_SHA256,
  OFFICIAL_MARKET_CALENDAR_OLE_UNICODE_VERSION,
  toOfficialMarketCalendarOleSimpleUppercaseCodeUnit
} from "./officialMarketCalendarOleUnicodeSimpleUppercase.js";

test("official calendar OLE Unicode mapping is pinned to UnicodeData", () => {
  assert.equal(OFFICIAL_MARKET_CALENDAR_OLE_UNICODE_VERSION, "17.0.0");
  assert.equal(
    OFFICIAL_MARKET_CALENDAR_OLE_UNICODE_DATA_SHA256,
    "2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c"
  );
});

test("official calendar OLE Unicode mapping applies simple uppercase values", () => {
  assert.equal(toOfficialMarketCalendarOleSimpleUppercaseCodeUnit(0x0061), 0x0041);
  assert.equal(toOfficialMarketCalendarOleSimpleUppercaseCodeUnit(0x1f80), 0x1f88);
  assert.equal(toOfficialMarketCalendarOleSimpleUppercaseCodeUnit(0x00df), 0x00df);
  assert.equal(toOfficialMarketCalendarOleSimpleUppercaseCodeUnit(0xac00), 0xac00);
});

test("official calendar OLE Unicode mapping preserves surrogate code units", () => {
  assert.equal(toOfficialMarketCalendarOleSimpleUppercaseCodeUnit(0xd801), 0xd801);
  assert.equal(toOfficialMarketCalendarOleSimpleUppercaseCodeUnit(0xdc00), 0xdc00);
});

test("official calendar OLE Unicode mapping rejects non-code-unit inputs", () => {
  for (const value of [-1, 0x10000, 1.5, Number.NaN]) {
    assert.throws(
      () => toOfficialMarketCalendarOleSimpleUppercaseCodeUnit(value),
      RangeError
    );
  }
});
