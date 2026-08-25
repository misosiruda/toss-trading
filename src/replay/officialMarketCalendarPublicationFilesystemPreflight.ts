import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import { publishOfficialMarketCalendarEntryAtomicNoReplace } from "./officialMarketCalendarWindowsAtomicNoReplacePublish.js";
import { createOfficialMarketCalendarWindowsProbeSession } from "./officialMarketCalendarWindowsProbeSession.js";

export const OFFICIAL_MARKET_CALENDAR_PUBLICATION_FILESYSTEM_PREFLIGHT_SCHEMA_VERSION =
  "official_market_calendar_publication_filesystem_preflight.v2";

const blockerSchema = z.enum([
  "atomic_no_replace_directory_publish_unavailable",
  "directory_durability_sync_unavailable",
  "exclusive_staging_file_create_unavailable",
  "file_durability_sync_unavailable",
  "atomic_no_replace_file_publish_unavailable",
  "safe_mutation_probe_cleanup_unavailable"
]);

const preflightPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_PUBLICATION_FILESYSTEM_PREFLIGHT_SCHEMA_VERSION
    ),
    implementationId: z.enum([
      "node_fs_promises.v2",
      "node_fs_promises_win32_movefileex.v2",
      "node_fs_promises_win32_native_probe_session.v3"
    ]),
    platform: z.string().regex(/^[a-z0-9_]+$/),
    publicationRootIdentityHash: sha256HashSchema,
    status: z.enum(["supported", "unsupported"]),
    capabilities: z
      .object({
        exclusiveStagingFileCreate: z.boolean(),
        fileDurabilitySync: z.boolean(),
        directoryDurabilitySync: z.boolean(),
        atomicNoReplaceFilePublish: z.boolean(),
        atomicNoReplaceDirectoryPublish: z.boolean()
      })
      .strict(),
    observations: z
      .object({
        existingFileExclusiveCreate: z.enum([
          "verified",
          "not_probed",
          "probe_failed"
        ]),
        fileSync: z.enum(["verified", "not_probed", "probe_failed"]),
        directorySync: z.enum([
          "synced",
          "movefileex_write_through_only",
          "unsupported",
          "probe_failed"
        ]),
        freshFileAtomicMove: z.enum([
          "verified",
          "not_probed",
          "probe_failed"
        ]),
        existingFileAtomicMove: z.enum([
          "collision_preserved",
          "not_probed",
          "probe_failed"
        ]),
        freshDirectoryAtomicMove: z.enum([
          "verified",
          "not_probed",
          "probe_failed"
        ]),
        existingDirectoryAtomicMove: z.enum([
          "collision_preserved",
          "not_probed",
          "probe_failed"
        ]),
        probeCleanup: z.enum([
          "verified",
          "identity_not_retained",
          "probe_failed"
        ])
      })
      .strict(),
    blockers: z.array(blockerSchema)
  })
  .strict()
  .superRefine(validatePreflightPayload);

export const officialMarketCalendarPublicationFilesystemPreflightSchema =
  preflightPayloadSchema.safeExtend({ preflightHash: sha256HashSchema }).strict();

export type OfficialMarketCalendarPublicationFilesystemBlocker = z.infer<
  typeof blockerSchema
>;
export type OfficialMarketCalendarPublicationFilesystemPreflight = z.infer<
  typeof officialMarketCalendarPublicationFilesystemPreflightSchema
>;
export type OfficialMarketCalendarPublicationFilesystemPreflightPayload = z.infer<
  typeof preflightPayloadSchema
>;

export async function inspectOfficialMarketCalendarPublicationFilesystem(input: {
  publicationRoot: string;
}): Promise<OfficialMarketCalendarPublicationFilesystemPreflight> {
  if (!isAbsolute(input.publicationRoot)) {
    throw new Error("publication filesystem preflight root must be absolute");
  }
  const publicationRoot = await realpath(input.publicationRoot);
  await assertDirectory(publicationRoot);
  const observation =
    process.platform === "win32"
      ? await probeWindowsPublicationFilesystem(publicationRoot)
      : await inspectUnsupportedNodeFilesystem(publicationRoot);
  const blockers = createBlockers(
    observation.capabilities,
    observation.observations.probeCleanup === "verified"
  );
  const payload = preflightPayloadSchema.parse({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_PUBLICATION_FILESYSTEM_PREFLIGHT_SCHEMA_VERSION,
    implementationId:
      process.platform === "win32"
        ? "node_fs_promises_win32_native_probe_session.v3"
        : "node_fs_promises.v2",
    platform: process.platform,
    publicationRootIdentityHash: createReplayResearchHash(publicationRoot),
    status: blockers.length === 0 ? "supported" : "unsupported",
    capabilities: observation.capabilities,
    observations: observation.observations,
    blockers
  });
  return deepFreeze({
    ...payload,
    preflightHash:
      createOfficialMarketCalendarPublicationFilesystemPreflightHash(payload)
  });
}

export function parseOfficialMarketCalendarPublicationFilesystemPreflight(
  value: unknown
): OfficialMarketCalendarPublicationFilesystemPreflight {
  const parsed = officialMarketCalendarPublicationFilesystemPreflightSchema.parse(value);
  const { preflightHash, ...payload } = parsed;
  if (
    preflightHash !==
    createOfficialMarketCalendarPublicationFilesystemPreflightHash(payload)
  ) {
    throw new Error("official calendar publication filesystem preflight hash mismatch");
  }
  return deepFreeze(parsed);
}

export function assertOfficialMarketCalendarPublicationFilesystemSupported(
  value: unknown
): OfficialMarketCalendarPublicationFilesystemPreflight {
  const preflight = parseOfficialMarketCalendarPublicationFilesystemPreflight(value);
  if (preflight.status !== "supported") {
    throw new Error(
      `official calendar publication filesystem is unsupported: ${preflight.blockers.join(",")}`
    );
  }
  return preflight;
}

export function createOfficialMarketCalendarPublicationFilesystemPreflightHash(
  value: OfficialMarketCalendarPublicationFilesystemPreflightPayload
): Sha256Hash {
  return createReplayResearchHash(preflightPayloadSchema.parse(value));
}

function validatePreflightPayload(
  value: OfficialMarketCalendarPublicationFilesystemPreflightPayload,
  context: z.RefinementCtx
): void {
  for (let index = 1; index < value.blockers.length; index += 1) {
    if (value.blockers[index - 1]! >= value.blockers[index]!) {
      context.addIssue({
        code: "custom",
        path: ["blockers", index],
        message: "publication filesystem blockers must be unique and canonical"
      });
    }
  }
  const expectedBlockers = createBlockers(
    value.capabilities,
    value.observations.probeCleanup === "verified"
  );
  if (JSON.stringify(value.blockers) !== JSON.stringify(expectedBlockers)) {
    context.addIssue({
      code: "custom",
      path: ["blockers"],
      message: "publication filesystem blockers must match capabilities"
    });
  }
  if ((value.status === "supported") !== (value.blockers.length === 0)) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "publication filesystem status must match blockers"
    });
  }
  if (value.status === "supported") {
    context.addIssue({
      code: "custom",
      path: ["implementationId"],
      message: "current publication filesystem implementations cannot report supported"
    });
  }
  if (
    value.capabilities.directoryDurabilitySync !==
    (value.observations.directorySync === "synced")
  ) {
    context.addIssue({
      code: "custom",
      path: ["observations", "directorySync"],
      message: "publication directory durability observation must match capability"
    });
  }
  const observationCapabilities = {
    exclusiveStagingFileCreate:
      value.observations.existingFileExclusiveCreate === "verified",
    fileDurabilitySync: value.observations.fileSync === "verified",
    atomicNoReplaceFilePublish:
      value.observations.freshFileAtomicMove === "verified" &&
      value.observations.existingFileAtomicMove === "collision_preserved",
    atomicNoReplaceDirectoryPublish:
      value.observations.freshDirectoryAtomicMove === "verified" &&
      value.observations.existingDirectoryAtomicMove ===
        "collision_preserved"
  };
  for (const [capability, observed] of Object.entries(
    observationCapabilities
  )) {
    if (
      value.capabilities[
        capability as keyof typeof observationCapabilities
      ] !== observed
    ) {
      context.addIssue({
        code: "custom",
        path: ["capabilities", capability],
        message: "publication filesystem observations must match capabilities"
      });
    }
  }
  if (
    value.observations.directorySync === "movefileex_write_through_only" &&
    (value.platform !== "win32" ||
      !value.implementationId.startsWith("node_fs_promises_win32_"))
  ) {
    context.addIssue({
      code: "custom",
      path: ["observations", "directorySync"],
      message: "MoveFileEx durability is reserved for the Windows implementation"
    });
  }
  if (
    value.implementationId.startsWith("node_fs_promises_win32_") !==
    (value.platform === "win32")
  ) {
    context.addIssue({
      code: "custom",
      path: ["implementationId"],
      message: "publication filesystem implementation must match platform"
    });
  }
}

function createBlockers(
  capabilities: OfficialMarketCalendarPublicationFilesystemPreflightPayload["capabilities"],
  cleanupVerified: boolean
): OfficialMarketCalendarPublicationFilesystemBlocker[] {
  const blockers: OfficialMarketCalendarPublicationFilesystemBlocker[] = [];
  if (!capabilities.atomicNoReplaceDirectoryPublish) {
    blockers.push("atomic_no_replace_directory_publish_unavailable");
  }
  if (!capabilities.directoryDurabilitySync) {
    blockers.push("directory_durability_sync_unavailable");
  }
  if (!capabilities.exclusiveStagingFileCreate) {
    blockers.push("exclusive_staging_file_create_unavailable");
  }
  if (!capabilities.fileDurabilitySync) {
    blockers.push("file_durability_sync_unavailable");
  }
  if (!capabilities.atomicNoReplaceFilePublish) {
    blockers.push("atomic_no_replace_file_publish_unavailable");
  }
  if (!cleanupVerified) {
    blockers.push("safe_mutation_probe_cleanup_unavailable");
  }
  return blockers.sort();
}

async function probeWindowsPublicationFilesystem(
  publicationRoot: string
): Promise<{
  capabilities: OfficialMarketCalendarPublicationFilesystemPreflightPayload["capabilities"];
  observations: OfficialMarketCalendarPublicationFilesystemPreflightPayload["observations"];
}> {
  const probeSession =
    await createOfficialMarketCalendarWindowsProbeSession({ publicationRoot });
  const probeRoot = probeSession.probeRoot;
  const observations: OfficialMarketCalendarPublicationFilesystemPreflightPayload["observations"] = {
    existingFileExclusiveCreate: "not_probed",
    fileSync: "not_probed",
    directorySync: "unsupported",
    freshFileAtomicMove: "not_probed",
    existingFileAtomicMove: "not_probed",
    freshDirectoryAtomicMove: "not_probed",
    existingDirectoryAtomicMove: "not_probed",
    probeCleanup: "probe_failed"
  };
  try {
    const freshFileSource = join(probeRoot, "fresh-file.staging");
    const freshFileDestination = join(probeRoot, "fresh-file.published");
    const freshFileContents = "calendar publication preflight\n";
    const freshFile = await open(freshFileSource, "wx");
    try {
      await freshFile.writeFile(freshFileContents, "utf8");
      await freshFile.sync();
      observations.fileSync = "verified";
    } finally {
      await freshFile.close();
    }
    observations.existingFileExclusiveCreate =
      (await verifyExistingFileExclusiveCreate(
        freshFileSource,
        freshFileContents
      ))
        ? "verified"
        : "probe_failed";
    await publishOfficialMarketCalendarEntryAtomicNoReplace({
      sourcePath: freshFileSource,
      destinationPath: freshFileDestination,
      entryKind: "file"
    });
    observations.freshFileAtomicMove = "verified";

    const collisionFileSource = join(probeRoot, "collision-file.staging");
    const collisionFileContents = "collision source must remain unchanged\n";
    const collisionFile = await open(collisionFileSource, "wx");
    try {
      await collisionFile.writeFile(collisionFileContents, "utf8");
      await collisionFile.sync();
    } finally {
      await collisionFile.close();
    }
    try {
      await publishOfficialMarketCalendarEntryAtomicNoReplace({
        sourcePath: collisionFileSource,
        destinationPath: freshFileDestination,
        entryKind: "file"
      });
      observations.existingFileAtomicMove = "probe_failed";
    } catch (error) {
      observations.existingFileAtomicMove =
        isNodeError(error) &&
        error.code === "EEXIST" &&
        (await verifyFileCollisionPreserved({
          sourcePath: collisionFileSource,
          sourceContents: collisionFileContents,
          destinationPath: freshFileDestination,
          destinationContents: freshFileContents
        }))
          ? "collision_preserved"
          : "probe_failed";
    }

    const freshDirectorySource = join(probeRoot, "fresh-directory.staging");
    const freshDirectoryDestination = join(
      probeRoot,
      "fresh-directory.published"
    );
    await mkdir(freshDirectorySource);
    const nestedFile = await open(join(freshDirectorySource, "artifact.json"), "wx");
    try {
      await nestedFile.writeFile("{}\n", "utf8");
      await nestedFile.sync();
    } finally {
      await nestedFile.close();
    }
    await publishOfficialMarketCalendarEntryAtomicNoReplace({
      sourcePath: freshDirectorySource,
      destinationPath: freshDirectoryDestination,
      entryKind: "directory"
    });
    observations.freshDirectoryAtomicMove = "verified";
    observations.directorySync = "movefileex_write_through_only";

    const collisionDirectorySource = join(
      probeRoot,
      "collision-directory.staging"
    );
    await mkdir(collisionDirectorySource);
    const collisionDirectoryMarkerContents =
      "collision directory source must remain unchanged\n";
    const collisionDirectoryMarker = await open(
      join(collisionDirectorySource, "source-marker.txt"),
      "wx"
    );
    try {
      await collisionDirectoryMarker.writeFile(
        collisionDirectoryMarkerContents,
        "utf8"
      );
      await collisionDirectoryMarker.sync();
    } finally {
      await collisionDirectoryMarker.close();
    }
    try {
      await publishOfficialMarketCalendarEntryAtomicNoReplace({
        sourcePath: collisionDirectorySource,
        destinationPath: freshDirectoryDestination,
        entryKind: "directory"
      });
      observations.existingDirectoryAtomicMove = "probe_failed";
    } catch (error) {
      observations.existingDirectoryAtomicMove =
        isNodeError(error) &&
        error.code === "EEXIST" &&
        (await verifyDirectoryCollisionPreserved({
          sourcePath: collisionDirectorySource,
          sourceMarkerContents: collisionDirectoryMarkerContents,
          destinationPath: freshDirectoryDestination
        }))
          ? "collision_preserved"
          : "probe_failed";
    }
  } catch {
    // Each observation remains explicit; unsupported capabilities fail closed.
  } finally {
    observations.probeCleanup = (await probeSession.cleanup())
      ? "verified"
      : "probe_failed";
  }
  return {
    capabilities: {
      exclusiveStagingFileCreate:
        observations.existingFileExclusiveCreate === "verified",
      fileDurabilitySync: observations.fileSync === "verified",
      directoryDurabilitySync: false,
      atomicNoReplaceFilePublish:
        observations.freshFileAtomicMove === "verified" &&
        observations.existingFileAtomicMove === "collision_preserved",
      atomicNoReplaceDirectoryPublish:
        observations.freshDirectoryAtomicMove === "verified" &&
        observations.existingDirectoryAtomicMove === "collision_preserved"
    },
    observations
  };
}

async function inspectUnsupportedNodeFilesystem(
  publicationRoot: string
): Promise<{
  capabilities: OfficialMarketCalendarPublicationFilesystemPreflightPayload["capabilities"];
  observations: OfficialMarketCalendarPublicationFilesystemPreflightPayload["observations"];
}> {
  const directorySync = await probeDirectorySync(publicationRoot);
  return {
    capabilities: {
      exclusiveStagingFileCreate: false,
      fileDurabilitySync: false,
      directoryDurabilitySync: directorySync === "synced",
      atomicNoReplaceFilePublish: false,
      atomicNoReplaceDirectoryPublish: false
    },
    observations: {
      existingFileExclusiveCreate: "not_probed",
      fileSync: "not_probed",
      directorySync,
      freshFileAtomicMove: "not_probed",
      existingFileAtomicMove: "not_probed",
      freshDirectoryAtomicMove: "not_probed",
      existingDirectoryAtomicMove: "not_probed",
      probeCleanup: "verified"
    }
  };
}

async function assertDirectory(path: string): Promise<void> {
  const stats = await lstat(path);
  if (!stats.isDirectory()) {
    throw new Error("publication filesystem preflight root must be a directory");
  }
}

async function probeDirectorySync(path: string) {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY |
        (constants.O_DIRECTORY ?? 0) |
        (constants.O_NONBLOCK ?? 0)
    );
  } catch {
    return "probe_failed" as const;
  }
  try {
    await handle.sync();
    return "synced" as const;
  } catch {
    return "probe_failed" as const;
  } finally {
    try {
      await handle.close();
    } catch {
      return "probe_failed" as const;
    }
  }
}

async function verifyExistingFileExclusiveCreate(
  path: string,
  expectedContents: string
): Promise<boolean> {
  try {
    const unexpectedHandle = await open(path, "wx");
    await unexpectedHandle.close();
    return false;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") {
      return false;
    }
  }
  try {
    return (await readFile(path, "utf8")) === expectedContents;
  } catch {
    return false;
  }
}

async function verifyFileCollisionPreserved(input: {
  sourcePath: string;
  sourceContents: string;
  destinationPath: string;
  destinationContents: string;
}): Promise<boolean> {
  try {
    const [sourceContents, destinationContents] = await Promise.all([
      readFile(input.sourcePath, "utf8"),
      readFile(input.destinationPath, "utf8")
    ]);
    return (
      sourceContents === input.sourceContents &&
      destinationContents === input.destinationContents
    );
  } catch {
    return false;
  }
}

async function verifyDirectoryCollisionPreserved(input: {
  sourcePath: string;
  sourceMarkerContents: string;
  destinationPath: string;
}): Promise<boolean> {
  try {
    const [sourceContents, destinationContents] = await Promise.all([
      readFile(join(input.sourcePath, "source-marker.txt"), "utf8"),
      readFile(join(input.destinationPath, "artifact.json"), "utf8")
    ]);
    return (
      sourceContents === input.sourceMarkerContents &&
      destinationContents === "{}\n"
    );
  } catch {
    return false;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
