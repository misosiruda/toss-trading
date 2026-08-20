import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertOfficialMarketCalendarPublicationFilesystemSupported,
  createOfficialMarketCalendarPublicationFilesystemPreflightHash,
  inspectOfficialMarketCalendarPublicationFilesystem,
  parseOfficialMarketCalendarPublicationFilesystemPreflight
} from "./officialMarketCalendarPublicationFilesystemPreflight.js";

test("calendar publication filesystem preflight keeps Node directory publish disabled", async () => {
  const publicationRoot = await mkdtemp(join(tmpdir(), "calendar-publication-preflight-test-"));
  try {
    const preflight = await inspectOfficialMarketCalendarPublicationFilesystem({
      publicationRoot
    });

    assert.equal(preflight.status, "unsupported");
    assert.equal(preflight.capabilities.exclusiveStagingFileCreate, false);
    assert.equal(preflight.capabilities.fileDurabilitySync, false);
    assert.equal(preflight.capabilities.atomicNoReplaceFilePublish, false);
    assert.equal(preflight.capabilities.atomicNoReplaceDirectoryPublish, false);
    assert.equal(
      preflight.observations.existingFileExclusiveCreate,
      "not_probed_safe_cleanup_unavailable"
    );
    assert.equal(
      preflight.observations.fileSync,
      "not_probed_safe_cleanup_unavailable"
    );
    assert.equal(
      preflight.observations.freshFileHardLink,
      "not_probed_safe_cleanup_unavailable"
    );
    assert.equal(
      preflight.observations.existingFileHardLink,
      "not_probed_safe_cleanup_unavailable"
    );
    assert.equal(
      preflight.observations.existingDirectoryRename,
      "not_probed_safe_cleanup_unavailable"
    );
    assert.deepEqual(await readdir(publicationRoot), []);
    assert.equal(Object.isFrozen(preflight.capabilities), true);
    assert.equal(Object.isFrozen(preflight.observations), true);
    assert.equal(Object.isFrozen(preflight.blockers), true);
    assert.ok(
      preflight.blockers.includes(
        "atomic_no_replace_directory_publish_unavailable"
      )
    );
    assert.ok(
      preflight.blockers.includes("safe_mutation_probe_cleanup_unavailable")
    );
    assert.deepEqual(
      parseOfficialMarketCalendarPublicationFilesystemPreflight(preflight),
      preflight
    );
    assert.throws(
      () => assertOfficialMarketCalendarPublicationFilesystemSupported(preflight),
      /filesystem is unsupported/
    );
  } finally {
    await rm(publicationRoot, { recursive: true });
  }
});

test("calendar publication filesystem preflight rejects tamper", async () => {
  const preflight = await inspectOfficialMarketCalendarPublicationFilesystem({
    publicationRoot: tmpdir()
  });

  assert.throws(
    () =>
      parseOfficialMarketCalendarPublicationFilesystemPreflight({
        ...preflight,
        preflightHash: `sha256:${"f".repeat(64)}`
      }),
    /preflight hash mismatch/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarPublicationFilesystemPreflight({
        ...preflight,
        blockers: [...preflight.blockers, preflight.blockers[0]!]
      }),
    /unique and canonical|blockers must match capabilities/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarPublicationFilesystemPreflight({
        ...preflight,
        capabilities: {
          ...preflight.capabilities,
          atomicNoReplaceFilePublish:
            !preflight.capabilities.atomicNoReplaceFilePublish
        }
      }),
    /expected false|blockers must match capabilities|observations must match capabilities/
  );
  const { preflightHash: _preflightHash, ...payload } = preflight;
  const nonWindowsUnsupportedPayload = {
    ...payload,
    platform: "linux",
    capabilities: {
      ...payload.capabilities,
      directoryDurabilitySync: false
    },
    observations: {
      ...payload.observations,
      directorySync: "unsupported" as const
    },
    blockers: [...new Set([
      ...payload.blockers,
      "directory_durability_sync_unavailable" as const
    ])].sort()
  };
  assert.throws(
    () =>
      parseOfficialMarketCalendarPublicationFilesystemPreflight({
        ...nonWindowsUnsupportedPayload,
        preflightHash:
          createOfficialMarketCalendarPublicationFilesystemPreflightHash(
            nonWindowsUnsupportedPayload
          )
      }),
    /unsupported directory sync is reserved for Windows/
  );
});

test("calendar publication filesystem preflight requires an absolute existing root", async () => {
  await assert.rejects(
    inspectOfficialMarketCalendarPublicationFilesystem({
      publicationRoot: "relative-publication-root"
    }),
    /root must be absolute/
  );
});

test("calendar publication filesystem preflight rejects a regular-file root", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "calendar-publication-file-root-test-"));
  const fileRoot = join(testRoot, "publication-root.json");
  try {
    await writeFile(fileRoot, "{}", { flag: "wx" });
    await assert.rejects(
      inspectOfficialMarketCalendarPublicationFilesystem({
        publicationRoot: fileRoot
      }),
      /root must be a directory/
    );
  } finally {
    await rm(testRoot, { recursive: true });
  }
});
