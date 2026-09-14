import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createInvestmentMandateEvent, type InvestmentMandateEvent } from "./investmentMandate.js";
import { InvestmentMandateFileRepository, createInvestmentMandatePaths } from "./investmentMandateFiles.js";
import { createCandidateAssignmentPaths } from "./candidateAssignmentFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { resolveStoredSelectorOpeningCapacityTerminalOrigins } from "./storedSelectorOpeningCapacityTerminalOrigins.js";
import { HASH, OTHER, PORTFOLIO, START, at, mandateEvent } from "./storedManualOpeningCapacityTestFixtures.js";
import { fixture, type SelectorCapacityState as State } from "./storedSelectorOpeningCapacityTestFixtures.js";

test("selector retirement origins release actual remaining gross after zero or partial fills and preserve selected sources", async (context) => {
  for (const count of [0, 1, 2]) await fixture(context, { count, feeBps: 250 }, async (state) => {
    const terminal = await retire(state, context, 170);
    const event = await release(state, context, terminal, 180);
    const result = await run(state);
    assert.equal(result.bindings.length, 1);
    assert.deepEqual(result.bindings[0]!.terminalEvent, terminal);
    assert.deepEqual(result.bindings[0]!.event, event);
    assert.equal(result.bindings[0]!.releasedNotionalKrw, count === 0 ? 100 : count === 1 ? 60 : 30);
    assert.equal(result.fills.bindings.length, count);
    assert.equal(result.bindings[0]!.mandateBinding.source.binding.assignment.assignmentId, state.manual.assignment.assignmentId);
    assert.equal(result.bindings[0]!.mandateBinding.mandate.reservedSlotOrdinal, 19);
    assert.deepEqual(result.assessment.unverifiedEventIds, []);
    assert.equal(result.assessment.verificationScope, "stored_selector_capacity_retirement_origins_only");
    assert.equal(result.assessment.retirementAvailabilityBeforeRelease, "not_proven");
    assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
    assert.equal(result.assessment.slotAndBudgetAllocationAuthority, "not_verified");
    assert.deepEqual(await run(state), result);
    for (const item of [result, result.bindings, result.bindings[0], result.assessment, result.assessment.mandateObservation]) assert.ok(Object.isFrozen(item));
  });
});

test("selector retirement origins reject missing changed or nonterminal mandate events", async (context) => {
  for (const mode of ["missing", "hash", "active", "review_required"] as const) await fixture(context, { count: 0 }, async (state) => {
    const repository = new InvestmentMandateFileRepository(state.dir);
    const activated = (await repository.readSnapshot()).events[0]!;
    let terminal = activated;
    if (mode === "review_required") {
      context.mock.timers.setTime(START + 100);
      terminal = mandateEvent(state.manual.mandate, "review_required", 100, activated.mandateEventId);
      await repository.appendEvent(terminal);
    } else if (mode !== "active") terminal = await retire(state, context, 100);
    await release(state, context, terminal, 110, mode === "missing" ? { mandateEventId: "missing" }
      : mode === "hash" ? { mandateEventHash: OTHER } : {});
    await assert.rejects(run(state), /actual retired mandate event/);
  });
});

test("selector retirement origins reject future effective creation or same-time predecessor sources", async (context) => {
  for (const mode of ["effective", "created", "predecessor"] as const) await fixture(context, { count: mode === "predecessor" ? 1 : 0 }, async (state) => {
    const repository = new InvestmentMandateFileRepository(state.dir);
    const activated = (await repository.readSnapshot()).events[0]!;
    const base = mandateEvent(state.manual.mandate, "retired", mode === "predecessor" ? 90 : mode === "effective" ? 150 : 100, activated.mandateEventId);
    const { mandateEventId: _id, mandateEventHash: _hash, ...payload } = base;
    const terminal = createInvestmentMandateEvent({ ...payload, createdAt: at(mode === "predecessor" ? 90 : 160) });
    context.mock.timers.setTime(START + 160);
    await repository.appendEvent(terminal);
    await release(state, context, terminal, 170, {}, mode === "predecessor" ? 95 : 120);
    await assert.rejects(run(state), /chronology mismatch/);
  });
});

test("selector retirement origins reject capacity generation changes during final source observation", async (context) => {
  await fixture(context, {}, async (state) => {
    await release(state, context, await retire(state, context, 100), 110);
    const original = OpeningCapacityReservationEventFileRepository.prototype.withDurableVerifiedHistory;
    let observations = 0;
    const mocked = context.mock.method(OpeningCapacityReservationEventFileRepository.prototype, "withDurableVerifiedHistory",
      async function(this: OpeningCapacityReservationEventFileRepository, operation: Parameters<typeof original>[0]) {
        if (++observations === 4) {
          context.mock.timers.setTime(START + 120);
          await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({
            eventType: "reserved", portfolioId: PORTFOLIO, policyHash: OTHER, bucket: "intraday", reservationId: "concurrent-manual", reservationHash: HASH,
            capacityLedgerVersion: 1, remainingReservedNotionalKrw: 20, occupiesNewPositionSlot: true, asOf: at(120), createdAt: at(120),
            reservationSource: { sourceKind: "manual", manualCapacityReservationId: "concurrent-manual", manualCapacityReservationHash: HASH }
          }));
        }
        return original.call(this, operation);
      } as typeof original);
    try { await assert.rejects(run(state), /generation changed during terminal resolution/); assert.equal(observations, 4); }
    finally { mocked.mock.restore(); }
    const retry = await run(state);
    assert.equal(retry.bindings.length, 1);
    assert.equal(retry.assessment.unverifiedEventIds.length, 1);
  });
});

test("selector retirement origins recheck selected and consumed histories and preserve corrupt source bytes", async (context) => {
  await fixture(context, {}, async (state) => {
    await release(state, context, await retire(state, context, 100), 110);
    assert.equal((await run(state)).bindings.length, 1);
    for (const path of [createCandidateAssignmentPaths(state.dir).recordsPath, createInvestmentMandatePaths(state.dir).recordsPath,
      createInvestmentMandatePaths(state.dir).eventsPath, createPaperFillExecutionPaths(state.dir).recordsPath,
      createOpeningCapacityReservationEventPaths(state.dir).eventsPath]) {
      const valid = await readFile(path, "utf8");
      await unlink(path);
      if (path !== createOpeningCapacityReservationEventPaths(state.dir).eventsPath) await assert.rejects(run(state));
      else assert.equal((await run(state)).bindings.length, 0);
      await writeFile(path, valid + "{broken}\n");
      await assert.rejects(run(state));
      assert.equal(await readFile(path, "utf8"), valid + "{broken}\n");
      await writeFile(path, valid);
    }
    assert.equal((await run(state)).bindings.length, 1);
  });
});

test("selector retirement origins leave unbound cancellation and another policy manual roots unverified", async (context) => {
  await fixture(context, { count: 0 }, async (state) => {
    const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath;
    const rows = (await readFile(path, "utf8")).trimEnd().split("\n");
    await writeFile(path, rows.slice(0, 2).join("\n") + "\n");
    context.mock.timers.setTime(START + 110);
    const root = state.manual.root;
    const cancelled = createOpeningCapacityReservationEvent({ eventType: "released", portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday",
      reservationId: root.reservationId, reservationHash: root.reservationHash, previousCapacityReservationEventId: root.capacityReservationEventId,
      capacityLedgerVersion: 2, remainingReservedNotionalKrw: 0, occupiesNewPositionSlot: false, asOf: at(110), createdAt: at(110),
      releaseReasonCode: "cancelled", releaseOrigin: { originKind: "request_cancelled", requestOrManualEventId: state.manual.assignment.requestId } });
    const journal = new OpeningCapacityReservationEventFileRepository(state.dir);
    await journal.append(cancelled);
    context.mock.timers.setTime(START + 120);
    const foreign = createOpeningCapacityReservationEvent({ eventType: "reserved", portfolioId: PORTFOLIO, policyHash: OTHER, bucket: "intraday",
      reservationId: root.reservationId, reservationHash: root.reservationHash, capacityLedgerVersion: 1, remainingReservedNotionalKrw: 20,
      occupiesNewPositionSlot: true, asOf: at(120), createdAt: at(120), reservationSource: { sourceKind: "manual",
        manualCapacityReservationId: root.reservationId, manualCapacityReservationHash: root.reservationHash } });
    await journal.append(foreign);
    const result = await run(state);
    assert.equal(result.bindings.length, 0);
    assert.deepEqual(result.assessment.unverifiedEventIds, [root.capacityReservationEventId, cancelled.capacityReservationEventId, foreign.capacityReservationEventId]);
    assert.equal(result.assessment.requestCancellationAuthority, "not_verified");
    assert.equal(result.assessment.targetCompletionAuthority, "not_verified");
  });
});

test("selector retirement origins capture strict input and do not fabricate releases for active or exhausted reservations", async (context) => {
  for (const count of [0, 3]) await fixture(context, { count }, async (state) => {
    const input = { baseDir: state.dir, portfolioId: PORTFOLIO };
    const pending = resolveStoredSelectorOpeningCapacityTerminalOrigins(input);
    input.baseDir = join(state.dir, "missing"); input.portfolioId = "foreign";
    const result = await pending;
    assert.equal(result.bindings.length, 0);
    assert.equal(result.fills.bindings.length, count);
    await assert.rejects(resolveStoredSelectorOpeningCapacityTerminalOrigins({ baseDir: state.dir, portfolioId: PORTFOLIO, extra: true } as typeof input));
  });
});

async function retire(state: State, context: TestContext, ms: number) {
  const repository = new InvestmentMandateFileRepository(state.dir);
  const activated = (await repository.readSnapshot()).events[0]!;
  const terminal = mandateEvent(state.manual.mandate, "retired", ms, activated.mandateEventId);
  context.mock.timers.setTime(START + ms);
  await repository.appendEvent(terminal);
  return terminal;
}
async function release(state: State, context: TestContext, terminal: InvestmentMandateEvent, ms: number,
  originPatch: Record<string, string> = {}, asOf = ms) {
  const previous = state.capacity.at(-1) ?? state.manual.bound;
  context.mock.timers.setTime(START + ms);
  const event = createOpeningCapacityReservationEvent({ eventType: "released", portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday",
    reservationId: previous.reservationId, reservationHash: previous.reservationHash, previousCapacityReservationEventId: previous.capacityReservationEventId,
    capacityLedgerVersion: previous.capacityLedgerVersion + 1, remainingReservedNotionalKrw: 0, occupiesNewPositionSlot: false,
    asOf: at(asOf), createdAt: at(ms), releaseReasonCode: "retired", releaseOrigin: { originKind: "mandate_terminal",
      mandateId: terminal.mandateId, mandateHash: terminal.mandateHash, mandateEventId: terminal.mandateEventId,
      mandateEventHash: terminal.mandateEventHash, ...originPatch } });
  await new OpeningCapacityReservationEventFileRepository(state.dir).append(event);
  return event;
}
function run(state: State) { return resolveStoredSelectorOpeningCapacityTerminalOrigins({ baseDir: state.dir, portfolioId: PORTFOLIO }); }
