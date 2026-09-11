import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { InvestmentMandateFileRepository, createInvestmentMandatePaths } from "./investmentMandateFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { createPortfolioActionRiskDecisionPaths } from "./portfolioActionRiskDecisionFiles.js";
import { createRebalancePlanPaths } from "./rebalancePlanFiles.js";
import { createRebalancePlanEventPaths } from "./rebalancePlanEventFiles.js";
import { createSourcePriceEvidencePaths } from "./sourcePriceEvidenceFiles.js";
import { resolveStoredManualOpeningCapacityFillOrigins } from "./storedManualOpeningCapacityFillOrigins.js";
import { HASH, START, PORTFOLIO, at, fixture, run, mandateEvent } from "./storedManualOpeningCapacityTestFixtures.js";

test("manual capacity fill origins bind actual plan Risk price and gross consumption across partial fills and restart", async (context) => {
  for (const increase of [false, true]) await fixture(context, { increase, count: 3, feeBps: 250 }, async (state) => {
    const result = await run(state);
    assert.equal(result.bindings.length, 3);
    assert.deepEqual(result.bindings.map((item) => item.consumedNotionalKrw), [40, 30, 30]);
    assert.equal(result.bindings[0]!.execution.paperFill.netAmountKrw, 41);
    assert.equal(result.bindings[0]!.event.remainingReservedNotionalKrw, 60);
    assert.equal(result.bindings[2]!.event.remainingReservedNotionalKrw, 0);
    assert.equal(result.bindings[0]!.execution.riskDecision.decision, "approved");
    assert.equal(result.bindings[0]!.fillOrigin.riskOrigin!.commitHash, result.bindings[0]!.riskOrigin.commitHash);
    assert.equal(result.bindings[0]!.mandateBinding.mandate.mandateId, state.manual.mandate.mandateId);
    assert.deepEqual(await run(state), result);
    assert.equal(result.assessment.accountingAndResultingPositionAuthority, "not_verified");
    assert.equal(result.assessment.riskPolicyAndRuleAuthority, "not_verified");
    assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
    assert.deepEqual(result.assessment.unverifiedEventIds, []);
    for (const value of [result, result.bindings, result.bindings[0], result.assessment, result.assessment.priceObservation]) assert.ok(Object.isFrozen(value));
  });
});

test("manual capacity fill origins reject wrong gross decrement unbound Risk target bucket mandate and chronology", async (context) => {
  for (const options of [{ wrongDelta: true, feeBps: 250 }, { unbound: true }, { wrongRiskTarget: true },
    { wrongRiskBucket: true }, { wrongMandate: true }, { earlyCapacity: true }]) await fixture(context, options, async (state) => {
    await assert.rejects(run(state), /differs from actual filled|risk origin persisted|target|scope mismatch|lineage mismatch|chronology mismatch/);
  });
});

test("manual capacity fills require an active mandate at the Risk decision and retain historical validity after retirement", async (context) => {
  for (const mandateState of ["proposed", "review_required", "retired", "late_activation"] as const) {
    await fixture(context, { mandateState }, async (state) => { await assert.rejects(run(state), /mandate/); });
  }
  await fixture(context, {}, async (state) => {
    const repository = new InvestmentMandateFileRepository(state.dir);
    const history = await repository.withDurableVerifiedHistory(async (history) => history);
    context.mock.timers.setTime(START + 100);
    await repository.appendEvent(mandateEvent(state.manual.mandate, "retired", 100, history.events[0]!.mandateEventId));
    assert.equal((await run(state)).bindings[0]!.mandateState.status, "active");
  });
});

test("manual capacity fills revalidate stored Risk plan and mandate receipts against actual source prefixes", async (context) => {
  await fixture(context, { receipt: "valid" }, async (state) => {
    assert.ok((await run(state)).bindings[0]!.riskOrigin.mandateOrigin);
  });
  for (const receipt of ["wrong_mandate", "wrong_event", "wrong_prefix", "wrong_plan"] as const) {
    await fixture(context, { receipt }, async (state) => {
      await assert.rejects(run(state), /receipt mismatch|does not match durable source prefixes/);
    });
  }
});

test("manual capacity fill origins require actual fill Risk price plan and execution sources and preserve corruption", async (context) => {
  await fixture(context, {}, async (state) => {
    const { dir } = state;
    const paths = [createPaperFillExecutionPaths(dir).recordsPath, createPortfolioActionRiskDecisionPaths(dir).recordsPath,
      createSourcePriceEvidencePaths(dir).recordsPath, createRebalancePlanPaths(dir).recordsPath, createRebalancePlanEventPaths(dir).eventsPath,
      createInvestmentMandatePaths(dir).eventsPath];
    for (const path of paths) {
      const valid = await readFile(path, "utf8");
      await unlink(path);
      await assert.rejects(run(state));
      await writeFile(path, valid);
      const corrupt = valid + "{broken}\n";
      await writeFile(path, corrupt);
      await assert.rejects(run(state));
      assert.equal(await readFile(path, "utf8"), corrupt);
      await writeFile(path, valid);
    }
    assert.equal((await run(state)).bindings.length, 1);
  });
});

test("manual capacity fill origins recheck exhausted histories and keep release claims unverified", async (context) => {
  await fixture(context, {}, async (state) => {
    context.mock.timers.setTime(START + 100);
    const prior = state.capacity.at(-1)!;
    await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({
      eventType: "released", portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday", reservationId: prior.reservationId,
      reservationHash: prior.reservationHash, previousCapacityReservationEventId: prior.capacityReservationEventId,
      capacityLedgerVersion: 4, remainingReservedNotionalKrw: 0, occupiesNewPositionSlot: false,
      asOf: at(100), createdAt: at(100), releaseReasonCode: "cancelled", releaseOrigin: { originKind: "mandate_terminal",
        mandateId: state.manual.mandate.mandateId, mandateHash: state.manual.mandate.mandateHash, mandateEventId: "terminal", mandateEventHash: HASH }
    }));
    const result = await run(state);
    assert.equal(result.bindings.length, 1);
    assert.equal(result.assessment.unverifiedEventIds.length, 1);
    await unlink(createPaperFillExecutionPaths(state.dir).recordsPath);
    await assert.rejects(run(state));
  });
});

test("manual capacity fill origins handle zero fills without authority and capture strict input", async (context) => {
  await fixture(context, { count: 0 }, async (state) => {
    const result = await run(state);
    assert.equal(result.bindings.length, 0);
    assert.equal(result.assessment.verifiedFillCount, 0);
    assert.equal(result.assessment.slotAndBudgetAllocationAuthority, "not_verified");
    const input = { baseDir: state.dir, portfolioId: PORTFOLIO };
    const promise = resolveStoredManualOpeningCapacityFillOrigins(input);
    input.baseDir = join(state.dir, "missing"); input.portfolioId = "foreign";
    assert.equal((await promise).mandates.bindings.length, 1);
    await assert.rejects(resolveStoredManualOpeningCapacityFillOrigins({ baseDir: state.dir, portfolioId: PORTFOLIO, extra: true } as typeof input));
  });
});

test("manual capacity fill origins reject replayed fill IDs with a rehashed capacity event", async (context) => {
  await fixture(context, { count: 2 }, async (state) => {
    const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath;
    const valid = await readFile(path, "utf8");
    const rows = valid.trimEnd().split("\n");
    await writeFile(path, rows.slice(0, -2).join("\n") + "\n");
    const previous = state.capacity[0]!, last = state.capacity[1]!;
    if (previous.eventType !== "consumed_by_position" || last.eventType !== "partially_consumed") assert.fail("fixture variants");
    const { capacityReservationEventId: _id, capacityReservationEventHash: _hash, ...payload } = last;
    await assert.rejects(new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({
      ...payload, fillId: previous.fillId, paperFillRecordId: previous.paperFillRecordId, paperFillHash: previous.paperFillHash
    })), /reuses a fill/);
    await writeFile(path, valid);
    assert.equal((await run(state)).bindings.length, 2);
  });
});
