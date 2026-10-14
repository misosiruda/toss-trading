import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPILER_ARTIFACT_A, COMPILER_ARTIFACT_A_BYTES, COMPILER_ARTIFACT_LIMIT,
  type CompilerLoadCaseId } from "./runtimeCompilerLoadProtocolTestFixtures.js";

export class CompilerLoadPreparationError extends Error {
  constructor(readonly reason: "FIXTURE_PREPARATION_FAILED" | "BOOTSTRAP_LIMIT") { super(reason); }
}
/** Trusted test seam for stable reads; it never executes the file or accepts a public path. */
export async function readCompilerLoadFileForTest(path: string, limit: number, afterOpen?: () => Promise<void>): Promise<string> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > COMPILER_ARTIFACT_LIMIT) throw new Error("FILE_LIMIT");
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error("FILE_UNSAFE");
  if (before.size > limit) throw new Error("FILE_LIMIT");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    const same = (s: typeof before): boolean => s.isFile() && !s.isSymbolicLink() && s.nlink === 1 &&
      s.dev === before.dev && s.ino === before.ino && s.size === before.size &&
      s.mtimeMs === before.mtimeMs && s.ctimeMs === before.ctimeMs;
    if (!same(opened)) throw new Error("FILE_CHANGED");
    await afterOpen?.();
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const part = await handle.read(buffer, size, buffer.length - size, size);
      if (part.bytesRead === 0) break;
      size += part.bytesRead;
    }
    if (size > limit) throw new Error("FILE_LIMIT");
    if (!same(await handle.stat()) || !same(await lstat(path)) || size !== before.size) throw new Error("FILE_CHANGED");
    const bytes = buffer.subarray(0, size);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!Buffer.from(text).equals(bytes)) throw new Error("FILE_UTF8");
    return text;
  } finally { await handle.close(); }
}
/** Only the harness-created empty root and a fixed case reach this function. */
export async function prepareCompilerLoadFixture(_caseId: CompilerLoadCaseId, root: string): Promise<string> {
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("ROOT_UNSAFE");
    const artifact = await readCompilerLoadFileForTest(fileURLToPath(new URL("../../node_modules/typescript/lib/typescript.js", import.meta.url)), COMPILER_ARTIFACT_LIMIT);
    if (Buffer.byteLength(artifact) !== COMPILER_ARTIFACT_A_BYTES ||
      "sha256:" + createHash("sha256").update(artifact).digest("hex") !== COMPILER_ARTIFACT_A) throw new Error("ARTIFACT_MISMATCH");
    let bootstrap: string;
    try { bootstrap = await readCompilerLoadFileForTest(fileURLToPath(new URL("./runtimeCompilerLoadTestChild.js", import.meta.url)), 65536); }
    catch (error) {
      if (error instanceof Error && error.message === "FILE_LIMIT") throw new CompilerLoadPreparationError("BOOTSTRAP_LIMIT");
      throw error;
    }
    await writeFile(join(root, "compiler.cjs"), artifact, { flag: "wx", mode: 0o600 });
    const child = join(root, "bootstrap.mjs");
    await writeFile(child, bootstrap, { flag: "wx", mode: 0o600 });
    return child;
  } catch (error) {
    if (error instanceof CompilerLoadPreparationError) throw error;
    throw new CompilerLoadPreparationError("FIXTURE_PREPARATION_FAILED");
  }
}
