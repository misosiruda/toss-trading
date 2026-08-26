import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { publishOfficialMarketCalendarEntryAtomicNoReplace } from "./officialMarketCalendarWindowsAtomicNoReplacePublish.js";
import { createOfficialMarketCalendarWindowsPackageStagingSession } from "./officialMarketCalendarWindowsPackageStagingSession.js";

const ARTIFACT_HEX = "a".repeat(64);
const SOURCE_FILE_NAME = `${"b".repeat(64)}.bin`;

test(
  "Windows calendar package staging session retains every directory identity and cleans exact files",
  { skip: process.platform !== "win32" },
  async () => {
    const publicationRoot = await mkdtemp(
      join(tmpdir(), "calendar-package-staging-session-")
    );
    const packageNamespace = join(publicationRoot, "sha256");
    const stagingRoot = join(
      packageNamespace,
      `.calendar-package-${ARTIFACT_HEX}-00000000-0000-4000-8000-000000000001.staging`
    );
    const movedSources = join(stagingRoot, "moved-sources");
    try {
      await mkdir(packageNamespace);
      const session =
        await createOfficialMarketCalendarWindowsPackageStagingSession({
          publicationRoot,
          packageNamespace,
          stagingRoot
        });
      await writeFile(join(stagingRoot, "artifact.json"), "{}\n", {
        flag: "wx"
      });
      await writeFile(
        join(stagingRoot, "sources", "sha256", SOURCE_FILE_NAME),
        "source bytes\n",
        { flag: "wx" }
      );
      await assert.rejects(
        rename(join(stagingRoot, "sources"), movedSources),
        (error: unknown) =>
          isNodeError(error) && ["EBUSY", "EPERM"].includes(error.code ?? "")
      );

      assert.equal(await session.cleanup([SOURCE_FILE_NAME]), true);
      await assert.rejects(
        access(stagingRoot),
        (error: unknown) => isNodeError(error) && error.code === "ENOENT"
      );
      assert.deepEqual(await readdir(packageNamespace), []);
    } finally {
      await rm(publicationRoot, { recursive: true, force: true });
    }
  }
);

test(
  "Windows calendar package staging session releases only for publication completion",
  { skip: process.platform !== "win32" },
  async () => {
    const publicationRoot = await mkdtemp(
      join(tmpdir(), "calendar-package-staging-release-")
    );
    const packageNamespace = join(publicationRoot, "sha256");
    const stagingRoot = join(
      packageNamespace,
      `.calendar-package-${ARTIFACT_HEX}-00000000-0000-4000-8000-000000000002.staging`
    );
    const destinationRoot = join(packageNamespace, ARTIFACT_HEX);
    try {
      await mkdir(packageNamespace);
      const session =
        await createOfficialMarketCalendarWindowsPackageStagingSession({
          publicationRoot,
          packageNamespace,
          stagingRoot
      });
      assert.equal(await session.release(), true);
      await access(stagingRoot);
      await publishOfficialMarketCalendarEntryAtomicNoReplace({
        sourcePath: stagingRoot,
        destinationPath: destinationRoot,
        entryKind: "directory"
      });
      assert.equal(await session.complete(), true);
      await assert.rejects(
        access(stagingRoot),
        (error: unknown) => isNodeError(error) && error.code === "ENOENT"
      );
      await access(destinationRoot);
    } finally {
      await rm(publicationRoot, { recursive: true, force: true });
    }
  }
);

test(
  "Windows calendar package staging session rejects a substituted published directory",
  { skip: process.platform !== "win32" },
  async () => {
    const publicationRoot = await mkdtemp(
      join(tmpdir(), "calendar-package-staging-identity-")
    );
    const packageNamespace = join(publicationRoot, "sha256");
    const stagingRoot = join(
      packageNamespace,
      `.calendar-package-${ARTIFACT_HEX}-00000000-0000-4000-8000-000000000003.staging`
    );
    const displacedRoot = join(packageNamespace, "c".repeat(64));
    const substitutedRoot = join(packageNamespace, ARTIFACT_HEX);
    try {
      await mkdir(packageNamespace);
      const session =
        await createOfficialMarketCalendarWindowsPackageStagingSession({
          publicationRoot,
          packageNamespace,
          stagingRoot
        });
      assert.equal(await session.release(), true);
      await publishOfficialMarketCalendarEntryAtomicNoReplace({
        sourcePath: stagingRoot,
        destinationPath: displacedRoot,
        entryKind: "directory"
      });
      await mkdir(substitutedRoot);

      assert.equal(await session.complete(), false);
      await access(displacedRoot);
      await access(substitutedRoot);
    } finally {
      await rm(publicationRoot, { recursive: true, force: true });
    }
  }
);

test(
  "Windows calendar package staging session never cleans a moved staging identity",
  { skip: process.platform !== "win32" },
  async () => {
    const publicationRoot = await mkdtemp(
      join(tmpdir(), "calendar-package-staging-moved-cleanup-")
    );
    const packageNamespace = join(publicationRoot, "sha256");
    const stagingRoot = join(
      packageNamespace,
      `.calendar-package-${ARTIFACT_HEX}-00000000-0000-4000-8000-000000000004.staging`
    );
    const destinationRoot = join(packageNamespace, ARTIFACT_HEX);
    try {
      await mkdir(packageNamespace);
      const session =
        await createOfficialMarketCalendarWindowsPackageStagingSession({
          publicationRoot,
          packageNamespace,
          stagingRoot
        });
      assert.equal(await session.release(), true);
      await publishOfficialMarketCalendarEntryAtomicNoReplace({
        sourcePath: stagingRoot,
        destinationPath: destinationRoot,
        entryKind: "directory"
      });

      assert.equal(await session.cleanup([]), false);
      await access(destinationRoot);
    } finally {
      await rm(publicationRoot, { recursive: true, force: true });
    }
  }
);

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
