import { isAbsolute } from "node:path";
import { open, realpath } from "node:fs/promises";

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
    publicationRootIdentityHash: sha256HashSchema,
    status: z.literal("unsupported"),
    capabilities: z
      .object({
        exclusiveStagingFileCreate: z.literal(false),
        fileDurabilitySync: z.literal(false),
        directoryDurabilitySync: z.boolean(),
        atomicNoReplaceFilePublish: z.literal(false),
        atomicNoReplaceDirectoryPublish: z.literal(false)
      })
      .strict(),
    observations: z
      .object({
        existingFileExclusiveCreate: z.literal(
          "not_probed_safe_cleanup_unavailable"
        ),
        fileSync: z.literal("not_probed_safe_cleanup_unavailable"),
        directorySync: z.enum(["synced", "unsupported", "probe_failed"]),
        freshFileHardLink: z.literal("not_probed_safe_cleanup_unavailable"),
        existingFileHardLink: z.literal("not_probed_safe_cleanup_unavailable"),
        existingDirectoryRename: z.literal(
          "not_probed_safe_cleanup_unavailable"
        )
      })
      .strict(),
    blockers: z.array(z.enum([
      "atomic_no_replace_directory_publish_unavailable",
      "directory_durability_sync_unavailable",
      "exclusive_staging_file_create_unavailable",
      "file_durability_sync_unavailable",
      "atomic_no_replace_file_publish_unavailable",
      "safe_mutation_probe_cleanup_unavailable"
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
    if (!value.blockers.includes("safe_mutation_probe_cleanup_unavailable")) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "publication filesystem safe mutation probe blocker is required"
      });
    }
    if (
      value.capabilities.directoryDurabilitySync !==
      (value.observations.directorySync === "synced")
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

export async function inspectOfficialMarketCalendarPublicationFilesystem(input: {
  publicationRoot: string;
}): Promise<OfficialMarketCalendarPublicationFilesystemPreflight> {
  if (!isAbsolute(input.publicationRoot)) {
    throw new Error("publication filesystem preflight root must be absolute");
  }
  const publicationRoot = await realpath(input.publicationRoot);
  const directorySync = await probeDirectorySync(publicationRoot);
  const blockers: OfficialMarketCalendarPublicationFilesystemPreflightPayload["blockers"] = [
    "atomic_no_replace_directory_publish_unavailable",
    "atomic_no_replace_file_publish_unavailable",
    "exclusive_staging_file_create_unavailable",
    "file_durability_sync_unavailable",
    "safe_mutation_probe_cleanup_unavailable"
  ];
  if (directorySync !== "synced") {
    blockers.push("directory_durability_sync_unavailable");
  }
  blockers.sort();
  const payload = preflightPayloadSchema.parse({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_PUBLICATION_FILESYSTEM_PREFLIGHT_SCHEMA_VERSION,
    implementationId: "node_fs_promises.v1",
    platform: process.platform,
    publicationRootIdentityHash: createReplayResearchHash(publicationRoot),
    status: "unsupported",
    capabilities: {
      exclusiveStagingFileCreate: false,
      fileDurabilitySync: false,
      directoryDurabilitySync: directorySync === "synced",
      atomicNoReplaceFilePublish: false,
      atomicNoReplaceDirectoryPublish: false
    },
    observations: {
      existingFileExclusiveCreate: "not_probed_safe_cleanup_unavailable",
      fileSync: "not_probed_safe_cleanup_unavailable",
      directorySync,
      freshFileHardLink: "not_probed_safe_cleanup_unavailable",
      existingFileHardLink: "not_probed_safe_cleanup_unavailable",
      existingDirectoryRename: "not_probed_safe_cleanup_unavailable"
    },
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

async function probeDirectorySync(path: string) {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    return "probe_failed" as const;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isDirectory()) {
      throw new Error("publication filesystem preflight root must be a directory");
    }
    try {
      await handle.sync();
      return "synced" as const;
    } catch (error) {
      return isNodeError(error) && error.code === "EPERM"
        ? "unsupported" as const
        : "probe_failed" as const;
    }
  } finally {
    await handle.close();
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
