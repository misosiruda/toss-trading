import { createHash } from "node:crypto";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy,
  type OfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition
} from "./officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOCUMENT_IDENTITY_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_document_identity.v2";

type LegacyDocument =
  OfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition["documents"][number];
type LegacyFileName = LegacyDocument["fileName"];

export interface OfficialMarketCalendarKrxLegacyDocumentIdentityInput {
  fileName: LegacyFileName;
  rawDocumentBytes: Uint8Array;
}

export interface VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOCUMENT_IDENTITY_SCHEMA_VERSION;
  fileName: LegacyFileName;
  targetYear: LegacyDocument["targetYear"];
  contentLength: number;
  sourceDocumentHash: `sha256:${string}`;
  containerFormat: "ole_compound_file_signature_only";
  oleCompoundFileSignature: LegacyDocument["oleCompoundFileSignature"];
  identityVerified: true;
  identityVerificationAuthority:
    | "registered_source_policy"
    | "test_only_expectation";
  parserStatus: "not_verified";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyDocumentIdentityErrorCode =
  | "KRX_LEGACY_DOCUMENT_IDENTITY_INVALID_CONFIG"
  | "KRX_LEGACY_DOCUMENT_IDENTITY_INVALID_INPUT"
  | "KRX_LEGACY_DOCUMENT_IDENTITY_LENGTH_MISMATCH"
  | "KRX_LEGACY_DOCUMENT_IDENTITY_CONTAINER_MISMATCH"
  | "KRX_LEGACY_DOCUMENT_IDENTITY_HASH_MISMATCH";

export class OfficialMarketCalendarKrxLegacyDocumentIdentityError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyDocumentIdentityErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyDocumentIdentityError";
  }
}

export interface TestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityExpectation {
  fileName: LegacyFileName;
  targetYear: LegacyDocument["targetYear"];
  contentLength: number;
  sha256: string;
  oleCompoundFileSignature: LegacyDocument["oleCompoundFileSignature"];
}

export interface TestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier {
  verify(
    input: OfficialMarketCalendarKrxLegacyDocumentIdentityInput
  ): VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity;
}

interface DocumentIdentityExpectation {
  fileName: LegacyFileName;
  targetYear: LegacyDocument["targetYear"];
  contentLength: number;
  sha256: string;
  oleCompoundFileSignature: LegacyDocument["oleCompoundFileSignature"];
}

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype
) as object;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength"
)?.get;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer"
)?.get;
const sharedArrayBufferByteLengthGetter =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
        SharedArrayBuffer.prototype,
        "byteLength"
      )?.get;

export function verifyOfficialMarketCalendarKrxLegacyDocumentIdentity(
  input: OfficialMarketCalendarKrxLegacyDocumentIdentityInput
): VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity {
  const parsed = parseInput(input);
  const document = resolveRegisteredDocument(parsed.fileName);
  return verifyAgainstExpectation(
    parsed.rawDocumentBytes,
    document,
    "registered_source_policy"
  );
}

export function createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier(
  expectation: TestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityExpectation
): TestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier {
  const snapshot = snapshotTestExpectation(expectation);
  return Object.freeze({
    verify(input: OfficialMarketCalendarKrxLegacyDocumentIdentityInput) {
      const parsed = parseInput(input);
      if (parsed.fileName !== snapshot.fileName) {
        throw identityError(
          "KRX_LEGACY_DOCUMENT_IDENTITY_INVALID_INPUT",
          "KRX legacy document identity input is invalid."
        );
      }
      return verifyAgainstExpectation(
        parsed.rawDocumentBytes,
        snapshot,
        "test_only_expectation"
      );
    }
  });
}

function verifyAgainstExpectation(
  rawDocumentBytes: Uint8Array,
  expected: DocumentIdentityExpectation,
  identityVerificationAuthority: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity["identityVerificationAuthority"]
): VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity {
  const contentLength = readByteLength(rawDocumentBytes);
  if (contentLength !== expected.contentLength) {
    throw identityError(
      "KRX_LEGACY_DOCUMENT_IDENTITY_LENGTH_MISMATCH",
      "KRX legacy document byte length did not match the registered identity."
    );
  }
  if (!hasExpectedOleSignature(rawDocumentBytes, expected.oleCompoundFileSignature)) {
    throw identityError(
      "KRX_LEGACY_DOCUMENT_IDENTITY_CONTAINER_MISMATCH",
      "KRX legacy document container signature did not match the registered identity."
    );
  }
  const actualHash = createHash("sha256")
    .update(rawDocumentBytes)
    .digest("hex");
  if (actualHash !== expected.sha256) {
    throw identityError(
      "KRX_LEGACY_DOCUMENT_IDENTITY_HASH_MISMATCH",
      "KRX legacy document hash did not match the registered identity."
    );
  }
  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOCUMENT_IDENTITY_SCHEMA_VERSION,
    fileName: expected.fileName,
    targetYear: expected.targetYear,
    contentLength,
    sourceDocumentHash: `sha256:${actualHash}`,
    containerFormat: "ole_compound_file_signature_only",
    oleCompoundFileSignature: expected.oleCompoundFileSignature,
    identityVerified: true,
    identityVerificationAuthority,
    parserStatus: "not_verified",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function parseInput(
  value: unknown
): Readonly<OfficialMarketCalendarKrxLegacyDocumentIdentityInput> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid input");
    }
    const keys = Object.keys(value);
    if (
      keys.length !== 2 ||
      !keys.includes("fileName") ||
      !keys.includes("rawDocumentBytes")
    ) {
      throw new Error("invalid input shape");
    }
    const input = value as Record<string, unknown>;
    const fileName = resolveRegisteredDocument(input.fileName).fileName;
    const rawDocumentBytes = input.rawDocumentBytes;
    readByteLength(rawDocumentBytes);
    return Object.freeze({
      fileName,
      rawDocumentBytes: rawDocumentBytes as Uint8Array
    });
  } catch (error) {
    if (error instanceof OfficialMarketCalendarKrxLegacyDocumentIdentityError) {
      throw error;
    }
    throw identityError(
      "KRX_LEGACY_DOCUMENT_IDENTITY_INVALID_INPUT",
      "KRX legacy document identity input is invalid."
    );
  }
}

function snapshotTestExpectation(
  value: unknown
): Readonly<DocumentIdentityExpectation> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid expectation");
    }
    const keys = Object.keys(value);
    if (
      keys.length !== 5 ||
      !keys.includes("fileName") ||
      !keys.includes("targetYear") ||
      !keys.includes("contentLength") ||
      !keys.includes("sha256") ||
      !keys.includes("oleCompoundFileSignature")
    ) {
      throw new Error("invalid expectation shape");
    }
    const input = value as Record<string, unknown>;
    const document = resolveRegisteredDocument(input.fileName);
    if (
      input.targetYear !== document.targetYear ||
      !Number.isSafeInteger(input.contentLength) ||
      (input.contentLength as number) < 8 ||
      (input.contentLength as number) > 1_048_576 ||
      typeof input.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.sha256) ||
      input.oleCompoundFileSignature !== document.oleCompoundFileSignature
    ) {
      throw new Error("invalid expectation fields");
    }
    return Object.freeze({
      fileName: document.fileName,
      targetYear: document.targetYear,
      contentLength: input.contentLength as number,
      sha256: input.sha256,
      oleCompoundFileSignature: document.oleCompoundFileSignature
    });
  } catch {
    throw identityError(
      "KRX_LEGACY_DOCUMENT_IDENTITY_INVALID_CONFIG",
      "KRX legacy document test-only identity expectation is invalid."
    );
  }
}

function resolveRegisteredDocument(value: unknown): LegacyDocument {
  const policy =
    resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION
    );
  const document = policy.documents.find(
    (candidate) => candidate.fileName === value
  );
  if (document === undefined) {
    throw new Error("unregistered document");
  }
  return document;
}

function readByteLength(value: unknown): number {
  if (
    Object.getPrototypeOf(value) !== Uint8Array.prototype ||
    typedArrayByteLengthGetter === undefined ||
    typedArrayBufferGetter === undefined
  ) {
    throw new Error("invalid byte view");
  }
  const byteLength = typedArrayByteLengthGetter.call(value) as number;
  const buffer = typedArrayBufferGetter.call(value) as ArrayBufferLike;
  if (byteLength < 8 || hasSharedArrayBufferBacking(buffer)) {
    throw new Error("invalid byte view backing");
  }
  return byteLength;
}

function hasSharedArrayBufferBacking(buffer: ArrayBufferLike): boolean {
  if (sharedArrayBufferByteLengthGetter === undefined) {
    return false;
  }
  try {
    sharedArrayBufferByteLengthGetter.call(buffer);
    return true;
  } catch {
    return false;
  }
}

function hasExpectedOleSignature(
  value: Uint8Array,
  expectedHex: string
): boolean {
  if (value.byteLength < 8) {
    return false;
  }
  for (let index = 0; index < 8; index += 1) {
    if (value[index] !== Number.parseInt(expectedHex.slice(index * 2, index * 2 + 2), 16)) {
      return false;
    }
  }
  return true;
}

function identityError(
  code: OfficialMarketCalendarKrxLegacyDocumentIdentityErrorCode,
  message: string
): OfficialMarketCalendarKrxLegacyDocumentIdentityError {
  return new OfficialMarketCalendarKrxLegacyDocumentIdentityError(code, message);
}
