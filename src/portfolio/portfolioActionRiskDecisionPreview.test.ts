// Each file runs in its own Node test worker; keep top-level tests serial for global mocks.
import assert from "node:assert/strict";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import test from "node:test";
import { PaperFillExecutionFileRepository, createPaperFillExecutionPaths, resolvePersistedPaperFillExecutionOrigin } from "./paperFillExecutionFiles.js";
import { createPortfolioActionRiskDecisionPaths, PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { createPortfolioPolicyExecutionPreview, portfolioExecutionRuleParametersSchema } from "./portfolioPolicyExecutionPreview.js";
import { createPortfolioActionExecutionPreview, parsePortfolioActionExecutionPreview } from "./portfolioActionExecutionPreview.js";
import { createPortfolioPacketExecutionPreview } from "./portfolioPacketExecutionPreview.js";
import { createPortfolioPlanExecutionPreview } from "./portfolioPlanExecutionPreview.js";
import { WHOLE_SHARE_PAPER_EXECUTION_MODEL_VERSION } from "../paper/versionedExecutionModel.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import { createStoragePaths, FileMarketPacketStore } from "../storage/repositories.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { SourcePriceEvidenceFileRepository, createSourcePriceEvidencePaths, getDurableSourcePriceEvidenceObservation } from "./sourcePriceEvidenceFiles.js";
import { createRebalancePlanEvent, type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { createRebalancePlanEventPaths, RebalancePlanEventFileRepository, resolveDurableRebalancePlanEventObservation } from "./rebalancePlanEventFiles.js";
import {
  createBucketDrawdownSemanticsRecord, createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord, createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord, createSessionCalendarRecord, scheduleBoundaryRefFor,
  drawdownSemanticsRefFor, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage,
  riskRuleParameterRefFor, riskRuleSetRefFor, selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords
} from "./runtimePolicyContracts.js";
import { createImmutablePolicyDependencyPaths } from "./runtimePolicyDependencyFiles.js";
import { createRuntimePortfolioPolicyActivationPaths, RuntimePortfolioPolicyActivationFileRepository, readStoredRuntimePortfolioPolicyActivationSnapshot } from "./runtimePortfolioPolicyActivationFiles.js";
import { CREATED_AT, HASH, mandateTransition, planScope, planEvent, withPlanExecutionFixture, executionLiquidityPacket, packetExecutionInput, executionFixtureParameters, withPolicyExecutionFixture, policyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";


test("stored policy execution preview selects bucket and root legacy cost parameters before Risk persistence", async () => {
  await withPolicyExecutionFixture(async ({ input, fixture }) => {
    for (const side of ["BUY", "SELL"] as const) {
      const result = await createPortfolioPolicyExecutionPreview({ ...input, side });
      assert.equal(result.preview.input.executionPolicy.feeBps, 10);
      assert.equal(result.preview.execution.costBreakdown.feeKrw, 100);
      assert.equal(result.preview.execution.netAmountKrw, side === "BUY" ? 100_100 : 99_700);
      assert.equal(result.policyContext.riskRuleSetRef.hash, fixture.bucketSet.hash);
      assert.equal(result.policyContext.policyHash, input.expectedPolicyHash);
      assert.equal(result.policyContext.priceOrigin.evidenceRef, input.priceEvidenceRef);
      assert.deepEqual(parsePortfolioActionExecutionPreview(JSON.parse(JSON.stringify(result.preview))), result.preview);
      assert.equal(result.observationHash, hashCanonicalPayload({ preview: result.preview, policyContext: result.policyContext }));
      assert.ok(Object.isFrozen(result.policyContext.executionParameterRef));
      const restarted = await createPortfolioPolicyExecutionPreview({ ...input, side });
      assert.deepEqual(restarted.preview.execution, result.preview.execution);
      assert.deepEqual(restarted.policyContext.executionParameterRef, result.policyContext.executionParameterRef);
    }
    const legacy = await createPortfolioPolicyExecutionPreview({ ...input, side: "SELL", scope: { scopeKind: "legacy_reduce_only" } });
    assert.equal(legacy.preview.input.executionPolicy.feeBps, 20);
    assert.equal(legacy.preview.execution.netAmountKrw, 99_600);
    assert.equal(legacy.policyContext.riskRuleSetRef.hash, fixture.legacySet.hash);
    await assert.rejects(readFile(createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath), { code: "ENOENT" });
    await assert.rejects(readFile(createPaperFillExecutionPaths(input.baseDir).recordsPath), { code: "ENOENT" });
  });
});


test("stored policy execution preview rejects caller policy, price, timestamp and scope substitution", async () => {
  await withPolicyExecutionFixture(async ({ input }) => {
    for (const extra of [{ executionPolicy: {} }, { sourcePriceEvidence: {} }, { asOf: CREATED_AT }, { policies: [] }, { activationEvents: [] }]) {
      await assert.rejects(createPortfolioPolicyExecutionPreview({ ...input, ...extra }), /unrecognized_keys/);
    }
    await assert.rejects(createPortfolioPolicyExecutionPreview({ ...input, expectedPolicyHash: HASH }), /policy drift/);
    await assert.rejects(createPortfolioPolicyExecutionPreview({ ...input, portfolioId: "other" }), /active runtime portfolio policy/);
    await assert.rejects(createPortfolioPolicyExecutionPreview({ ...input, market: "US" }), /market is not enabled/);
    await assert.rejects(createPortfolioPolicyExecutionPreview({ ...input, symbol: "KR:000660" }), /price scope/);
    await assert.rejects(createPortfolioPolicyExecutionPreview({ ...input, priceEvidenceRef: "missing" }));
    await assert.rejects(createPortfolioPolicyExecutionPreview({ ...input, scope: { scopeKind: "legacy_reduce_only" } }), /SELL only/);
    const mutated = structuredClone(input);
    const pending = createPortfolioPolicyExecutionPreview(mutated);
    mutated.symbol = "KR:000660";
    mutated.volume = 0;
    const result = await pending;
    assert.equal(result.policyContext.symbol, input.symbol);
    assert.equal(result.preview.input.volume, 100);
  });
});


test("stored policy execution preview fails closed for missing, unsupported or wrong-side execution rules", async () => {
  const options = { bucket: executionFixtureParameters(10), legacy: executionFixtureParameters(20) };
  for (const fixture of [policyFixture(), policyFixture("v1", { ...options, ruleVersion: "v2" }),
    policyFixture("v1", { ...options, appliesTo: ["SELL"] })]) {
    await withPolicyExecutionFixture(async ({ input }) => {
      await assert.rejects(createPortfolioPolicyExecutionPreview(input), /paper_execution v1/);
    }, fixture);
  }
});


test("execution parameter schema rejects incomplete market policy and noncanonical source allowlists", () => {
  const valid = executionFixtureParameters(10);
  const market = valid.markets.KR!;
  for (const value of [
    { ...valid, unknown: true }, { ...valid, schemaVersion: "other" }, { ...valid, markets: {} },
    { ...valid, markets: { KR: { ...market, maximumPriceAgeSeconds: 0 } } },
    { ...valid, markets: { KR: { ...market, allowedPriceSourceContractIds: ["z", "a"] } } },
    { ...valid, markets: { KR: { ...market, allowedPriceSourceContractIds: ["a", "a"] } } },
    { ...valid, markets: { KR: { ...market, executionPolicy: { feeBps: 0 } } } }
  ]) assert.throws(() => portfolioExecutionRuleParametersSchema.parse(value));
});


test("stored policy execution preview enforces selected source contract, freshness and market settings", async () => {
  const standard = executionFixtureParameters(10);
  const market = standard.markets.KR!;
  for (const [parameters, pattern] of [
    [{ ...standard, markets: { KR: { ...market, allowedPriceSourceContractIds: ["different-source"] } } }, /price scope/],
    [{ ...standard, markets: { KR: { ...market, maximumPriceAgeSeconds: 1 } } }, /source price is stale/],
    [{ ...standard, markets: { US: market } }, /market parameters are missing/],
    [{ fixtureLimit: 1 }, /invalid|expected/i]
  ] as const) {
    await withPolicyExecutionFixture(async ({ input }) => {
      await assert.rejects(createPortfolioPolicyExecutionPreview(input), pattern);
    }, policyFixture("v1", { bucket: parameters, legacy: executionFixtureParameters(20) }));
  }
});


test("stored policy execution preview uses an inclusive age boundary and rejects a backwards observation clock", async (context) => {
  const now = Date.parse("2026-09-07T00:00:00.000Z");
  context.mock.timers.enable({ apis: ["Date"], now });
  const parameters = executionFixtureParameters(10);
  parameters.markets.KR!.maximumPriceAgeSeconds = 60;
  try {
    await withPolicyExecutionFixture(async ({ input }) => {
      assert.equal((await createPortfolioPolicyExecutionPreview(input)).preview.input.asOf, new Date(now).toISOString());
      context.mock.timers.setTime(now + 1);
      await assert.rejects(createPortfolioPolicyExecutionPreview(input), /source price is stale/);
      context.mock.timers.setTime(now - 1);
      await assert.rejects(createPortfolioPolicyExecutionPreview(input));
      context.mock.timers.setTime(now);
      await createPortfolioPolicyExecutionPreview(input);
    }, policyFixture("v1", { bucket: parameters, legacy: executionFixtureParameters(20) }));
  } finally { context.mock.timers.reset(); }
});


test("stored policy execution preview selects US settings without borrowing KR costs for legacy SELL", async () => {
  const legacy = executionFixtureParameters(20);
  legacy.markets.US = executionFixtureParameters(30).markets.KR!;
  await withPolicyExecutionFixture(async ({ input }) => {
    const price = createSourcePriceEvidenceRecord({ sourceContractId: "fixture-execution", market: "US", symbol: "US:AAPL",
      priceField: "last_price", priceKrw: 10_000, observedAt: new Date(Date.now() - 1000).toISOString(),
      sourceRefs: ["synthetic-us-fixture"], createdAt: new Date().toISOString() });
    await new SourcePriceEvidenceFileRepository(input.baseDir).append(price);
    const result = await createPortfolioPolicyExecutionPreview({ ...input, side: "SELL", scope: { scopeKind: "legacy_reduce_only" },
      market: "US", symbol: price.symbol, priceEvidenceRef: price.evidenceRef });
    assert.equal(result.preview.input.executionPolicy.feeBps, 30);
    assert.equal(result.preview.execution.netAmountKrw, 99_500);
    assert.equal(result.policyContext.market, "US");
  }, policyFixture("v1", { bucket: executionFixtureParameters(10), legacy }));
});


test("stored policy execution preview reloads retirement and rejects corrupt dependency or price history", async () => {
  await withPolicyExecutionFixture(async ({ input, fixture }) => {
    await createPortfolioPolicyExecutionPreview(input);
    await new RuntimePortfolioPolicyActivationFileRepository(input.baseDir, [fixture.policy], fixture.dependencies)
      .appendRetired({ portfolioId: fixture.policy.portfolioId, retiredActivationId: fixture.activation.activationId,
        reasonCode: "fixture", createdAt: CREATED_AT });
    await assert.rejects(createPortfolioPolicyExecutionPreview(input), /active runtime portfolio policy/);
  });
  for (const kind of ["parameter", "price"] as const) {
    await withPolicyExecutionFixture(async ({ input }) => {
      await createPortfolioPolicyExecutionPreview(input);
      const path = kind === "parameter" ? createImmutablePolicyDependencyPaths(input.baseDir).riskParameters
        : createSourcePriceEvidencePaths(input.baseDir).recordsPath;
      await writeFile(path, "{broken\n", "utf8");
      await assert.rejects(createPortfolioPolicyExecutionPreview(input));
    });
  }
});


test("packet execution preview derives partial BUY/SELL and legacy costs from the exact stored volume", async () => {
  await withPolicyExecutionFixture(async ({ input }) => {
    const packet = executionLiquidityPacket(input);
    const path = createStoragePaths(input.baseDir).marketPacketsPath;
    await new FileMarketPacketStore(path).append(packet);
    const request = packetExecutionInput(input, packet);
    for (const side of ["BUY", "SELL"] as const) {
      const result = await createPortfolioPacketExecutionPreview({ ...request, side });
      assert.equal(result.policyPreview.preview.input.volume, 50);
      assert.equal(result.policyPreview.preview.input.averageVolume, 100);
      assert.equal(result.policyPreview.preview.execution.quantity, 5);
      assert.equal(result.policyPreview.preview.execution.fillStatus, "partial");
      assert.equal(result.policyPreview.preview.execution.netAmountKrw, side === "BUY" ? 50_050 : 49_850);
      assert.equal(result.liquidityContext.packetHash, createMarketPacketHash(packet));
      assert.deepEqual(result.liquidityContext.sourceRefs, ["synthetic-liquidity"]);
      assert.equal(result.observationHash, hashCanonicalPayload({ policyPreview: result.policyPreview, liquidityContext: result.liquidityContext }));
      assert.ok(Object.isFrozen(result.liquidityContext.sourceRefs));
      const restarted = await createPortfolioPacketExecutionPreview({ ...request, side });
      assert.deepEqual(restarted.policyPreview.preview.execution, result.policyPreview.preview.execution);
    }
    const legacy = await createPortfolioPacketExecutionPreview({ ...request, side: "SELL", scope: { scopeKind: "legacy_reduce_only" } });
    assert.equal(legacy.policyPreview.preview.execution.netAmountKrw, 49_800);
    await assert.rejects(readFile(createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath), { code: "ENOENT" });
    await assert.rejects(readFile(createPaperFillExecutionPaths(input.baseDir).recordsPath), { code: "ENOENT" });
  });
});


test("packet execution preview rejects liquidity override, missing hashes and scope substitution", async () => {
  await withPolicyExecutionFixture(async ({ input }) => {
    const packet = executionLiquidityPacket(input);
    await new FileMarketPacketStore(createStoragePaths(input.baseDir).marketPacketsPath).append(packet);
    const request = packetExecutionInput(input, packet);
    for (const extra of [{ volume: 1000 }, { averageVolume: 1000 }, { liquidityStale: false }, { marketPacketHistory: [] }, { asOf: CREATED_AT }]) {
      await assert.rejects(createPortfolioPacketExecutionPreview({ ...request, ...extra }), /unrecognized_keys/);
    }
    await assert.rejects(createPortfolioPacketExecutionPreview({ ...request, liquidityPacketHash: HASH }), /resolve exactly once/);
    await assert.rejects(createPortfolioPacketExecutionPreview({ ...request, portfolioId: "other" }), /portfolio mismatch/);
    await assert.rejects(createPortfolioPacketExecutionPreview({ ...request, symbol: "KR:000660" }), /candidate must resolve exactly once/);
    const pending = createPortfolioPacketExecutionPreview(request);
    request.symbol = "mutated";
    assert.equal((await pending).liquidityContext.symbol, input.symbol);
  });
});


test("packet execution preview rejects corrupt, duplicate, reused-ID and ambiguous candidate history", async () => {
  await withPolicyExecutionFixture(async ({ input }) => {
    const packet = executionLiquidityPacket(input);
    const request = packetExecutionInput(input, packet);
    const path = createStoragePaths(input.baseDir).marketPacketsPath;
    await assert.rejects(createPortfolioPacketExecutionPreview(request), /resolve exactly once/);
    for (const raw of [
      JSON.stringify(packet), `${JSON.stringify(packet)}\n{broken\n`, `${JSON.stringify(packet)}\n\n`,
      `${JSON.stringify(packet)}\n${JSON.stringify(packet)}\n`,
      `${JSON.stringify(packet)}\n${JSON.stringify({ ...packet, expiresAt: new Date(Date.now() + 60_000).toISOString() })}\n`
    ]) {
      await writeFile(path, raw, "utf8");
      await assert.rejects(createPortfolioPacketExecutionPreview(request), /corrupt|resolve exactly once|ID was reused/);
    }
    const ambiguous = { ...packet, candidates: [packet.candidates[0]!, packet.candidates[0]!] };
    await writeFile(path, `${JSON.stringify(ambiguous)}\n`, "utf8");
    await assert.rejects(createPortfolioPacketExecutionPreview(packetExecutionInput(input, ambiguous)), /candidate must resolve exactly once/);
  });
});


test("packet execution preview distinguishes missing, zero and average-only liquidity", async () => {
  await withPolicyExecutionFixture(async ({ input }) => {
    const packet = executionLiquidityPacket(input);
    const path = createStoragePaths(input.baseDir).marketPacketsPath;
    const { volume: _volume, averageVolume: _average, ...candidate } = packet.candidates[0]!;
    for (const [candidateInput, expected] of [[candidate, "missing"], [{ ...candidate, volume: 0 }, "rejected"],
      [{ ...candidate, averageVolume: 50 }, "partial"], [{ ...candidate, volume: Number.MAX_SAFE_INTEGER + 1 }, "unsafe"]] as const) {
      const source = { ...packet, candidates: [candidateInput] };
      await writeFile(path, `${JSON.stringify(source)}\n`, "utf8");
      const pending = createPortfolioPacketExecutionPreview(packetExecutionInput(input, source));
      if (expected === "missing") await assert.rejects(pending, /no volume evidence/);
      else if (expected === "unsafe") await assert.rejects(pending, /supported range/);
      else assert.equal((await pending).policyPreview.preview.execution.fillStatus, expected);
    }
  });
});


test("packet execution preview rejects expired or future packet and candidate timestamps at the exact boundary", async (context) => {
  const now = Date.parse("2026-09-07T00:00:00.000Z");
  context.mock.timers.enable({ apis: ["Date"], now });
  try {
    await withPolicyExecutionFixture(async ({ input }) => {
      const packet = executionLiquidityPacket(input);
      const candidate = packet.candidates[0]!;
      const at = new Date(now).toISOString();
      const future = new Date(now + 1).toISOString();
      for (const source of [
        { ...packet, expiresAt: at }, { ...packet, generatedAt: future },
        { ...packet, candidates: [{ ...candidate, staleAfter: at }] },
        { ...packet, candidates: [{ ...candidate, collectedAt: future }] },
        { ...packet, candidates: [{ ...candidate, collectedAt: "2026-09-07T00:00:00" }] }
      ]) {
        await writeFile(createStoragePaths(input.baseDir).marketPacketsPath, `${JSON.stringify(source)}\n`, "utf8");
        await assert.rejects(createPortfolioPacketExecutionPreview(packetExecutionInput(input, source)));
      }
    });
  } finally { context.mock.timers.reset(); }
});


test("packet execution preview rechecks liquidity expiry after policy and price I/O", async (context) => {
  const now = Date.parse("2026-09-07T00:00:00.000Z");
  context.mock.timers.enable({ apis: ["Date"], now });
  try {
    await withPolicyExecutionFixture(async ({ input }) => {
      const packet = executionLiquidityPacket(input);
      packet.expiresAt = new Date(now + 1000).toISOString();
      await new FileMarketPacketStore(createStoragePaths(input.baseDir).marketPacketsPath).append(packet);
      const original = RuntimePortfolioPolicyActivationFileRepository.prototype.withDurableActivePolicy;
      const mock = context.mock.method(RuntimePortfolioPolicyActivationFileRepository.prototype, "withDurableActivePolicy",
        function (this: RuntimePortfolioPolicyActivationFileRepository, ...args: Parameters<typeof original>) {
          context.mock.timers.setTime(now + 1000);
          return original.apply(this, args);
        });
      try {
        await assert.rejects(createPortfolioPacketExecutionPreview(packetExecutionInput(input, packet)), /stale or temporally inconsistent/);
      } finally { mock.mock.restore(); }
    });
  } finally { context.mock.timers.reset(); }
});


test("plan execution preview derives BUY, SELL and legacy scope from stored action and mandate", async () => {
  for (const side of ["BUY", "SELL"] as const) for (const legacy of side === "SELL" ? [false, true] : [false]) {
    await withPlanExecutionFixture(async ({ request, input, plan, approval }) => {
      const before = await readFile(createRebalancePlanEventPaths(input.baseDir).eventsPath, "utf8");
      const result = await createPortfolioPlanExecutionPreview(request);
      const preview = result.packetPreview.policyPreview.preview;
      assert.equal(preview.input.side, side);
      assert.equal(preview.input.requestedNotionalKrw, side === "BUY" ? 100_000 : 3000);
      assert.equal(preview.input.quantityOverride, side === "BUY" ? null : 0.3);
      assert.equal(result.planContext.actionId, plan.actions[0]!.actionId);
      assert.equal(result.planContext.origin.predecessorEventHash, approval.planEventHash);
      assert.equal(result.planContext.mandate === null, legacy);
      assert.equal(result.packetPreview.policyPreview.policyContext.scope.scopeKind, legacy ? "legacy_reduce_only" : "bucket");
      assert.equal(result.observationHash, hashCanonicalPayload({ packetPreview: result.packetPreview, planContext: result.planContext }));
      assert.ok(Object.isFrozen(result.planContext));
      assert.deepEqual((await createPortfolioPlanExecutionPreview(request)).packetPreview.policyPreview.preview.execution, preview.execution);
      assert.equal(await readFile(createRebalancePlanEventPaths(input.baseDir).eventsPath, "utf8"), before);
      await assert.rejects(readFile(createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath), { code: "ENOENT" });
      await assert.rejects(readFile(createPaperFillExecutionPaths(input.baseDir).recordsPath), { code: "ENOENT" });
    }, { side, legacy });
  }
});


test("plan execution preview computes exact remaining fractional SELL quantity after stored partial fill", async () => {
  await withPlanExecutionFixture(async ({ request, input, plan, events, approval }) => {
    const partial = await events.append(createRebalancePlanEvent({ ...planScope(plan), asOf: new Date().toISOString(),
      eventType: "execution_applied", previousPlanEventId: approval.planEventId, actionId: "action-1", actionSequence: 0,
      fillSequence: 0, fillId: "synthetic-fill", paperFillRecordId: "synthetic-paper", paperFillHash: HASH, riskDecisionId: "synthetic-risk",
      requestedNotionalKrw: 1000, requestedQuantity: 0.1, filledNotionalKrw: 1000, filledQuantity: 0.1,
      cumulativeFilledNotionalKrw: 1000, cumulativeFilledQuantity: 0.1,
      expectedPrePortfolioVersion: "v1", expectedPrePortfolioSnapshotHash: HASH,
      resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: hashCanonicalPayload({ version: 2 }) }));
    await assert.rejects(createPortfolioPlanExecutionPreview(request), /predecessor drift/);
    const result = await createPortfolioPlanExecutionPreview({ ...request, expectedPlanEventHash: partial.planEventHash });
    assert.equal(result.packetPreview.policyPreview.preview.input.quantityOverride, 0.2);
    assert.equal(result.packetPreview.policyPreview.preview.input.requestedNotionalKrw, 2000);
    assert.equal(result.planContext.portfolioVersion, "v2");
    assert.equal(result.planContext.priorCumulativeFilledQuantity, 0.1);
    assert.equal(result.planContext.remainingNotionalCapKrw, 99_000);
    await assert.rejects(readFile(createPaperFillExecutionPaths(input.baseDir).recordsPath), { code: "ENOENT" });
  }, { side: "SELL" });
});


test("plan execution preview keeps whole-share targets and rejects caller scope or amount overrides", async () => {
  await withPlanExecutionFixture(async ({ request }) => {
    const preview = (await createPortfolioPlanExecutionPreview(request)).packetPreview.policyPreview.preview;
    assert.equal(preview.input.quantityOverride, 10);
    assert.equal(preview.execution.quantity, 5);
    assert.equal(preview.input.executionPolicy.modelVersion, WHOLE_SHARE_PAPER_EXECUTION_MODEL_VERSION);
    for (const extra of [{ requestedNotionalKrw: 1 }, { quantityOverride: 1 }, { side: "SELL" }, { scope: { scopeKind: "legacy_reduce_only" } },
      { market: "US" }, { actionId: "other" }, { asOf: CREATED_AT }, { portfolioVersion: "other" }, { executionPolicy: {} }]) {
      await assert.rejects(createPortfolioPlanExecutionPreview({ ...request, ...extra }));
    }
  }, { whole: true });
});


test("plan execution preview rejects terminal history, invalid source and share-mode mismatch", async () => {
  await withPlanExecutionFixture(async ({ request, events, plan, approval }) => {
    await assert.rejects(createPortfolioPlanExecutionPreview({ ...request, priceEvidenceRef: "missing" }), /does not resolve/);
    await assert.rejects(createPortfolioPlanExecutionPreview({ ...request, liquidityPacketHash: HASH }), /exactly once/);
    const rejected = await events.append(planEvent(plan, "rejected", approval));
    await assert.rejects(createPortfolioPlanExecutionPreview({ ...request, expectedPlanEventHash: rejected.planEventHash }), /approved unfinished/);
  });
  await withPlanExecutionFixture(async ({ request }) => {
    await assert.rejects(createPortfolioPlanExecutionPreview(request), /share mode differ/);
  }, { whole: true, fractionalPolicy: true });
});


test("plan execution preview rejects reduce-only or retired BUY mandates and source-price cap excess", async () => {
  await withPlanExecutionFixture(async ({ request, mandates, mandate, activation }) => {
    await mandates.appendEvent(mandateTransition(mandate!, "retired", activation!.mandateEventId));
    await assert.rejects(createPortfolioPlanExecutionPreview(request), /active investment mandate/);
  });
  await withPlanExecutionFixture(async ({ request }) => {
    await assert.rejects(createPortfolioPlanExecutionPreview(request), /open-or-increase/);
  }, { reduceOnly: true });
  await withPlanExecutionFixture(async ({ request, input }) => {
    const price = createSourcePriceEvidenceRecord({ sourceContractId: "fixture-execution", market: input.market, symbol: input.symbol,
      priceField: "last_price", priceKrw: 1_000_000, observedAt: new Date().toISOString(), createdAt: new Date().toISOString(), sourceRefs: ["synthetic"] });
    await new SourcePriceEvidenceFileRepository(input.baseDir).append(price);
    await assert.rejects(createPortfolioPlanExecutionPreview({ ...request, priceEvidenceRef: price.evidenceRef }), /remaining request exceeds/);
  }, { side: "SELL" });
});


test("plan execution preview detects plan or mandate changes during policy calculation", async (t) => {
  for (const change of ["plan", "mandate"] as const) {
    await withPlanExecutionFixture(async ({ request, plan, events, approval, mandate, mandates, activation }) => {
      const original = RuntimePortfolioPolicyActivationFileRepository.prototype.withDurableActivePolicy;
      t.mock.method(RuntimePortfolioPolicyActivationFileRepository.prototype, "withDurableActivePolicy", async function (
        this: RuntimePortfolioPolicyActivationFileRepository, ...args: Parameters<typeof original>
      ) {
        const result = await original.apply(this, args);
        if (change === "plan") await events.append(planEvent(plan, "rejected", approval));
        else await mandates.appendEvent(mandateTransition(mandate!, "retired", activation!.mandateEventId));
        return result;
      });
      try { await assert.rejects(createPortfolioPlanExecutionPreview(request), /changed during calculation/); }
      finally { t.mock.restoreAll(); }
    });
  }
});
