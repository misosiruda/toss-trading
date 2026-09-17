import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { createInvestmentMandateRecord, createInvestmentMandateEvent } from "./investmentMandate.js";
import { InvestmentMandateFileRepository, createInvestmentMandatePaths, getDurableInvestmentMandateObservation,
  resolveObservedInvestmentMandateHistory } from "./investmentMandateFiles.js";
import { createHeldRiskMandateStateResolver } from "./heldRiskMandateStateIndex.js";
import { validateRiskDecisionMandateState } from "./portfolioActionRiskDecisionMandateContext.js";
import { PortfolioActionRiskDecisionFileRepository } from "./portfolioActionRiskDecisionFiles.js";
import { validateRiskDecisionPlanState } from "./portfolioActionRiskDecisionPlanContext.js";
import { RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository } from "./rebalancePlanEventFiles.js";
import { replayRebalancePlanExecutionContexts } from "./rebalancePlanEventReplay.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { fixture, at, START, mandateEvent, type State } from "./storedManualOpeningCapacityTestFixtures.js";

async function binding(state: State) {
  const history = await new RebalancePlanEventFileRepository(state.dir, new RebalancePlanFileRepository(state.dir)).readVerifiedHistory();
  const execution = replayRebalancePlanExecutionContexts({ plan: state.plan, events: history.events }).executionContexts[0]!;
  const risk = (await new PortfolioActionRiskDecisionFileRepository(state.dir).readVerifiedHistory()).records[0]!;
  return validateRiskDecisionPlanState(risk, execution.priorState);
}
function outcome<T>(operation: () => T) {
  try { return { valid: true, value: operation() }; } catch { return { valid: false }; }
}

test("held mandate index matches full replay across successor chains cutoff boundaries and receipt prefixes", async (context) => {
  await fixture(context, {}, async (state) => {
    const planState = await binding(state), repository = new InvestmentMandateFileRepository(state.dir);
    const first = (await repository.readSnapshot()).events[0]!;
    const { mandateId: _id, mandateHash: _hash, ...payload } = state.manual.mandate;
    const next = createInvestmentMandateRecord({ ...payload, manualAssignmentEventId: "successor", createdAt: at(100), validFrom: at(100), expiresAt: at(135) });
    await repository.appendRecord(next);
    const retirementEvent = mandateEvent(state.manual.mandate, "retired", 110, first.mandateEventId);
    if (retirementEvent.eventType !== "retired") throw new Error("retirement fixture required");
    const { mandateEventId: _eventId, mandateEventHash: _eventHash, ...retirementPayload } = retirementEvent;
    const retirement = createInvestmentMandateEvent({ ...retirementPayload, supersededByMandateId: next.mandateId });
    await repository.appendEvent(retirement);
    const activation = mandateEvent(next, "activated", 120, retirement.mandateEventId);
    await repository.appendEvent(activation);
    const review = mandateEvent(next, "review_required", 130, activation.mandateEventId);
    await repository.appendEvent(review);
    await repository.appendEvent(mandateEvent(next, "retired", 140, review.mandateEventId));
    context.mock.timers.setTime(START + 200);
    let expired!: ReturnType<typeof createHeldRiskMandateStateResolver>;
    await repository.withDurableVerifiedHistory(async (history) => {
      const resolve = createHeldRiskMandateStateResolver(history); expired = resolve;
      for (const record of [state.manual.mandate, next]) for (const offset of [30, 40, 41, 81, 100, 109, 110, 119, 120, 129, 130, 134, 135, 140, 200]) {
        const input = { ...planState, action: { ...planState.action, mandateId: record.mandateId },
          decision: { ...planState.decision, decidedAt: at(offset) } };
        assert.deepEqual(outcome(() => resolve(input)), outcome(() => validateRiskDecisionMandateState(input, history)));
        for (let recordCount = 0; recordCount <= history.records.length; recordCount++) for (let eventCount = 0; eventCount <= history.events.length; eventCount++) {
          const receipt = { recordCount, eventCount, recordsHash: hashCanonicalPayload(history.records.slice(0, recordCount)),
            eventsHash: hashCanonicalPayload(history.events.slice(0, eventCount)), observedAt: at(200) };
          assert.deepEqual(outcome(() => resolve(input, receipt)),
            outcome(() => validateRiskDecisionMandateState(input, resolveObservedInvestmentMandateHistory(history, receipt))));
        }
      }
      assert.strictEqual(resolve(planState), resolve(planState));
    });
    assert.throws(() => expired(planState), /verified|lease/);
  });
});

test("held mandate index performs no new source hashing for ten thousand distinct cutoff and prefix queries", async (context) => {
  await fixture(context, {}, async (state) => {
    const planState = await binding(state), paths = createInvestmentMandatePaths(state.dir);
    const { mandateId: _id, mandateHash: _hash, ...payload } = state.manual.mandate;
    const records = Array.from({ length: 500 }, (_, index) => createInvestmentMandateRecord({ ...payload,
      symbol: `INDEX-${index}`, manualAssignmentEventId: `assignment-${index}` }));
    const events = records.map((record) => mandateEvent(record, "activated", 41));
    await writeFile(paths.recordsPath, (await readFile(paths.recordsPath, "utf8")) + records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    await writeFile(paths.eventsPath, (await readFile(paths.eventsPath, "utf8")) + events.map((event) => JSON.stringify(event)).join("\n") + "\n");
    context.mock.timers.setTime(START + 1000);
    await new InvestmentMandateFileRepository(state.dir).withDurableVerifiedHistory(async (history) => {
      // Build independently authenticated receipts before counting work in the resolver.
      const current = getDurableInvestmentMandateObservation(history);
      const receipts = records.map((_, index) => ({ ...current, recordCount: index + 2, eventCount: index + 2,
        recordsHash: hashCanonicalPayload(history.records.slice(0, index + 2)), eventsHash: hashCanonicalPayload(history.events.slice(0, index + 2)) }));
      const original = crypto.createHash, mock = context.mock.method(crypto, "createHash", (...args: Parameters<typeof crypto.createHash>) => original(...args));
      syncBuiltinESMExports();
      try {
        const resolve = createHeldRiskMandateStateResolver(history);
        assert.equal(mock.mock.callCount(), 2);
        for (let index = 0; index < 10000; index++) {
          const source = index % records.length, record = records[source]!;
          const input = { ...planState, action: { ...planState.action, mandateId: record.mandateId },
            decision: { ...planState.decision, symbol: record.symbol, decidedAt: at(81 + Math.floor(index / records.length)) } };
          assert.equal(resolve(input, receipts[source]).record.mandateId, record.mandateId);
        }
        assert.equal(mock.mock.callCount(), 2);
      } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    });
  });
});
