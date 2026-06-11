import assert from "node:assert/strict";
import test from "node:test";

import { maskObject, maskSensitiveText } from "./masking.js";

test("maskSensitiveText masks account-like and order-like values", () => {
  const masked = maskSensitiveText(
    "account 1234-5678-901234 order ord_abcdef123456 execution exec_xyz987654321"
  );

  assert.equal(
    masked,
    "account ****-****-**** order ord_**** execution exec_****"
  );
});

test("maskObject masks sensitive keys recursively", () => {
  const masked = maskObject({
    accountNumber: "1234-5678-901234",
    nested: {
      token: "secret-token-value",
      visible: "ord_abcdef123456"
    }
  });

  assert.deepEqual(masked, {
    accountNumber: "****",
    nested: {
      token: "****",
      visible: "ord_****"
    }
  });
});
