// Fixed, disposable binary copies only. Never changes the installed Node executable.
import { constants } from "node:fs";
import { appendFile, copyFile, lstat, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readExecutableFileForTest, EXECUTABLE_FILE_LIMIT } from "./runtimeExecutableExperimentFileReaderTestFixtures.js";
import type { RuntimeExecutableExperimentCaseId } from "./runtimeExecutableExperimentProtocolTestFixtures.js";

export class RuntimeExecutableExperimentPreparationError extends Error {
  constructor(readonly reason: "FIXTURE_PREPARATION_FAILED" | "BOOTSTRAP_LIMIT" | "BINARY_LIMIT") { super(reason); }
}
const MARKER = "\nC2C1_SYNTHETIC_TRAILING_BYTES\n";
const fail = () => new RuntimeExecutableExperimentPreparationError("FIXTURE_PREPARATION_FAILED");
async function bootstrapBytes(name: string): Promise<Buffer> {
  const path = fileURLToPath(new URL(name, import.meta.url));
  const first = await lstat(path);
  if (!first.isFile() || first.isSymbolicLink() || first.nlink !== 1) throw fail();
  if (first.size > 65536) throw new RuntimeExecutableExperimentPreparationError("BOOTSTRAP_LIMIT");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== first.dev || opened.ino !== first.ino) throw fail();
    const bytes = Buffer.alloc(65537);
    let count = 0;
    while (count < bytes.length) {
      const part = await handle.read(bytes, count, bytes.length - count, count);
      if (part.bytesRead === 0) break;
      count += part.bytesRead;
    }
    if (count > 65536) throw new RuntimeExecutableExperimentPreparationError("BOOTSTRAP_LIMIT");
    const after = await handle.stat(), current = await lstat(path);
    if (count !== first.size || after.size !== count || first.mtimeMs !== after.mtimeMs ||
      first.ctimeMs !== after.ctimeMs || current.dev !== opened.dev || current.ino !== opened.ino ||
      !current.isFile() || current.nlink !== 1 || current.size !== count ||
      current.mtimeMs !== after.mtimeMs || current.ctimeMs !== after.ctimeMs) throw fail();
    return bytes.subarray(0, count);
  } finally { await handle.close(); }
}
export async function prepareRuntimeExecutableExperimentFixture(caseId: RuntimeExecutableExperimentCaseId, root: string):
  Promise<string> {
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail();
    const names = ["runtimeExecutableExperimentTestChild.js", "runtimeExecutableExperimentFileReaderTestFixtures.js"];
    const sources = await Promise.all(names.map(bootstrapBytes));
    if (sources.reduce((sum, bytes) => sum + bytes.length, 0) > 65536) {
      throw new RuntimeExecutableExperimentPreparationError("BOOTSTRAP_LIMIT");
    }
    const original = await readExecutableFileForTest("/proc/self/exe");
    if (original.bytes + Buffer.byteLength(MARKER) > EXECUTABLE_FILE_LIMIT) {
      throw new RuntimeExecutableExperimentPreparationError("BINARY_LIMIT");
    }
    await copyFile("/proc/self/exe", join(root, "reference-node"), constants.COPYFILE_EXCL);
    const reference = await readExecutableFileForTest(join(root, "reference-node"));
    if (reference.digest !== original.digest || reference.bytes !== original.bytes) throw fail();
    await copyFile(join(root, "reference-node"), join(root, "node"), constants.COPYFILE_EXCL);
    if (caseId === "path_replaced") {
      await copyFile(join(root, "reference-node"), join(root, "replacement-node"), constants.COPYFILE_EXCL);
      await appendFile(join(root, "replacement-node"), MARKER);
    }
    if (caseId === "same_version_other_bytes") await appendFile(join(root, "node"), MARKER);
    for (let index = 0; index < names.length; index++) {
      await writeFile(join(root, names[index]!), sources[index]!, { flag: "wx", mode: 0o600 });
    }
    await writeFile(join(root, "package.json"), '{"type":"module"}\n', { flag: "wx", mode: 0o600 });
    return join(root, names[0]!);
  } catch (error) {
    if (error instanceof RuntimeExecutableExperimentPreparationError) throw error;
    throw fail();
  }
}
