export interface RunBudget {
  readonly scope: "instance_utc_day" | "run";
  canConsume(now: Date): boolean;
  consume(now: Date): void;
  used(now: Date): number;
}

/** Local to this object; a new provider/process starts with a fresh budget. */
export class InMemoryInstanceUtcDayRunBudget implements RunBudget {
  readonly scope = "instance_utc_day" as const;
  private usedByDay = new Map<string, number>();

  constructor(private readonly maxRunsPerDay: number) {}

  canConsume(now: Date): boolean {
    return (this.usedByDay.get(dayKey(now)) ?? 0) < this.maxRunsPerDay;
  }

  consume(now: Date): void {
    const key = dayKey(now);
    this.usedByDay.set(key, (this.usedByDay.get(key) ?? 0) + 1);
  }

  used(now: Date): number {
    return this.usedByDay.get(dayKey(now)) ?? 0;
  }
}

/** A single replay run owns this object. UTC rollover does not replenish it. */
export class InMemoryRunBudget implements RunBudget {
  readonly scope = "run" as const;
  private usedCalls = 0;

  constructor(private readonly maxCallsPerRun: number) {}

  canConsume(_now: Date): boolean { return this.usedCalls < this.maxCallsPerRun; }
  consume(_now: Date): void { this.usedCalls += 1; }
  used(_now: Date): number { return this.usedCalls; }
}

/** @deprecated Compatibility alias; this is not a shared daily quota. */
export { InMemoryInstanceUtcDayRunBudget as InMemoryDailyRunBudget };

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}
