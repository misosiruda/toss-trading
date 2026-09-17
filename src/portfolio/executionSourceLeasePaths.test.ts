import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { RebalancePlanFileRepository, assertHeldRebalancePlanSource } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository, assertHeldRebalancePlanEventSource } from "./rebalancePlanEventFiles.js";
import { PortfolioActionRiskDecisionFileRepository, assertHeldPortfolioActionRiskDecisionSource } from "./portfolioActionRiskDecisionFiles.js";
import { PaperFillExecutionFileRepository, assertHeldPaperFillExecutionSource } from "./paperFillExecutionFiles.js";
import { SourcePriceEvidenceFileRepository, assertDurableSourcePriceEvidenceSource } from "./sourcePriceEvidenceFiles.js";
import { fixture } from "./storedManualOpeningCapacityTestFixtures.js";

interface Repository<H> {
  withDurableVerifiedHistory<T>(operation: (history: H) => Promise<T>): Promise<T>;
  readVerifiedHistory(): Promise<H>;
}
async function temporary(operation: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "execution-source-path-"));
  try { await operation(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
function sourceTests<H extends object>(label: string, make: (dir: string) => Repository<H>, check: (history: H, dir: string) => void) {
  test(`${label} lease rejects copied foreign expired and historical sources even for empty histories`, async () => {
    await temporary(async (dir) => {
      const repository = make(dir); let expired!: H;
      await repository.withDurableVerifiedHistory(async (history) => {
        expired = history; check(history, dir); check(history, join(dir, "unused", ".."));
        assert.throws(() => check({ ...history }, dir), /lease/);
        await make(join(dir, "foreign")).withDurableVerifiedHistory(async (foreign) => {
          assert.deepEqual(foreign, history);
          assert.throws(() => check(foreign, dir), /different source path/);
          assert.throws(() => check(history, join(dir, "foreign")), /different source path/);
        });
      });
      assert.throws(() => check(expired, dir), /lease/);
      const historical = await repository.readVerifiedHistory();
      assert.throws(() => check(historical, dir), /lease/);
      await repository.withDurableVerifiedHistory(async (history) => {
        check(history, dir); assert.throws(() => check(expired, dir), /lease/);
      });
    });
  });
  test(`${label} lease is revoked on consumer failure without losing the next lock acquisition`, async () => {
    await temporary(async (dir) => {
      const repository = make(dir); let failed!: H;
      await assert.rejects(repository.withDurableVerifiedHistory(async (history) => {
        failed = history; check(history, dir); throw new Error("consumer failure");
      }), /consumer failure/);
      assert.throws(() => check(failed, dir), /lease/);
      await repository.withDurableVerifiedHistory(async (history) => check(history, dir));
    });
  });
  test(`${label} repository anchors relative source paths at construction across cwd changes`, async () => {
    await temporary(async (dir) => {
      const prior = process.cwd(), repository = make(relative(prior, dir)), other = join(dir, "other");
      await mkdir(other);
      try {
        process.chdir(other);
        await repository.withDurableVerifiedHistory(async (history) => {
          check(history, dir); assert.throws(() => check(history, other), /different source path/);
        });
      } finally { process.chdir(prior); }
    });
  });
}

sourceTests("plan", (dir) => new RebalancePlanFileRepository(dir), assertHeldRebalancePlanSource);
sourceTests("plan event", (dir) => new RebalancePlanEventFileRepository(dir, new RebalancePlanFileRepository(dir)), assertHeldRebalancePlanEventSource);
sourceTests("Risk", (dir) => new PortfolioActionRiskDecisionFileRepository(dir), assertHeldPortfolioActionRiskDecisionSource);
sourceTests("paper fill", (dir) => new PaperFillExecutionFileRepository(dir), assertHeldPaperFillExecutionSource);
sourceTests("price evidence", (dir) => new SourcePriceEvidenceFileRepository(dir), assertDurableSourcePriceEvidenceSource);

test("plan event source assertion rejects a different injected plan repository even with identical empty bytes", async () => {
  await temporary(async (dir) => {
    const events = new RebalancePlanEventFileRepository(dir, new RebalancePlanFileRepository(join(dir, "foreign")));
    await events.withDurableVerifiedHistory(async (history) => {
      assert.deepEqual(history.events, []);
      assert.throws(() => assertHeldRebalancePlanEventSource(history, dir), /rebalance plan lease belongs to a different source path/);
    });
    await new RebalancePlanEventFileRepository(dir, new RebalancePlanFileRepository(dir)).withDurableVerifiedHistory(async (history) =>
      assertHeldRebalancePlanEventSource(history, dir));
  });
});

test("execution source path assertions accept actual populated plan Risk fill and price histories", async (context) => {
  await fixture(context, { count: 1 }, async ({ dir }) => {
    const plans = new RebalancePlanFileRepository(dir);
    await plans.withDurableVerifiedHistory(async (history) => { assertHeldRebalancePlanSource(history, dir); assert.equal(history.records.length, 1); });
    await new RebalancePlanEventFileRepository(dir, plans).withDurableVerifiedHistory(async (history) => {
      assertHeldRebalancePlanEventSource(history, dir); assert.equal(history.events.length, 3);
    });
    await new PortfolioActionRiskDecisionFileRepository(dir).withDurableVerifiedHistory(async (history) => {
      assertHeldPortfolioActionRiskDecisionSource(history, dir); assert.equal(history.records.length, 1);
    });
    await new PaperFillExecutionFileRepository(dir).withDurableVerifiedHistory(async (history) => {
      assertHeldPaperFillExecutionSource(history, dir); assert.equal(history.records.length, 1);
    });
    await new SourcePriceEvidenceFileRepository(dir).withDurableVerifiedHistory(async (history) => {
      assertDurableSourcePriceEvidenceSource(history, dir); assert.equal(history.records.length, 1);
    });
  });
});
