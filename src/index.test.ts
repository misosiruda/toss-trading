import assert from "node:assert/strict";
import test from "node:test";

import { getRuntimeInfo } from "./index.js";

test("runtime scaffold keeps safe defaults visible", () => {
  assert.deepEqual(getRuntimeInfo(), {
    name: "toss-trading",
    tradingEnabledDefault: false,
    aiDecisionModeDefault: "paper_only",
    brokerProviderDefault: "mock"
  });
});
