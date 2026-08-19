import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";
import {
  parseOfficialMarketCalendarSourceCollection
} from "./officialMarketCalendarSourceCollection.js";
import {
  officialCalendarSourceDocumentRefSchema,
  resolveOfficialCalendarSourceDocumentRefs,
  type OfficialCalendarSourceDocumentRef
} from "./officialMarketCalendarSessionProvenance.js";

const archivePathSchema = z
  .string()
  .regex(
    /^sources\/sha256\/[a-f0-9]{64}\.bin$/,
    "source archive path must use the hash-addressed package namespace"
  );

export const officialMarketCalendarSourceArchiveBindingSchema = z
  .object({
    sourceDocumentRef: officialCalendarSourceDocumentRefSchema,
    archivePath: archivePathSchema,
    sourceDocumentHash: sha256HashSchema,
    contentLength: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
  })
  .strict()
  .superRefine((value, context) => {
    const expectedPath = createOfficialMarketCalendarSourceArchivePath(
      value.sourceDocumentHash
    );
    if (value.archivePath !== expectedPath) {
      context.addIssue({
        code: "custom",
        path: ["archivePath"],
        message: "source archive path must match source document hash"
      });
    }
  });

export type OfficialMarketCalendarSourceArchiveBinding = z.infer<
  typeof officialMarketCalendarSourceArchiveBindingSchema
>;

export interface ResolvedOfficialMarketCalendarSourceArchiveBinding {
  binding: OfficialMarketCalendarSourceArchiveBinding;
  collectionHash: string;
  metadataHash: string;
}

export function resolveOfficialMarketCalendarSourceArchiveBindings(
  values: readonly unknown[],
  options: { collections: readonly unknown[] }
): ResolvedOfficialMarketCalendarSourceArchiveBinding[] {
  const bindings = values.map((value) =>
    officialMarketCalendarSourceArchiveBindingSchema.parse(value)
  );
  const resolvedRefs = resolveOfficialCalendarSourceDocumentRefs(
    bindings.map(({ sourceDocumentRef }) => sourceDocumentRef),
    options.collections
  );
  const expectedRefs = options.collections
    .map((value) => parseOfficialMarketCalendarSourceCollection(value))
    .flatMap((collection) =>
      collection.documents.map((document) => ({
        exchange: collection.exchange,
        collectionId: collection.collectionId,
        documentId: document.documentId
      }))
    )
    .sort(compareSourceDocumentRefs);

  if (
    expectedRefs.length !== bindings.length ||
    expectedRefs.some(
      (expected, index) =>
        compareSourceDocumentRefs(
          expected,
          bindings[index]!.sourceDocumentRef
        ) !== 0
    )
  ) {
    throw new Error(
      "official calendar source archive bindings must cover every collection document"
    );
  }

  const contentLengthByPath = new Map<string, number>();
  return bindings.map((binding, index) => {
    const resolved = resolvedRefs[index]!;
    if (binding.sourceDocumentHash !== resolved.sourceDocumentHash) {
      throw new Error(
        "official calendar source archive binding hash must match collection document"
      );
    }
    const existingLength = contentLengthByPath.get(binding.archivePath);
    if (
      existingLength !== undefined &&
      existingLength !== binding.contentLength
    ) {
      throw new Error(
        "official calendar shared source archive path must use one content length"
      );
    }
    contentLengthByPath.set(binding.archivePath, binding.contentLength);
    return {
      binding,
      collectionHash: resolved.collectionHash,
      metadataHash: resolved.metadataHash
    };
  });
}

export function createOfficialMarketCalendarSourceArchivePath(
  sourceDocumentHash: string
): string {
  return `sources/sha256/${sourceDocumentHash.slice("sha256:".length)}.bin`;
}

function compareSourceDocumentRefs(
  left: OfficialCalendarSourceDocumentRef,
  right: OfficialCalendarSourceDocumentRef
): number {
  return (
    compareCanonicalText(left.exchange, right.exchange) ||
    compareCanonicalText(left.collectionId, right.collectionId) ||
    compareCanonicalText(left.documentId, right.documentId)
  );
}

function compareCanonicalText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
