import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION,
  verifyOfficialMarketCalendarDomainAllowlist
} from "./officialMarketCalendarDomainAllowlist.js";

test("calendar domain allowlist accepts registered KRX and NYSE hosts", () => {
  for (const input of [
    allowlist({
      exchange: "KRX",
      urls: [
        "https://global.krx.co.kr/contents/calendar",
        "https://global.krx.co.kr/download/calendar.pdf"
      ]
    }),
    allowlist({
      exchange: "NYSE",
      urls: ["https://www.nyse.com/trade/hours-calendars"]
    })
  ]) {
    assert.deepEqual(verifyOfficialMarketCalendarDomainAllowlist(input), input);
  }
});

test("calendar domain allowlist rejects cross-exchange hosts", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarDomainAllowlist(
        allowlist({
          exchange: "KRX",
          urls: ["https://www.nyse.com/trade/hours-calendars"]
        })
      ),
    /not allowed for KRX/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarDomainAllowlist(
        allowlist({
          exchange: "NYSE",
          urls: ["https://global.krx.co.kr/contents/calendar"]
        })
      ),
    /not allowed for NYSE/
  );
});

test("calendar domain allowlist rejects unregistered and lookalike hosts", () => {
  for (const rawUrl of [
    "https://krx.co.kr/calendar",
    "https://download.global.krx.co.kr/calendar",
    "https://global.krx.co.kr.example.com/calendar",
    "https://global.krx.co.kr./calendar",
    "http://global.krx.co.kr/calendar",
    "https://user@global.krx.co.kr/calendar"
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarDomainAllowlist(
        allowlist({ urls: [rawUrl] })
      )
    );
  }
});

test("calendar domain allowlist rejects non-default ports", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarDomainAllowlist(
        allowlist({ urls: ["https://global.krx.co.kr:8443/calendar"] })
      ),
    /not allowed for KRX/
  );
});

test("calendar domain allowlist rejects invalid URLs", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarDomainAllowlist(
        allowlist({ urls: ["not-a-url"] })
      ),
    /URL must be valid/
  );
});

test("calendar domain allowlist rejects parser-normalized URLs", () => {
  for (const rawUrl of [
    " https://global.krx.co.kr/contents/calendar",
    "https:global.krx.co.kr/contents/calendar",
    "https://GLOBAL.KRX.CO.KR/contents/calendar",
    "https://global.krx.co.kr:443/contents/calendar"
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarDomainAllowlist(
          allowlist({ urls: [rawUrl] })
        ),
      /must use canonical serialization/
    );
  }
});

test("calendar domain allowlist rejects unknown version and fields", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarDomainAllowlist({
      ...allowlist(),
      domainAllowlistPolicyVersion:
        "official_market_calendar_domain_allowlist.v2"
    })
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarDomainAllowlist({
        ...allowlist(),
        allowSubdomains: true
      }),
    /Unrecognized key/
  );
});

function allowlist(
  overrides: Partial<{
    exchange: "KRX" | "NYSE";
    domainAllowlistPolicyVersion: string;
    urls: string[];
  }> = {}
) {
  return {
    exchange: "KRX" as const,
    domainAllowlistPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION,
    urls: ["https://global.krx.co.kr/contents/calendar"],
    ...overrides
  };
}
