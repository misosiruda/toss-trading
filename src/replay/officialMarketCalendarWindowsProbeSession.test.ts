import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createOfficialMarketCalendarWindowsProbeSession } from "./officialMarketCalendarWindowsProbeSession.js";

test(
  "Windows calendar probe session retains the created root identity until cleanup",
  { skip: process.platform !== "win32" },
  async () => {
    const publicationRoot = await mkdtemp(
      join(tmpdir(), "캘린더-probe-session-test-")
    );
    const movedRoot = join(publicationRoot, "unexpected-replacement");
    try {
      const session =
        await createOfficialMarketCalendarWindowsProbeSession({ publicationRoot });
      await access(session.probeRoot);
      await assert.rejects(
        rename(session.probeRoot, movedRoot),
        (error: unknown) =>
          isNodeError(error) && ["EBUSY", "EPERM"].includes(error.code ?? "")
      );
      assert.equal(await session.cleanup(), true);
      assert.equal(await session.cleanup(), true);
      await assert.rejects(
        access(session.probeRoot),
        (error: unknown) => isNodeError(error) && error.code === "ENOENT"
      );
    } finally {
      await rm(publicationRoot, { recursive: true, force: true });
    }
  }
);

test(
  "Windows calendar probe session rejects an intermediate sources junction",
  { skip: process.platform !== "win32" },
  async () => {
    const testRoot = await mkdtemp(join(tmpdir(), "calendar-session-nested-test-"));
    const publicationRoot = join(testRoot, "publication");
    const externalRoot = join(testRoot, "external");
    const externalHashRoot = join(externalRoot, "sha256");
    const externalSource = join(externalHashRoot, "source.bin");
    try {
      await mkdir(publicationRoot);
      await mkdir(externalHashRoot, { recursive: true });
      await writeFile(externalSource, "external source must survive\n", {
        flag: "wx"
      });
      const session =
        await createOfficialMarketCalendarWindowsProbeSession({ publicationRoot });
      const packageRoot = join(session.probeRoot, "fresh-directory.published");
      await mkdir(packageRoot);
      await symlink(externalRoot, join(packageRoot, "sources"), "junction");

      assert.equal(await session.cleanup(), false);
      assert.equal(
        await readFile(externalSource, "utf8"),
        "external source must survive\n"
      );
      await access(session.probeRoot);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  }
);

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
