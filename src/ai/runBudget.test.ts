import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { InMemoryDailyRunBudget, InMemoryInstanceUtcDayRunBudget, InMemoryRunBudget } from "./runBudget.js";

const before = new Date("2026-10-29T23:59:59.999Z");
const after = new Date("2026-10-30T00:00:00.000Z");

test("instance UTC-day budget retains each day's usage across rollover and clock rollback", () => {
  const budget = new InMemoryInstanceUtcDayRunBudget(1);
  assert.equal(budget.scope, "instance_utc_day");
  budget.consume(before);
  assert.equal(budget.canConsume(new Date("2026-10-30T08:59:59.999+09:00")), false);
  assert.equal(budget.canConsume(after), true);
  budget.consume(after);
  assert.equal(budget.canConsume(before), false);
  assert.equal(budget.canConsume(after), false);
  assert.equal(budget.used(before), 1);
  assert.equal(budget.used(after), 1);
});

test("fresh instances and the legacy alias preserve independent local budgets", () => {
  assert.equal(InMemoryDailyRunBudget, InMemoryInstanceUtcDayRunBudget);
  const first = new InMemoryDailyRunBudget(1);
  first.consume(before);
  assert.equal(first.canConsume(before), false);
  assert.equal(new InMemoryInstanceUtcDayRunBudget(1).canConsume(before), true);
});

test("a run budget does not replenish at UTC rollover or on clock rollback", () => {
  const budget = new InMemoryRunBudget(2);
  assert.equal(budget.scope, "run");
  budget.consume(before);
  assert.equal(budget.canConsume(after), true);
  budget.consume(after);
  assert.equal(budget.used(before), 2);
  assert.equal(budget.canConsume(after), false);
  assert.equal(budget.canConsume(before), false);
  assert.equal(new InMemoryRunBudget(2).used(after), 0);
});

test("new processes start fresh local budgets without persistent quota", () => {
  const code = `import { InMemoryInstanceUtcDayRunBudget } from ${JSON.stringify(new URL("./runBudget.js", import.meta.url).href)};
    const budget = new InMemoryInstanceUtcDayRunBudget(1);
    const now = new Date("2026-10-30T00:00:00Z");
    const available = budget.canConsume(now); budget.consume(now);
    process.stdout.write(JSON.stringify([available, budget.canConsume(now)]));`;
  for (let run = 0; run < 2; run += 1) {
    const output = execFileSync(process.execPath, ["--input-type=module", "--eval", code], { encoding: "utf8", windowsHide: true });
    assert.deepEqual(JSON.parse(output), [true, false]);
  }
});
