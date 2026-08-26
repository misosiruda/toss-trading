import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath
} from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

import { z } from "zod";

import { assertOfficialMarketCalendarPublicationFilesystemSupported } from "./officialMarketCalendarPublicationFilesystemPreflight.js";
import {
  parseOfficialMarketCalendarPublicationPackagePlan,
  type OfficialMarketCalendarPublicationPackagePlan
} from "./officialMarketCalendarPublicationPackagePlan.js";
import {
  OfficialMarketCalendarAtomicPublishError
} from "./officialMarketCalendarWindowsAtomicNoReplacePublish.js";
import { syncOfficialMarketCalendarWindowsPublicationDirectoryChain } from "./officialMarketCalendarWindowsDirectorySync.js";
import { createOfficialMarketCalendarWindowsPackageStagingSession } from "./officialMarketCalendarWindowsPackageStagingSession.js";
import { createOfficialMarketCalendarWindowsPublicationRootLease } from "./officialMarketCalendarWindowsPublicationRootLease.js";
import {
  pinOfficialMarketCalendarWindowsPackageFiles,
  type OfficialMarketCalendarWindowsPinnedFiles
} from "./officialMarketCalendarWindowsPinnedFiles.js";

const sourceSidecarSchema = z
  .object({
    archivePath: z.string().regex(/^sources\/sha256\/[a-f0-9]{64}\.bin$/),
    bytes: z.instanceof(Uint8Array)
  })
  .strict();

interface PublicationPackageWriterOptions {
  sourceBytesByExchange: unknown;
  freshnessPolicyRegistry: unknown;
  parserContractRegistry: unknown;
}

export interface OfficialMarketCalendarPublishedPackage {
  readonly status: "package_published";
  readonly artifactHash: string;
  readonly packagePath: string;
  readonly planHash: string;
  readonly publicationRecordPath: string;
}

export class OfficialMarketCalendarPackageQuarantinedError extends Error {
  readonly code = "OFFICIAL_CALENDAR_PACKAGE_QUARANTINED";
  readonly artifactHash: string;
  readonly packagePath: string;
  readonly reason:
    | "atomic_publish_outcome_uncertain"
    | "staged_file_identity_failed"
    | "staging_completion_failed"
    | "package_parent_sync_failed";

  constructor(input: {
    artifactHash: string;
    packagePath: string;
    reason:
      | "atomic_publish_outcome_uncertain"
      | "staged_file_identity_failed"
      | "staging_completion_failed"
      | "package_parent_sync_failed";
  }) {
    super(
      `official calendar package is quarantined: ${input.reason}`
    );
    this.name = "OfficialMarketCalendarPackageQuarantinedError";
    this.artifactHash = input.artifactHash;
    this.packagePath = input.packagePath;
    this.reason = input.reason;
  }
}

export async function writeOfficialMarketCalendarPublicationPackage(
  input: {
    publicationRoot: string;
    filesystemPreflight: unknown;
    packagePlan: unknown;
    sidecars: readonly unknown[];
  },
  options: PublicationPackageWriterOptions
): Promise<OfficialMarketCalendarPublishedPackage> {
  if (process.platform !== "win32") {
    throw new Error(
      "official calendar publication package writer requires win32"
    );
  }
  if (!isAbsolute(input.publicationRoot)) {
    throw new Error(
      "official calendar publication package writer root must be absolute"
    );
  }

  const preflight =
    assertOfficialMarketCalendarPublicationFilesystemSupported(
      input.filesystemPreflight
    );
  const prepared = parseOfficialMarketCalendarPublicationPackagePlan(
    input.packagePlan,
    { sidecars: input.sidecars },
    options
  );
  const sidecars = input.sidecars.map((sidecar) =>
    sourceSidecarSchema.parse(sidecar)
  );
  const artifactHex = prepared.plan.artifact.artifactHash.slice(
    "sha256:".length
  );
  const sourceFileNames = prepared.plan.sourceArchiveFiles.map(({ archivePath }) =>
    basename(archivePath)
  );
  const {
    publicationRoot,
    destinationPath,
    stagingRoot,
    stagingSession
  } = await preparePublicationStaging({
    publicationRootInput: input.publicationRoot,
    publicationRootIdentityHash: preflight.publicationRootIdentityHash,
    artifactHex,
    packagePath: prepared.plan.packagePath
  });
  let released = false;
  let published = false;
  let stagingCompleted = false;
  let publishOutcomeUncertain = false;
  let pinnedFiles: OfficialMarketCalendarWindowsPinnedFiles | undefined;
  let pinnedFilesFinalized = false;
  try {
    await writeDurableFile(
      join(stagingRoot, prepared.plan.artifactFile.packageRelativePath),
      prepared.artifactBytes
    );
    for (let index = 0; index < sidecars.length; index += 1) {
      const sidecar = sidecars[index]!;
      const descriptor = prepared.plan.sourceArchiveFiles[index]!;
      if (sidecar.archivePath !== descriptor.archivePath) {
        throw new Error(
          "official calendar publication sidecar order does not match package plan"
        );
      }
      await writeDurableFile(
        join(stagingRoot, ...sidecar.archivePath.split("/")),
        sidecar.bytes
      );
    }
    await verifyStagingTree(stagingRoot, prepared.plan, sidecars);
    pinnedFiles = await pinOfficialMarketCalendarWindowsPackageFiles({
      stagingRoot,
      destinationRoot: destinationPath,
      files: [
        {
          relativePath: prepared.plan.artifactFile.packageRelativePath,
          contentHash: prepared.plan.artifactFile.contentHash,
          contentLength: prepared.plan.artifactFile.contentLength
        },
        ...prepared.plan.sourceArchiveFiles.map((file) => ({
          relativePath: file.archivePath,
          contentHash: file.sourceDocumentHash,
          contentLength: file.contentLength
        }))
      ]
    });
    const sourceHashDirectory = join(stagingRoot, "sources", "sha256");
    if (
      !(await syncOfficialMarketCalendarWindowsPublicationDirectoryChain({
        publicationRoot,
        leafDirectory: sourceHashDirectory,
        inclusiveAncestorDirectory: stagingRoot
      }))
    ) {
      throw new Error(
        "official calendar publication package staging directory sync failed"
      );
    }
    released = await stagingSession.release();
    if (!released) {
      throw new Error(
        "official calendar publication package staging release failed"
      );
    }
    const publishOutcome = await pinnedFiles.publish();
    pinnedFilesFinalized = true;
    if (publishOutcome === "collision") {
      throw new OfficialMarketCalendarAtomicPublishError({
        message: "official calendar atomic publish destination already exists",
        outcome: "confirmed_not_moved",
        code: "EEXIST"
      });
    }
    if (publishOutcome === "indeterminate") {
      publishOutcomeUncertain = true;
      try {
        stagingCompleted = await stagingSession.cleanup(sourceFileNames);
      } catch {
        stagingCompleted = false;
      }
      throw new OfficialMarketCalendarPackageQuarantinedError({
        artifactHash: prepared.plan.artifact.artifactHash,
        packagePath: prepared.plan.packagePath,
        reason: "atomic_publish_outcome_uncertain"
      });
    }
    published = true;
    if (publishOutcome === "published_unverified") {
      throw new OfficialMarketCalendarPackageQuarantinedError({
        artifactHash: prepared.plan.artifact.artifactHash,
        packagePath: prepared.plan.packagePath,
        reason: "staged_file_identity_failed"
      });
    }
    let packageParentSyncFailed = false;
    try {
      packageParentSyncFailed =
        !(await syncOfficialMarketCalendarWindowsPublicationDirectoryChain({
          publicationRoot,
          leafDirectory: join(destinationPath, "sources", "sha256"),
          inclusiveAncestorDirectory: publicationRoot
        }));
    } catch {
      packageParentSyncFailed = true;
    }
    stagingCompleted = await stagingSession.cleanup(sourceFileNames);
    if (!stagingCompleted) {
      throw new OfficialMarketCalendarPackageQuarantinedError({
        artifactHash: prepared.plan.artifact.artifactHash,
        packagePath: prepared.plan.packagePath,
        reason: "staging_completion_failed"
      });
    }
    if (packageParentSyncFailed) {
      throw new OfficialMarketCalendarPackageQuarantinedError({
        artifactHash: prepared.plan.artifact.artifactHash,
        packagePath: prepared.plan.packagePath,
        reason: "package_parent_sync_failed"
      });
    }
    return Object.freeze({
      status: "package_published",
      artifactHash: prepared.plan.artifact.artifactHash,
      packagePath: prepared.plan.packagePath,
      planHash: prepared.plan.planHash,
      publicationRecordPath: prepared.plan.publicationRecordPath
    });
  } catch (error) {
    if (publishOutcomeUncertain) {
      throw error;
    }
    if (pinnedFiles !== undefined && !pinnedFilesFinalized) {
      pinnedFilesFinalized = await pinnedFiles.release();
      if (!pinnedFilesFinalized) {
        throw new Error(
          "official calendar publication pinned file release failed",
          { cause: error }
        );
      }
    }
    if (published && !released) {
      throw new Error(
        "official calendar publication package state is inconsistent",
        { cause: error }
      );
    }
    if (!stagingCompleted) {
      stagingCompleted = await stagingSession.cleanup(sourceFileNames);
      if (!stagingCompleted) {
        throw new OfficialMarketCalendarPackageQuarantinedError({
          artifactHash: prepared.plan.artifact.artifactHash,
          packagePath: prepared.plan.packagePath,
          reason: "staging_completion_failed"
        });
      }
    }
    throw error;
  }
}

async function preparePublicationStaging(input: {
  publicationRootInput: string;
  publicationRootIdentityHash: string;
  artifactHex: string;
  packagePath: string;
}) {
  const rootLease =
    await createOfficialMarketCalendarWindowsPublicationRootLease(
      input.publicationRootInput
    );
  let leaseReleased = false;
  let stagingSession:
    | Awaited<
        ReturnType<
          typeof createOfficialMarketCalendarWindowsPackageStagingSession
        >
      >
    | undefined;
  try {
    if (
      rootLease.publicationRootIdentityHash !==
      input.publicationRootIdentityHash
    ) {
      throw new Error(
        "official calendar publication package writer preflight root identity mismatch"
      );
    }
    const publicationRoot = rootLease.publicationRoot;
    const rootStats = await lstat(publicationRoot);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw new Error(
        "official calendar publication package writer root must be a real directory"
      );
    }
    const packageNamespace = await ensureDurableNamespaceChain(
      publicationRoot,
      ["sha256"]
    );
    await ensureDurableNamespaceChain(publicationRoot, ["published", "sha256"]);
    const destinationPath = join(
      publicationRoot,
      ...input.packagePath.split("/")
    );
    const stagingRoot = join(
      packageNamespace,
      `.calendar-package-${input.artifactHex}-${randomUUID()}.staging`
    );
    stagingSession =
      await createOfficialMarketCalendarWindowsPackageStagingSession({
        publicationRoot,
        packageNamespace,
        stagingRoot
      });
    leaseReleased = await rootLease.release();
    if (!leaseReleased) {
      throw new Error(
        "official calendar publication root lease handoff failed"
      );
    }
    return {
      publicationRoot,
      destinationPath,
      stagingRoot,
      stagingSession
    };
  } catch (error) {
    if (stagingSession !== undefined) {
      await stagingSession.cleanup([]);
    }
    throw error;
  } finally {
    if (!leaseReleased) {
      await rootLease.release();
    }
  }
}

async function ensureDurableNamespaceChain(
  publicationRoot: string,
  segments: readonly string[]
): Promise<string> {
  let namespacePath = publicationRoot;
  for (const segment of segments) {
    namespacePath = join(namespacePath, segment);
    try {
      await mkdir(namespacePath);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }
    const resolvedPath = await realpath(namespacePath);
    const namespaceStats = await lstat(namespacePath);
    if (
      resolvedPath !== namespacePath ||
      !namespaceStats.isDirectory() ||
      namespaceStats.isSymbolicLink()
    ) {
      throw new Error(
        "official calendar publication namespace must be a real directory"
      );
    }
    if (
      !(await syncOfficialMarketCalendarWindowsPublicationDirectoryChain({
        publicationRoot,
        leafDirectory: namespacePath,
        inclusiveAncestorDirectory: publicationRoot
      }))
    ) {
      throw new Error("official calendar publication namespace sync failed");
    }
  }
  return namespacePath;
}

async function writeDurableFile(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function verifyStagingTree(
  stagingRoot: string,
  plan: OfficialMarketCalendarPublicationPackagePlan,
  sidecars: readonly { archivePath: string; bytes: Uint8Array }[]
): Promise<void> {
  const artifactBytes = await readFile(
    join(stagingRoot, plan.artifactFile.packageRelativePath)
  );
  if (
    artifactBytes.byteLength !== plan.artifactFile.contentLength ||
    hashBytes(artifactBytes) !== plan.artifactFile.contentHash
  ) {
    throw new Error(
      "official calendar publication staged artifact verification failed"
    );
  }
  for (let index = 0; index < plan.sourceArchiveFiles.length; index += 1) {
    const descriptor = plan.sourceArchiveFiles[index]!;
    const sidecar = sidecars[index]!;
    const bytes = await readFile(
      join(stagingRoot, ...descriptor.archivePath.split("/"))
    );
    if (
      bytes.byteLength !== descriptor.contentLength ||
      hashBytes(bytes) !== descriptor.sourceDocumentHash ||
      !bytes.equals(sidecar.bytes)
    ) {
      throw new Error(
        "official calendar publication staged sidecar verification failed"
      );
    }
  }
}

function hashBytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
