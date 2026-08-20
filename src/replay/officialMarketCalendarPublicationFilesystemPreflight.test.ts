import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOfficialMarketCalendarPublicationFilesystemSupported,
  inspectOfficialMarketCalendarPublicationFilesystem,
  parseOfficialMarketCalendarPublicationFilesystemPreflight
} from "./officialMarketCalendarPublicationFilesystemPreflight.js";

test("calendar publication filesystem preflight keeps Node directory publish disabled", async () => {
  const preflight = await inspectOfficialMarketCalendarPublicationFilesystem();

  assert.equal(preflight.status, "unsupported");
  assert.equal(preflight.capabilities.atomicNoReplaceDirectoryPublish, false);
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
  const preflight = await inspectOfficialMarketCalendarPublicationFilesystem();

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
