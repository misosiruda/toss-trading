import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { createPortfolioActionRiskDecisionPaths } from "./portfolioActionRiskDecisionFiles.js";

test("Risk and fill source contention stays bounded under frozen backwards and forward wall clocks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "risk-fill-lock-clocks-"));
  try {
    for (const kind of ["risk", "fill"] as const) {
      const path = (kind === "risk" ? createPortfolioActionRiskDecisionPaths : createPaperFillExecutionPaths)(directory).lockPath;
      await writeFile(path, "synthetic-abandoned\n");
      for (const mode of ["frozen", "backwards", "forward"]) {
        const script = `
          import assert from "node:assert/strict";
          import { PortfolioActionRiskDecisionFileRepository as Risk } from "./dist/portfolio/portfolioActionRiskDecisionFiles.js";
          import { PaperFillExecutionFileRepository as Fill } from "./dist/portfolio/paperFillExecutionFiles.js";
          const [baseDir, kind, mode] = process.argv.slice(1);
          const repository = new (kind === "risk" ? Risk : Fill)(baseDir, { lockTimeoutMs: 80, lockRetryDelayMs: 3 });
          let calls = 0;
          Date.now = () => mode === "frozen" ? 100 : mode === "backwards" ? 100 - (++calls * 1000) : 100 + (++calls * 1000);
          const started = performance.now();
          await assert.rejects(repository.withDurableVerifiedHistory(async () => assert.fail("abandoned lock acquired")), /lock is unavailable/);
          assert.ok(performance.now() - started >= 60, "wall clock jump must not end contention early");
          assert.ok(performance.now() - started < 4000, "contention must remain bounded");
        `;
        await new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, ["--input-type=module", "--eval", script, directory, kind, mode],
            { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"], windowsHide: true, timeout: 10_000 });
          let stderr = ""; child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk: string) => { stderr += chunk; });
          child.once("error", reject); child.once("close", (code, signal) => code === 0 ? resolve() : reject(new Error(stderr || `child exited ${code}/${signal}`)));
        });
        assert.equal(await readFile(path, "utf8"), "synthetic-abandoned\n");
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
