import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { appendPolicyBoundCurrentPortfolioSizingSnapshot as publish } from "./currentPortfolioSizingSnapshotFiles.js";
import { fixture, request, event, options, T, at, H } from "./currentSizingPendingTestFixtures.js";
import { createInvestmentMandateEvent } from "./investmentMandate.js";
import { createInvestmentMandatePaths } from "./investmentMandateFiles.js";

test("current sizing binds both manual and selector mandate reservation identities on append and retry", async (context) => {
  for (const selector of [false, true]) await fixture(context, "whole_buy", async (state) => {
    const first = await publish(request(state), options), before = await fs.readFile(state.records);
    assert.equal(state.pending.side, "BUY"); if (state.pending.side !== "BUY") return;
    for (const change of [{ openingCapacityReservationId: "other" }, { openingCapacityReservationHash: H("other") }]) {
      await assert.rejects(publish(request(state, [{ ...state.pending, ...change }]), options), /reservation differs from stored mandate/);
      assert.deepEqual(await fs.readFile(state.records), before);
    }
    assert.deepEqual(await publish(request(state), options), first);
  }, { selector });
});

test("current sizing revalidates complete mandate record and event sources on append and exact retry", async (context) => {
  for (const source of ["recordsPath", "eventsPath"] as const) await fixture(context, "fractional_buy", async (state) => {
    const path = createInvestmentMandatePaths(state.baseDir)[source], original = await fs.readFile(path);
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

test("current sizing refuses mandate scope expiry future validity and executed Risk bucket mismatches", async (context) => {
  for (const mandate of [{ portfolioId: "other" }, { policyHash: H("other") }, { market: "US" as const }, { symbol: "OTHER" },
    { bucket: "short_term" as const }, { validFrom: at(51) }, { expiresAt: at(50) }]) await fixture(context, "fractional_buy", async (state) => {
    await assert.rejects(publish(request(state), options), /investment mandate is required|mandate bucket/);
    await assert.rejects(fs.readFile(state.records), { code: "ENOENT" });
  }, { mandate });
});

test("current sizing retains SELL review and reduce-only semantics but refuses pending BUY review or retirement", async (context) => {
  for (const side of ["fractional_buy", "fractional_sell"] as const) for (const type of ["review_required", "retired"] as const) {
    await fixture(context, side, async (state) => {
      const { mandateEventId: _id, mandateEventHash: _hash, eventType: _type, ...scope } = state.activation;
      await state.mandates.appendEvent(createInvestmentMandateEvent({ ...scope, eventType: type,
        previousMandateEventId: state.activation.mandateEventId, asOf: at(45), createdAt: at(45) }));
      if (side === "fractional_sell" && type === "review_required") await publish(request(state), options);
      else await assert.rejects(publish(request(state), options), /active opening mandate|investment mandate is required/);
    });
  }
  for (const side of ["whole_buy", "whole_sell"] as const) await fixture(context, side, async (state) => {
    if (side === "whole_sell") await publish(request(state), options);
    else await assert.rejects(publish(request(state), options), /active opening mandate/);
  }, { reduceOnly: true });
});

test("current sizing validates terminal execution mandates at Risk time instead of current lifecycle state", async (context) => {
  await fixture(context, "fractional_buy", async (state) => {
    const { mandateEventId: _id, mandateEventHash: _hash, eventType: _type, ...scope } = state.activation;
    const retired = createInvestmentMandateEvent({ ...scope, eventType: "retired", previousMandateEventId: state.activation.mandateEventId,
      asOf: at(45), createdAt: at(45) });
    await state.mandates.appendEvent(retired);
    await state.events.append(event(state.plan, "rejected", state.lastEvent, 100));
    context.mock.timers.setTime(T + 120);
    const first = await publish(request(state, [], 110), options), before = await fs.readFile(state.records);
    const path = createInvestmentMandatePaths(state.baseDir).eventsPath, original = await fs.readFile(path);
    const earlier = createInvestmentMandateEvent({ ...scope, eventType: "retired", previousMandateEventId: state.activation.mandateEventId,
      asOf: at(30), createdAt: at(30) });
    await fs.writeFile(path, [state.activation, earlier].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    await assert.rejects(publish(request(state, [], 110), options), /investment mandate is required/);
    assert.deepEqual(await fs.readFile(state.records), before);
    await fs.writeFile(path, original);
    assert.deepEqual(await publish(request(state, [], 110), options), first);
  });
});

test("current sizing holds the mandate writer lock through destination append and exact retry", async (context) => {
  await fixture(context, "whole_buy", async (state) => {
    const original = fs.open; let checks = 0, inspect = true;
    const hook = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === state.records && ["a", "r+"].includes(String(args[1]))) {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => {
          await sync(); if (!inspect) return; inspect = false; checks++;
          await assert.rejects(state.mandates.appendRecord(state.mandate), /lock is unavailable/);
          await assert.rejects(state.mandates.appendEvent(state.activation), /lock is unavailable/);
        });
      }
      return handle;
    }); syncBuiltinESMExports();
    try { const first = await publish(request(state), options); inspect = true; assert.deepEqual(await publish(request(state), options), first); }
    finally { hook.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(checks, 2);
    await state.mandates.appendRecord(state.mandate); await state.mandates.appendEvent(state.activation);
  });
});

test("current sizing rejects backwards mandate observations and releases source leases after destination failure", async (context) => {
  for (const failure of ["clock", "destination"] as const) await fixture(context, "whole_sell", async (state) => {
    const path = createInvestmentMandatePaths(state.baseDir).recordsPath, original = fs.open;
    const hook = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (failure === "clock" && args[0] === path && args[1] === "r+") {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => { await sync(); context.mock.timers.setTime(T + 99); });
      }
      if (failure === "destination" && args[0] === state.records && args[1] === "a") {
        context.mock.method(handle, "sync", async () => { throw new Error("synthetic destination fsync failure"); });
      }
      return handle;
    }); syncBuiltinESMExports();
    try { await assert.rejects(publish(request(state), options), /observation clock moved backwards|synthetic destination fsync failure/); }
    finally { hook.mock.restore(); syncBuiltinESMExports(); context.mock.timers.setTime(T + 100); }
    await state.mandates.appendRecord(state.mandate); await state.mandates.appendEvent(state.activation);
    assert.deepEqual(await publish(request(state), options), await publish(request(state), options));
    assert.equal((await state.snapshots.readAll()).length, 1);
  });
});
