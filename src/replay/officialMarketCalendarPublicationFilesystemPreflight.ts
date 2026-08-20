import { isAbsolute, join, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  link,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";

import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_PUBLICATION_FILESYSTEM_PREFLIGHT_SCHEMA_VERSION =
  "official_market_calendar_publication_filesystem_preflight.v1";

const preflightPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_PUBLICATION_FILESYSTEM_PREFLIGHT_SCHEMA_VERSION
    ),
    implementationId: z.literal("node_fs_promises.v1"),
    platform: z.string().regex(/^[a-z0-9_]+$/),
    status: z.literal("unsupported"),
    capabilities: z
      .object({
        exclusiveStagingFileCreate: z.boolean(),
        fileDurabilitySync: z.boolean(),
        directoryDurabilitySync: z.boolean(),
        atomicNoReplaceFilePublish: z.boolean(),
        atomicNoReplaceDirectoryPublish: z.literal(false)
      })
      .strict(),
    observations: z
      .object({
        existingFileExclusiveCreate: z.enum([
          "collision_rejected",
          "unexpectedly_opened",
          "probe_failed"
        ]),
        directorySync: z.enum(["synced", "unsupported", "probe_failed"]),
        existingFileHardLink: z.enum([
          "collision_rejected",
          "unexpectedly_linked",
          "probe_failed"
        ]),
        existingDirectoryRename: z.enum([
          "collision_rejected",
          "destination_replaced",
          "probe_failed"
        ])
      })
      .strict(),
    blockers: z.array(z.enum([
      "atomic_no_replace_directory_publish_unavailable",
      "directory_durability_sync_unavailable",
      "exclusive_staging_file_create_unavailable",
      "file_durability_sync_unavailable",
      "atomic_no_replace_file_publish_unavailable"
    ]))
  })
  .strict()
  .superRefine((value, context) => {
    for (let index = 1; index < value.blockers.length; index += 1) {
      if (value.blockers[index - 1]! >= value.blockers[index]!) {
        context.addIssue({
          code: "custom",
          path: ["blockers", index],
          message: "publication filesystem blockers must be unique and canonical"
        });
      }
    }
    const capabilityBlockers = [
      [
        value.capabilities.atomicNoReplaceDirectoryPublish,
        "atomic_no_replace_directory_publish_unavailable"
      ],
      [
        value.capabilities.directoryDurabilitySync,
        "directory_durability_sync_unavailable"
      ],
      [
        value.capabilities.exclusiveStagingFileCreate,
        "exclusive_staging_file_create_unavailable"
      ],
      [
        value.capabilities.fileDurabilitySync,
        "file_durability_sync_unavailable"
      ],
      [
        value.capabilities.atomicNoReplaceFilePublish,
        "atomic_no_replace_file_publish_unavailable"
      ]
    ] as const;
    for (const [available, blocker] of capabilityBlockers) {
      if (value.blockers.includes(blocker) === available) {
        context.addIssue({
          code: "custom",
          path: ["blockers"],
          message: "publication filesystem blockers must match capabilities"
        });
      }
    }
    if (
      value.capabilities.exclusiveStagingFileCreate !==
        (value.observations.existingFileExclusiveCreate ===
          "collision_rejected") ||
      value.capabilities.directoryDurabilitySync !==
        (value.observations.directorySync === "synced") ||
      value.capabilities.atomicNoReplaceFilePublish !==
        (value.observations.existingFileHardLink === "collision_rejected")
    ) {
      context.addIssue({
        code: "custom",
        path: ["observations"],
        message: "publication filesystem observations must match capabilities"
      });
    }
  });

export const officialMarketCalendarPublicationFilesystemPreflightSchema =
  preflightPayloadSchema.safeExtend({ preflightHash: sha256HashSchema }).strict();

export type OfficialMarketCalendarPublicationFilesystemPreflight = z.infer<
  typeof officialMarketCalendarPublicationFilesystemPreflightSchema
>;
export type OfficialMarketCalendarPublicationFilesystemPreflightPayload = z.infer<
  typeof preflightPayloadSchema
>;

export async function inspectOfficialMarketCalendarPublicationFilesystem(): Promise<
  OfficialMarketCalendarPublicationFilesystemPreflight
> {
  const prefix = "toss-calendar-publication-preflight-";
  const probeRoot = await mkdtemp(join(tmpdir(), prefix));
  try {
    const filePath = join(probeRoot, "exclusive-file");
    const exclusiveStagingFileCreate = await probeExclusiveFile(filePath);
    const fileDurabilitySync = await probeFileSync(join(probeRoot, "sync-file"));
    const directorySync = await probeDirectorySync(probeRoot);
    const hardLink = await probeExistingFileHardLink(probeRoot);
    const directoryRename = await probeExistingDirectoryRename(probeRoot);
    const blockers: OfficialMarketCalendarPublicationFilesystemPreflightPayload["blockers"] = [
      "atomic_no_replace_directory_publish_unavailable"
    ];
    if (directorySync !== "synced") {
      blockers.push("directory_durability_sync_unavailable");
    }
    if (exclusiveStagingFileCreate !== "collision_rejected") {
      blockers.push("exclusive_staging_file_create_unavailable");
    }
    if (!fileDurabilitySync) {
      blockers.push("file_durability_sync_unavailable");
    }
    if (hardLink !== "collision_rejected") {
      blockers.push("atomic_no_replace_file_publish_unavailable");
    }
    blockers.sort();
    const payload = preflightPayloadSchema.parse({
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_PUBLICATION_FILESYSTEM_PREFLIGHT_SCHEMA_VERSION,
      implementationId: "node_fs_promises.v1",
      platform: process.platform,
      status: "unsupported",
      capabilities: {
        exclusiveStagingFileCreate:
          exclusiveStagingFileCreate === "collision_rejected",
        fileDurabilitySync,
        directoryDurabilitySync: directorySync === "synced",
        atomicNoReplaceFilePublish: hardLink === "collision_rejected",
        atomicNoReplaceDirectoryPublish: false
      },
      observations: {
        existingFileExclusiveCreate: exclusiveStagingFileCreate,
        directorySync,
        existingFileHardLink: hardLink,
        existingDirectoryRename: directoryRename
      },
      blockers
    });
    return Object.freeze({
      ...payload,
      preflightHash:
        createOfficialMarketCalendarPublicationFilesystemPreflightHash(payload)
    });
  } finally {
    await removeVerifiedProbeRoot(probeRoot, prefix);
  }
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
  return Object.freeze(parsed);
}

export function assertOfficialMarketCalendarPublicationFilesystemSupported(
  value: unknown
): never {
  const preflight = parseOfficialMarketCalendarPublicationFilesystemPreflight(value);
  throw new Error(
    `official calendar publication filesystem is unsupported: ${preflight.blockers.join(",")}`
  );
}

export function createOfficialMarketCalendarPublicationFilesystemPreflightHash(
  value: OfficialMarketCalendarPublicationFilesystemPreflightPayload
): Sha256Hash {
  return createReplayResearchHash(preflightPayloadSchema.parse(value));
}

async function probeExclusiveFile(path: string) {
  await writeFile(path, "existing", { flag: "wx" });
  try {
    const handle = await open(path, "wx");
    await handle.close();
    return "unexpectedly_opened" as const;
  } catch (error) {
    return isNodeError(error) && error.code === "EEXIST"
      ? "collision_rejected" as const
      : "probe_failed" as const;
  }
}

async function probeFileSync(path: string): Promise<boolean> {
  try {
    const handle = await open(path, "wx");
    try {
      await handle.writeFile("sync");
      await handle.sync();
      return true;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function probeDirectorySync(path: string) {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
      return "synced" as const;
    } finally {
      await handle.close();
    }
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM"
      ? "unsupported" as const
      : "probe_failed" as const;
  }
}

async function probeExistingFileHardLink(root: string) {
  const source = join(root, "link-source");
  const destination = join(root, "link-destination");
  await Promise.all([
    writeFile(source, "source", { flag: "wx" }),
    writeFile(destination, "destination", { flag: "wx" })
  ]);
  try {
    await link(source, destination);
    return "unexpectedly_linked" as const;
  } catch (error) {
    return isNodeError(error) && error.code === "EEXIST"
      ? "collision_rejected" as const
      : "probe_failed" as const;
  }
}

async function probeExistingDirectoryRename(root: string) {
  const source = join(root, "rename-source");
  const destination = join(root, "rename-destination");
  await Promise.all([mkdir(source), mkdir(destination)]);
  await writeFile(join(source, "marker"), "source", { flag: "wx" });
  try {
    await rename(source, destination);
    return "destination_replaced" as const;
  } catch (error) {
    return isNodeError(error) && ["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code ?? "")
      ? "collision_rejected" as const
      : "probe_failed" as const;
  }
}

async function removeVerifiedProbeRoot(root: string, prefix: string): Promise<void> {
  const [resolvedTemp, resolvedRoot] = await Promise.all([
    realpath(tmpdir()),
    realpath(root)
  ]);
  const relativeRoot = relative(resolvedTemp, resolvedRoot);
  if (
    isAbsolute(relativeRoot) ||
    relativeRoot === ".." ||
    relativeRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    !relativeRoot.startsWith(prefix)
  ) {
    throw new Error("publication preflight cleanup root escaped the system temp directory");
  }
  await rm(resolvedRoot, { recursive: true, force: false });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
