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

test("calendar publication filesystem preflight verifies or blocks the runtime capabilities", async () => {
  const publicationRoot = await mkdtemp(
    join(tmpdir(), "calendar-publication-preflight-test-")
  );
  try {
    const preflight = await inspectOfficialMarketCalendarPublicationFilesystem({
      publicationRoot
    });

    if (process.platform === "win32") {
      assert.equal(preflight.status, "supported");
      assert.deepEqual(preflight.capabilities, {
        exclusiveStagingFileCreate: true,
        fileDurabilitySync: true,
        directoryDurabilitySync: true,
        atomicNoReplaceFilePublish: true,
        atomicNoReplaceDirectoryPublish: true
      });
      assert.equal(
        preflight.observations.existingFileExclusiveCreate,
        "verified"
      );
      assert.equal(preflight.observations.fileSync, "verified");
      assert.equal(
        preflight.observations.directorySync,
        "movefileex_write_through"
      );
      assert.equal(preflight.observations.freshFileAtomicMove, "verified");
      assert.equal(
        preflight.observations.existingFileAtomicMove,
        "collision_preserved"
      );
      assert.equal(
        preflight.observations.freshDirectoryAtomicMove,
        "verified"
      );
      assert.equal(
        preflight.observations.existingDirectoryAtomicMove,
        "collision_preserved"
      );
      assert.deepEqual(preflight.blockers, []);
      assert.deepEqual(
        assertOfficialMarketCalendarPublicationFilesystemSupported(preflight),
        preflight
      );
    } else {
      assert.equal(preflight.status, "unsupported");
      assert.throws(
        () =>
          assertOfficialMarketCalendarPublicationFilesystemSupported(preflight),
        /filesystem is unsupported/
      );
    }
    assert.equal(preflight.observations.probeCleanup, "verified");
    assert.deepEqual(await readdir(publicationRoot), []);
    assert.equal(Object.isFrozen(preflight.capabilities), true);
    assert.equal(Object.isFrozen(preflight.observations), true);
    assert.equal(Object.isFrozen(preflight.blockers), true);
    assert.deepEqual(
      parseOfficialMarketCalendarPublicationFilesystemPreflight(preflight),
      preflight
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
        blockers: [
          ...preflight.blockers,
          "safe_mutation_probe_cleanup_unavailable"
        ]
      }),
    /unique and canonical|blockers must match capabilities|status must match blockers/
  );
  const capabilityTamper = {
    ...preflight,
    capabilities: {
      ...preflight.capabilities,
      atomicNoReplaceFilePublish:
        !preflight.capabilities.atomicNoReplaceFilePublish
    }
  };
  const { preflightHash: _preflightHash, ...capabilityPayload } =
    capabilityTamper;
  assert.throws(
    () =>
      parseOfficialMarketCalendarPublicationFilesystemPreflight({
        ...capabilityPayload,
        preflightHash:
          createOfficialMarketCalendarPublicationFilesystemPreflightHash(
            capabilityPayload
          )
      }),
    /blockers must match capabilities/
  );
  if (process.platform === "win32") {
    const platformTamper = {
      ...preflight,
      platform: "linux"
    };
    const { preflightHash: _platformHash, ...platformPayload } = platformTamper;
    assert.throws(
      () =>
        parseOfficialMarketCalendarPublicationFilesystemPreflight({
          ...platformPayload,
          preflightHash:
            createOfficialMarketCalendarPublicationFilesystemPreflightHash(
              platformPayload
            )
        }),
      /MoveFileEx durability is reserved for the Windows implementation/
    );
  }
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
  const testRoot = await mkdtemp(
    join(tmpdir(), "calendar-publication-file-root-test-")
  );
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
