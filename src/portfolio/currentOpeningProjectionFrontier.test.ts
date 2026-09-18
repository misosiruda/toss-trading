import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { assertHeldCurrentOpeningProjectionFrontier as check } from "./currentOpeningProjectionFrontier.js";
import { RebalancePlanEventFileRepository, createRebalancePlanEventPaths } from "./rebalancePlanEventFiles.js";
import { RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { PaperFillExecutionFileRepository, createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { fixture, START, PORTFOLIO, at } from "./storedManualOpeningCapacityTestFixtures.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const options = { lockTimeoutMs: 90, lockRetryDelayMs: 3 };
type Sources = Parameters<typeof check>[1];
async function hold<T>(dir: string, operation: (sources: Sources) => Promise<T>) {
  return new RebalancePlanEventFileRepository(dir, new RebalancePlanFileRepository(dir, options), options).withDurableVerifiedHistory((planEvents) =>
    new PaperFillExecutionFileRepository(dir, options).withDurableVerifiedHistory((fills) =>
      new OpeningCapacityReservationEventFileRepository(dir, options).withDurableVerifiedHistory((events) => operation({ planEvents, fills, events }))));
}
const query = (baseDir: string, cutoff: number) => ({ baseDir, portfolioId: PORTFOLIO, asOf: at(cutoff) });

test("current frontier authenticates empty actual sources and rejects copied foreign expired scopes", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "current-frontier-")); let escaped!: Sources;
  try {
    await hold(dir, async (sources) => {
      escaped = sources; check(query(dir, 100), sources);
      assert.throws(() => check({ ...query(dir, 100), trusted: true } as never, sources));
      assert.throws(() => check({ ...query(dir, 100), asOf: "invalid" }, sources));
      assert.throws(() => check({ ...query(dir, 100), asOf: "9999-01-01T00:00:00.000Z" }, sources), /follows source observation/);
      await hold(join(dir, "foreign"), async (foreign) => {
        for (const key of Object.keys(sources) as (keyof Sources)[]) {
          assert.throws(() => check(query(dir, 100), { ...sources, [key]: { ...sources[key] } }), /lease|verified/);
          assert.throws(() => check(query(dir, 100), { ...sources, [key]: foreign[key] }), /different source path/);
        }
      });
    });
    await hold(dir, async (fresh) => {
      for (const key of Object.keys(fresh) as (keyof Sources)[]) assert.throws(() => check(query(dir, 100), { ...fresh, [key]: escaped[key] }), /lease|expired/);
    });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

for (const count of [0, 1, 3]) test(`current frontier accepts complete actual histories and ignores other portfolio scope fills=${count}`, async (context) => {
  await fixture(context, { count }, async ({ dir }) => {
    context.mock.timers.setTime(START + 200);
    await hold(dir, async (sources) => {
      check(query(dir, 170), sources);
      check({ ...query(dir, 1), portfolioId: "other-portfolio" }, sources);
      context.mock.timers.setTime(START + 199);
      assert.throws(() => check(query(dir, 170), sources), /clock moved backwards/);
      context.mock.timers.setTime(START + 200);
      check(query(dir, 170), sources);
    });
  });
});

for (const [cutoff, reason] of [[59, "plan commit"], [60, "plan commit"], [79, "plan event commit"], [80, "plan event commit"],
  [94, "capacity commit"], [95, "capacity commit"]] as const) {
  test(`current frontier rejects omitted or coincident ${reason} cutoff=${cutoff}`, async (context) => {
    await fixture(context, { count: cutoff > 80 ? 1 : 0 }, async ({ dir }) => {
      context.mock.timers.setTime(START + 200);
      await hold(dir, async (sources) => assert.throws(() => check(query(dir, cutoff), sources), new RegExp(reason)));
    });
  });
}

test("current frontier includes plans that have never acquired an event", async (context) => {
  await fixture(context, { count: 0 }, async ({ dir }) => {
    await fs.writeFile(createRebalancePlanEventPaths(dir).eventsPath, "");
    context.mock.timers.setTime(START + 200);
    await hold(dir, async (sources) => {
      assert.equal(sources.planEvents.events.length, 0);
      assert.throws(() => check(query(dir, 60), sources), /plan commit/);
      check(query(dir, 61), sources);
    });
  });
});

for (const cutoff of [84, 85]) test(`current frontier includes an orphan fill without an execution event cutoff=${cutoff}`, async (context) => {
  await fixture(context, { count: 1 }, async ({ dir }) => {
    // Restore valid predecessor prefixes, leaving the actual fill journal ahead of plan/capacity acknowledgement.
    for (const path of [createRebalancePlanEventPaths(dir).eventsPath, createOpeningCapacityReservationEventPaths(dir).eventsPath]) {
      const lines = (await fs.readFile(path, "utf8")).trimEnd().split("\n");
      await fs.writeFile(path, `${lines.slice(0, -2).join("\n")}\n`);
    }
    context.mock.timers.setTime(START + 200);
    await hold(dir, async (sources) => assert.throws(() => check(query(dir, cutoff), sources), /fill commit/));
  });
});

test("current frontier checks the durable fill completion timestamp independently of commit", async (context) => {
  context.mock.method(PaperFillExecutionFileRepository.prototype, "createAndAppendWithRiskOrigin",
    function (this: PaperFillExecutionFileRepository, ...args: Parameters<PaperFillExecutionFileRepository["createAndAppendWithRiskOrigin"]>) {
      return this.createAndAppendWithRiskCompletion(...args);
    });
  await fixture(context, { count: 1 }, async ({ dir }) => {
    for (const path of [createRebalancePlanEventPaths(dir).eventsPath, createOpeningCapacityReservationEventPaths(dir).eventsPath]) {
      const lines = (await fs.readFile(path, "utf8")).trimEnd().split("\n");
      await fs.writeFile(path, `${lines.slice(0, -2).join("\n")}\n`);
    }
    const path = createPaperFillExecutionPaths(dir).recordsPath, lines = (await fs.readFile(path, "utf8")).trimEnd().split("\n");
    const { completionHash: _hash, ...prior } = JSON.parse(lines.at(-1)!);
    assert.equal(prior.schemaVersion, "paper_fill_execution_completion.v1");
    const completion = { ...prior, completedAt: at(87) };
    lines[lines.length - 1] = JSON.stringify({ ...completion, completionHash: hashCanonicalPayload(completion) });
    await fs.writeFile(path, `${lines.join("\n")}\n`); context.mock.timers.setTime(START + 200);
    await hold(dir, async (sources) => {
      for (const cutoff of [86, 87]) assert.throws(() => check(query(dir, cutoff), sources), /fill completion/);
      check(query(dir, 88), sources);
    });
  });
});
