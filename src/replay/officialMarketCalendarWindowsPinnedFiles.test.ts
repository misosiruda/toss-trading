import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";

import { writeOfficialMarketCalendarWindowsHelperInput } from "./officialMarketCalendarWindowsChildInput.js";
import {
  pinOfficialMarketCalendarWindowsPackageFiles
} from "./officialMarketCalendarWindowsPinnedFiles.js";
import type { OfficialMarketCalendarWindowsPinnedFiles } from "./officialMarketCalendarWindowsPinnedFiles.js";

const SOURCE_HEX = "b".repeat(64);

test("Windows calendar package helper input fails closed on broken pipes", async () => {
  const writeFailure = new Writable({
    write(_chunk, _encoding, callback) {
      callback(Object.assign(new Error("broken pipe"), { code: "EPIPE" }));
    }
  });
  writeFailure.on("error", () => undefined);
  assert.equal(
    await writeOfficialMarketCalendarWindowsHelperInput(
      writeFailure,
      "PUBLISH\n"
    ),
    false
  );

  const endFailure = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
    final(callback) {
      callback(Object.assign(new Error("broken pipe"), { code: "EPIPE" }));
    }
  });
  endFailure.on("error", () => undefined);
  assert.equal(
    await writeOfficialMarketCalendarWindowsHelperInput(
      endFailure,
      "COMPLETE\n",
      true
    ),
    false
  );
});

test(
  "Windows calendar package file pins block planned mutation and reject final tree additions",
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
      assert.equal(outcome, "published_verified");
      await access(join(destinationRoot, "artifact.json"));
      await access(
        join(destinationRoot, "sources", "sha256", `${SOURCE_HEX}.bin`)
      );
      await assert.rejects(
        rename(
          join(destinationRoot, "artifact.json"),
          join(destinationRoot, "artifact.displaced.json")
        ),
        isSharingViolation
      );
      await writeFile(
        join(destinationRoot, "unplanned.txt"),
        "unplanned\n"
      );
      finalized = await pinned.release();
      assert.equal(finalized, false);
    } finally {
      if (pinned !== undefined && !finalized) {
        await pinned.release();
      }
      await rm(publicationRoot, { recursive: true, force: true });
    }
  }
);

test(
  "Windows calendar package file publication excludes unplanned staging entries",
  { skip: process.platform !== "win32" },
  async () => {
    const publicationRoot = await mkdtemp(
      join(tmpdir(), "calendar-package-unplanned-entry-")
    );
    const packageNamespace = join(publicationRoot, "sha256");
    const stagingRoot = join(packageNamespace, ".package.staging");
    const destinationRoot = join(packageNamespace, "a".repeat(64));
    const artifactBytes = Buffer.from("{\"schemaVersion\":1}\n", "utf8");
    let pinned: OfficialMarketCalendarWindowsPinnedFiles | undefined;
    let finalized = false;
    try {
      await mkdir(join(stagingRoot, "sources", "sha256"), {
        recursive: true
      });
      await writeFile(join(stagingRoot, "artifact.json"), artifactBytes);
      await writeFile(join(stagingRoot, "unplanned.txt"), "unplanned\n");
      pinned = await pinOfficialMarketCalendarWindowsPackageFiles({
        stagingRoot,
        destinationRoot,
        files: [descriptor("artifact.json", artifactBytes)]
      });

      const outcome = await pinned.publish();
      assert.equal(outcome, "published_verified");
      assert.deepEqual(await readdir(destinationRoot), [
        "artifact.json",
        "sources"
      ]);
      assert.equal(
        await readFile(join(stagingRoot, "unplanned.txt"), "utf8"),
        "unplanned\n"
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
  "Windows calendar package file publication quarantines and recovers a partial destination",
  { skip: process.platform !== "win32" },
  async () => {
    const publicationRoot = await mkdtemp(
      join(tmpdir(), "calendar-package-partial-destination-")
    );
    const packageNamespace = join(publicationRoot, "sha256");
    const stagingRoot = join(packageNamespace, ".package.staging");
    const destinationName = "a".repeat(64);
    const destinationRoot = join(packageNamespace, destinationName);
    const artifactBytes = Buffer.from("{\"schemaVersion\":1}\n", "utf8");
    let pinned: OfficialMarketCalendarWindowsPinnedFiles | undefined;
    let finalized = false;
    try {
      await mkdir(stagingRoot, { recursive: true });
      await writeFile(join(stagingRoot, "artifact.json"), artifactBytes);
      await mkdir(destinationRoot);
      await writeFile(join(destinationRoot, "artifact.json"), "partial\n");
      pinned = await pinOfficialMarketCalendarWindowsPackageFiles({
        stagingRoot,
        destinationRoot,
        files: [descriptor("artifact.json", artifactBytes)]
      });

      const outcome = await pinned.publish();
      assert.equal(outcome, "published_verified");
      assert.deepEqual(
        await readFile(join(destinationRoot, "artifact.json")),
        artifactBytes
      );
      const quarantineName = (await readdir(packageNamespace)).find((entry) =>
        entry.startsWith(`${destinationName}.quarantine-`)
      );
      assert.notEqual(quarantineName, undefined);
      assert.equal(
        await readFile(
          join(packageNamespace, quarantineName!, "artifact.json"),
          "utf8"
        ),
        "partial\n"
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
  "Windows calendar package file pins publish retained identity after staged path substitution",
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

      await rename(sourcePath, displacedPath);
      await writeFile(sourcePath, Buffer.from("substituted\n", "utf8"));
      const outcome = await pinned.publish();
      assert.equal(outcome, "published_verified");
      assert.deepEqual(
        await readFile(
          join(destinationRoot, "sources", "sha256", `${SOURCE_HEX}.bin`)
        ),
        sourceBytes
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
