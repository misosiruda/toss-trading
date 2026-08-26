import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { pinOfficialMarketCalendarWindowsPackageFiles } from "./officialMarketCalendarWindowsPinnedFiles.js";
import type { OfficialMarketCalendarWindowsPinnedFiles } from "./officialMarketCalendarWindowsPinnedFiles.js";

const SOURCE_HEX = "b".repeat(64);

test(
  "Windows calendar package file pins block mutation and retain identity through directory publication",
  { skip: process.platform !== "win32" },
  async () => {
    const publicationRoot = await mkdtemp(
      join(tmpdir(), "calendar-package-pinned-files-")
    );
    const packageNamespace = join(publicationRoot, "sha256");
    const stagingRoot = join(packageNamespace, ".package.staging");
    const destinationRoot = join(packageNamespace, "a".repeat(64));
    const artifactPath = join(stagingRoot, "artifact.json");
    const sourcePath = join(
      stagingRoot,
      "sources",
      "sha256",
      `${SOURCE_HEX}.bin`
    );
    const artifactBytes = Buffer.from("{\"schemaVersion\":1}\n", "utf8");
    const sourceBytes = Buffer.from("source bytes\n", "utf8");
    let pinned: OfficialMarketCalendarWindowsPinnedFiles | undefined;
    let finalized = false;
    try {
      await mkdir(join(stagingRoot, "sources", "sha256"), {
        recursive: true
      });
      await writeFile(artifactPath, artifactBytes);
      await writeFile(sourcePath, sourceBytes);
      pinned = await pinOfficialMarketCalendarWindowsPackageFiles({
        stagingRoot,
        destinationRoot,
        files: [
          descriptor("artifact.json", artifactBytes),
          descriptor(`sources/sha256/${SOURCE_HEX}.bin`, sourceBytes)
        ]
      });

      const outcome = await pinned.publish();
      finalized = true;
      assert.equal(outcome, "published_verified");
      await access(join(destinationRoot, "artifact.json"));
      await access(
        join(destinationRoot, "sources", "sha256", `${SOURCE_HEX}.bin`)
      );
    } finally {
      if (pinned !== undefined && !finalized) {
        await pinned.release();
      }
      await rm(publicationRoot, { recursive: true, force: true });
    }
  }
);

test(
  "Windows calendar package file pins deny in-place content mutation before publication",
  { skip: process.platform !== "win32" },
  async () => {
    const publicationRoot = await mkdtemp(
      join(tmpdir(), "calendar-package-mutated-file-")
    );
    const packageNamespace = join(publicationRoot, "sha256");
    const stagingRoot = join(packageNamespace, ".package.staging");
    const destinationRoot = join(packageNamespace, "a".repeat(64));
    const artifactPath = join(stagingRoot, "artifact.json");
    const artifactBytes = Buffer.from("{\"schemaVersion\":1}\n", "utf8");
    let pinned: OfficialMarketCalendarWindowsPinnedFiles | undefined;
    let finalized = false;
    try {
      await mkdir(stagingRoot, { recursive: true });
      await writeFile(artifactPath, artifactBytes);
      pinned = await pinOfficialMarketCalendarWindowsPackageFiles({
        stagingRoot,
        destinationRoot,
        files: [descriptor("artifact.json", artifactBytes)]
      });

      await assert.rejects(
        writeFile(artifactPath, Buffer.from("{\"mutated\":true}\n", "utf8")),
        isSharingViolation
      );
      finalized = await pinned.release();
      assert.equal(finalized, true);
    } finally {
      if (pinned !== undefined && !finalized) {
        await pinned.release();
      }
      await rm(publicationRoot, { recursive: true, force: true });
    }
  }
);

test(
  "Windows calendar package file pins deny staged file substitution before publication",
  { skip: process.platform !== "win32" },
  async () => {
    const publicationRoot = await mkdtemp(
      join(tmpdir(), "calendar-package-substituted-file-")
    );
    const packageNamespace = join(publicationRoot, "sha256");
    const stagingRoot = join(packageNamespace, ".package.staging");
    const destinationRoot = join(packageNamespace, "a".repeat(64));
    const sourceDirectory = join(stagingRoot, "sources", "sha256");
    const sourcePath = join(sourceDirectory, `${SOURCE_HEX}.bin`);
    const displacedPath = join(sourceDirectory, `${"c".repeat(64)}.bin`);
    const artifactBytes = Buffer.from("{\"schemaVersion\":1}\n", "utf8");
    const sourceBytes = Buffer.from("source bytes\n", "utf8");
    let pinned: OfficialMarketCalendarWindowsPinnedFiles | undefined;
    let finalized = false;
    try {
      await mkdir(sourceDirectory, { recursive: true });
      await writeFile(join(stagingRoot, "artifact.json"), artifactBytes);
      await writeFile(sourcePath, sourceBytes);
      pinned = await pinOfficialMarketCalendarWindowsPackageFiles({
        stagingRoot,
        destinationRoot,
        files: [
          descriptor("artifact.json", artifactBytes),
          descriptor(`sources/sha256/${SOURCE_HEX}.bin`, sourceBytes)
        ]
      });

      await assert.rejects(rename(sourcePath, displacedPath), isSharingViolation);
      finalized = await pinned.release();
      assert.equal(finalized, true);
    } finally {
      if (pinned !== undefined && !finalized) {
        await pinned.release();
      }
      await rm(publicationRoot, { recursive: true, force: true });
    }
  }
);

function descriptor(relativePath: string, bytes: Uint8Array) {
  return {
    relativePath,
    contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    contentLength: bytes.byteLength
  };
}

function isSharingViolation(error: unknown): boolean {
  return isNodeError(error) && ["EBUSY", "EPERM"].includes(error.code ?? "");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
