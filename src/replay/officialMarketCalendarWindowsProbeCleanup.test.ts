import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cleanupOfficialMarketCalendarWindowsPublicationProbe } from "./officialMarketCalendarWindowsProbeCleanup.js";

test(
  "Windows calendar probe cleanup rejects a junction without deleting its target",
  { skip: process.platform !== "win32" },
  async () => {
    const testRoot = await mkdtemp(join(tmpdir(), "calendar-cleanup-test-"));
    const publicationRoot = join(testRoot, "publication");
    const externalRoot = join(testRoot, "external");
    const probeRoot = join(
      publicationRoot,
      ".calendar-publication-preflight-junction"
    );
    const externalArtifact = join(externalRoot, "artifact.json");
    try {
      await mkdir(probeRoot, { recursive: true });
      await mkdir(externalRoot);
      await writeFile(externalArtifact, "external must survive\n", {
        flag: "wx"
      });
      await symlink(
        externalRoot,
        join(probeRoot, "fresh-directory.published"),
        "junction"
      );

      assert.equal(
        await cleanupOfficialMarketCalendarWindowsPublicationProbe({
          publicationRoot,
          probeRoot
        }),
        false
      );
      assert.equal(
        await readFile(externalArtifact, "utf8"),
        "external must survive\n"
      );
      await access(probeRoot);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  }
);

test(
  "Windows calendar probe cleanup rejects an intermediate sources junction",
  { skip: process.platform !== "win32" },
  async () => {
    const testRoot = await mkdtemp(join(tmpdir(), "calendar-cleanup-nested-test-"));
    const publicationRoot = join(testRoot, "publication");
    const externalRoot = join(testRoot, "external");
    const externalHashRoot = join(externalRoot, "sha256");
    const probeRoot = join(
      publicationRoot,
      ".calendar-publication-preflight-nested-junction"
    );
    const packageRoot = join(probeRoot, "fresh-directory.published");
    const externalSource = join(externalHashRoot, "source.bin");
    try {
      await mkdir(packageRoot, { recursive: true });
      await mkdir(externalHashRoot, { recursive: true });
      await writeFile(externalSource, "external source must survive\n", {
        flag: "wx"
      });
      await symlink(externalRoot, join(packageRoot, "sources"), "junction");

      assert.equal(
        await cleanupOfficialMarketCalendarWindowsPublicationProbe({
          publicationRoot,
          probeRoot
        }),
        false
      );
      assert.equal(
        await readFile(externalSource, "utf8"),
        "external source must survive\n"
      );
      await access(probeRoot);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  }
);
