import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createOfficialMarketCalendarEvidenceArtifactV2 } from "./officialMarketCalendarEvidenceArtifactV2.js";
import { inspectOfficialMarketCalendarPublicationFilesystem } from "./officialMarketCalendarPublicationFilesystemPreflight.js";
import { createOfficialMarketCalendarPublicationPackagePlan } from "./officialMarketCalendarPublicationPackagePlan.js";
import { writeOfficialMarketCalendarPublicationPackage } from "./officialMarketCalendarPublicationPackageWriter.js";
import { evidenceArtifactV2Fixture } from "./officialMarketCalendarBoundaryTestFixtures.js";

test(
  "calendar publication package writer rejects a replaced preflight root before mutation",
  { skip: process.platform !== "win32" },
  async (t) => {
    const parentRoot = await mkdtemp(
      join(tmpdir(), "calendar-package-writer-root-identity-")
    );
    t.after(() => rm(parentRoot, { recursive: true, force: true }));
    const publicationRoot = join(parentRoot, "publication");
    const displacedRoot = join(parentRoot, "displaced-publication");
    await mkdir(publicationRoot);
    const fixture = evidenceArtifactV2Fixture();
    const artifact = createOfficialMarketCalendarEvidenceArtifactV2(
      fixture.input,
      fixture.options
    );
    const sidecars = artifact.sourceArchiveBindings
      .map(({ archivePath, sourceDocumentRef }) => ({
        archivePath,
        bytes:
          fixture.options.sourceBytesByExchange[sourceDocumentRef.exchange][
            sourceDocumentRef.documentId
          ]
      }))
      .sort((left, right) =>
        left.archivePath < right.archivePath ? -1 : 1
      );
    const prepared = createOfficialMarketCalendarPublicationPackagePlan(
      { artifact, sidecars },
      fixture.options
    );
    const filesystemPreflight =
      await inspectOfficialMarketCalendarPublicationFilesystem({
        publicationRoot
      });
    await rename(publicationRoot, displacedRoot);
    await mkdir(publicationRoot);

    await assert.rejects(
      writeOfficialMarketCalendarPublicationPackage(
        {
          publicationRoot,
          filesystemPreflight,
          packagePlan: prepared.plan,
          sidecars
        },
        fixture.options
      ),
      /preflight root identity mismatch/
    );
    assert.deepEqual(await readdir(publicationRoot), []);
  }
);
