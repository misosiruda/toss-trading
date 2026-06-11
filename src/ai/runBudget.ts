export class InMemoryDailyRunBudget {
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

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}
