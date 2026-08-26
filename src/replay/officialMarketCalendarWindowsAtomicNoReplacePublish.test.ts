import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  OfficialMarketCalendarAtomicPublishError,
  publishOfficialMarketCalendarEntryAtomicNoReplace
} from "./officialMarketCalendarWindowsAtomicNoReplacePublish.js";

const windowsTest = process.platform === "win32" ? test : test.skip;

windowsTest("Windows calendar atomic publish moves a file with no replacement", async (t) => {
  const root = await temporaryRoot(t);
  const sourcePath = join(root, "artifact.staging");
  const destinationPath = join(root, "artifact.json");
  await writeFile(sourcePath, "verified artifact\n", { flag: "wx" });

  await publishOfficialMarketCalendarEntryAtomicNoReplace({
    sourcePath,
    destinationPath,
    entryKind: "file"
  });

  assert.equal(await readFile(destinationPath, "utf8"), "verified artifact\n");
  await assert.rejects(readFile(sourcePath), { code: "ENOENT" });
});

windowsTest("Windows calendar atomic publish preserves an existing file", async (t) => {
  const root = await temporaryRoot(t);
  const sourcePath = join(root, "record.staging");
  const destinationPath = join(root, "record.json");
  await writeFile(sourcePath, "new record\n", { flag: "wx" });
  await writeFile(destinationPath, "existing record\n", { flag: "wx" });

  await assert.rejects(
    publishOfficialMarketCalendarEntryAtomicNoReplace({
      sourcePath,
      destinationPath,
      entryKind: "file"
    }),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarAtomicPublishError &&
      error.code === "EEXIST" &&
      error.outcome === "confirmed_not_moved"
  );
  assert.equal(await readFile(destinationPath, "utf8"), "existing record\n");
  assert.equal(await readFile(sourcePath, "utf8"), "new record\n");
});

windowsTest("Windows calendar atomic publish moves a populated directory with no replacement", async (t) => {
  const root = await temporaryRoot(t);
  const sourcePath = join(root, "package.staging");
  const destinationPath = join(root, "package");
  await mkdir(sourcePath);
  await writeFile(join(sourcePath, "artifact.json"), "artifact\n", {
    flag: "wx"
  });

  await publishOfficialMarketCalendarEntryAtomicNoReplace({
    sourcePath,
    destinationPath,
    entryKind: "directory"
  });

  assert.equal(
    await readFile(join(destinationPath, "artifact.json"), "utf8"),
    "artifact\n"
  );
  await assert.rejects(readFile(join(sourcePath, "artifact.json")), {
    code: "ENOENT"
  });
});

windowsTest("Windows calendar atomic publish preserves an existing directory", async (t) => {
  const root = await temporaryRoot(t);
  const sourcePath = join(root, "package.staging");
  const destinationPath = join(root, "package");
  await mkdir(sourcePath);
  await mkdir(destinationPath);
  await writeFile(join(sourcePath, "source.txt"), "source\n", { flag: "wx" });
  await writeFile(join(destinationPath, "existing.txt"), "existing\n", {
    flag: "wx"
  });

  await assert.rejects(
    publishOfficialMarketCalendarEntryAtomicNoReplace({
      sourcePath,
      destinationPath,
      entryKind: "directory"
    }),
    { code: "EEXIST" }
  );
  assert.equal(
    await readFile(join(destinationPath, "existing.txt"), "utf8"),
    "existing\n"
  );
  assert.equal(
    await readFile(join(sourcePath, "source.txt"), "utf8"),
    "source\n"
  );
});

windowsTest("Windows calendar atomic publish rejects loose paths and source types", async (t) => {
  const firstRoot = await temporaryRoot(t);
  const secondRoot = await temporaryRoot(t);
  const sourcePath = join(firstRoot, "source.txt");
  await writeFile(sourcePath, "source\n", { flag: "wx" });

  await assert.rejects(
    publishOfficialMarketCalendarEntryAtomicNoReplace({
      sourcePath: "source.txt",
      destinationPath: join(firstRoot, "destination.txt"),
      entryKind: "file"
    }),
    /paths must be absolute/
  );
  await assert.rejects(
    publishOfficialMarketCalendarEntryAtomicNoReplace({
      sourcePath,
      destinationPath: join(secondRoot, "destination.txt"),
      entryKind: "file"
    }),
    /share one real parent/
  );
  await assert.rejects(
    publishOfficialMarketCalendarEntryAtomicNoReplace({
      sourcePath,
      destinationPath: join(firstRoot, "destination"),
      entryKind: "directory"
    }),
    /source must be a directory/
  );
});

async function temporaryRoot(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(
    join(tmpdir(), "calendar-windows-atomic-publish-test-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
