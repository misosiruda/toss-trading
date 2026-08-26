import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createOfficialMarketCalendarWindowsPublicationRootLease } from "./officialMarketCalendarWindowsPublicationRootLease.js";

test(
  "Windows calendar publication root lease prevents root replacement until handoff",
  { skip: process.platform !== "win32" },
  async () => {
    const parent = await mkdtemp(
      join(tmpdir(), "calendar-publication-root-lease-")
    );
    const publicationRoot = join(parent, "publication");
    const movedRoot = join(parent, "moved-publication");
    try {
      await mkdir(publicationRoot);
      const lease =
        await createOfficialMarketCalendarWindowsPublicationRootLease(
          publicationRoot
        );
      await assert.rejects(
        rename(publicationRoot, movedRoot),
        (error: unknown) =>
          isNodeError(error) && ["EBUSY", "EPERM"].includes(error.code ?? "")
      );
      assert.equal(await lease.release(), true);
      await rename(publicationRoot, movedRoot);
      await access(movedRoot);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }
);

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
