import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syncOfficialMarketCalendarWindowsPublicationDirectoryChain } from "./officialMarketCalendarWindowsDirectorySync.js";

test(
  "Windows calendar directory sync flushes an exact bottom-up chain through the publication root",
  { skip: process.platform !== "win32" },
  async () => {
    const publicationRoot = await mkdtemp(
      join(tmpdir(), "캘린더-directory-sync-test-")
    );
    const packageRoot = join(publicationRoot, "package.staging");
    const sourcesRoot = join(packageRoot, "sources");
    const leafDirectory = join(sourcesRoot, "sha256");
    try {
      await mkdir(leafDirectory, { recursive: true });
      assert.equal(
        await syncOfficialMarketCalendarWindowsPublicationDirectoryChain({
          publicationRoot,
          leafDirectory,
          inclusiveAncestorDirectory: publicationRoot
        }),
        true
      );
      assert.equal(
        await syncOfficialMarketCalendarWindowsPublicationDirectoryChain({
          publicationRoot,
          leafDirectory: packageRoot,
          inclusiveAncestorDirectory: leafDirectory
        }),
        false
      );
      assert.equal(
        await syncOfficialMarketCalendarWindowsPublicationDirectoryChain({
          publicationRoot,
          leafDirectory: tmpdir(),
          inclusiveAncestorDirectory: tmpdir()
        }),
        false
      );
    } finally {
      await rm(publicationRoot, { recursive: true, force: true });
    }
  }
);
