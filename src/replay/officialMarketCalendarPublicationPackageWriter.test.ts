import assert from "node:assert/strict";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createOfficialMarketCalendarEvidenceArtifactV2 } from "./officialMarketCalendarEvidenceArtifactV2.js";
import { inspectOfficialMarketCalendarPublicationFilesystem } from "./officialMarketCalendarPublicationFilesystemPreflight.js";
import { createOfficialMarketCalendarPublicationPackagePlan } from "./officialMarketCalendarPublicationPackagePlan.js";
import { writeOfficialMarketCalendarPublicationPackage } from "./officialMarketCalendarPublicationPackageWriter.js";
import { evidenceArtifactV2Fixture } from "./officialMarketCalendarBoundaryTestFixtures.js";

test(
  "calendar publication package writer durably publishes one immutable package without a record",
  { skip: process.platform !== "win32" },
  async (t) => {
    const publicationRoot = await mkdtemp(
      join(tmpdir(), "calendar-package-writer-")
    );
    t.after(() => rm(publicationRoot, { recursive: true, force: true }));
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

    const published = await writeOfficialMarketCalendarPublicationPackage(
      {
        publicationRoot,
        filesystemPreflight,
        packagePlan: prepared.plan,
        sidecars
      },
      fixture.options
    );

    assert.deepEqual(published, {
      status: "package_published",
      artifactHash: artifact.artifactHash,
      packagePath: prepared.plan.packagePath,
      planHash: prepared.plan.planHash,
      publicationRecordPath: prepared.plan.publicationRecordPath
    });
    const packageRoot = join(
      publicationRoot,
      ...prepared.plan.packagePath.split("/")
    );
    assert.deepEqual(
      await readFile(join(packageRoot, "artifact.json")),
      Buffer.from(prepared.artifactBytes)
    );
    for (const sidecar of sidecars) {
      assert.deepEqual(
        await readFile(join(packageRoot, ...sidecar.archivePath.split("/"))),
        Buffer.from(sidecar.bytes!)
      );
    }
    assert.deepEqual(await readdir(join(publicationRoot, "sha256")), [
      artifact.artifactHash.slice("sha256:".length)
    ]);
    assert.deepEqual(await readdir(join(publicationRoot, "published")), [
      "sha256"
    ]);
    assert.deepEqual(
      await readdir(join(publicationRoot, "published", "sha256")),
      []
    );
    await assert.rejects(
      access(
        join(
          publicationRoot,
          ...prepared.plan.publicationRecordPath.split("/")
        )
      ),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
    );
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
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "EEXIST"
    );
    assert.deepEqual(await readdir(join(publicationRoot, "sha256")), [
      artifact.artifactHash.slice("sha256:".length)
    ]);
  }
);
