import assert from "node:assert/strict";
import test from "node:test";
import { appendPolicyBoundCurrentPortfolioSizingSnapshot as publish } from "./currentPortfolioSizingSnapshotFiles.js";
import { fixture, request, options, T, at, H } from "./currentSizingPendingTestFixtures.js";
import { getDurableInvestmentMandateObservation } from "./investmentMandateFiles.js";
import { createInvestmentMandateEvent } from "./investmentMandate.js";
import { bindSnapshotPendingExecutionOrigins } from "./snapshotPendingExecutionBinding.js";
import { bindSnapshotPendingPlanProgress } from "./snapshotPendingPlanBinding.js";
import { bindSnapshotPendingMandateOrigins } from "./snapshotPendingMandateBinding.js";
import { resolveStoredPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";

test("mandate comparison validates optional Risk receipt identity prefix chronology and lease lifetime", async (context) => {
  await fixture(context, "fractional_buy", async (state) => {
    context.mock.timers.setTime(T + 31);
    const receipt = await state.mandates.withDurableVerifiedHistory((history) => ({
      mandateId: state.mandate.mandateId, mandateHash: state.mandate.mandateHash,
      mandateEventId: state.activation.mandateEventId, mandateEventHash: state.activation.mandateEventHash,
      observation: getDurableInvestmentMandateObservation(history) }));
    context.mock.timers.setTime(T + 100);
    const snapshot = await publish(request(state), options);
    const progress = await resolveStoredPendingPlanActionProgress({ baseDir: state.baseDir, portfolioId: state.plan.portfolioId, asOf: at(50) }, options);
    const risks = await state.risks.readVerifiedHistory(), fills = await state.fills.readVerifiedHistory();
    await state.prices.withDurableVerifiedHistory(async (prices) => {
      const pending = bindSnapshotPendingPlanProgress(snapshot, progress, prices);
      const executions = bindSnapshotPendingExecutionOrigins(progress, risks, fills, prices);
      const withReceipt = (value: typeof receipt) => executions.map((binding) => ({ ...binding,
        riskOrigin: { ...binding.riskOrigin, mandateOrigin: value } }));
      const escaped = await state.mandates.withDurableVerifiedHistory(async (history) => {
        assert.doesNotThrow(() => bindSnapshotPendingMandateOrigins(progress, pending, withReceipt(receipt), history));
        for (const invalid of [{ ...receipt, mandateId: "other" }, { ...receipt, mandateEventHash: H("other") },
          { ...receipt, observation: { ...receipt.observation, recordsHash: H("other") } },
          { ...receipt, observation: { ...receipt.observation, eventCount: 0 } },
          { ...receipt, observation: { ...receipt.observation, observedAt: at(32) } }]) {
          assert.throws(() => bindSnapshotPendingMandateOrigins(progress, pending, withReceipt(invalid), history));
        }
        return history;
      });
      assert.throws(() => bindSnapshotPendingMandateOrigins(progress, pending, executions, escaped), /not repository verified/);
    });
  });
});

test("current sizing refuses a future-created mandate suffix even outside the pending cutoff", async (context) => {
  await fixture(context, "fractional_buy", async (state) => {
    const { mandateEventId: _id, mandateEventHash: _hash, eventType: _type, ...scope } = state.activation;
    await state.mandates.appendEvent(createInvestmentMandateEvent({ ...scope, eventType: "retired",
      previousMandateEventId: state.activation.mandateEventId, asOf: at(120), createdAt: at(120) }));
    await assert.rejects(publish(request(state), options), /source creation follows its observation/);
    context.mock.timers.setTime(T + 130);
    assert.equal((await publish(request(state), options)).pendingActionInputs.length, 1);
  });
});
