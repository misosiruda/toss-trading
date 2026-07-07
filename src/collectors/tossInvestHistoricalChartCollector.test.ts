import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProcessRunOptions,
  ProcessRunResult,
  ProcessRunner
} from "../ai/processRunner.js";
import { collectTossInvestHistoricalChartSnapshots } from "./tossInvestHistoricalChartCollector.js";

class FakeRunner implements ProcessRunner {
  calls: Array<{
    command: string;
    args: readonly string[];
    options: ProcessRunOptions;
  }> = [];

  constructor(private readonly results: ProcessRunResult[]) {}

  async run(
    command: string,
    args: readonly string[],
    options: ProcessRunOptions
  ): Promise<ProcessRunResult> {
    this.calls.push({ command, args, options });
    return (
      this.results.shift() ?? {
        exitCode: 0,
        stdout: "{}",
        stderr: "",
        timedOut: false
      }
    );
  }
}

test("TossInvest chart collector converts quote.chart candles to historical snapshots", async () => {
  const runner = new FakeRunner([
    {
      exitCode: 0,
      stdout: JSON.stringify({
        symbol: "005930",
        interval: "60m",
        candles: [
          {
            time: "2026-06-18T14:00:00+09:00",
            open: 350_000,
            high: 357_000,
            low: 349_000,
            close: 353_250,
            volume: 1000
          },
          {
            time: "2026-06-18T15:00:00+09:00",
            open: 353_250,
            high: 354_500,
            low: 351_000,
            close: 353_500,
            volume: 2000
          }
        ]
      }),
      stderr: "",
      timedOut: false
    }
  ]);

  const result = await collectTossInvestHistoricalChartSnapshots({
    symbols: [
      {
        market: "KR",
        symbol: "005930",
        name: "Samsung Electronics",
        assetType: "STOCK",
        assetClass: "equity",
        region: "KR",
        strategyBucket: "swing",
        sector: "Technology"
      }
    ],
    interval: "60m",
    count: 2,
    config: {
      enabled: true,
      tossctlPath: "tossctl",
      timeoutMs: 10_000
    },
    runner,
    now: () => new Date("2026-06-18T15:10:00+09:00")
  });

  assert.equal(result.status, "completed");
  assert.equal(result.snapshotCount, 2);
  assert.deepEqual(runner.calls[0]?.args, [
    "quote",
    "chart",
    "005930",
    "--interval",
    "60m",
    "--count",
    "2",
    "--output",
    "json"
  ]);
  assert.equal(result.snapshots[0]?.interval, "1h");
  assert.equal(result.snapshots[0]?.name, "Samsung Electronics");
  assert.equal(result.snapshots[0]?.lastPriceKrw, 353_250);
  assert.equal(result.snapshots[0]?.assetType, "STOCK");
  assert.equal(result.snapshots[0]?.assetClass, "equity");
  assert.equal(result.snapshots[0]?.region, "KR");
  assert.equal(result.snapshots[0]?.strategyBucket, "swing");
  assert.equal(result.snapshots[0]?.sector, "Technology");
  assert.deepEqual(result.snapshots[0]?.sourceRefs, [
    "tossinvest_cli:quote.chart:005930:2026-06-18T05:00:00.000Z:0"
  ]);
});

test("TossInvest chart collector keeps disabled collector from executing", async () => {
  const runner = new FakeRunner([]);

  const result = await collectTossInvestHistoricalChartSnapshots({
    symbols: [{ market: "KR", symbol: "005930" }],
    interval: "60m",
    count: 2,
    config: {
      enabled: false,
      tossctlPath: "tossctl",
      timeoutMs: 10_000
    },
    runner
  });

  assert.equal(result.status, "completed_with_failures");
  assert.equal(result.snapshotCount, 0);
  assert.equal(result.symbolReports[0]?.status, "failed");
  assert.match(result.symbolReports[0]?.error ?? "", /COLLECTOR_DISABLED/);
  assert.equal(runner.calls.length, 0);
});
