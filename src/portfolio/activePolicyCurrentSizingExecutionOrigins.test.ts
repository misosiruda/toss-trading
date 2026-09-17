import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import test from "node:test";
import { FileVirtualPortfolioStore } from "../storage/virtualPortfolioFileStore.js";
import { appendPolicyBoundCurrentPortfolioSizingSnapshot as publish } from "./currentPortfolioSizingSnapshotFiles.js";
import { fixture, request, event, options, T, at, H } from "./currentSizingPendingTestFixtures.js";
import { createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { createPortfolioActionRiskDecisionPaths } from "./portfolioActionRiskDecisionFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { pendingActionExposureTotals } from "./portfolioSizingInputs.js";
import { createSourcePriceEvidencePaths } from "./sourcePriceEvidenceFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

test("current sizing requires a stored fill completion strictly before its execution event on append and retry", async (context) => {
  await fixture(context, "fractional_buy", async (state) => {
    const path = createPaperFillExecutionPaths(state.baseDir).recordsPath, original = await fs.readFile(path, "utf8");
    const lines = original.trimEnd().split("\n").map((line) => JSON.parse(line));
    const { completionHash: _hash, ...completion } = lines.at(-1)!;
    assert.equal(completion.schemaVersion, "paper_fill_execution_completion.v1");
    for (const retry of [false, true]) {
      if (retry) await publish(request(state), options);
      const before = retry ? await fs.readFile(state.records) : null;
      for (const offset of [40, 41, 100]) {
        const payload = { ...completion, completedAt: at(offset) };
        const damaged = [...lines.slice(0, -1), { ...payload, completionHash: hashCanonicalPayload(payload) }].map((line) => JSON.stringify(line)).join("\n") + "\n";
        await fs.writeFile(path, damaged);
        await assert.rejects(publish(request(state), options), /fill completion was unavailable/);
        if (before === null) await assert.rejects(fs.readFile(state.records), { code: "ENOENT" });
        else assert.deepEqual(await fs.readFile(state.records), before);
        assert.equal(await fs.readFile(path, "utf8"), damaged);
      }
      await fs.writeFile(path, original);
    }
    assert.deepEqual(await publish(request(state), options), await publish(request(state), options));
  }, { completion: true });
});

test("current sizing rejects missing or corrupt execution sources before append and on exact retry", async (context) => {
  for (const source of ["risk", "fill"] as const) await fixture(context, "fractional_buy", async (state) => {
    const path = source === "risk" ? createPortfolioActionRiskDecisionPaths(state.baseDir).recordsPath
      : createPaperFillExecutionPaths(state.baseDir).recordsPath;
    const original = await fs.readFile(path);
    for (const retry of [false, true]) {
      if (retry) await publish(request(state), options);
      const before = retry ? await fs.readFile(state.records) : null;
      for (const damaged of [Buffer.from(""), Buffer.concat([original, Buffer.from("{\n")]), original.subarray(0, original.length - 1)]) {
        await fs.writeFile(path, damaged);
        await assert.rejects(publish(request(state), options));
        if (before === null) await assert.rejects(fs.readFile(state.records), { code: "ENOENT" });
        else assert.deepEqual(await fs.readFile(state.records), before);
        assert.deepEqual(await fs.readFile(path), damaged);
      }
      await fs.writeFile(path, original);
    }
    assert.deepEqual(await publish(request(state), options), await publish(request(state), options));
  });
});

test("current sizing refuses fill records lacking persisted Risk origin", async (context) => {
  await fixture(context, "whole_buy", async (state) => {
    await assert.rejects(publish(request(state), options), /risk origin persisted with the fill/);
    await assert.rejects(fs.readFile(state.records), { code: "ENOENT" });
  }, { unbound: true });
});

test("current sizing checks actual execution Risk scope prior state cap and predecessor chronology", async (context) => {
  for (const risk of [{ actionExecutionTargetHash: H("wrong-target") }, { symbol: "OTHER" },
    { expectedPortfolioSnapshotHash: H("wrong-state") },
    { approvedMaximumFillNotionalKrw: 101, cashAssessment: { side: "BUY" as const, worstCaseNetCashDebitKrw: 40, approvedMaximumNetCashDebitKrw: 101 } },
    { decidedAt: at(29) }, { decidedAt: at(30) }]) await fixture(context, "fractional_buy", async (state) => {
    await assert.rejects(publish(request(state), options), /scope mismatch|remaining buy target|pre-state mismatch|predates its stored plan predecessor/);
    await assert.rejects(fs.readFile(state.records), { code: "ENOENT" });
  }, { risk });
});

test("cash-only current sizing still verifies execution prices and origins of terminal plans", async (context) => {
  await fixture(context, "fractional_buy", async (state) => {
    await state.events.append(event(state.plan, "rejected", state.lastEvent, 100));
    await new FileVirtualPortfolioStore(state.portfolioPath).write({ portfolioId: state.plan.portfolioId,
      cashKrw: 1000, positions: [], updatedAt: at(0) });
    context.mock.timers.setTime(T + 120);
    const input = { ...request(state, [], 110), valuationInputs: [],
      ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 1000, cashKrw: 1000,
        bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
        marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {},
        ...pendingActionExposureTotals([]) }) };
    const first = await publish(input, options), before = await fs.readFile(state.records);
    assert.deepEqual(first.pendingActionInputs, []);
    for (const path of [createSourcePriceEvidencePaths(state.baseDir).recordsPath,
      createPortfolioActionRiskDecisionPaths(state.baseDir).recordsPath, createPaperFillExecutionPaths(state.baseDir).recordsPath]) {
      const original = await fs.readFile(path);
      await fs.writeFile(path, "");
      await assert.rejects(publish(input, options), /exactly once/);
      assert.deepEqual(await fs.readFile(state.records), before);
      await fs.writeFile(path, original);
    }
    assert.deepEqual(await publish(input, options), first);
  });
});

test("current sizing keeps Risk and fill writers excluded through destination append and retry fsync", async (context) => {
  await fixture(context, "whole_buy", async (state) => {
    const original = fs.open; let checks = 0, inspect = true, finalPhase = false;
    const hook = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === createOpeningCapacityReservationEventPaths(state.baseDir).lockPath && args[1] === "wx") finalPhase = true;
      if (args[0] === state.records && finalPhase && ["a", "r+"].includes(String(args[1]))) {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => {
          await sync(); if (!inspect) return; inspect = false; checks++;
          await assert.rejects(state.risks.append(state.risk), /lock is unavailable/);
          await assert.rejects(state.fills.readVerifiedHistory(), /lock is unavailable/);
        });
      }
      return handle;
    }); syncBuiltinESMExports();
    try { const first = await publish(request(state), options); inspect = true; finalPhase = false; assert.deepEqual(await publish(request(state), options), first); }
    finally { hook.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(checks, 2);
    assert.deepEqual(await state.risks.append(state.risk), state.risk);
    assert.deepEqual((await state.fills.readVerifiedHistory()).records, [state.paperFill]);
  });
});

test("current sizing rejects backwards Risk or fill observation before destination persistence", async (context) => {
  for (const source of ["risk", "fill"] as const) await fixture(context, "fractional_buy", async (state) => {
    const path = source === "risk" ? createPortfolioActionRiskDecisionPaths(state.baseDir).recordsPath
      : createPaperFillExecutionPaths(state.baseDir).recordsPath;
    const original = fs.open;
    const hook = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === path && args[1] === "r+") {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => { await sync(); context.mock.timers.setTime(T + 99); });
      }
      return handle;
    }); syncBuiltinESMExports();
    try { await assert.rejects(publish(request(state), options), /observation clock moved backwards/); }
    finally { hook.mock.restore(); syncBuiltinESMExports(); context.mock.timers.setTime(T + 100); }
    await assert.rejects(fs.readFile(state.records), { code: "ENOENT" });
    await publish(request(state), options);
  });
});

test("current sizing releases execution source locks after destination failure and permits exact recovery", async (context) => {
  await fixture(context, "whole_sell", async (state) => {
    const original = fs.open;
    const hook = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === state.records && args[1] === "a") context.mock.method(handle, "sync", async () => { throw new Error("synthetic destination fsync failure"); });
      return handle;
    }); syncBuiltinESMExports();
    try { await assert.rejects(publish(request(state), options), /synthetic destination fsync failure/); }
    finally { hook.mock.restore(); syncBuiltinESMExports(); }
    await state.risks.append(state.risk);
    assert.equal((await state.fills.readVerifiedHistory()).records.length, 1);
    const first = await publish(request(state), options);
    assert.deepEqual(await publish(request(state), options), first);
    assert.equal((await state.snapshots.readAll()).length, 1);
  });
});
