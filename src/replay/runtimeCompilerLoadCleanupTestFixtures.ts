// Test-only cleanup for the two-file compiler fixture, after the harness's identity check.
import { rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";

interface CleanupDependencies {
  unlink(path: string): Promise<void>;
  rmdir(path: string): Promise<void>;
}

export async function removeCompilerLoadFixtureForTest(
  root: string, deps: CleanupDependencies = { unlink, rmdir },
): Promise<void> {
  // A preparation failure may leave either known file absent. Never traverse an
  // unexpected entry: rmdir must fail if anything other than this inventory remains.
  for (const name of ["compiler.cjs", "bootstrap.mjs"]) {
    try { await deps.unlink(join(root, name)); }
    catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  await deps.rmdir(root);
}
