import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  assertOfficialMarketCalendarPublicationFilesystemSupported,
  inspectOfficialMarketCalendarPublicationFilesystem,
  parseOfficialMarketCalendarPublicationFilesystemPreflight
} from "./officialMarketCalendarPublicationFilesystemPreflight.js";

test("calendar publication filesystem preflight keeps Node directory publish disabled", async () => {
  const preflight = await inspectOfficialMarketCalendarPublicationFilesystem({
    publicationRoot: tmpdir()
  });

  assert.equal(preflight.status, "unsupported");
  assert.equal(preflight.capabilities.atomicNoReplaceDirectoryPublish, false);
  if (preflight.capabilities.atomicNoReplaceFilePublish) {
    assert.equal(preflight.observations.freshFileHardLink, "linked");
    assert.equal(
      preflight.observations.existingFileHardLink,
      "collision_rejected"
    );
  }
  assert.equal(Object.isFrozen(preflight.capabilities), true);
  assert.equal(Object.isFrozen(preflight.observations), true);
  assert.equal(Object.isFrozen(preflight.blockers), true);
  assert.ok(
    preflight.blockers.includes(
      "atomic_no_replace_directory_publish_unavailable"
    )
  );
  assert.deepEqual(
    parseOfficialMarketCalendarPublicationFilesystemPreflight(preflight),
    preflight
  );
  assert.throws(
    () => assertOfficialMarketCalendarPublicationFilesystemSupported(preflight),
    /filesystem is unsupported/
  );
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
    /blockers must match capabilities|observations must match capabilities/
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
