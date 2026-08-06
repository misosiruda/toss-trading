import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarTransferCompletion } from "./officialMarketCalendarTransferCompletion.js";

test("calendar transfer completion accepts documented protocol framing combinations", () => {
  for (const value of [
    completion({
      httpProtocolVersion: "http_1_0",
      transferFraming: "content_length"
    }),
    completion({
      httpProtocolVersion: "http_1_1",
      transferFraming: "content_length"
    }),
    completion({
      httpProtocolVersion: "http_1_1",
      transferFraming: "chunked",
      declaredContentLength: null
    }),
    completion({
      httpProtocolVersion: "http_2",
      transferFraming: "stream_end"
    }),
    completion({
      httpProtocolVersion: "http_3",
      transferFraming: "stream_end",
      declaredContentLength: null
    })
  ]) {
    assert.deepEqual(verifyOfficialMarketCalendarTransferCompletion(value), value);
  }
});

test("calendar transfer completion rejects protocol framing mismatches", () => {
  for (const value of [
    completion({
      httpProtocolVersion: "http_1_0",
      transferFraming: "chunked"
    }),
    completion({
      httpProtocolVersion: "http_1_1",
      transferFraming: "stream_end"
    }),
    completion({
      httpProtocolVersion: "http_2",
      transferFraming: "content_length"
    }),
    completion({
      httpProtocolVersion: "http_3",
      transferFraming: "chunked"
    })
  ]) {
    assert.throws(
      () => verifyOfficialMarketCalendarTransferCompletion(value),
      /combination is invalid/
    );
  }
});

test("calendar transfer completion rejects incomplete transfer", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarTransferCompletion(
        completion({ transferCompleted: false })
      ),
    /transfer must be complete/
  );
});

test("calendar transfer completion rejects invalid content lengths", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarTransferCompletion(
        completion({ declaredContentLength: null })
      ),
    /requires declared length/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarTransferCompletion(
        completion({ declaredContentLength: 99 })
      ),
    /content length must match/
  );
  for (const contentLength of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarTransferCompletion(
        completion({ contentLength })
      )
    );
  }
});

test("calendar transfer completion rejects unknown protocol framing and fields", () => {
  for (const overrides of [
    { httpProtocolVersion: "http_4" },
    { transferFraming: "connection_close" }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarTransferCompletion({
        ...completion(),
        ...overrides
      })
    );
  }
  assert.throws(
    () =>
      verifyOfficialMarketCalendarTransferCompletion({
        ...completion(),
        terminalChunkSeen: true
      }),
    /Unrecognized key/
  );
});

function completion(
  overrides: Partial<{
    responseUrl: string;
    httpProtocolVersion: "http_1_0" | "http_1_1" | "http_2" | "http_3";
    transferFraming: "content_length" | "chunked" | "stream_end";
    transferCompleted: boolean;
    declaredContentLength: number | null;
    contentLength: number;
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
