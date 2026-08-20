import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertOfficialMarketCalendarPublicationFilesystemSupported,
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
});

test("calendar publication filesystem preflight requires an absolute existing root", async () => {
  await assert.rejects(
    inspectOfficialMarketCalendarPublicationFilesystem({
      publicationRoot: "relative-publication-root"
    }),
    /root must be absolute/
  );
});
