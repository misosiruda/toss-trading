import assert from "node:assert/strict";
import test from "node:test";
import { runRuntimeExecutableExperiment } from "./runtimeExecutableExperimentHarnessTestFixtures.js";
import { readExecutableFileForTest } from "./runtimeExecutableExperimentFileReaderTestFixtures.js";
import { RUNTIME_EXECUTABLE_EXPERIMENT_CASE_IDS } from "./runtimeExecutableExperimentProtocolTestFixtures.js";
const supported = process.version === "v24.19.0" && process.platform === "linux" && process.arch === "x64";
test("actual Node24.19 Linux executable-file experiments keep all completeness unavailable",
  { skip: supported ? false : "Actual executable-file observations require Node v24.19.0 Linux x64" }, async (t) => {
    const installedBefore = await readExecutableFileForTest("/proc/self/exe");
    for (const caseId of RUNTIME_EXECUTABLE_EXPERIMENT_CASE_IDS) {
      await t.test(caseId, async () => {
        const value = await runRuntimeExecutableExperiment(caseId);
        assert.equal(value.termination, "confirmed");
        assert.equal(value.cleanup, "removed");
        const failures = {
          transport_invalid: "INVALID_REPORT", transport_exit: "EXIT_FAILURE",
          transport_stdout_limit: "STDOUT_LIMIT", transport_stderr_limit: "STDERR_LIMIT",
        } as const;
        if (caseId in failures) {
          assert.equal(value.status, "failed");
          if (value.status !== "failed") assert.fail("Expected an actual transport failure");
          assert.equal(value.reason, failures[caseId as keyof typeof failures]);
          assert.equal(value.report, null);
          return;
        }
        assert.equal(value.status, "collected");
        if (value.status !== "collected") assert.fail("Actual observation missing");
        const report = value.report;
        assert.equal(report.caseId, caseId);
        assert.equal(report.reference.digest, installedBefore.digest);
        assert.equal(report.reference.bytes, installedBefore.bytes);
        assert.equal(report.nodeVersion, process.version);
        assert.deepEqual(report.imageBefore, report.imageAfter);
        assert.equal(report.ownedFdMatchesImage, true);
        assert.equal(report.runtime, "unavailable"); assert.equal(report.dependencies, "unavailable");
        assert.equal(report.result, "unavailable"); assert.equal(report.comparability, "unavailable");
        assert.equal(report.completeRuntime, false); assert.equal(report.completeConfiguration, false);
        assert.equal(report.completeInput, false);
        if (caseId === "path_replaced") {
          assert.notEqual(report.pathAfter?.digest, report.imageAfter.digest);
          assert.equal(report.procLinkDeleted, true); assert.equal(report.pathMatchesImage, false);
        } else if (caseId === "path_unlinked") {
          assert.equal(report.pathAfter, null); assert.equal(report.procLinkDeleted, true);
        } else if (caseId === "same_version_other_bytes") {
          assert.notEqual(report.imageBefore.digest, installedBefore.digest);
          assert.equal(report.pathMatchesImage, true);
        } else assert.deepEqual(report.pathAfter, report.imageAfter);
      });
    }
    assert.deepEqual(await readExecutableFileForTest("/proc/self/exe"), installedBefore);
  });
