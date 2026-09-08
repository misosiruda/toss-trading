import assert from "node:assert/strict";
import test from "node:test";
import { createBucketTurnoverEvent, createInitialBucketTurnoverState, parseBucketTurnoverEvent, parseBucketTurnoverState,
  replayBucketTurnoverEvents, resolveBucketTurnoverState } from "./bucketTurnover.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const POLICY_A = `sha256:${"a".repeat(64)}`;
const POLICY_B = `sha256:${"b".repeat(64)}`;
const START = "2026-09-08T00:00:00.000Z";
const END = "2026-09-09T00:00:00.000Z";
const rootInput = { portfolioId: "synthetic-portfolio", bucket: "swing" as const, policyHash: POLICY_A,
  asOf: "2026-09-08T12:00:00.000Z", durationSeconds: 86_400, windowOpenPortfolioNetWorthKrw: 100_000 };

test("turnover fixed UTC window identity excludes policy and uses epoch floor before and after 1970", () => {
  const initial = createInitialBucketTurnoverState(rootInput);
  assert.equal(initial.windowStartedAt, START);
  assert.equal(initial.windowEndsAt, END);
  assert.equal(initial.asOf, START);
  assert.equal(initial.turnoverRatio, 0);
  const sameWindow = createInitialBucketTurnoverState({ ...rootInput, policyHash: POLICY_B, asOf: "2026-09-08T23:59:59.999Z" });
  assert.equal(initial.turnoverStateId, sameWindow.turnoverStateId);
  assert.notEqual(initial.turnoverStateHash, sameWindow.turnoverStateHash);
  assert.equal(createInitialBucketTurnoverState({ ...rootInput, asOf: "2026-09-08T09:00:00+09:00" }).turnoverStateId, initial.turnoverStateId);
  assert.notEqual(createInitialBucketTurnoverState({ ...rootInput, asOf: END }).turnoverStateId, initial.turnoverStateId);
  const beforeEpoch = createInitialBucketTurnoverState({ ...rootInput, asOf: "1969-12-31T23:59:59.999Z" });
  assert.equal(beforeEpoch.windowStartedAt, "1969-12-31T00:00:00.000Z");
  assert.equal(beforeEpoch.windowEndsAt, "1970-01-01T00:00:00.000Z");
  const minute = createInitialBucketTurnoverState({ ...rootInput, durationSeconds: 60, asOf: "2026-09-08T12:34:59.999Z" });
  assert.equal(minute.windowStartedAt, "2026-09-08T12:34:00.000Z");
  assert.equal(minute.windowEndsAt, "2026-09-08T12:35:00.000Z");
  for (const change of [{ durationSeconds: 0 }, { durationSeconds: 0.1 }, { durationSeconds: Number.MAX_SAFE_INTEGER },
    { windowOpenPortfolioNetWorthKrw: 0 }, { windowOpenPortfolioNetWorthKrw: -0 }, { windowOpenPortfolioNetWorthKrw: 1.1 },
    { windowOpenPortfolioNetWorthKrw: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => createInitialBucketTurnoverState({ ...rootInput, ...change }));
  }
});

test("turnover event hash covers the full payload but excludes createdAt", () => {
  const { first } = fixture();
  assert.deepEqual(parseBucketTurnoverEvent(JSON.parse(JSON.stringify(first))), first);
  const { turnoverEventId: _id, turnoverEventHash: _hash, ...payload } = first;
  const later = createBucketTurnoverEvent({ ...payload, createdAt: END });
  assert.equal(later.turnoverEventId, first.turnoverEventId);
  assert.equal(later.turnoverEventHash, first.turnoverEventHash);
  for (const change of [{ fillId: "other" }, { rebalancePlanId: "other" }, { rebalanceActionId: "other" },
    { portfolioId: "other" }, { bucket: "hedge" }, { turnoverStateId: "other" }, { previousTurnoverEventId: "other" },
    { turnoverEventId: "other" }, { turnoverEventHash: POLICY_B }, { policyHash: POLICY_B }, { absoluteFilledNotionalKrw: 99 },
    { resultingCumulativeAbsoluteFilledNotionalKrw: 101 }, { asOf: "2026-09-08T00:00:02.000Z" }]) {
    assert.throws(() => parseBucketTurnoverEvent({ ...first, ...change }));
  }
  assert.throws(() => createBucketTurnoverEvent({ ...payload, previousTurnoverEventId: undefined }));
  assert.throws(() => createBucketTurnoverEvent({ ...payload, absoluteFilledNotionalKrw: 0 }));
  assert.throws(() => createBucketTurnoverEvent({ ...payload, createdAt: START }));
  assert.throws(() => createBucketTurnoverEvent({ ...payload, asOf: "2026-09-08T09:00:01+09:00" }));
  assert.throws(() => parseBucketTurnoverEvent({ ...first, extra: true }));
});

test("turnover complete replay preserves denominator and cumulative amount across policy changes and restart", () => {
  const { initial, first, second } = fixture();
  const state = replayBucketTurnoverEvents({ initialState: initial, events: [first, second] });
  assert.equal(state.turnoverStateId, initial.turnoverStateId);
  assert.equal(state.windowOpenPortfolioNetWorthKrw, 100_000);
  assert.equal(state.cumulativeAbsoluteFilledNotionalKrw, 300);
  assert.equal(state.turnoverRatio, 0.003);
  assert.equal(state.lastAppliedPolicyHash, POLICY_B);
  assert.equal(state.lastTurnoverEventId, second.turnoverEventId);
  assert.equal(state.asOf, second.asOf);
  assert.ok(Object.isFrozen(state));
  assert.deepEqual(parseBucketTurnoverState(JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(resolveBucketTurnoverState(JSON.parse(JSON.stringify({ initialState: initial, events: [first, second], state }))), state);
  assert.deepEqual(replayBucketTurnoverEvents({ initialState: initial, events: [] }), initial);
  assert.throws(() => replayBucketTurnoverEvents({ initialState: state, events: [] }), /empty window root/);
});

test("turnover replay rejects fully rehashed duplicate, branch, scope, backward and boundary events", () => {
  const { initial, first, second } = fixture();
  const { turnoverEventId: _id, turnoverEventHash: _hash, ...payload } = second;
  for (const change of [{ fillId: first.fillId }, { previousTurnoverEventId: "unknown" }, { portfolioId: "other" },
    { bucket: "hedge" as const }, { turnoverStateId: "other" }, { resultingCumulativeAbsoluteFilledNotionalKrw: 301 },
    { asOf: START }, { asOf: END, createdAt: END }]) {
    const event = createBucketTurnoverEvent({ ...payload, ...change });
    assert.throws(() => replayBucketTurnoverEvents({ initialState: initial, events: [first, event] }));
  }
  assert.throws(() => replayBucketTurnoverEvents({ initialState: initial, events: [first, first] }), /duplicate/);
  assert.throws(() => replayBucketTurnoverEvents({ initialState: initial, events: [second] }), /predecessor/);
  assert.throws(() => replayBucketTurnoverEvents({ initialState: initial, events: [second, first] }), /predecessor/);
});

test("turnover replay rejects backward creation times even when hashes and asOf remain valid", () => {
  const { initial, first, second } = fixture();
  const delayedFirst = { ...first, createdAt: "2026-09-08T10:00:00.000Z" };
  const backwardSecond = { ...second, createdAt: "2026-09-08T09:00:00.000Z" };
  assert.deepEqual(parseBucketTurnoverEvent(delayedFirst), delayedFirst);
  assert.deepEqual(parseBucketTurnoverEvent(backwardSecond), backwardSecond);
  assert.throws(() => replayBucketTurnoverEvents({ initialState: initial, events: [delayedFirst, backwardSecond] }), /creation time moves backward/);
  for (const createdAt of [delayedFirst.createdAt, "2026-09-08T11:00:00.000Z"]) {
    assert.equal(replayBucketTurnoverEvents({ initialState: initial, events: [delayedFirst, { ...second, createdAt }] })
      .cumulativeAbsoluteFilledNotionalKrw, 300);
  }
});

test("turnover snapshot requires complete replay even when its amounts, policy and hash are self-consistent", () => {
  const { initial, first, second } = fixture();
  const state = replayBucketTurnoverEvents({ initialState: initial, events: [first, second] });
  const { turnoverStateHash: _hash, ...payload } = state;
  for (const change of [{ cumulativeAbsoluteFilledNotionalKrw: 400, turnoverRatio: 0.004 },
    { lastAppliedPolicyHash: POLICY_A }, { lastTurnoverEventId: first.turnoverEventId },
    { windowOpenPortfolioNetWorthKrw: 200_000, turnoverRatio: 0.0015 }]) {
    const changed = { ...payload, ...change };
    const altered = { ...changed, turnoverStateHash: hashCanonicalPayload(changed) };
    assert.doesNotThrow(() => parseBucketTurnoverState(altered));
    assert.throws(() => resolveBucketTurnoverState({ initialState: initial, events: [first, second], state: altered }), /complete event replay/);
  }
  for (const change of [{ turnoverRatio: 0.5 }, { turnoverStateId: "other" }, { windowStartedAt: "2026-09-08T00:00:00.001Z" },
    { windowOpenPortfolioNetWorthKrw: 0 }]) {
    const changed = { ...payload, ...change };
    assert.throws(() => parseBucketTurnoverState({ ...changed, turnoverStateHash: hashCanonicalPayload(changed) }));
  }
});

test("turnover accumulation fails closed beyond safe integer KRW", () => {
  const initial = createInitialBucketTurnoverState({ ...rootInput, windowOpenPortfolioNetWorthKrw: Number.MAX_SAFE_INTEGER });
  const first = createBucketTurnoverEvent({ turnoverStateId: initial.turnoverStateId, portfolioId: initial.portfolioId, bucket: initial.bucket,
    policyHash: POLICY_A, rebalancePlanId: "plan-1", rebalanceActionId: "action-1", fillId: "fill-1",
    absoluteFilledNotionalKrw: Number.MAX_SAFE_INTEGER, resultingCumulativeAbsoluteFilledNotionalKrw: Number.MAX_SAFE_INTEGER,
    asOf: START, createdAt: START });
  const second = createBucketTurnoverEvent({ turnoverStateId: initial.turnoverStateId, portfolioId: initial.portfolioId, bucket: initial.bucket,
    previousTurnoverEventId: first.turnoverEventId, policyHash: POLICY_A, rebalancePlanId: "plan-2", rebalanceActionId: "action-2", fillId: "fill-2",
    absoluteFilledNotionalKrw: 1, resultingCumulativeAbsoluteFilledNotionalKrw: Number.MAX_SAFE_INTEGER, asOf: START, createdAt: START });
  assert.equal(replayBucketTurnoverEvents({ initialState: initial, events: [first] }).turnoverRatio, 1);
  assert.throws(() => replayBucketTurnoverEvents({ initialState: initial, events: [first, second] }), /cumulative/);
});

test("turnover replay preserves observed ratios over one instead of hiding a limit breach", () => {
  const { first, second } = fixture();
  const initial = createInitialBucketTurnoverState({ ...rootInput, windowOpenPortfolioNetWorthKrw: 100 });
  const state = replayBucketTurnoverEvents({ initialState: initial, events: [first, second] });
  assert.equal(state.cumulativeAbsoluteFilledNotionalKrw, 300);
  assert.equal(state.turnoverRatio, 3);
  assert.deepEqual(resolveBucketTurnoverState({ initialState: initial, events: [first, second], state }), state);
});

function fixture() {
  const initial = createInitialBucketTurnoverState(rootInput);
  const first = createBucketTurnoverEvent({ turnoverStateId: initial.turnoverStateId, portfolioId: initial.portfolioId, bucket: initial.bucket,
    policyHash: POLICY_A, rebalancePlanId: "plan-1", rebalanceActionId: "action-1", fillId: "fill-1", absoluteFilledNotionalKrw: 100,
    resultingCumulativeAbsoluteFilledNotionalKrw: 100, asOf: "2026-09-08T00:00:01.000Z", createdAt: "2026-09-08T00:00:01.000Z" });
  const second = createBucketTurnoverEvent({ turnoverStateId: initial.turnoverStateId, portfolioId: initial.portfolioId, bucket: initial.bucket,
    previousTurnoverEventId: first.turnoverEventId, policyHash: POLICY_B, rebalancePlanId: "plan-2", rebalanceActionId: "action-2", fillId: "fill-2",
    absoluteFilledNotionalKrw: 200, resultingCumulativeAbsoluteFilledNotionalKrw: 300, asOf: "2026-09-08T00:00:02.000Z", createdAt: "2026-09-08T00:00:02.000Z" });
  return { initial, first, second };
}
