// Each file runs in its own Node test worker; keep top-level tests serial for global mocks.
import assert from "node:assert/strict";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import test from "node:test";
import { createPaperFillExecutionRecord } from "./paperFillExecution.js";
import { PaperFillExecutionFileRepository, createPaperFillExecutionPaths, resolvePersistedPaperFillExecutionOrigin } from "./paperFillExecutionFiles.js";
import { validateRebalancePlanExecutionFillRiskBinding } from "./rebalancePlanExecutionFillRiskBinding.js";
import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { createPortfolioActionRiskDecisionPaths, PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { resolvePortfolioActionRiskDecisionPrice } from "./portfolioActionRiskDecisionPriceResolver.js";
import { validateRiskDecisionPriceState } from "./portfolioActionRiskDecisionPriceContext.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { SourcePriceEvidenceFileRepository, createSourcePriceEvidencePaths, getDurableSourcePriceEvidenceObservation } from "./sourcePriceEvidenceFiles.js";
import {
  createBucketDrawdownSemanticsRecord, createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord, createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord, createSessionCalendarRecord, scheduleBoundaryRefFor,
  drawdownSemanticsRefFor, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage,
  riskRuleParameterRefFor, riskRuleSetRefFor, selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords
} from "./runtimePolicyContracts.js";
import { CREATED_AT, DECIDED_AT, HASH, priceBoundFillInput, priceBoundFillEvent, pricePayload, withPriceFixture } from "./portfolioActionRiskDecisionTestFixtures.js";


test("price-bound Risk replays the durable typed quote for assigned BUY/SELL and legacy SELL", async () => {
  for (const [side, legacy] of [["BUY", false], ["SELL", false], ["SELL", true]] as const) {
    await withPriceFixture(side, legacy, async ({ directory, repository, candidate, price, prices }) => {
      const decision = await repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef);
      const input = { baseDir: directory, riskDecisionId: decision.riskDecisionId };
      const result = await resolvePortfolioActionRiskDecisionPrice(input);
      assert.deepEqual(result.sourcePrice.record, price);
      assert.equal(result.sourcePrice.record.priceKrw, 100);
      assert.equal(result.mandate === null, legacy);
      assert.ok(Object.isFrozen(result.priceOrigin.observation));
      assert.ok(Date.parse(result.sourcePrice.appendedAt) <= Date.parse(decision.decidedAt));
      assert.ok(Date.parse(result.priceOrigin.observation.observedAt) <= Date.parse(decision.decidedAt));
      const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
      const raw = await readFile(path, "utf8");
      assert.equal(JSON.parse(raw.split("\n")[0]!).schemaVersion, "portfolio_action_risk_decision_entry.v7");
      await prices.append(createSourcePriceEvidenceRecord({ ...pricePayload(candidate), sourceContractId: "fixture-price-next", priceKrw: 101 }));
      assert.deepEqual(await new PortfolioActionRiskDecisionFileRepository(directory).createAndAppendWithPriceOrigin(candidate, price.evidenceRef), decision);
      assert.deepEqual((await resolvePortfolioActionRiskDecisionPrice(input)).priceOrigin, result.priceOrigin);
      assert.equal(await readFile(path, "utf8"), raw);
    });
  }
});


test("price-bound Risk rejects missing, generic, unlisted or wrong-scope price inputs before persistence", async () => {
  await withPriceFixture("BUY", false, async ({ directory, repository, candidate, price, prices }) => {
    for (const ref of ["missing", "price-1"]) {
      await assert.rejects(repository.createAndAppendWithPriceOrigin(candidate, ref), /does not resolve exactly once/);
    }
    await assert.rejects(repository.createAndAppendWithPriceOrigin({ ...candidate, riskEvidenceRefs: ["other"] }, price.evidenceRef), /price source scope/);
    for (const scope of [{ symbol: "KR:000660" }, { market: "US" as const }]) {
      const wrong = createSourcePriceEvidenceRecord({ ...pricePayload(candidate), ...scope });
      await prices.append(wrong);
      await assert.rejects(repository.createAndAppendWithPriceOrigin({ ...candidate, riskEvidenceRefs: [...candidate.riskEvidenceRefs, wrong.evidenceRef] }, wrong.evidenceRef), /price source scope/);
    }
    // Even an old observedAt does not make a source durably available at an earlier decision time.
    const history = await prices.readVerifiedHistory();
    assert.throws(() => validateRiskDecisionPriceState(createPortfolioActionRiskDecision({ ...candidate, decidedAt: DECIDED_AT }), history, price.evidenceRef), /availability mismatch/);
    await writeFile(createSourcePriceEvidencePaths(directory).recordsPath, "");
    await assert.rejects(repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef), /does not resolve exactly once/);
    assert.equal((await repository.readAll()).length, 0);
  });
});


test("price-bound Risk retry cannot replace its selected price when both refs are in the same decision input", async () => {
  await withPriceFixture("BUY", false, async ({ directory, repository, candidate, price, prices }) => {
    const other = createSourcePriceEvidenceRecord({ ...pricePayload(candidate), sourceContractId: "fixture-price-other", priceKrw: 101 });
    await prices.append(other);
    const input = { ...candidate, riskEvidenceRefs: [...candidate.riskEvidenceRefs, other.evidenceRef] };
    const decision = await repository.createAndAppendWithPriceOrigin(input, price.evidenceRef);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const raw = await readFile(path, "utf8");
    await assert.rejects(repository.createAndAppendWithPriceOrigin(input, other.evidenceRef), /price origin cannot be added or replaced/);
    assert.equal(await readFile(path, "utf8"), raw);
    assert.deepEqual(await repository.createAndAppendWithPriceOrigin(input, price.evidenceRef), decision);
  });
});


test("price-bound Risk freezes input before awaiting sources and refuses caller-generated fields", async () => {
  await withPriceFixture("BUY", false, async ({ repository, candidate, price }) => {
    for (const key of ["decidedAt", "riskDecisionId", "riskDecisionHash", "riskInputHash"]) {
      await assert.rejects(repository.createAndAppendWithPriceOrigin({ ...candidate, [key]: undefined }, price.evidenceRef), /cannot accept a record or timestamp/);
    }
    const mutable = structuredClone(candidate);
    const pending = repository.createAndAppendWithPriceOrigin(mutable, price.evidenceRef);
    mutable.riskEvidenceRefs.splice(0);
    mutable.symbol = "other";
    const decision = await pending;
    assert.equal(decision.symbol, candidate.symbol);
    assert.ok(decision.riskEvidenceRefs.includes(price.evidenceRef));
  });
});


test("price provenance cannot upgrade prior Risk records or legacy price availability", async () => {
  await withPriceFixture("BUY", false, async ({ directory, repository, candidate, price }) => {
    const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const raw = await readFile(path, "utf8");
    assert.equal(resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), decision.riskDecisionId).priceOrigin, null);
    await assert.rejects(repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef), /price origin cannot be added/);
    await assert.rejects(resolvePortfolioActionRiskDecisionPrice({ baseDir: directory, riskDecisionId: decision.riskDecisionId }), /lacks price-before-creation/);
    assert.equal(await readFile(path, "utf8"), raw);
  });
  await withPriceFixture("SELL", true, async ({ directory, repository, candidate, price }) => {
    const legacy = { record: price, appendedAt: CREATED_AT, previousEntryHash: null };
    await writeFile(createSourcePriceEvidencePaths(directory).recordsPath, `${JSON.stringify({ ...legacy, entryHash: hashCanonicalPayload(legacy) })}\n`);
    await assert.rejects(repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef), /durable origin is unavailable/);
    assert.equal((await repository.readAll()).length, 0);
  });
});


test("price-bound Risk rejects lost or metadata-replaced source prefixes on retry and historical replay", async () => {
  await withPriceFixture("BUY", false, async ({ directory, repository, candidate, price }) => {
    const decision = await repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef);
    const input = { baseDir: directory, riskDecisionId: decision.riskDecisionId };
    const path = createSourcePriceEvidencePaths(directory).recordsPath;
    const source = await readFile(path, "utf8");
    const riskPath = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const riskBytes = await readFile(riskPath, "utf8");
    const [entry, marker] = source.trimEnd().split("\n").map((line) => JSON.parse(line));
    const { entryHash: _hash, ...payload } = { ...entry, appendStartedAt: new Date(Date.parse(entry.appendStartedAt) - 1).toISOString() };
    const entryHash = hashCanonicalPayload(payload);
    const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
    const changed = `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`;
    for (const bytes of ["", changed, `${source}{broken\n`]) {
      await writeFile(path, bytes);
      await assert.rejects(repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef));
      await assert.rejects(resolvePortfolioActionRiskDecisionPrice(input));
      assert.equal(await readFile(riskPath, "utf8"), riskBytes);
      assert.equal(await readFile(path, "utf8"), bytes);
    }
    await writeFile(path, source);
    assert.deepEqual(await repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef), decision);
  });
});


test("price receipts reject independently rehashed identity, prefix, time and schema mutations", async () => {
  await withPriceFixture("SELL", true, async ({ directory, repository, candidate, price }) => {
    const decision = await repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const [entry, marker] = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    const receipt = entry.priceOrigin;
    for (const [priceOrigin, error] of [
      [{ ...receipt, evidenceRef: "other" }, /corrupt line/],
      [{ ...receipt, evidenceHash: HASH }, /price origin does not match/],
      [{ ...receipt, observation: { ...receipt.observation, entriesHash: HASH } }, /source prefix/],
      [{ ...receipt, observation: { ...receipt.observation, recordCount: 0 } }, /source prefix/],
      [{ ...receipt, observation: { ...receipt.observation, observedAt: "2099-01-01T00:00:00.000Z" } }, /corrupt line/],
      [{ ...receipt, observation: { ...receipt.observation, observedAt: CREATED_AT } }, /observation/],
      [{ ...receipt, unexpected: true }, /corrupt line/],
      [null, /corrupt line/]
    ] as const) {
      const { entryHash: _hash, ...payload } = { ...entry, priceOrigin };
      const entryHash = hashCanonicalPayload(payload);
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
      const bytes = `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`;
      await writeFile(path, bytes);
      await assert.rejects(resolvePortfolioActionRiskDecisionPrice({ baseDir: directory, riskDecisionId: decision.riskDecisionId }), error);
      assert.equal(await readFile(path, "utf8"), bytes);
    }
  });
});


test("price-bound Risk fails closed on price fsync and retains the source lock through Risk commit", async (context) => {
  await withPriceFixture("BUY", false, async ({ directory, repository, candidate, price }) => {
    const prices = new SourcePriceEvidenceFileRepository(directory, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
    const extra = createSourcePriceEvidenceRecord({ ...pricePayload(candidate), sourceContractId: "fixture-price-next", priceKrw: 101 });
    const path = createSourcePriceEvidencePaths(directory).recordsPath;
    const source = await stat(path, { bigint: true });
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    const originalWrite = prototype.writeFile;
    await probe.close();
    let failSync = true;
    let commitProbed = false;
    const syncMock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat({ bigint: true });
      if (failSync && own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev)) throw new Error("injected price fsync failure");
      return originalSync.call(this);
    });
    const writeMock = context.mock.method(prototype, "writeFile", async function (this: FileHandle, ...args: Parameters<FileHandle["writeFile"]>) {
      if (typeof args[0] === "string" && args[0].includes('"schemaVersion":"portfolio_action_risk_decision_commit.v1"')) {
        await assert.rejects(prices.append(extra), /lock is unavailable/);
        commitProbed = true;
      }
      return originalWrite.apply(this, args);
    });
    try {
      await assert.rejects(repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef), /price fsync failure/);
      assert.equal((await repository.readAll()).length, 0);
      failSync = false;
      await repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef);
      assert.equal(commitProbed, true);
    } finally { writeMock.mock.restore(); syncMock.mock.restore(); }
    await prices.append(extra);
  });
});


test("v7 Risk selected price is preserved through BUY/SELL/legacy fill creation, retry and event binding", async () => {
  for (const [side, legacy] of [["BUY", false], ["SELL", false], ["SELL", true]] as const) {
    await withPriceFixture(side, legacy, async ({ directory, repository, candidate, price, prices, plan }) => {
      const requested = side === "BUY" ? 100 : 30;
      const creation = { ...candidate, requestedNotionalKrw: requested, worstCaseFillNotionalKrw: requested,
        approvedMaximumFillNotionalKrw: requested,
        cashAssessment: side === "BUY" ? { side, worstCaseNetCashDebitKrw: requested, approvedMaximumNetCashDebitKrw: requested }
          : { side, expectedMinimumNetCashCreditKrw: requested },
        turnoverAssessment: candidate.turnoverAssessment.scopeKind === "legacy_reduce_only" ? candidate.turnoverAssessment
          : { ...candidate.turnoverAssessment, requestedBucketTurnoverNotionalKrw: requested,
            resultingBucketTurnoverRatio: (candidate.turnoverAssessment.priorBucketTurnoverNotionalKrw + requested) / candidate.turnoverAssessment.turnoverWindowOpenPortfolioNetWorthKrw }
      };
      const decision = await repository.createAndAppendWithPriceOrigin(creation, price.evidenceRef);
      const riskDecisionHistory = await repository.readVerifiedHistory();
      const fills = new PaperFillExecutionFileRepository(directory);
      const input = priceBoundFillInput(creation, price);
      await new Promise((resolve) => setTimeout(resolve, 2));
      const fill = await fills.createAndAppendWithRiskOrigin(input, riskDecisionHistory, decision.riskDecisionId);
      const path = createPaperFillExecutionPaths(directory).recordsPath;
      const bytes = await readFile(path, "utf8");
      assert.deepEqual(await new PaperFillExecutionFileRepository(directory).createAndAppendWithRiskOrigin(input, riskDecisionHistory, decision.riskDecisionId), fill);
      assert.equal(await readFile(path, "utf8"), bytes);
      const paperFillHistory = await fills.readVerifiedHistory();
      const event = priceBoundFillEvent(plan, decision, fill, resolvePersistedPaperFillExecutionOrigin(paperFillHistory, fill.paperFillRecordId).appendedAt);
      const bound = validateRebalancePlanExecutionFillRiskBinding({ event, riskDecisionHistory, paperFillHistory,
        sourcePriceEvidenceHistory: await prices.readVerifiedHistory() });
      assert.deepEqual(bound.sourcePriceEvidence, price);
      assert.equal(await readFile(path, "utf8"), bytes);
    });
  }
});


test("v7 Risk fill creation rejects another listed price or altered selected hash without writes", async () => {
  await withPriceFixture("BUY", false, async ({ directory, repository, candidate, price, prices }) => {
    const other = createSourcePriceEvidenceRecord({ ...pricePayload(candidate), sourceContractId: "other-listed-price" });
    await prices.append(other);
    const decision = await repository.createAndAppendWithPriceOrigin({ ...candidate, riskEvidenceRefs: [...candidate.riskEvidenceRefs, other.evidenceRef] }, price.evidenceRef);
    const history = await repository.readVerifiedHistory();
    const fills = new PaperFillExecutionFileRepository(directory);
    const input = priceBoundFillInput(candidate, price);
    for (const bad of [priceBoundFillInput(candidate, other), { ...input, sourcePriceEvidence: { ...input.sourcePriceEvidence, evidenceHash: HASH } }]) {
      await assert.rejects(fills.createAndAppendWithRiskOrigin(bad, history, decision.riskDecisionId), /selected price origin/);
      assert.equal((await fills.readAll()).length, 0);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
    await fills.createAndAppendWithRiskOrigin(input, history, decision.riskDecisionId);
    const path = createPaperFillExecutionPaths(directory).recordsPath;
    const bytes = await readFile(path, "utf8");
    await assert.rejects(fills.createAndAppendWithRiskOrigin(priceBoundFillInput(candidate, other), history, decision.riskDecisionId), /selected price origin/);
    assert.equal(await readFile(path, "utf8"), bytes);
  });
});


test("v7 event binding rejects a fully rehashed fill that substitutes another listed stored quote", async () => {
  await withPriceFixture("BUY", false, async ({ directory, repository, candidate, price, prices, plan }) => {
    const other = createSourcePriceEvidenceRecord({ ...pricePayload(candidate), sourceContractId: "other-listed-price" });
    await prices.append(other);
    const decision = await repository.createAndAppendWithPriceOrigin({ ...candidate, riskEvidenceRefs: [...candidate.riskEvidenceRefs, other.evidenceRef] }, price.evidenceRef);
    const riskDecisionHistory = await repository.readVerifiedHistory();
    const fills = new PaperFillExecutionFileRepository(directory);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const original = await fills.createAndAppendWithRiskOrigin(priceBoundFillInput(candidate, price), riskDecisionHistory, decision.riskDecisionId);
    const path = createPaperFillExecutionPaths(directory).recordsPath;
    const [entry, marker] = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    const record = createPaperFillExecutionRecord({ ...priceBoundFillInput(candidate, other), asOf: original.asOf, createdAt: original.createdAt });
    const { entryHash: _hash, ...payload } = { ...entry, record };
    const entryHash = hashCanonicalPayload(payload);
    const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
    const bytes = `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`;
    await writeFile(path, bytes);
    const paperFillHistory = await new PaperFillExecutionFileRepository(directory).readVerifiedHistory();
    const event = priceBoundFillEvent(plan, decision, record, marker.committedAt);
    const sourcePriceEvidenceHistory = await prices.readVerifiedHistory();
    assert.throws(() => validateRebalancePlanExecutionFillRiskBinding({ event, riskDecisionHistory, paperFillHistory,
      sourcePriceEvidenceHistory }), /selected price origin/);
    assert.equal(await readFile(path, "utf8"), bytes);
  });
});
