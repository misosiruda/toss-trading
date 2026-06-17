import assert from "node:assert/strict";
import test from "node:test";

import type { TossOpenApiReadOnlyRequestOptions } from "./tossOpenApiReadOnlyHttpClient.js";
import {
  TossOpenApiAccountSnapshotReader,
  TossOpenApiAccountSnapshotReaderError
} from "./tossOpenApiAccountSnapshotReader.js";

class FakeAccountReadOnlyJsonClient {
  readonly calls: Array<{
    path: string;
    options: TossOpenApiReadOnlyRequestOptions | undefined;
  }> = [];
  private readonly responses: unknown[];

  constructor(responses: unknown[]) {
    this.responses = [...responses];
  }

  async getJson(
    path: string,
    options?: TossOpenApiReadOnlyRequestOptions
  ): Promise<unknown> {
    this.calls.push({ path, options });
    return this.responses.shift() ?? { result: {} };
  }
}

test("account snapshot reader masks accounts and reads holdings with account header boundary", async () => {
  const client = new FakeAccountReadOnlyJsonClient([
    {
      result: [
        {
          accountNo: "12345678901",
          accountSeq: 1,
          accountType: "BROKERAGE"
        }
      ]
    },
    {
      result: {
        totalPurchaseAmount: { krw: "6500000", usd: null },
        items: [
          {
            symbol: "005930",
            name: "Samsung Electronics",
            quantity: "100",
            accountNo: "12345678901"
          }
        ]
      }
    }
  ]);
  const reader = new TossOpenApiAccountSnapshotReader(client);

  const snapshot = await reader.readSnapshot({ accountSeq: 1, symbol: "005930" });

  assert.equal(snapshot.status, "ok");
  assert.deepEqual(snapshot.accounts, [
    {
      accountRef: "account:1",
      accountNoMasked: "****",
      accountSeqMasked: "****",
      accountType: "BROKERAGE"
    }
  ]);
  assert.deepEqual(snapshot.sourceStatus, {
    status: "ok",
    accountCount: 1,
    holdingsStatus: "ok",
    warnings: []
  });
  assert.deepEqual(snapshot.holdings, {
    accountSeqMasked: "****",
    itemCount: 1,
    symbol: "005930",
    holdings: {
      totalPurchaseAmount: { krw: "6500000", usd: null },
      items: [
        {
          symbol: "005930",
          name: "Samsung Electronics",
          quantity: "100",
          accountNo: "****"
        }
      ]
    }
  });
  assert.deepEqual(client.calls, [
    { path: "/api/v1/accounts", options: undefined },
    {
      path: "/api/v1/holdings",
      options: { accountSeq: 1, query: [["symbol", "005930"]] }
    }
  ]);
});

test("account snapshot reader skips holdings without explicit accountSeq", async () => {
  const client = new FakeAccountReadOnlyJsonClient([
    {
      result: [
        {
          accountNo: "12345678901",
          accountSeq: 1,
          accountType: "BROKERAGE"
        }
      ]
    }
  ]);
  const reader = new TossOpenApiAccountSnapshotReader(client);

  const snapshot = await reader.readSnapshot();

  assert.equal(snapshot.status, "degraded");
  assert.equal(snapshot.holdings, undefined);
  assert.deepEqual(snapshot.sourceStatus, {
    status: "degraded",
    accountCount: 1,
    holdingsStatus: "skipped",
    warnings: [
      "holdings skipped: accountSeq is required for GET /api/v1/holdings"
    ]
  });
  assert.deepEqual(
    client.calls.map((call) => call.path),
    ["/api/v1/accounts"]
  );
});

test("account snapshot reader reads all holdings when symbol is omitted", async () => {
  const client = new FakeAccountReadOnlyJsonClient([
    { result: [] },
    { result: { items: [] } }
  ]);
  const reader = new TossOpenApiAccountSnapshotReader(client);

  const snapshot = await reader.readSnapshot({ accountSeq: 2 });

  assert.equal(snapshot.status, "ok");
  assert.equal(snapshot.holdings?.itemCount, 0);
  assert.deepEqual(client.calls[1], {
    path: "/api/v1/holdings",
    options: { accountSeq: 2 }
  });
});

test("account snapshot reader rejects invalid accountSeq and symbol before holdings call", async () => {
  const client = new FakeAccountReadOnlyJsonClient([{ result: [] }]);
  const reader = new TossOpenApiAccountSnapshotReader(client);

  await assert.rejects(
    () => reader.readSnapshot({ accountSeq: 0 }),
    (error) =>
      error instanceof TossOpenApiAccountSnapshotReaderError &&
      error.code === "TOSS_OPEN_API_ACCOUNT_READER_INVALID_ACCOUNT_SEQ"
  );
  await assert.rejects(
    () => reader.readSnapshot({ accountSeq: 1, symbol: "../orders" }),
    (error) =>
      error instanceof TossOpenApiAccountSnapshotReaderError &&
      error.code === "TOSS_OPEN_API_ACCOUNT_READER_INVALID_SYMBOL"
  );

  assert.equal(
    client.calls.filter((call) => call.path === "/api/v1/holdings").length,
    0
  );
});

test("account snapshot reader rejects malformed official envelopes", async () => {
  const invalidAccounts = new TossOpenApiAccountSnapshotReader(
    new FakeAccountReadOnlyJsonClient([{ result: { accountNo: "123" } }])
  );
  const invalidHoldings = new TossOpenApiAccountSnapshotReader(
    new FakeAccountReadOnlyJsonClient([
      { result: [] },
      { result: { items: "not-array" } }
    ])
  );

  await assert.rejects(
    () => invalidAccounts.readSnapshot(),
    (error) =>
      error instanceof TossOpenApiAccountSnapshotReaderError &&
      error.code === "TOSS_OPEN_API_ACCOUNT_READER_INVALID_RESPONSE"
  );
  await assert.rejects(
    () => invalidHoldings.readSnapshot({ accountSeq: 1 }),
    (error) =>
      error instanceof TossOpenApiAccountSnapshotReaderError &&
      error.code === "TOSS_OPEN_API_ACCOUNT_READER_INVALID_RESPONSE"
  );
});

test("account snapshot reader exposes only read-only account endpoints", async () => {
  const client = new FakeAccountReadOnlyJsonClient([
    { result: [] },
    { result: { items: [] } }
  ]);
  const reader = new TossOpenApiAccountSnapshotReader(client);

  await reader.readSnapshot({ accountSeq: 1 });

  assert.deepEqual(
    client.calls.map((call) => call.path),
    ["/api/v1/accounts", "/api/v1/holdings"]
  );
  assert.equal(
    client.calls.some((call) => call.path.includes("/api/v1/orders")),
    false
  );
});
