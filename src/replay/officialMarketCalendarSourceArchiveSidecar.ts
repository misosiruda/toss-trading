import { createHash } from "node:crypto";

import { z } from "zod";

import {
  resolveOfficialMarketCalendarSourceArchiveBindings,
  type OfficialMarketCalendarSourceArchiveBinding
} from "./officialMarketCalendarSourceArchiveBinding.js";

const sourceArchiveSidecarSchema = z
  .object({
    archivePath: z.string().min(1),
    bytes: z.instanceof(Uint8Array)
  })
  .strict();

export interface OfficialMarketCalendarSourceArchiveSidecar {
  archivePath: string;
  bytes: Uint8Array;
}

export interface VerifiedOfficialMarketCalendarSourceArchiveSidecar {
  archivePath: string;
  sourceDocumentHash: string;
  contentLength: number;
}

export function verifyOfficialMarketCalendarSourceArchiveSidecars(input: {
  bindings: readonly unknown[];
  collections: readonly unknown[];
  sidecars: readonly unknown[];
}): VerifiedOfficialMarketCalendarSourceArchiveSidecar[] {
  const resolvedBindings =
    resolveOfficialMarketCalendarSourceArchiveBindings(input.bindings, {
      collections: input.collections
    });
  const expectedByPath = new Map<
    string,
    OfficialMarketCalendarSourceArchiveBinding
  >();
  for (const { binding } of resolvedBindings) {
    expectedByPath.set(binding.archivePath, binding);
  }

  const sidecars = input.sidecars.map((sidecar) =>
    sourceArchiveSidecarSchema.parse(sidecar)
  );
  const verified: VerifiedOfficialMarketCalendarSourceArchiveSidecar[] = [];
  let previousPath: string | null = null;
  for (const sidecar of sidecars) {
    if (
      previousPath !== null &&
      compareCanonicalText(previousPath, sidecar.archivePath) >= 0
    ) {
      throw new Error(
        "official calendar source archive sidecars must use unique canonical paths"
      );
    }
    previousPath = sidecar.archivePath;

    const expected = expectedByPath.get(sidecar.archivePath);
    if (expected === undefined) {
      throw new Error(
        "official calendar source archive contains an unreferenced sidecar"
      );
    }
    if (sidecar.bytes.byteLength !== expected.contentLength) {
      throw new Error(
        "official calendar source archive sidecar length mismatch"
      );
    }
    const actualHash = hashBytes(sidecar.bytes);
    if (actualHash !== expected.sourceDocumentHash) {
      throw new Error(
        "official calendar source archive sidecar hash mismatch"
      );
    }
    verified.push({
      archivePath: sidecar.archivePath,
      sourceDocumentHash: actualHash,
      contentLength: sidecar.bytes.byteLength
    });
  }

  if (verified.length !== expectedByPath.size) {
    throw new Error(
      "official calendar source archive is missing a referenced sidecar"
    );
  }
  return verified;
}

function hashBytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function compareCanonicalText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
