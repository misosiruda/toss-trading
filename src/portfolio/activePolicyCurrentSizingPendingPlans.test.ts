import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { FileVirtualPortfolioStore } from "../storage/virtualPortfolioFileStore.js";
import { appendPolicyBoundCurrentPortfolioSizingSnapshot as publish,
  appendCurrentPortfolioSizingSnapshot as publishUnbound } from "./currentPortfolioSizingSnapshotFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { pendingActionExposureTotals } from "./portfolioSizingInputs.js";
import { createRebalancePlanPaths } from "./rebalancePlanFiles.js";
import { createRebalancePlanEventPaths } from "./rebalancePlanEventFiles.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { fixture, request, event, options, T, at, H } from "./currentSizingPendingTestFixtures.js";

test("policy-bound current sizing binds partial pending progress for every target kind including earlier policy plans", async (context) => {
  for (const kind of ["fractional_buy", "fractional_sell", "whole_buy", "whole_sell"] as const) await fixture(context, kind, async (state) => {
    const result = await publish(request(state), options);
    assert.deepEqual(result.pendingActionInputs, [state.pending]);
    assert.notEqual(state.plan.policyHash, result.policyHash);
    assert.deepEqual(await publish(request(state), options), result);
    assert.equal((await new PortfolioSizingSnapshotFileRepository(state.baseDir).readAll()).length, 1);
  });
});

test("policy-bound current sizing rejects omitted extra substituted and mismatched pending actions before persistence", async (context) => {
  await fixture(context, "fractional_buy", async (state) => {
    const wrong = { ...state.pending, actionId: "synthetic-other" };
    for (const pending of [[], [state.pending, wrong], [wrong], [{ ...state.pending, planHash: H("wrong") }],
      [{ ...state.pending, planEventHash: H("wrong") }], [{ ...state.pending, actionExecutionTargetHash: H("wrong") }]]) {
      await assert.rejects(publish(request(state, pending), options), /snapshot pending/);
      await assert.rejects(fs.readFile(state.records), { code: "ENOENT" });
    }
    // Legacy publisher still accepts independently valid historical inputs without source-origin binding.
    assert.equal((await publishUnbound(request(state, []), options)).pendingActionInputs.length, 0);
  });
});

test("policy-bound current sizing reads pending quantity price sources even when the portfolio holds only cash", async (context) => {
  await fixture(context, "whole_buy", async (state) => {
    await new FileVirtualPortfolioStore(state.portfolioPath).write({ portfolioId: state.policy.policy.portfolioId,
      cashKrw: 1000, positions: [], updatedAt: at(0) });
    const input = { ...request(state), valuationInputs: [], ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 1000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
      marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {},
      ...pendingActionExposureTotals([state.pending]) }) };
    assert.equal((await publish(input, options)).pendingActionInputs[0]!.remainingNotionalKrw, 200);
  });
});

test("policy-bound current sizing compares remaining target or quantity gross instead of execution cap", async (context) => {
  for (const kind of ["fractional_buy", "fractional_sell", "whole_buy", "whole_sell"] as const) await fixture(context, kind, async (state) => {
    await assert.rejects(publish(request(state, [{ ...state.pending, remainingNotionalKrw: 360 }]), options), /remaining gross/);
    if (state.pending.side === "SELL") {
      await assert.rejects(publish(request(state, [{ ...state.pending, remainingQuantity: 0.1 }]), options), /remaining quantity/);
    }
    await assert.rejects(fs.readFile(state.records), { code: "ENOENT" });
  });
});

test("policy-bound current sizing uses stored SELL revaluation and rejects missing or late pending price origins", async (context) => {
  await fixture(context, "fractional_sell", async (state) => {
    assert.equal(state.pending.side, "SELL"); if (state.pending.side !== "SELL") return;
    await assert.rejects(publish(request(state, [{ ...state.pending, priceEvidenceRef: "missing-price" }]), options), /does not resolve/);
    context.mock.timers.setTime(T + 45);
    const revalued = await state.prices.append(createSourcePriceEvidenceRecord({ sourceContractId: "synthetic-revalue", market: "KR", symbol: "SYNTH",
      priceField: "last_price", priceKrw: 120, observedAt: at(44), createdAt: at(44), sourceRefs: ["synthetic"] }));
    context.mock.timers.setTime(T + 100);
    const pending = { ...state.pending, priceEvidenceRef: revalued.evidenceRef, remainingNotionalKrw: 24 };
    assert.equal((await publish(request(state, [pending]), options)).exposureSnapshot.pendingSellExposureKrw, 24);
    const late = await state.prices.append(createSourcePriceEvidenceRecord({ sourceContractId: "synthetic-late", market: "KR", symbol: "SYNTH",
      priceField: "last_price", priceKrw: 120, observedAt: at(44), createdAt: at(44), sourceRefs: ["synthetic-late"] }));
    await assert.rejects(publish(request(state, [{ ...pending, priceEvidenceRef: late.evidenceRef }]), options), /availability mismatch/);
  });
});

test("policy-bound current sizing keeps plan and event writers excluded through append and retry fsync", async (context) => {
  await fixture(context, "whole_buy", async (state) => {
    const original = fs.open; let checks = 0, inspect = true;
    const hook = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === state.records && ["a", "r+"].includes(String(args[1]))) {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => {
          await sync(); if (!inspect) return; inspect = false; checks++;
          await assert.rejects(state.plans.append(state.plan), /lock is unavailable/);
          await assert.rejects(state.events.append(event(state.plan, "rejected", state.lastEvent, 100)), /lock is unavailable/);
        });
      }
      return handle;
    }); syncBuiltinESMExports();
    try { const first = await publish(request(state), options); inspect = true; assert.deepEqual(await publish(request(state), options), first); }
    finally { hook.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(checks, 2);
    await state.plans.append(state.plan);
    await state.events.append(event(state.plan, "rejected", state.lastEvent, 100));
  });
});

test("policy-bound current sizing rejects missing and corrupt pending sources on exact retry without changing destination", async (context) => {
  for (const source of ["plan", "events"] as const) await fixture(context, "whole_buy", async (state) => {
    await publish(request(state), options); const before = await fs.readFile(state.records);
    const path = source === "plan" ? createRebalancePlanPaths(state.baseDir).recordsPath : createRebalancePlanEventPaths(state.baseDir).eventsPath;
    const original = await fs.readFile(path);
    for (const damaged of [Buffer.from(""), Buffer.concat([original, Buffer.from("{\n")])]) {
      await fs.writeFile(path, damaged);
      await assert.rejects(publish(request(state), options));
      assert.deepEqual(await fs.readFile(state.records), before);
      assert.deepEqual(await fs.readFile(path), damaged);
    }
  });
});

test("policy-bound current sizing selects cutoff prefix and refuses pending input at its event commit boundary", async (context) => {
  await fixture(context, "fractional_buy", async (state) => {
    await assert.rejects(publish(request(state, [{ ...state.pending, asOf: at(40) }]), options), /predates its stored/);
    await state.events.append(event(state.plan, "rejected", state.lastEvent, 100));
    const earlier = await publish(request(state), options);
    assert.equal(earlier.pendingActionInputs.length, 1);
    context.mock.timers.setTime(T + 120);
    assert.equal((await publish(request(state, [], 110), options)).pendingActionInputs.length, 0);
    await assert.rejects(publish(request(state, [state.pending], 110), options), /action set/);
  });
});
