// Trusted test bootstrap plus the fixed bounded-reader module; no application/provider imports.
import { open, readlink, rename, unlink, lstat } from "node:fs/promises";
import { join } from "node:path";
import { hashOpenedExecutableFileForTest, readExecutableFileForTest,
  type ExecutableFileSnapshot } from "./runtimeExecutableExperimentFileReaderTestFixtures.js";
import type { RuntimeExecutableExperimentWireReport } from "./runtimeExecutableExperimentProtocolTestFixtures.js";

const sample = (value: ExecutableFileSnapshot) => ({ digest: value.digest, bytes: value.bytes });
const sameFile = (a: ExecutableFileSnapshot, b: ExecutableFileSnapshot) => a.dev === b.dev && a.ino === b.ino;
async function main(): Promise<void> {
  const caseId = process.argv[2];
  if (caseId === "transport_invalid") { process.stdout.write("invalid\n"); return; }
  if (caseId === "transport_exit") { process.exitCode = 7; return; }
  if (caseId === "transport_stdout_limit") { process.stdout.write(Buffer.alloc(4097, 120)); return; }
  if (caseId === "transport_stderr_limit") { process.stderr.write(Buffer.alloc(4097, 120)); return; }
  if (process.version !== "v24.19.0" || process.platform !== "linux" || process.arch !== "x64" ||
    !["image_matches_path", "path_replaced", "path_unlinked", "same_version_other_bytes"].includes(caseId ?? "")) {
    process.exitCode = 8; return;
  }
  if (process.execPath !== join(process.cwd(), "node")) throw new Error("UNEXPECTED_EXECUTABLE");
  const reference = await readExecutableFileForTest(join(process.cwd(), "reference-node"));
  const held = await open("/proc/self/exe", "r");
  try {
    const before = await hashOpenedExecutableFileForTest(held);
    const initialPath = await readExecutableFileForTest(process.execPath);
    if (!sameFile(before, initialPath) || before.digest !== initialPath.digest) throw new Error("START_CHANGED");
    if (caseId === "path_replaced") await rename(join(process.cwd(), "replacement-node"), process.execPath);
    if (caseId === "path_unlinked") await unlink(process.execPath);
    const heldAfter = await hashOpenedExecutableFileForTest(held);
    const after = await readExecutableFileForTest("/proc/self/exe");
    let pathAfter: ExecutableFileSnapshot | null = null;
    if (caseId === "path_unlinked") {
      let absent = false;
      try { await lstat(process.execPath); }
      catch (error) { absent = (error as NodeJS.ErrnoException).code === "ENOENT"; }
      if (!absent) throw new Error("PATH_NOT_ABSENT");
    } else pathAfter = await readExecutableFileForTest(process.execPath);
    const report: RuntimeExecutableExperimentWireReport = {
      schemaVersion: "runtime_executable_experiment.v1",
      caseId: caseId as RuntimeExecutableExperimentWireReport["caseId"],
      runtime: "unavailable", dependencies: "unavailable", result: "unavailable", comparability: "unavailable",
      completeRuntime: false, completeConfiguration: false, completeInput: false,
      status: caseId === "image_matches_path" ? "observed" : "counterexample",
      evidence: "synthetic_fixture_observation", nodeVersion: "v24.19.0",
      reference: sample(reference), imageBefore: sample(before), imageAfter: sample(after),
      pathAfter: pathAfter === null ? null : sample(pathAfter),
      ownedFdMatchesImage: sameFile(heldAfter, after) && heldAfter.digest === after.digest && before.digest === after.digest,
      pathMatchesImage: pathAfter !== null && sameFile(pathAfter, after) && pathAfter.digest === after.digest,
      procLinkDeleted: (await readlink("/proc/self/exe")).endsWith(" (deleted)"),
      observation: caseId === "image_matches_path" ? "image_matches_path" :
        caseId === "path_replaced" ? "path_replacement_preserves_running_file" :
        caseId === "path_unlinked" ? "path_absence_preserves_running_file" : "version_label_does_not_identify_bytes",
    };
    // Close is part of success; an error must not leave a successful record on stdout.
    await held.close();
    process.stdout.write(JSON.stringify(report) + "\n");
  } catch (error) {
    try { await held.close(); } catch { /* failure is already terminal */ }
    throw error;
  }
}
void main().catch(() => { process.exitCode = 9; }); // No raw paths, environment, argv or errors leave the child.
