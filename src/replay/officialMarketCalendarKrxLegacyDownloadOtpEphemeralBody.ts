import type { ClientRequest, IncomingMessage } from "node:http";
import {
  Agent as HttpsAgent,
  request as httpsRequest,
  type RequestOptions
} from "node:https";
import { isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy,
  type OfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition
} from "./officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy.js";
import { verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody } from "./officialMarketCalendarKrxLegacyDownloadOtpResponseBody.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_NETWORK_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicy,
  type OfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition
} from "./officialMarketCalendarKrxLegacyDownloadPostNetworkPolicy.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostWirePolicy
} from "./officialMarketCalendarKrxLegacyDownloadPostWirePolicy.js";
import {
  verifyOfficialMarketCalendarKrxLegacyDocumentIdentity,
  type TestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier,
  type VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity
} from "./officialMarketCalendarKrxLegacyDocumentIdentity.js";
import {
  verifyOfficialMarketCalendarOleCompoundFileHeader,
  type VerifiedOfficialMarketCalendarOleCompoundFileHeader
} from "./officialMarketCalendarOleCompoundFileHeader.js";
import {
  verifyOfficialMarketCalendarOleCompoundFileDifat,
  type VerifiedOfficialMarketCalendarOleCompoundFileDifat
} from "./officialMarketCalendarOleCompoundFileDifat.js";
import {
  verifyOfficialMarketCalendarOleCompoundFileFat,
  type VerifiedOfficialMarketCalendarOleCompoundFileFat
} from "./officialMarketCalendarOleCompoundFileFat.js";
import {
  verifyOfficialMarketCalendarOleCompoundFileSystemChains,
  type VerifiedOfficialMarketCalendarOleCompoundFileSystemChains
} from "./officialMarketCalendarOleCompoundFileSystemChains.js";
import {
  verifyOfficialMarketCalendarOleCompoundFileDirectoryEntries,
  type VerifiedOfficialMarketCalendarOleCompoundFileDirectoryEntries,
  type VerifiedOfficialMarketCalendarOleDirectoryEntry
} from "./officialMarketCalendarOleCompoundFileDirectoryEntries.js";
import {
  verifyOfficialMarketCalendarOleCompoundFileDirectoryTree,
  type VerifiedOfficialMarketCalendarOleCompoundFileDirectoryTree
} from "./officialMarketCalendarOleCompoundFileDirectoryTree.js";
import {
  verifyOfficialMarketCalendarOleCompoundFileMiniFatEntries,
  type VerifiedOfficialMarketCalendarOleCompoundFileMiniFatEntries
} from "./officialMarketCalendarOleCompoundFileMiniFatEntries.js";
import {
  verifyOfficialMarketCalendarOleCompoundFileRootMiniStream,
  type VerifiedOfficialMarketCalendarOleCompoundFileRootMiniStream
} from "./officialMarketCalendarOleCompoundFileRootMiniStream.js";
import {
  verifyOfficialMarketCalendarOleCompoundFileUserStreamAllocation,
  type VerifiedOfficialMarketCalendarOleCompoundFileUserStreamAllocation
} from "./officialMarketCalendarOleCompoundFileUserStreamAllocation.js";
import {
  projectOfficialMarketCalendarOleCompoundFileUserStreamBytes,
  type ProjectedOfficialMarketCalendarOleCompoundFileUserStreamBytes
} from "./officialMarketCalendarOleCompoundFileUserStreamBytes.js";
import {
  verifyOfficialMarketCalendarKrxLegacyWordBinaryFileStreams,
  type VerifiedOfficialMarketCalendarKrxLegacyWordBinaryFileStreams
} from "./officialMarketCalendarKrxLegacyWordBinaryFileStreams.js";
import {
  verifyOfficialMarketCalendarKrxLegacyWordFib,
  type VerifiedOfficialMarketCalendarKrxLegacyWordFib
} from "./officialMarketCalendarKrxLegacyWordFib.js";
import {
  verifyOfficialMarketCalendarKrxLegacyWordClxReference,
  type VerifiedOfficialMarketCalendarKrxLegacyWordClxReference
} from "./officialMarketCalendarKrxLegacyWordClxReference.js";
import {
  verifyOfficialMarketCalendarKrxLegacyWordClx,
  type VerifiedOfficialMarketCalendarKrxLegacyWordClx
} from "./officialMarketCalendarKrxLegacyWordClx.js";
import {
  verifyOfficialMarketCalendarKrxLegacyWordPlcPcd,
  type VerifiedOfficialMarketCalendarKrxLegacyWordPlcPcd
} from "./officialMarketCalendarKrxLegacyWordPlcPcd.js";
import {
  verifyOfficialMarketCalendarKrxLegacyWordPcdPrms,
  type VerifiedOfficialMarketCalendarKrxLegacyWordPcdPrms
} from "./officialMarketCalendarKrxLegacyWordPcdPrm.js";
import {
  verifyOfficialMarketCalendarKrxLegacyWordPrcGrpPrls,
  type VerifiedOfficialMarketCalendarKrxLegacyWordPrcGrpPrls
} from "./officialMarketCalendarKrxLegacyWordPrcGrpPrl.js";
import {
  verifyOfficialMarketCalendarKrxLegacyWordDocumentCounts,
  type VerifiedOfficialMarketCalendarKrxLegacyWordDocumentCounts
} from "./officialMarketCalendarKrxLegacyWordDocumentCounts.js";
import {
  verifyOfficialMarketCalendarKrxLegacyWordTextRanges,
  type VerifiedOfficialMarketCalendarKrxLegacyWordTextRanges
} from "./officialMarketCalendarKrxLegacyWordTextRanges.js";
import {
  projectOfficialMarketCalendarKrxLegacyWordTextBytes,
  type ProjectedOfficialMarketCalendarKrxLegacyWordTextBytes
} from "./officialMarketCalendarKrxLegacyWordTextBytes.js";
import {
  decodeOfficialMarketCalendarKrxLegacyWordText,
  type DecodedOfficialMarketCalendarKrxLegacyWordText
} from "./officialMarketCalendarKrxLegacyWordTextDecoding.js";
import {
  verifyOfficialMarketCalendarKrxLegacyWordMainDocument,
  type VerifiedOfficialMarketCalendarKrxLegacyWordMainDocument
} from "./officialMarketCalendarKrxLegacyWordMainDocument.js";

declare const krxLegacyDownloadOtpEphemeralBodyBrand: unique symbol;
declare const krxLegacyDownloadEphemeralParametersBrand: unique symbol;
declare const krxLegacyDownloadPostEphemeralWireBodyBrand: unique symbol;
declare const krxLegacyDownloadEphemeralResponseBrand: unique symbol;
declare const krxLegacyDownloadIdentityVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadOleHeaderVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadDifatVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadFatVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadSystemChainsVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadDirectoryEntriesVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadDirectoryTreeVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadMiniFatEntriesVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadRootMiniStreamVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadUserStreamAllocationVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadUserStreamBytesProjectedDocumentBrand: unique symbol;
declare const krxLegacyDownloadWordStreamsVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadWordFibVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadWordClxReferenceVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadWordClxVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadWordPlcPcdVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadWordPcdPrmVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadWordPrcGrpPrlVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadWordDocumentCountsVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadWordTextRangesVerifiedDocumentBrand: unique symbol;
declare const krxLegacyDownloadWordTextBytesProjectedDocumentBrand: unique symbol;
declare const krxLegacyDownloadWordTextDecodedDocumentBrand: unique symbol;
declare const krxLegacyDownloadWordMainDocumentVerifiedDocumentBrand: unique symbol;

export interface OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody {
  readonly [krxLegacyDownloadOtpEphemeralBodyBrand]: true;
  toJSON(): never;
}

export interface CreateOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBodyInput {
  rawResponseBytes: Uint8Array;
  requestedFileName: unknown;
}

export interface OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters {
  readonly [krxLegacyDownloadEphemeralParametersBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody {
  readonly [krxLegacyDownloadPostEphemeralWireBodyBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse {
  readonly [krxLegacyDownloadEphemeralResponseBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadIdentityVerifiedDocument {
  readonly [krxLegacyDownloadIdentityVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadOleHeaderVerifiedDocument {
  readonly [krxLegacyDownloadOleHeaderVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadDifatVerifiedDocument {
  readonly [krxLegacyDownloadDifatVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadFatVerifiedDocument {
  readonly [krxLegacyDownloadFatVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadSystemChainsVerifiedDocument {
  readonly [krxLegacyDownloadSystemChainsVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadDirectoryEntriesVerifiedDocument {
  readonly [krxLegacyDownloadDirectoryEntriesVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadDirectoryTreeVerifiedDocument {
  readonly [krxLegacyDownloadDirectoryTreeVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadMiniFatEntriesVerifiedDocument {
  readonly [krxLegacyDownloadMiniFatEntriesVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadRootMiniStreamVerifiedDocument {
  readonly [krxLegacyDownloadRootMiniStreamVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadUserStreamAllocationVerifiedDocument {
  readonly [krxLegacyDownloadUserStreamAllocationVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadUserStreamBytesProjectedDocument {
  readonly [krxLegacyDownloadUserStreamBytesProjectedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadWordStreamsVerifiedDocument {
  readonly [krxLegacyDownloadWordStreamsVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadWordFibVerifiedDocument {
  readonly [krxLegacyDownloadWordFibVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadWordClxReferenceVerifiedDocument {
  readonly [krxLegacyDownloadWordClxReferenceVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadWordClxVerifiedDocument {
  readonly [krxLegacyDownloadWordClxVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadWordPlcPcdVerifiedDocument {
  readonly [krxLegacyDownloadWordPlcPcdVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadWordPcdPrmVerifiedDocument {
  readonly [krxLegacyDownloadWordPcdPrmVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadWordPrcGrpPrlVerifiedDocument {
  readonly [krxLegacyDownloadWordPrcGrpPrlVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadWordDocumentCountsVerifiedDocument {
  readonly [krxLegacyDownloadWordDocumentCountsVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadWordTextRangesVerifiedDocument {
  readonly [krxLegacyDownloadWordTextRangesVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadWordTextBytesProjectedDocument {
  readonly [krxLegacyDownloadWordTextBytesProjectedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadWordTextDecodedDocument {
  readonly [krxLegacyDownloadWordTextDecodedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadWordMainDocumentVerifiedDocument {
  readonly [krxLegacyDownloadWordMainDocumentVerifiedDocumentBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadNetworkConsumer {
  consume(
    handle: OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody
  ): Promise<OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse>;
}

export interface TestOnlyOfficialMarketCalendarKrxLegacyDownloadSocketConnector {
  dialAddress: string;
  dialPort: number;
  certificateAuthority: string;
  deadlineMs?: number;
}

export type OfficialMarketCalendarKrxLegacyDownloadNetworkErrorCode =
  | "KRX_LEGACY_DOWNLOAD_NETWORK_INVALID_CONFIG"
  | "KRX_LEGACY_DOWNLOAD_NETWORK_FAILURE"
  | "KRX_LEGACY_DOWNLOAD_NETWORK_DEADLINE_EXCEEDED"
  | "KRX_LEGACY_DOWNLOAD_NETWORK_RESPONSE_REJECTED"
  | "KRX_LEGACY_DOWNLOAD_NETWORK_RESPONSE_TOO_LARGE"
  | "KRX_LEGACY_DOWNLOAD_NETWORK_INCOMPLETE_RESPONSE";

export class OfficialMarketCalendarKrxLegacyDownloadNetworkError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyDownloadNetworkErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyDownloadNetworkError";
  }
}

type LegacyDocument =
  OfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition["documents"][number];
type LegacyFileName = LegacyDocument["fileName"];

interface ReadyBodyState {
  status: "ready";
  rawResponseBytes: Uint8Array;
  fileName: LegacyFileName;
}

interface ReadyParametersState {
  status: "ready";
  rawOtpBytes: Uint8Array;
  fileName: LegacyFileName;
}

interface DisposedState {
  status: "disposed";
}

type BodyState = ReadyBodyState | DisposedState;
type ParametersState = ReadyParametersState | DisposedState;

interface ReadyWireBodyState {
  status: "ready";
  bodyBytes: Uint8Array;
  fileName: LegacyFileName;
  requestContentType: "application/x-www-form-urlencoded";
}

interface ReadyResponseState {
  status: "ready";
  rawResponseBytes: Uint8Array;
  fileName: LegacyFileName;
  contentLength: LegacyDocument["contentLength"];
}

interface ReadyIdentityVerifiedDocumentState {
  status: "ready";
  rawDocumentBytes: Uint8Array;
  identity: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity;
}

interface ReadyOleHeaderVerifiedDocumentState {
  status: "ready";
  rawDocumentBytes: Uint8Array;
  identity: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity;
  oleHeader: VerifiedOfficialMarketCalendarOleCompoundFileHeader;
}

interface ReadyDifatVerifiedDocumentState {
  status: "ready";
  rawDocumentBytes: Uint8Array;
  identity: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity;
  oleHeader: VerifiedOfficialMarketCalendarOleCompoundFileHeader;
  difat: VerifiedOfficialMarketCalendarOleCompoundFileDifat;
}

interface ReadyFatVerifiedDocumentState {
  status: "ready";
  rawDocumentBytes: Uint8Array;
  identity: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity;
  oleHeader: VerifiedOfficialMarketCalendarOleCompoundFileHeader;
  difat: VerifiedOfficialMarketCalendarOleCompoundFileDifat;
  fat: VerifiedOfficialMarketCalendarOleCompoundFileFat;
}

interface ReadySystemChainsVerifiedDocumentState {
  status: "ready";
  rawDocumentBytes: Uint8Array;
  identity: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity;
  oleHeader: VerifiedOfficialMarketCalendarOleCompoundFileHeader;
  difat: VerifiedOfficialMarketCalendarOleCompoundFileDifat;
  fat: VerifiedOfficialMarketCalendarOleCompoundFileFat;
  systemChains: VerifiedOfficialMarketCalendarOleCompoundFileSystemChains;
}

interface ReadyDirectoryEntriesVerifiedDocumentState {
  status: "ready";
  rawDocumentBytes: Uint8Array;
  identity: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity;
  oleHeader: VerifiedOfficialMarketCalendarOleCompoundFileHeader;
  difat: VerifiedOfficialMarketCalendarOleCompoundFileDifat;
  fat: VerifiedOfficialMarketCalendarOleCompoundFileFat;
  systemChains: VerifiedOfficialMarketCalendarOleCompoundFileSystemChains;
  directoryEntries: VerifiedOfficialMarketCalendarOleCompoundFileDirectoryEntries;
}

interface ReadyDirectoryTreeVerifiedDocumentState {
  status: "ready";
  rawDocumentBytes: Uint8Array;
  identity: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity;
  oleHeader: VerifiedOfficialMarketCalendarOleCompoundFileHeader;
  difat: VerifiedOfficialMarketCalendarOleCompoundFileDifat;
  fat: VerifiedOfficialMarketCalendarOleCompoundFileFat;
  systemChains: VerifiedOfficialMarketCalendarOleCompoundFileSystemChains;
  directoryEntries: VerifiedOfficialMarketCalendarOleCompoundFileDirectoryEntries;
  directoryTree: VerifiedOfficialMarketCalendarOleCompoundFileDirectoryTree;
}

interface ReadyMiniFatEntriesVerifiedDocumentState {
  status: "ready";
  rawDocumentBytes: Uint8Array;
  identity: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity;
  oleHeader: VerifiedOfficialMarketCalendarOleCompoundFileHeader;
  difat: VerifiedOfficialMarketCalendarOleCompoundFileDifat;
  fat: VerifiedOfficialMarketCalendarOleCompoundFileFat;
  systemChains: VerifiedOfficialMarketCalendarOleCompoundFileSystemChains;
  directoryEntries: VerifiedOfficialMarketCalendarOleCompoundFileDirectoryEntries;
  directoryTree: VerifiedOfficialMarketCalendarOleCompoundFileDirectoryTree;
  miniFatEntries: VerifiedOfficialMarketCalendarOleCompoundFileMiniFatEntries;
}

interface ReadyRootMiniStreamVerifiedDocumentState {
  status: "ready";
  rawDocumentBytes: Uint8Array;
  identity: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity;
  oleHeader: VerifiedOfficialMarketCalendarOleCompoundFileHeader;
  difat: VerifiedOfficialMarketCalendarOleCompoundFileDifat;
  fat: VerifiedOfficialMarketCalendarOleCompoundFileFat;
  systemChains: VerifiedOfficialMarketCalendarOleCompoundFileSystemChains;
  directoryEntries: VerifiedOfficialMarketCalendarOleCompoundFileDirectoryEntries;
  directoryTree: VerifiedOfficialMarketCalendarOleCompoundFileDirectoryTree;
  miniFatEntries: VerifiedOfficialMarketCalendarOleCompoundFileMiniFatEntries;
  rootMiniStream: VerifiedOfficialMarketCalendarOleCompoundFileRootMiniStream;
}

interface ReadyUserStreamAllocationVerifiedDocumentState {
  status: "ready";
  rawDocumentBytes: Uint8Array;
  identity: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity;
  oleHeader: VerifiedOfficialMarketCalendarOleCompoundFileHeader;
  difat: VerifiedOfficialMarketCalendarOleCompoundFileDifat;
  fat: VerifiedOfficialMarketCalendarOleCompoundFileFat;
  systemChains: VerifiedOfficialMarketCalendarOleCompoundFileSystemChains;
  directoryEntries: VerifiedOfficialMarketCalendarOleCompoundFileDirectoryEntries;
  directoryTree: VerifiedOfficialMarketCalendarOleCompoundFileDirectoryTree;
  miniFatEntries: VerifiedOfficialMarketCalendarOleCompoundFileMiniFatEntries;
  rootMiniStream: VerifiedOfficialMarketCalendarOleCompoundFileRootMiniStream;
  userStreamAllocation: VerifiedOfficialMarketCalendarOleCompoundFileUserStreamAllocation;
}

interface ReadyUserStreamBytesProjectedDocumentState {
  status: "ready";
  rawDocumentBytes: Uint8Array;
  identity: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity;
  oleHeader: VerifiedOfficialMarketCalendarOleCompoundFileHeader;
  difat: VerifiedOfficialMarketCalendarOleCompoundFileDifat;
  fat: VerifiedOfficialMarketCalendarOleCompoundFileFat;
  systemChains: VerifiedOfficialMarketCalendarOleCompoundFileSystemChains;
  directoryEntries: VerifiedOfficialMarketCalendarOleCompoundFileDirectoryEntries;
  directoryTree: VerifiedOfficialMarketCalendarOleCompoundFileDirectoryTree;
  miniFatEntries: VerifiedOfficialMarketCalendarOleCompoundFileMiniFatEntries;
  rootMiniStream: VerifiedOfficialMarketCalendarOleCompoundFileRootMiniStream;
  userStreamAllocation: VerifiedOfficialMarketCalendarOleCompoundFileUserStreamAllocation;
  userStreamBytes: ProjectedOfficialMarketCalendarOleCompoundFileUserStreamBytes;
}

interface ReadyWordStreamsVerifiedDocumentState {
  status: "ready";
  rawDocumentBytes: Uint8Array;
  identity: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity;
  oleHeader: VerifiedOfficialMarketCalendarOleCompoundFileHeader;
  difat: VerifiedOfficialMarketCalendarOleCompoundFileDifat;
  fat: VerifiedOfficialMarketCalendarOleCompoundFileFat;
  systemChains: VerifiedOfficialMarketCalendarOleCompoundFileSystemChains;
  directoryEntries: VerifiedOfficialMarketCalendarOleCompoundFileDirectoryEntries;
  directoryTree: VerifiedOfficialMarketCalendarOleCompoundFileDirectoryTree;
  miniFatEntries: VerifiedOfficialMarketCalendarOleCompoundFileMiniFatEntries;
  rootMiniStream: VerifiedOfficialMarketCalendarOleCompoundFileRootMiniStream;
  userStreamAllocation: VerifiedOfficialMarketCalendarOleCompoundFileUserStreamAllocation;
  userStreamBytes: ProjectedOfficialMarketCalendarOleCompoundFileUserStreamBytes;
  wordStreams: VerifiedOfficialMarketCalendarKrxLegacyWordBinaryFileStreams;
}

interface ReadyWordFibVerifiedDocumentState extends ReadyWordStreamsVerifiedDocumentState {
  wordFib: VerifiedOfficialMarketCalendarKrxLegacyWordFib;
}

interface ReadyWordClxReferenceVerifiedDocumentState extends ReadyWordFibVerifiedDocumentState {
  clxReference: VerifiedOfficialMarketCalendarKrxLegacyWordClxReference;
}

interface ReadyWordClxVerifiedDocumentState extends ReadyWordClxReferenceVerifiedDocumentState {
  clx: VerifiedOfficialMarketCalendarKrxLegacyWordClx;
}

interface ReadyWordPlcPcdVerifiedDocumentState extends ReadyWordClxVerifiedDocumentState {
  plcPcd: VerifiedOfficialMarketCalendarKrxLegacyWordPlcPcd;
}

interface ReadyWordPcdPrmVerifiedDocumentState extends ReadyWordPlcPcdVerifiedDocumentState {
  pcdPrms: VerifiedOfficialMarketCalendarKrxLegacyWordPcdPrms;
}

interface ReadyWordPrcGrpPrlVerifiedDocumentState extends ReadyWordPcdPrmVerifiedDocumentState {
  prcGrpPrls: VerifiedOfficialMarketCalendarKrxLegacyWordPrcGrpPrls;
}

interface ReadyWordDocumentCountsVerifiedDocumentState extends ReadyWordPrcGrpPrlVerifiedDocumentState {
  documentCounts: VerifiedOfficialMarketCalendarKrxLegacyWordDocumentCounts;
}

interface ReadyWordTextRangesVerifiedDocumentState extends ReadyWordDocumentCountsVerifiedDocumentState {
  textRanges: VerifiedOfficialMarketCalendarKrxLegacyWordTextRanges;
}

interface ReadyWordTextBytesProjectedDocumentState extends ReadyWordTextRangesVerifiedDocumentState {
  textBytes: ProjectedOfficialMarketCalendarKrxLegacyWordTextBytes;
}

interface ReadyWordTextDecodedDocumentState extends ReadyWordTextBytesProjectedDocumentState {
  decodedText: DecodedOfficialMarketCalendarKrxLegacyWordText;
}

interface ReadyWordMainDocumentVerifiedDocumentState extends ReadyWordTextDecodedDocumentState {
  mainDocument: VerifiedOfficialMarketCalendarKrxLegacyWordMainDocument;
}

type WireBodyState = ReadyWireBodyState | DisposedState;
type ResponseState = ReadyResponseState | DisposedState;
type IdentityVerifiedDocumentState =
  | ReadyIdentityVerifiedDocumentState
  | DisposedState;
type OleHeaderVerifiedDocumentState =
  | ReadyOleHeaderVerifiedDocumentState
  | DisposedState;
type DifatVerifiedDocumentState =
  | ReadyDifatVerifiedDocumentState
  | DisposedState;
type FatVerifiedDocumentState = ReadyFatVerifiedDocumentState | DisposedState;
type SystemChainsVerifiedDocumentState =
  | ReadySystemChainsVerifiedDocumentState
  | DisposedState;
type DirectoryEntriesVerifiedDocumentState =
  | ReadyDirectoryEntriesVerifiedDocumentState
  | DisposedState;
type DirectoryTreeVerifiedDocumentState =
  | ReadyDirectoryTreeVerifiedDocumentState
  | DisposedState;
type MiniFatEntriesVerifiedDocumentState =
  | ReadyMiniFatEntriesVerifiedDocumentState
  | DisposedState;
type RootMiniStreamVerifiedDocumentState =
  | ReadyRootMiniStreamVerifiedDocumentState
  | DisposedState;
type UserStreamAllocationVerifiedDocumentState =
  | ReadyUserStreamAllocationVerifiedDocumentState
  | DisposedState;
type UserStreamBytesProjectedDocumentState =
  | ReadyUserStreamBytesProjectedDocumentState
  | DisposedState;
type WordStreamsVerifiedDocumentState =
  | ReadyWordStreamsVerifiedDocumentState
  | DisposedState;
type WordFibVerifiedDocumentState =
  | ReadyWordFibVerifiedDocumentState
  | DisposedState;
type WordClxReferenceVerifiedDocumentState =
  | ReadyWordClxReferenceVerifiedDocumentState
  | DisposedState;
type WordClxVerifiedDocumentState =
  | ReadyWordClxVerifiedDocumentState
  | DisposedState;
type WordPlcPcdVerifiedDocumentState =
  | ReadyWordPlcPcdVerifiedDocumentState
  | DisposedState;
type WordPcdPrmVerifiedDocumentState =
  | ReadyWordPcdPrmVerifiedDocumentState
  | DisposedState;
type WordPrcGrpPrlVerifiedDocumentState =
  | ReadyWordPrcGrpPrlVerifiedDocumentState
  | DisposedState;
type WordDocumentCountsVerifiedDocumentState =
  | ReadyWordDocumentCountsVerifiedDocumentState
  | DisposedState;
type WordTextRangesVerifiedDocumentState =
  | ReadyWordTextRangesVerifiedDocumentState
  | DisposedState;
type WordTextBytesProjectedDocumentState =
  | ReadyWordTextBytesProjectedDocumentState
  | DisposedState;
type WordTextDecodedDocumentState =
  | ReadyWordTextDecodedDocumentState
  | DisposedState;
type WordMainDocumentVerifiedDocumentState =
  | ReadyWordMainDocumentVerifiedDocumentState
  | DisposedState;

const bodyStates = new WeakMap<object, BodyState>();
const parameterStates = new WeakMap<object, ParametersState>();
const wireBodyStates = new WeakMap<object, WireBodyState>();
const responseStates = new WeakMap<object, ResponseState>();
const identityVerifiedDocumentStates = new WeakMap<
  object,
  IdentityVerifiedDocumentState
>();
const oleHeaderVerifiedDocumentStates = new WeakMap<
  object,
  OleHeaderVerifiedDocumentState
>();
const difatVerifiedDocumentStates = new WeakMap<
  object,
  DifatVerifiedDocumentState
>();
const fatVerifiedDocumentStates = new WeakMap<
  object,
  FatVerifiedDocumentState
>();
const systemChainsVerifiedDocumentStates = new WeakMap<
  object,
  SystemChainsVerifiedDocumentState
>();
const directoryEntriesVerifiedDocumentStates = new WeakMap<
  object,
  DirectoryEntriesVerifiedDocumentState
>();
const directoryTreeVerifiedDocumentStates = new WeakMap<
  object,
  DirectoryTreeVerifiedDocumentState
>();
const miniFatEntriesVerifiedDocumentStates = new WeakMap<
  object,
  MiniFatEntriesVerifiedDocumentState
>();
const rootMiniStreamVerifiedDocumentStates = new WeakMap<
  object,
  RootMiniStreamVerifiedDocumentState
>();
const userStreamAllocationVerifiedDocumentStates = new WeakMap<
  object,
  UserStreamAllocationVerifiedDocumentState
>();
const userStreamBytesProjectedDocumentStates = new WeakMap<
  object,
  UserStreamBytesProjectedDocumentState
>();
const wordStreamsVerifiedDocumentStates = new WeakMap<
  object,
  WordStreamsVerifiedDocumentState
>();
const wordFibVerifiedDocumentStates = new WeakMap<
  object,
  WordFibVerifiedDocumentState
>();
const wordClxReferenceVerifiedDocumentStates = new WeakMap<
  object,
  WordClxReferenceVerifiedDocumentState
>();
const wordClxVerifiedDocumentStates = new WeakMap<
  object,
  WordClxVerifiedDocumentState
>();
const wordPlcPcdVerifiedDocumentStates = new WeakMap<
  object,
  WordPlcPcdVerifiedDocumentState
>();
const wordPcdPrmVerifiedDocumentStates = new WeakMap<
  object,
  WordPcdPrmVerifiedDocumentState
>();
const wordPrcGrpPrlVerifiedDocumentStates = new WeakMap<
  object,
  WordPrcGrpPrlVerifiedDocumentState
>();
const wordDocumentCountsVerifiedDocumentStates = new WeakMap<
  object,
  WordDocumentCountsVerifiedDocumentState
>();
const wordTextRangesVerifiedDocumentStates = new WeakMap<
  object,
  WordTextRangesVerifiedDocumentState
>();
const wordTextBytesProjectedDocumentStates = new WeakMap<
  object,
  WordTextBytesProjectedDocumentState
>();
const wordTextDecodedDocumentStates = new WeakMap<
  object,
  WordTextDecodedDocumentState
>();
const wordMainDocumentVerifiedDocumentStates = new WeakMap<
  object,
  WordMainDocumentVerifiedDocumentState
>();
type HttpsRequest = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void
) => ClientRequest;
interface NetworkConsumerOptions {
  deadlineMs: number;
  request: HttpsRequest;
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

export function createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(
  input: CreateOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBodyInput
): OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody {
  const transferredRawResponseBytes = input.rawResponseBytes;
  let requestedFileName: unknown;
  try {
    requestedFileName = input.requestedFileName;
  } catch (error) {
    zeroizeBytes(transferredRawResponseBytes);
    throw error;
  }
  let byteLength: number;
  try {
    byteLength = readTransferredByteLength(transferredRawResponseBytes);
  } catch (error) {
    zeroizeBytes(transferredRawResponseBytes);
    throw error;
  }
  let ownedRawResponseBytes: Uint8Array | undefined;
  let transferredBytesZeroized = false;

  try {
    ownedRawResponseBytes = new Uint8Array(byteLength);
    Uint8Array.prototype.set.call(
      ownedRawResponseBytes,
      transferredRawResponseBytes
    );
    zeroizeBytes(transferredRawResponseBytes);
    transferredBytesZeroized = true;
    verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody(
      ownedRawResponseBytes
    );
    const fileName = resolveRegisteredFileName(requestedFileName);

    const handle = createOpaqueHandle(() => {
      disposeBodyObject(handle);
      throw new Error(
        "KRX legacy download OTP ephemeral body cannot be serialized or exported"
      );
    });
    bodyStates.set(handle, {
      status: "ready",
      rawResponseBytes: ownedRawResponseBytes,
      fileName
    });
    return handle as OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody;
  } catch (error) {
    if (ownedRawResponseBytes !== undefined) {
      zeroizeBytes(ownedRawResponseBytes);
    }
    throw error;
  } finally {
    if (!transferredBytesZeroized) {
      zeroizeBytes(transferredRawResponseBytes);
    }
  }
}

export function consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody
): OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters {
  const handleObject = assertHandleObject(handle);
  const state = bodyStates.get(handleObject);
  if (state === undefined) {
    throw new Error(
      "KRX legacy download OTP ephemeral body must come from the process-local factory"
    );
  }
  if (state.status !== "ready") {
    throw new Error(
      "KRX legacy download OTP ephemeral body has already been consumed"
    );
  }

  bodyStates.set(handleObject, { status: "disposed" });
  let transferred = false;
  try {
    const fileName = resolveRegisteredFileName(state.fileName);

    const parameterHandle = createOpaqueHandle(() => {
      disposeParametersObject(parameterHandle);
      throw new Error(
        "KRX legacy download parameters cannot be serialized or exported"
      );
    });
    parameterStates.set(parameterHandle, {
      status: "ready",
      rawOtpBytes: state.rawResponseBytes,
      fileName
    });
    transferred = true;
    return parameterHandle as OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters;
  } finally {
    if (!transferred) {
      zeroizeBytes(state.rawResponseBytes);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(
  handle: OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody
): void {
  const handleObject = assertHandleObject(handle);
  if (!bodyStates.has(handleObject)) {
    throw new Error(
      "KRX legacy download OTP ephemeral body must come from the process-local factory"
    );
  }
  disposeBodyObject(handleObject);
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralParameters(
  handle: OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters
): void {
  const handleObject = assertHandleObject(handle);
  if (!parameterStates.has(handleObject)) {
    throw new Error(
      "KRX legacy download parameters must come from the fixed process-local consumer"
    );
  }
  disposeParametersObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyDownloadParametersToWireBody(
  handle: OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters
): OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody {
  const handleObject = assertHandleObject(handle);
  const state = parameterStates.get(handleObject);
  if (state === undefined) {
    throw new Error(
      "KRX legacy download parameters must come from the fixed process-local consumer"
    );
  }
  if (state.status !== "ready") {
    throw new Error(
      "KRX legacy download parameters have already been consumed"
    );
  }

  parameterStates.set(handleObject, { status: "disposed" });
  let bodyBytes: Uint8Array | undefined;
  let transferred = false;
  try {
    const wirePolicy =
      resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostWirePolicy(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_VERSION
      );
    const document = resolveRegisteredDocument(state.fileName);
    bodyBytes = encodeDownloadPostWireBody(
      state.rawOtpBytes,
      wirePolicy.wireLimits.maximumRequestBodyByteLength
    );
    verifyDownloadPostWireBody(bodyBytes, state.rawOtpBytes, wirePolicy);

    const wireBodyHandle = createOpaqueHandle(() => {
      disposeWireBodyObject(wireBodyHandle);
      throw new Error(
        "KRX legacy download POST wire body cannot be serialized or exported"
      );
    });
    wireBodyStates.set(wireBodyHandle, {
      status: "ready",
      bodyBytes,
      fileName: document.fileName,
      requestContentType: wirePolicy.requestContentType
    });
    transferred = true;
    return wireBodyHandle as OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody;
  } finally {
    zeroizeBytes(state.rawOtpBytes);
    if (!transferred && bodyBytes !== undefined) {
      zeroizeBytes(bodyBytes);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody(
  handle: OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody
): void {
  const handleObject = assertHandleObject(handle);
  if (!wireBodyStates.has(handleObject)) {
    throw new Error(
      "KRX legacy download POST wire body must come from the fixed byte encoder"
    );
  }
  disposeWireBodyObject(handleObject);
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralResponse(
  handle: OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse
): void {
  const handleObject = assertHandleObject(handle);
  if (!responseStates.has(handleObject)) {
    throw new Error(
      "KRX legacy download response must come from the fixed network consumer"
    );
  }
  disposeResponseObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse
): OfficialMarketCalendarKrxLegacyDownloadIdentityVerifiedDocument {
  return transferResponseToIdentityVerifiedDocument(
    handle,
    verifyOfficialMarketCalendarKrxLegacyDocumentIdentity
  );
}

export function consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse,
  verifier: TestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier
): OfficialMarketCalendarKrxLegacyDownloadIdentityVerifiedDocument {
  let verify: TestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier["verify"];
  try {
    if (
      verifier === null ||
      typeof verifier !== "object" ||
      Array.isArray(verifier)
    ) {
      throw new Error("invalid verifier");
    }
    verify = verifier.verify;
    if (typeof verify !== "function") {
      throw new Error("invalid verifier method");
    }
  } catch {
    throw new Error("KRX legacy document test-only identity verifier is invalid");
  }
  return transferResponseToIdentityVerifiedDocument(handle, (input) =>
    verify.call(verifier, input)
  );
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadIdentityVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadIdentityVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!identityVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy identity-verified document must come from the fixed response consumer"
    );
  }
  disposeIdentityVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyIdentityVerifiedDocumentToOleHeaderVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadIdentityVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadOleHeaderVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = identityVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy identity-verified document must be ready and come from the fixed response consumer"
    );
  }
  let transferred = false;
  try {
    const oleHeader = verifyOfficialMarketCalendarOleCompoundFileHeader(
      state.rawDocumentBytes
    );
    if (
      oleHeader.headerVerified !== true ||
      oleHeader.structureStatus !== "header_only_not_verified"
    ) {
      throw new Error("KRX legacy OLE header result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeOleHeaderVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy OLE-header-verified document cannot be serialized or exported"
      );
    });
    oleHeaderVerifiedDocumentStates.set(verifiedHandle, {
      status: "ready",
      rawDocumentBytes: state.rawDocumentBytes,
      identity: state.identity,
      oleHeader
    });
    identityVerifiedDocumentStates.set(handleObject, { status: "disposed" });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadOleHeaderVerifiedDocument;
  } finally {
    if (!transferred) {
      disposeIdentityVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadOleHeaderVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadOleHeaderVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!oleHeaderVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy OLE-header-verified document must come from the fixed header consumer"
    );
  }
  disposeOleHeaderVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyOleHeaderVerifiedDocumentToDifatVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadOleHeaderVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadDifatVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = oleHeaderVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy OLE-header-verified document must be ready and come from the fixed header consumer"
    );
  }
  let transferred = false;
  try {
    const difat = verifyOfficialMarketCalendarOleCompoundFileDifat(
      state.rawDocumentBytes
    );
    if (
      difat.majorVersion !== state.oleHeader.majorVersion ||
      difat.sectorSize !== state.oleHeader.sectorSize ||
      difat.fileSectorCount !== state.oleHeader.fileSectorCount ||
      difat.difatVerified !== true ||
      difat.fatStructureStatus !== "locations_only_not_verified"
    ) {
      throw new Error("KRX legacy OLE DIFAT result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeDifatVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy DIFAT-verified document cannot be serialized or exported"
      );
    });
    difatVerifiedDocumentStates.set(verifiedHandle, {
      status: "ready",
      rawDocumentBytes: state.rawDocumentBytes,
      identity: state.identity,
      oleHeader: state.oleHeader,
      difat
    });
    oleHeaderVerifiedDocumentStates.set(handleObject, { status: "disposed" });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadDifatVerifiedDocument;
  } finally {
    if (!transferred) {
      disposeOleHeaderVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadDifatVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadDifatVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!difatVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy DIFAT-verified document must come from the fixed DIFAT consumer"
    );
  }
  disposeDifatVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyDifatVerifiedDocumentToFatVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadDifatVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadFatVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = difatVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy DIFAT-verified document must be ready and come from the fixed DIFAT consumer"
    );
  }
  let transferred = false;
  try {
    const fat = verifyOfficialMarketCalendarOleCompoundFileFat(
      state.rawDocumentBytes
    );
    if (
      fat.majorVersion !== state.difat.majorVersion ||
      fat.sectorSize !== state.difat.sectorSize ||
      fat.fileSectorCount !== state.difat.fileSectorCount ||
      fat.fatSectorCount !== state.difat.fatSectorCount ||
      fat.difatSectorCount !== state.difat.difatSectorCount ||
      !sameNumberSequence(fat.fatSectorLocations, state.difat.fatSectorLocations) ||
      !sameNumberSequence(
        fat.difatSectorLocations,
        state.difat.difatSectorLocations
      ) ||
      fat.fatVerified !== true ||
      fat.chainStatus !== "markers_only_chains_not_verified"
    ) {
      throw new Error("KRX legacy OLE FAT result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeFatVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy FAT-verified document cannot be serialized or exported"
      );
    });
    fatVerifiedDocumentStates.set(verifiedHandle, {
      status: "ready",
      rawDocumentBytes: state.rawDocumentBytes,
      identity: state.identity,
      oleHeader: state.oleHeader,
      difat: state.difat,
      fat
    });
    difatVerifiedDocumentStates.set(handleObject, { status: "disposed" });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadFatVerifiedDocument;
  } finally {
    if (!transferred) {
      disposeDifatVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadFatVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadFatVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!fatVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy FAT-verified document must come from the fixed FAT consumer"
    );
  }
  disposeFatVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyFatVerifiedDocumentToSystemChainsVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadFatVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadSystemChainsVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = fatVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy FAT-verified document must be ready and come from the fixed FAT consumer"
    );
  }
  let transferred = false;
  try {
    const systemChains =
      verifyOfficialMarketCalendarOleCompoundFileSystemChains(
        state.rawDocumentBytes
      );
    if (
      systemChains.majorVersion !== state.fat.majorVersion ||
      systemChains.sectorSize !== state.fat.sectorSize ||
      systemChains.fileSectorCount !== state.fat.fileSectorCount ||
      systemChains.systemChainsVerified !== true ||
      systemChains.directoryEntryStatus !== "not_verified" ||
      systemChains.miniFatEntryStatus !== "not_verified"
    ) {
      throw new Error("KRX legacy OLE system chains result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeSystemChainsVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy system-chains-verified document cannot be serialized or exported"
      );
    });
    systemChainsVerifiedDocumentStates.set(verifiedHandle, {
      status: "ready",
      rawDocumentBytes: state.rawDocumentBytes,
      identity: state.identity,
      oleHeader: state.oleHeader,
      difat: state.difat,
      fat: state.fat,
      systemChains
    });
    fatVerifiedDocumentStates.set(handleObject, { status: "disposed" });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadSystemChainsVerifiedDocument;
  } finally {
    if (!transferred) {
      disposeFatVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadSystemChainsVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadSystemChainsVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!systemChainsVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy system-chains-verified document must come from the fixed system chains consumer"
    );
  }
  disposeSystemChainsVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacySystemChainsVerifiedDocumentToDirectoryEntriesVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadSystemChainsVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadDirectoryEntriesVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = systemChainsVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy system-chains-verified document must be ready and come from the fixed system chains consumer"
    );
  }
  let transferred = false;
  try {
    const directoryEntries =
      verifyOfficialMarketCalendarOleCompoundFileDirectoryEntries(
        state.rawDocumentBytes
      );
    if (
      directoryEntries.majorVersion !== state.systemChains.majorVersion ||
      directoryEntries.sectorSize !== state.systemChains.sectorSize ||
      !sameNumberSequence(
        directoryEntries.directorySectorLocations,
        state.systemChains.directorySectorLocations
      ) ||
      directoryEntries.directoryEntriesVerified !== true ||
      directoryEntries.treeStatus !== "not_verified" ||
      directoryEntries.streamAllocationStatus !== "not_verified"
    ) {
      throw new Error("KRX legacy OLE directory entries result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeDirectoryEntriesVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy directory-entries-verified document cannot be serialized or exported"
      );
    });
    directoryEntriesVerifiedDocumentStates.set(verifiedHandle, {
      status: "ready",
      rawDocumentBytes: state.rawDocumentBytes,
      identity: state.identity,
      oleHeader: state.oleHeader,
      difat: state.difat,
      fat: state.fat,
      systemChains: state.systemChains,
      directoryEntries
    });
    systemChainsVerifiedDocumentStates.set(handleObject, {
      status: "disposed"
    });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadDirectoryEntriesVerifiedDocument;
  } finally {
    if (!transferred) {
      disposeSystemChainsVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadDirectoryEntriesVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadDirectoryEntriesVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!directoryEntriesVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy directory-entries-verified document must come from the fixed directory entries consumer"
    );
  }
  disposeDirectoryEntriesVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyDirectoryEntriesVerifiedDocumentToDirectoryTreeVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadDirectoryEntriesVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadDirectoryTreeVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = directoryEntriesVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy directory-entries-verified document must be ready and come from the fixed directory entries consumer"
    );
  }
  let transferred = false;
  try {
    const directoryTree =
      verifyOfficialMarketCalendarOleCompoundFileDirectoryTree(
        state.rawDocumentBytes
      );
    if (
      directoryTree.majorVersion !== state.directoryEntries.majorVersion ||
      directoryTree.sectorSize !== state.directoryEntries.sectorSize ||
      !sameNumberSequence(
        directoryTree.directorySectorLocations,
        state.directoryEntries.directorySectorLocations
      ) ||
      !sameDirectoryEntrySequence(
        directoryTree.entries,
        state.directoryEntries.entries
      ) ||
      directoryTree.directoryEntriesVerified !== true ||
      directoryTree.directoryTreeVerified !== true ||
      directoryTree.treeStatus !== "verified" ||
      directoryTree.streamAllocationStatus !== "not_verified"
    ) {
      throw new Error("KRX legacy OLE directory tree result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeDirectoryTreeVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy directory-tree-verified document cannot be serialized or exported"
      );
    });
    directoryTreeVerifiedDocumentStates.set(verifiedHandle, {
      status: "ready",
      rawDocumentBytes: state.rawDocumentBytes,
      identity: state.identity,
      oleHeader: state.oleHeader,
      difat: state.difat,
      fat: state.fat,
      systemChains: state.systemChains,
      directoryEntries: state.directoryEntries,
      directoryTree
    });
    directoryEntriesVerifiedDocumentStates.set(handleObject, {
      status: "disposed"
    });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadDirectoryTreeVerifiedDocument;
  } finally {
    if (!transferred) {
      disposeDirectoryEntriesVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadDirectoryTreeVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadDirectoryTreeVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!directoryTreeVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy directory-tree-verified document must come from the fixed directory tree consumer"
    );
  }
  disposeDirectoryTreeVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyDirectoryTreeVerifiedDocumentToMiniFatEntriesVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadDirectoryTreeVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadMiniFatEntriesVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = directoryTreeVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy directory-tree-verified document must be ready and come from the fixed directory tree consumer"
    );
  }
  let transferred = false;
  try {
    const miniFatEntries =
      verifyOfficialMarketCalendarOleCompoundFileMiniFatEntries(
        state.rawDocumentBytes
      );
    if (
      miniFatEntries.majorVersion !== state.systemChains.majorVersion ||
      miniFatEntries.sectorSize !== state.systemChains.sectorSize ||
      miniFatEntries.miniSectorSize !== 64 ||
      !sameNumberSequence(
        miniFatEntries.miniFatSectorLocations,
        state.systemChains.miniFatSectorLocations
      ) ||
      miniFatEntries.miniFatEntriesVerified !== true ||
      miniFatEntries.streamChainStatus !== "not_verified" ||
      miniFatEntries.miniStreamStatus !== "not_verified"
    ) {
      throw new Error("KRX legacy OLE mini FAT entries result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeMiniFatEntriesVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy mini-FAT-entries-verified document cannot be serialized or exported"
      );
    });
    miniFatEntriesVerifiedDocumentStates.set(verifiedHandle, {
      status: "ready",
      rawDocumentBytes: state.rawDocumentBytes,
      identity: state.identity,
      oleHeader: state.oleHeader,
      difat: state.difat,
      fat: state.fat,
      systemChains: state.systemChains,
      directoryEntries: state.directoryEntries,
      directoryTree: state.directoryTree,
      miniFatEntries
    });
    directoryTreeVerifiedDocumentStates.set(handleObject, {
      status: "disposed"
    });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadMiniFatEntriesVerifiedDocument;
  } finally {
    if (!transferred) {
      disposeDirectoryTreeVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadMiniFatEntriesVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadMiniFatEntriesVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!miniFatEntriesVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy mini-FAT-entries-verified document must come from the fixed mini FAT entries consumer"
    );
  }
  disposeMiniFatEntriesVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyMiniFatEntriesVerifiedDocumentToRootMiniStreamVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadMiniFatEntriesVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadRootMiniStreamVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = miniFatEntriesVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy mini-FAT-entries-verified document must be ready and come from the fixed mini FAT entries consumer"
    );
  }
  let transferred = false;
  try {
    const rootMiniStream =
      verifyOfficialMarketCalendarOleCompoundFileRootMiniStream(
        state.rawDocumentBytes
      );
    const rootEntry = state.directoryTree.entries[0];
    if (
      rootEntry === undefined ||
      rootEntry.objectType !== "root" ||
      rootMiniStream.majorVersion !== state.fat.majorVersion ||
      rootMiniStream.sectorSize !== state.fat.sectorSize ||
      rootMiniStream.miniSectorSize !== state.miniFatEntries.miniSectorSize ||
      rootMiniStream.rootMiniStreamSize !== rootEntry.streamSize ||
      rootMiniStream.miniFatEntryCapacity !==
        state.miniFatEntries.miniFatEntries.length ||
      rootMiniStream.rootMiniStreamVerified !== true ||
      rootMiniStream.miniFatCapacityVerified !== true ||
      rootMiniStream.userStreamAllocationStatus !== "not_verified"
    ) {
      throw new Error("KRX legacy OLE root mini stream result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeRootMiniStreamVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy root-mini-stream-verified document cannot be serialized or exported"
      );
    });
    rootMiniStreamVerifiedDocumentStates.set(verifiedHandle, {
      status: "ready",
      rawDocumentBytes: state.rawDocumentBytes,
      identity: state.identity,
      oleHeader: state.oleHeader,
      difat: state.difat,
      fat: state.fat,
      systemChains: state.systemChains,
      directoryEntries: state.directoryEntries,
      directoryTree: state.directoryTree,
      miniFatEntries: state.miniFatEntries,
      rootMiniStream
    });
    miniFatEntriesVerifiedDocumentStates.set(handleObject, {
      status: "disposed"
    });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadRootMiniStreamVerifiedDocument;
  } finally {
    if (!transferred) {
      disposeMiniFatEntriesVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadRootMiniStreamVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadRootMiniStreamVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!rootMiniStreamVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy root-mini-stream-verified document must come from the fixed root mini stream consumer"
    );
  }
  disposeRootMiniStreamVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyRootMiniStreamVerifiedDocumentToUserStreamAllocationVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadRootMiniStreamVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadUserStreamAllocationVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = rootMiniStreamVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy root-mini-stream-verified document must be ready and come from the fixed root mini stream consumer"
    );
  }
  let transferred = false;
  try {
    const userStreamAllocation =
      verifyOfficialMarketCalendarOleCompoundFileUserStreamAllocation(
        state.rawDocumentBytes
      );
    const directoryStreams = state.directoryTree.entries.filter(
      (entry) => entry.objectType === "stream"
    );
    if (
      userStreamAllocation.majorVersion !== state.fat.majorVersion ||
      userStreamAllocation.sectorSize !== state.fat.sectorSize ||
      userStreamAllocation.miniSectorSize !==
        state.rootMiniStream.miniSectorSize ||
      !sameUserStreamIdentitySequence(
        userStreamAllocation.streams,
        directoryStreams
      ) ||
      userStreamAllocation.userStreamAllocationVerified !== true ||
      userStreamAllocation.miniFatOwnershipVerified !== true ||
      userStreamAllocation.streamBytesStatus !== "not_verified"
    ) {
      throw new Error("KRX legacy OLE user stream allocation result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeUserStreamAllocationVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy user-stream-allocation-verified document cannot be serialized or exported"
      );
    });
    userStreamAllocationVerifiedDocumentStates.set(verifiedHandle, {
      status: "ready",
      rawDocumentBytes: state.rawDocumentBytes,
      identity: state.identity,
      oleHeader: state.oleHeader,
      difat: state.difat,
      fat: state.fat,
      systemChains: state.systemChains,
      directoryEntries: state.directoryEntries,
      directoryTree: state.directoryTree,
      miniFatEntries: state.miniFatEntries,
      rootMiniStream: state.rootMiniStream,
      userStreamAllocation
    });
    rootMiniStreamVerifiedDocumentStates.set(handleObject, {
      status: "disposed"
    });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadUserStreamAllocationVerifiedDocument;
  } finally {
    if (!transferred) {
      disposeRootMiniStreamVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadUserStreamAllocationVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadUserStreamAllocationVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!userStreamAllocationVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy user-stream-allocation-verified document must come from the fixed user stream allocation consumer"
    );
  }
  disposeUserStreamAllocationVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyUserStreamAllocationVerifiedDocumentToUserStreamBytesProjectedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadUserStreamAllocationVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadUserStreamBytesProjectedDocument {
  const handleObject = assertHandleObject(handle);
  const state = userStreamAllocationVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy user-stream-allocation-verified document must be ready and come from the fixed user stream allocation consumer"
    );
  }
  let userStreamBytes:
    | ProjectedOfficialMarketCalendarOleCompoundFileUserStreamBytes
    | undefined;
  let transferred = false;
  try {
    userStreamBytes =
      projectOfficialMarketCalendarOleCompoundFileUserStreamBytes(
        state.rawDocumentBytes
      );
    if (
      userStreamBytes.majorVersion !== state.userStreamAllocation.majorVersion ||
      userStreamBytes.sectorSize !== state.userStreamAllocation.sectorSize ||
      userStreamBytes.miniSectorSize !==
        state.userStreamAllocation.miniSectorSize ||
      !sameProjectedUserStreamSequence(
        userStreamBytes,
        state.userStreamAllocation
      ) ||
      userStreamBytes.streamBytesProjected !== true ||
      userStreamBytes.trailingAllocationBytesStatus !== "excluded" ||
      userStreamBytes.wordDocumentStatus !== "not_parsed"
    ) {
      throw new Error("KRX legacy OLE user stream byte projection is invalid");
    }
    const projectedHandle = createOpaqueHandle(() => {
      disposeUserStreamBytesProjectedDocumentObject(projectedHandle);
      throw new Error(
        "KRX legacy user-stream-bytes-projected document cannot be serialized or exported"
      );
    });
    userStreamBytesProjectedDocumentStates.set(projectedHandle, {
      status: "ready",
      rawDocumentBytes: state.rawDocumentBytes,
      identity: state.identity,
      oleHeader: state.oleHeader,
      difat: state.difat,
      fat: state.fat,
      systemChains: state.systemChains,
      directoryEntries: state.directoryEntries,
      directoryTree: state.directoryTree,
      miniFatEntries: state.miniFatEntries,
      rootMiniStream: state.rootMiniStream,
      userStreamAllocation: state.userStreamAllocation,
      userStreamBytes
    });
    userStreamAllocationVerifiedDocumentStates.set(handleObject, {
      status: "disposed"
    });
    transferred = true;
    return projectedHandle as OfficialMarketCalendarKrxLegacyDownloadUserStreamBytesProjectedDocument;
  } finally {
    if (!transferred) {
      if (userStreamBytes !== undefined) {
        zeroizeProjectedUserStreamBytes(userStreamBytes);
      }
      disposeUserStreamAllocationVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadUserStreamBytesProjectedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadUserStreamBytesProjectedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!userStreamBytesProjectedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy user-stream-bytes-projected document must come from the fixed user stream bytes consumer"
    );
  }
  disposeUserStreamBytesProjectedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyUserStreamBytesProjectedDocumentToWordStreamsVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadUserStreamBytesProjectedDocument
): OfficialMarketCalendarKrxLegacyDownloadWordStreamsVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = userStreamBytesProjectedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy user-stream-bytes-projected document must be ready and come from the fixed user stream bytes consumer"
    );
  }
  let wordStreams:
    | VerifiedOfficialMarketCalendarKrxLegacyWordBinaryFileStreams
    | undefined;
  let transferred = false;
  try {
    wordStreams = verifyOfficialMarketCalendarKrxLegacyWordBinaryFileStreams(
      state.rawDocumentBytes
    );
    if (
      !sameSelectedWordStreamProjection(wordStreams, state.userStreamBytes) ||
      wordStreams.fibBaseVerified !== true ||
      wordStreams.fibStatus !==
        "base_only_effective_version_not_resolved" ||
      wordStreams.protectionStatus !== "unencrypted" ||
      wordStreams.wordTableParserStatus !== "not_parsed" ||
      wordStreams.sourceRoleStatus !== "candidate_not_accepted"
    ) {
      throw new Error("KRX legacy Word stream verification result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeWordStreamsVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy word-streams-verified document cannot be serialized or exported"
      );
    });
    wordStreamsVerifiedDocumentStates.set(verifiedHandle, {
      status: "ready",
      rawDocumentBytes: state.rawDocumentBytes,
      identity: state.identity,
      oleHeader: state.oleHeader,
      difat: state.difat,
      fat: state.fat,
      systemChains: state.systemChains,
      directoryEntries: state.directoryEntries,
      directoryTree: state.directoryTree,
      miniFatEntries: state.miniFatEntries,
      rootMiniStream: state.rootMiniStream,
      userStreamAllocation: state.userStreamAllocation,
      userStreamBytes: state.userStreamBytes,
      wordStreams
    });
    userStreamBytesProjectedDocumentStates.set(handleObject, {
      status: "disposed"
    });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadWordStreamsVerifiedDocument;
  } finally {
    if (!transferred) {
      if (wordStreams !== undefined) {
        zeroizeWordStreamBytes(wordStreams);
      }
      disposeUserStreamBytesProjectedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadWordStreamsVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordStreamsVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!wordStreamsVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy word-streams-verified document must come from the fixed Word stream consumer"
    );
  }
  disposeWordStreamsVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyWordStreamsVerifiedDocumentToWordFibVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordStreamsVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadWordFibVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = wordStreamsVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy word-streams-verified document must be ready and come from the fixed Word stream consumer"
    );
  }
  let wordFib: VerifiedOfficialMarketCalendarKrxLegacyWordFib | undefined;
  let transferred = false;
  try {
    wordFib = verifyOfficialMarketCalendarKrxLegacyWordFib(
      state.rawDocumentBytes
    );
    if (
      wordFib.nFibBase !== state.wordStreams.nFibBase ||
      wordFib.tableStreamName !== state.wordStreams.tableStreamName ||
      !sameByteSequence(
        wordFib.wordDocumentBytes,
        state.wordStreams.wordDocumentBytes
      ) ||
      !sameByteSequence(
        wordFib.tableStreamBytes,
        state.wordStreams.tableStreamBytes
      ) ||
      wordFib.fibStructureVerified !== true ||
      wordFib.fibFieldStatus !== "count_sections_only_not_parsed" ||
      wordFib.clxStatus !== "not_parsed" ||
      wordFib.sourceRoleStatus !== "candidate_not_accepted"
    ) {
      throw new Error("KRX legacy Word FIB verification result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeWordFibVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy word-fib-verified document cannot be serialized or exported"
      );
    });
    wordFibVerifiedDocumentStates.set(verifiedHandle, {
      ...state,
      wordFib
    });
    wordStreamsVerifiedDocumentStates.set(handleObject, {
      status: "disposed"
    });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadWordFibVerifiedDocument;
  } finally {
    if (!transferred) {
      if (wordFib !== undefined) {
        zeroizeWordFibBytes(wordFib);
      }
      disposeWordStreamsVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadWordFibVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordFibVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!wordFibVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy word-fib-verified document must come from the fixed Word FIB consumer"
    );
  }
  disposeWordFibVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyWordFibVerifiedDocumentToWordClxReferenceVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordFibVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadWordClxReferenceVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = wordFibVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy word-fib-verified document must be ready and come from the fixed Word FIB consumer"
    );
  }
  let clxReference:
    | VerifiedOfficialMarketCalendarKrxLegacyWordClxReference
    | undefined;
  let transferred = false;
  try {
    clxReference = verifyOfficialMarketCalendarKrxLegacyWordClxReference(
      state.rawDocumentBytes
    );
    if (
      clxReference.nFib !== state.wordFib.nFib ||
      clxReference.version !== state.wordFib.version ||
      clxReference.tableStreamName !== state.wordFib.tableStreamName ||
      !sameByteRange(
        state.wordFib.tableStreamBytes,
        clxReference.fcClx,
        clxReference.clxBytes
      ) ||
      clxReference.lcbClx !== clxReference.clxBytes.length ||
      clxReference.clxReferenceVerified !== true ||
      clxReference.clxParserStatus !== "reference_only_not_parsed" ||
      clxReference.sourceRoleStatus !== "candidate_not_accepted"
    ) {
      throw new Error("KRX legacy Word CLX reference result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeWordClxReferenceVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy word-clx-reference-verified document cannot be serialized or exported"
      );
    });
    wordClxReferenceVerifiedDocumentStates.set(verifiedHandle, {
      ...state,
      clxReference
    });
    wordFibVerifiedDocumentStates.set(handleObject, {
      status: "disposed"
    });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadWordClxReferenceVerifiedDocument;
  } finally {
    if (!transferred) {
      if (clxReference !== undefined) {
        zeroizeBytes(clxReference.clxBytes);
      }
      disposeWordFibVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadWordClxReferenceVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordClxReferenceVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!wordClxReferenceVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy word-clx-reference-verified document must come from the fixed Word CLX reference consumer"
    );
  }
  disposeWordClxReferenceVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyWordClxReferenceVerifiedDocumentToWordClxVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordClxReferenceVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadWordClxVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = wordClxReferenceVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy word-clx-reference-verified document must be ready and come from the fixed Word CLX reference consumer"
    );
  }
  let clx: VerifiedOfficialMarketCalendarKrxLegacyWordClx | undefined;
  let transferred = false;
  try {
    clx = verifyOfficialMarketCalendarKrxLegacyWordClx(state.rawDocumentBytes);
    const plcPcdOffset = clx.pcdtOffset + 5;
    if (
      clx.nFib !== state.clxReference.nFib ||
      clx.tableStreamName !== state.clxReference.tableStreamName ||
      clx.fcClx !== state.clxReference.fcClx ||
      clx.lcbClx !== state.clxReference.lcbClx ||
      !sameByteRange(
        state.clxReference.clxBytes,
        plcPcdOffset,
        clx.plcPcdBytes
      ) ||
      clx.clxFramingVerified !== true ||
      clx.plcPcdStatus !== "framing_only_entries_not_parsed" ||
      clx.sourceRoleStatus !== "candidate_not_accepted"
    ) {
      throw new Error("KRX legacy Word CLX framing result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeWordClxVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy word-clx-verified document cannot be serialized or exported"
      );
    });
    wordClxVerifiedDocumentStates.set(verifiedHandle, { ...state, clx });
    wordClxReferenceVerifiedDocumentStates.set(handleObject, { status: "disposed" });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadWordClxVerifiedDocument;
  } finally {
    if (!transferred) {
      if (clx !== undefined) zeroizeBytes(clx.plcPcdBytes);
      disposeWordClxReferenceVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadWordClxVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordClxVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!wordClxVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy word-clx-verified document must come from the fixed Word CLX consumer"
    );
  }
  disposeWordClxVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyWordClxVerifiedDocumentToWordPlcPcdVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordClxVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadWordPlcPcdVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = wordClxVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy word-clx-verified document must be ready and come from the fixed Word CLX consumer"
    );
  }
  let transferred = false;
  try {
    const plcPcd = verifyOfficialMarketCalendarKrxLegacyWordPlcPcd(
      state.rawDocumentBytes
    );
    if (
      plcPcd.nFib !== state.clx.nFib ||
      plcPcd.tableStreamName !== state.clx.tableStreamName ||
      plcPcd.characterPositions.length !==
        state.clx.pieceDescriptorCount + 1 ||
      plcPcd.pieces.length !== state.clx.pieceDescriptorCount ||
      !samePlcPcdRanges(plcPcd) ||
      plcPcd.plcPcdVerified !== true ||
      plcPcd.documentTotalStatus !== "not_verified_against_fib_rg_lw" ||
      plcPcd.textRangeStatus !== "not_verified" ||
      plcPcd.prmStatus !== "not_parsed" ||
      plcPcd.sourceRoleStatus !== "candidate_not_accepted"
    ) {
      throw new Error("KRX legacy Word PlcPcd verification result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeWordPlcPcdVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy word-plc-pcd-verified document cannot be serialized or exported"
      );
    });
    wordPlcPcdVerifiedDocumentStates.set(verifiedHandle, {
      ...state,
      plcPcd
    });
    wordClxVerifiedDocumentStates.set(handleObject, { status: "disposed" });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadWordPlcPcdVerifiedDocument;
  } finally {
    if (!transferred) {
      disposeWordClxVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadWordPlcPcdVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordPlcPcdVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!wordPlcPcdVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy word-plc-pcd-verified document must come from the fixed Word PlcPcd consumer"
    );
  }
  disposeWordPlcPcdVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyWordPlcPcdVerifiedDocumentToWordPcdPrmVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordPlcPcdVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadWordPcdPrmVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = wordPlcPcdVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy word-plc-pcd-verified document must be ready and come from the fixed Word PlcPcd consumer"
    );
  }
  let pcdPrms: VerifiedOfficialMarketCalendarKrxLegacyWordPcdPrms | undefined;
  let transferred = false;
  try {
    pcdPrms = verifyOfficialMarketCalendarKrxLegacyWordPcdPrms(
      state.rawDocumentBytes
    );
    if (
      pcdPrms.nFib !== state.plcPcd.nFib ||
      pcdPrms.tableStreamName !== state.plcPcd.tableStreamName ||
      pcdPrms.pieces.length !== state.plcPcd.pieces.length ||
      !samePcdPrmRanges(state.plcPcd, pcdPrms) ||
      pcdPrms.prm0AllowlistVerified !== true ||
      pcdPrms.prm1PrcReferencesVerified !== true ||
      pcdPrms.prcGrpprlFramingVerified !== true ||
      pcdPrms.prcGrpprlSemanticsStatus !== "not_parsed" ||
      pcdPrms.tablePropertyApplicationStatus !== "not_applied" ||
      pcdPrms.sourceRoleStatus !== "candidate_not_accepted"
    ) {
      throw new Error("KRX legacy Word Pcd Prm verification result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeWordPcdPrmVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy word-pcd-prm-verified document cannot be serialized or exported"
      );
    });
    wordPcdPrmVerifiedDocumentStates.set(verifiedHandle, {
      ...state,
      pcdPrms
    });
    wordPlcPcdVerifiedDocumentStates.set(handleObject, { status: "disposed" });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadWordPcdPrmVerifiedDocument;
  } finally {
    if (!transferred) {
      if (pcdPrms !== undefined) zeroizePcdPrmBytes(pcdPrms);
      disposeWordPlcPcdVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadWordPcdPrmVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordPcdPrmVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!wordPcdPrmVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy word-pcd-prm-verified document must come from the fixed Word Pcd Prm consumer"
    );
  }
  disposeWordPcdPrmVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyWordPcdPrmVerifiedDocumentToWordPrcGrpPrlVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordPcdPrmVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadWordPrcGrpPrlVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = wordPcdPrmVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy word-pcd-prm-verified document must be ready and come from the fixed Word Pcd Prm consumer"
    );
  }
  let prcGrpPrls: VerifiedOfficialMarketCalendarKrxLegacyWordPrcGrpPrls | undefined;
  let transferred = false;
  try {
    prcGrpPrls = verifyOfficialMarketCalendarKrxLegacyWordPrcGrpPrls(
      state.rawDocumentBytes
    );
    if (
      prcGrpPrls.nFib !== state.pcdPrms.nFib ||
      prcGrpPrls.tableStreamName !== state.pcdPrms.tableStreamName ||
      prcGrpPrls.prcs.length !== state.pcdPrms.prcs.length ||
      prcGrpPrls.pieces.length !== state.pcdPrms.pieces.length ||
      !samePcdPrmProjection(state.pcdPrms, prcGrpPrls) ||
      !samePrcGrpPrlProjection(state.pcdPrms, prcGrpPrls) ||
      prcGrpPrls.prcGrpprlFramingVerified !== true ||
      prcGrpPrls.sprmFramingVerified !== true ||
      prcGrpPrls.paragraphModifierSelectionStatus !== "not_applied" ||
      prcGrpPrls.tablePropertyApplicationStatus !== "not_applied" ||
      prcGrpPrls.sourceRoleStatus !== "candidate_not_accepted"
    ) {
      throw new Error("KRX legacy Word Prc GrpPrl verification result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeWordPrcGrpPrlVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy word-prc-grpprl-verified document cannot be serialized or exported"
      );
    });
    wordPrcGrpPrlVerifiedDocumentStates.set(verifiedHandle, {
      ...state,
      prcGrpPrls
    });
    wordPcdPrmVerifiedDocumentStates.set(handleObject, { status: "disposed" });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadWordPrcGrpPrlVerifiedDocument;
  } finally {
    if (!transferred) {
      if (prcGrpPrls !== undefined) zeroizePrcGrpPrlBytes(prcGrpPrls);
      disposeWordPcdPrmVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadWordPrcGrpPrlVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordPrcGrpPrlVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!wordPrcGrpPrlVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy word-prc-grpprl-verified document must come from the fixed Word Prc GrpPrl consumer"
    );
  }
  disposeWordPrcGrpPrlVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyWordPrcGrpPrlVerifiedDocumentToWordDocumentCountsVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordPrcGrpPrlVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadWordDocumentCountsVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = wordPrcGrpPrlVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy word-prc-grpprl-verified document must be ready and come from the fixed Word Prc GrpPrl consumer"
    );
  }
  let transferred = false;
  try {
    const documentCounts =
      verifyOfficialMarketCalendarKrxLegacyWordDocumentCounts(
        state.rawDocumentBytes
      );
    const finalCp = state.plcPcd.characterPositions.at(-1);
    if (
      finalCp === undefined ||
      documentCounts.finalCp !== finalCp ||
      documentCounts.documentCountsVerified !== true ||
      documentCounts.textRangeStatus !== "not_verified" ||
      documentCounts.sourceRoleStatus !== "candidate_not_accepted"
    ) {
      throw new Error("KRX legacy Word document counts result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeWordDocumentCountsVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy word-document-counts-verified document cannot be serialized or exported"
      );
    });
    wordDocumentCountsVerifiedDocumentStates.set(verifiedHandle, {
      ...state,
      documentCounts
    });
    wordPrcGrpPrlVerifiedDocumentStates.set(handleObject, { status: "disposed" });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadWordDocumentCountsVerifiedDocument;
  } finally {
    if (!transferred) disposeWordPrcGrpPrlVerifiedDocumentObject(handleObject);
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadWordDocumentCountsVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordDocumentCountsVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!wordDocumentCountsVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy word-document-counts-verified document must come from the fixed Word document counts consumer"
    );
  }
  disposeWordDocumentCountsVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyWordDocumentCountsVerifiedDocumentToWordTextRangesVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordDocumentCountsVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadWordTextRangesVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = wordDocumentCountsVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy word-document-counts-verified document must be ready and come from the fixed Word document counts consumer"
    );
  }
  let transferred = false;
  try {
    const textRanges = verifyOfficialMarketCalendarKrxLegacyWordTextRanges(
      state.rawDocumentBytes
    );
    if (
      textRanges.nFib !== state.plcPcd.nFib ||
      textRanges.tableStreamName !== state.plcPcd.tableStreamName ||
      textRanges.ranges.length !== state.plcPcd.pieces.length ||
      !sameTextRangeProjection(state.plcPcd, textRanges) ||
      textRanges.textRangesVerified !== true ||
      textRanges.textProjectionStatus !== "not_projected" ||
      textRanges.textDecodingStatus !== "not_decoded" ||
      textRanges.sourceRoleStatus !== "candidate_not_accepted"
    ) {
      throw new Error("KRX legacy Word text ranges result is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeWordTextRangesVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy word-text-ranges-verified document cannot be serialized or exported"
      );
    });
    wordTextRangesVerifiedDocumentStates.set(verifiedHandle, {
      ...state,
      textRanges
    });
    wordDocumentCountsVerifiedDocumentStates.set(handleObject, { status: "disposed" });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadWordTextRangesVerifiedDocument;
  } finally {
    if (!transferred) disposeWordDocumentCountsVerifiedDocumentObject(handleObject);
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadWordTextRangesVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordTextRangesVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!wordTextRangesVerifiedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy word-text-ranges-verified document must come from the fixed Word text ranges consumer"
    );
  }
  disposeWordTextRangesVerifiedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyWordTextRangesVerifiedDocumentToWordTextBytesProjectedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordTextRangesVerifiedDocument
): OfficialMarketCalendarKrxLegacyDownloadWordTextBytesProjectedDocument {
  const handleObject = assertHandleObject(handle);
  const state = wordTextRangesVerifiedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy word-text-ranges-verified document must be ready and come from the fixed Word text ranges consumer"
    );
  }
  let textBytes: ProjectedOfficialMarketCalendarKrxLegacyWordTextBytes | undefined;
  let transferred = false;
  try {
    textBytes = projectOfficialMarketCalendarKrxLegacyWordTextBytes(
      state.rawDocumentBytes
    );
    if (
      textBytes.nFib !== state.textRanges.nFib ||
      textBytes.tableStreamName !== state.textRanges.tableStreamName ||
      textBytes.cbMac !== state.textRanges.cbMac ||
      textBytes.pieces.length !== state.textRanges.ranges.length ||
      !sameTextByteProjection(state.textRanges, textBytes) ||
      textBytes.textBytesProjected !== true ||
      textBytes.textDecodingStatus !== "not_decoded" ||
      textBytes.sourceRoleStatus !== "candidate_not_accepted"
    ) {
      throw new Error("KRX legacy Word text byte projection is invalid");
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeWordTextBytesProjectedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy word-text-bytes-projected document cannot be serialized or exported"
      );
    });
    wordTextBytesProjectedDocumentStates.set(verifiedHandle, {
      ...state,
      textBytes
    });
    wordTextRangesVerifiedDocumentStates.set(handleObject, { status: "disposed" });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadWordTextBytesProjectedDocument;
  } finally {
    if (!transferred) {
      if (textBytes !== undefined) zeroizeTextPieceBytes(textBytes);
      disposeWordTextRangesVerifiedDocumentObject(handleObject);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadWordTextBytesProjectedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordTextBytesProjectedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!wordTextBytesProjectedDocumentStates.has(handleObject)) {
    throw new Error(
      "KRX legacy word-text-bytes-projected document must come from the fixed Word text bytes consumer"
    );
  }
  disposeWordTextBytesProjectedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyWordTextBytesProjectedDocumentToWordTextDecodedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordTextBytesProjectedDocument
): OfficialMarketCalendarKrxLegacyDownloadWordTextDecodedDocument {
  const handleObject = assertHandleObject(handle);
  const state = wordTextBytesProjectedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error("KRX legacy word-text-bytes-projected document must be ready and come from the fixed Word text bytes consumer");
  }
  let transferred = false;
  try {
    const decodedText = decodeOfficialMarketCalendarKrxLegacyWordText(state.rawDocumentBytes);
    if (
      decodedText.nFib !== state.textBytes.nFib ||
      decodedText.tableStreamName !== state.textBytes.tableStreamName ||
      decodedText.cbMac !== state.textBytes.cbMac ||
      decodedText.pieces.length !== state.textBytes.pieces.length ||
      decodedText.finalCp !== state.documentCounts.finalCp ||
      decodedText.decodedCodeUnitCount !== decodedText.text.length ||
      decodedText.textDecoded !== true ||
      decodedText.tableSemanticsStatus !== "not_parsed" ||
      decodedText.sourceRoleStatus !== "candidate_not_accepted"
    ) throw new Error("KRX legacy Word decoded text result is invalid");
    const verifiedHandle = createOpaqueHandle(() => {
      disposeWordTextDecodedDocumentObject(verifiedHandle);
      throw new Error("KRX legacy word-text-decoded document cannot be serialized or exported");
    });
    wordTextDecodedDocumentStates.set(verifiedHandle, { ...state, decodedText });
    wordTextBytesProjectedDocumentStates.set(handleObject, { status: "disposed" });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadWordTextDecodedDocument;
  } finally {
    if (!transferred) disposeWordTextBytesProjectedDocumentObject(handleObject);
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadWordTextDecodedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordTextDecodedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!wordTextDecodedDocumentStates.has(handleObject)) {
    throw new Error("KRX legacy word-text-decoded document must come from the fixed Word text decoding consumer");
  }
  disposeWordTextDecodedDocumentObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyWordTextDecodedDocumentToWordMainDocumentVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordTextDecodedDocument
): OfficialMarketCalendarKrxLegacyDownloadWordMainDocumentVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = wordTextDecodedDocumentStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error("KRX legacy word-text-decoded document must be ready and come from the fixed Word text decoding consumer");
  }
  let transferred = false;
  try {
    const mainDocument = verifyOfficialMarketCalendarKrxLegacyWordMainDocument(state.rawDocumentBytes);
    if (
      mainDocument.nFib !== state.decodedText.nFib ||
      mainDocument.tableStreamName !== state.decodedText.tableStreamName ||
      mainDocument.finalCp !== state.decodedText.finalCp ||
      mainDocument.mainDocumentCpEnd !== state.documentCounts.ccpText ||
      mainDocument.mainDocumentText !== state.decodedText.text.slice(0, state.documentCounts.ccpText) ||
      mainDocument.mainDocumentVerified !== true ||
      mainDocument.sourceRoleStatus !== "candidate_not_accepted"
    ) throw new Error("KRX legacy Word main document result is invalid");
    const verifiedHandle = createOpaqueHandle(() => {
      disposeWordMainDocumentVerifiedDocumentObject(verifiedHandle);
      throw new Error("KRX legacy word-main-document-verified document cannot be serialized or exported");
    });
    wordMainDocumentVerifiedDocumentStates.set(verifiedHandle, { ...state, mainDocument });
    wordTextDecodedDocumentStates.set(handleObject, { status: "disposed" });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadWordMainDocumentVerifiedDocument;
  } finally {
    if (!transferred) disposeWordTextDecodedDocumentObject(handleObject);
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadWordMainDocumentVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadWordMainDocumentVerifiedDocument
): void {
  const handleObject = assertHandleObject(handle);
  if (!wordMainDocumentVerifiedDocumentStates.has(handleObject)) {
    throw new Error("KRX legacy word-main-document-verified document must come from the fixed Word main document consumer");
  }
  disposeWordMainDocumentVerifiedDocumentObject(handleObject);
}

export function createOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer(): OfficialMarketCalendarKrxLegacyDownloadNetworkConsumer {
  const policy = resolveDownloadNetworkPolicy();
  return createNetworkConsumer({
    deadlineMs: policy.networkLimits.absoluteDeadlineMilliseconds,
    request: httpsRequest
  });
}

export function createTestOnlyOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer(
  connector: TestOnlyOfficialMarketCalendarKrxLegacyDownloadSocketConnector
): OfficialMarketCalendarKrxLegacyDownloadNetworkConsumer {
  const normalizedConnector = normalizeTestOnlyNetworkConnector(connector);
  const policy = resolveDownloadNetworkPolicy();
  const agent = new HttpsAgent({ keepAlive: false, maxCachedSessions: 0 });
  agent.createConnection = () =>
    tlsConnect({
      host: normalizedConnector.dialAddress,
      port: normalizedConnector.dialPort,
      servername: policy.transportDerivedRequestHeaderValues.host,
      ca: normalizedConnector.certificateAuthority,
      rejectUnauthorized: true,
      ALPNProtocols: ["http/1.1"]
    });
  return createNetworkConsumer({
    deadlineMs:
      normalizedConnector.deadlineMs ??
      policy.networkLimits.absoluteDeadlineMilliseconds,
    request: (options, callback) =>
      httpsRequest({ ...options, agent }, callback)
  });
}

function transferResponseToIdentityVerifiedDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse,
  verify: (input: {
    fileName: LegacyFileName;
    rawDocumentBytes: Uint8Array;
  }) => VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity
): OfficialMarketCalendarKrxLegacyDownloadIdentityVerifiedDocument {
  const handleObject = assertHandleObject(handle);
  const state = responseStates.get(handleObject);
  if (state === undefined || state.status === "disposed") {
    throw new Error(
      "KRX legacy download response must be ready and come from the fixed network consumer"
    );
  }
  let transferred = false;
  try {
    const identity = verify({
      fileName: state.fileName,
      rawDocumentBytes: state.rawResponseBytes
    });
    if (
      identity.fileName !== state.fileName ||
      identity.contentLength !== state.contentLength ||
      identity.identityVerified !== true ||
      identity.parserStatus !== "not_verified" ||
      identity.sourceRoleStatus !== "candidate_not_accepted"
    ) {
      throw new Error(
        "KRX legacy document identity result did not match the network response"
      );
    }
    const verifiedHandle = createOpaqueHandle(() => {
      disposeIdentityVerifiedDocumentObject(verifiedHandle);
      throw new Error(
        "KRX legacy identity-verified document cannot be serialized or exported"
      );
    });
    identityVerifiedDocumentStates.set(verifiedHandle, {
      status: "ready",
      rawDocumentBytes: state.rawResponseBytes,
      identity
    });
    responseStates.set(handleObject, { status: "disposed" });
    transferred = true;
    return verifiedHandle as OfficialMarketCalendarKrxLegacyDownloadIdentityVerifiedDocument;
  } finally {
    if (!transferred) {
      disposeResponseObject(handleObject);
    }
  }
}

function createNetworkConsumer(
  options: NetworkConsumerOptions
): OfficialMarketCalendarKrxLegacyDownloadNetworkConsumer {
  return Object.freeze({
    consume: (
      handle: OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody
    ) => consumeWireBodyOverNetwork(handle, options)
  });
}

async function consumeWireBodyOverNetwork(
  handle: OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody,
  options: NetworkConsumerOptions
): Promise<OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse> {
  const handleObject = assertHandleObject(handle);
  const state = wireBodyStates.get(handleObject);
  if (state === undefined) {
    throw new Error(
      "KRX legacy download POST wire body must come from the fixed byte encoder"
    );
  }
  if (state.status !== "ready") {
    throw new Error(
      "KRX legacy download POST wire body has already been consumed"
    );
  }

  wireBodyStates.set(handleObject, { status: "disposed" });
  try {
    return await executeNetworkRequest(state, options);
  } finally {
    zeroizeBytes(state.bodyBytes);
  }
}

function executeNetworkRequest(
  state: ReadyWireBodyState,
  options: NetworkConsumerOptions
): Promise<OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse> {
  const policy = resolveDownloadNetworkPolicy();
  const document = resolveRegisteredDocument(state.fileName);
  if (
    state.requestContentType !== policy.fixedRequestHeaderValues.contentType ||
    state.bodyBytes.byteLength < 1 ||
    state.bodyBytes.byteLength >
      policy.networkLimits.maximumRequestBodyByteLength
  ) {
    throw responseRejected();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseStarted = false;
    let clientRequest: ClientRequest | undefined;
    let requestBodyCleared = false;
    const clearRequestBody = (): void => {
      if (!requestBodyCleared) {
        requestBodyCleared = true;
        zeroizeBytes(state.bodyBytes);
      }
    };
    const finish = (
      error: unknown,
      value?: OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse
    ): void => {
      if (settled) {
        if (value !== undefined) {
          disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralResponse(
            value
          );
        }
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearRequestBody();
      if (error === undefined) {
        resolve(value!);
      } else {
        reject(error);
      }
    };
    const timer = setTimeout(() => {
      finish(
        new OfficialMarketCalendarKrxLegacyDownloadNetworkError(
          "KRX_LEGACY_DOWNLOAD_NETWORK_DEADLINE_EXCEEDED",
          "KRX legacy download network deadline was exceeded."
        )
      );
      clientRequest?.destroy();
    }, options.deadlineMs);

    try {
      clientRequest = options.request(
        buildDownloadRequestOptions(policy, state.bodyBytes.byteLength),
        (response) => {
          responseStarted = true;
          readNetworkResponse(response, policy, document).then(
            (value) => finish(undefined, value),
            (error: unknown) => finish(error)
          );
        }
      );
      clientRequest.once("finish", clearRequestBody);
      clientRequest.once("error", () => {
        finish(
          responseStarted
            ? incompleteResponse()
            : new OfficialMarketCalendarKrxLegacyDownloadNetworkError(
                "KRX_LEGACY_DOWNLOAD_NETWORK_FAILURE",
                "KRX legacy download network request failed."
              )
        );
      });
      clientRequest.end(state.bodyBytes);
    } catch {
      finish(
        responseStarted
          ? incompleteResponse()
          : new OfficialMarketCalendarKrxLegacyDownloadNetworkError(
              "KRX_LEGACY_DOWNLOAD_NETWORK_FAILURE",
              "KRX legacy download network request failed."
            )
      );
    }
  });
}

function buildDownloadRequestOptions(
  policy: OfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition,
  bodyByteLength: number
): RequestOptions {
  const requestedUrl = new URL(policy.sourceSelector.requestedUrl);
  return {
    protocol: policy.dedicatedDomainBoundary.scheme,
    hostname: policy.dedicatedDomainBoundary.hostname,
    port: 443,
    servername: policy.dedicatedDomainBoundary.hostname,
    method: policy.sourceSelector.requestMethod,
    path: requestedUrl.pathname,
    agent: false,
    rejectUnauthorized: true,
    headers: {
      Accept: policy.fixedRequestHeaderValues.accept,
      "Cache-Control": policy.fixedRequestHeaderValues.cacheControl,
      "Content-Length": String(bodyByteLength),
      "Content-Type": policy.fixedRequestHeaderValues.contentType,
      Origin: policy.fixedRequestHeaderValues.origin,
      Pragma: policy.fixedRequestHeaderValues.pragma,
      Referer: policy.fixedRequestHeaderValues.referer,
      "User-Agent": policy.fixedRequestHeaderValues.userAgent,
      Host: policy.transportDerivedRequestHeaderValues.host,
      Connection: policy.transportDerivedRequestHeaderValues.connection
    }
  };
}

async function readNetworkResponse(
  response: IncomingMessage,
  policy: OfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition,
  document: LegacyDocument
): Promise<OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse> {
  let declaredContentLength: number;
  try {
    declaredContentLength = assertResponseHeaderBoundary(
      response,
      policy,
      document
    );
  } catch (error) {
    response.destroy();
    throw error;
  }
  const responseBytes = new Uint8Array(declaredContentLength);
  let responseByteLength = 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      error: unknown,
      value?: OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse
    ): void => {
      if (settled) {
        if (value !== undefined) {
          disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralResponse(
            value
          );
        }
        return;
      }
      settled = true;
      if (error === undefined) {
        resolve(value!);
      } else {
        zeroizeBytes(responseBytes);
        reject(error);
      }
    };
    response.on("data", (chunk: Buffer) => {
      if (settled) {
        zeroizeBytes(chunk);
        return;
      }
      try {
        if (responseByteLength + chunk.byteLength > declaredContentLength) {
          finish(responseTooLarge());
          response.destroy();
          return;
        }
        Uint8Array.prototype.set.call(
          responseBytes,
          chunk,
          responseByteLength
        );
        responseByteLength += chunk.byteLength;
      } finally {
        zeroizeBytes(chunk);
      }
    });
    response.once("aborted", () => finish(incompleteResponse()));
    response.once("error", () => finish(incompleteResponse()));
    response.once("end", () => {
      if (
        !response.complete ||
        responseByteLength !== declaredContentLength ||
        response.rawTrailers.length !== 0 ||
        Object.keys(response.trailers).length !== 0
      ) {
        finish(incompleteResponse());
        return;
      }
      const handle = createOpaqueHandle(() => {
        disposeResponseObject(handle);
        throw new Error(
          "KRX legacy download response cannot be serialized or exported"
        );
      });
      responseStates.set(handle, {
        status: "ready",
        rawResponseBytes: responseBytes,
        fileName: document.fileName,
        contentLength: document.contentLength
      });
      finish(
        undefined,
        handle as OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse
      );
    });
  });
}

function assertResponseHeaderBoundary(
  response: IncomingMessage,
  policy: OfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition,
  document: LegacyDocument
): number {
  if (
    response.statusCode !== policy.responseBoundary.requiredStatus ||
    response.httpVersion !== "1.1"
  ) {
    throw responseRejected();
  }
  const declaredContentLengths = readRawHeaderValues(
    response.rawHeaders,
    "content-length"
  );
  if (
    declaredContentLengths.length === 1 &&
    /^(0|[1-9][0-9]*)$/.test(declaredContentLengths[0] ?? "") &&
    Number(declaredContentLengths[0]) >
      policy.networkLimits.maximumResponseBodyByteLength
  ) {
    throw responseTooLarge();
  }
  for (const name of [
    "age",
    "location",
    "content-encoding",
    "transfer-encoding",
    "content-range",
    "trailer"
  ]) {
    if (countRawHeaders(response.rawHeaders, name) !== 0) {
      throw responseRejected();
    }
  }
  const expectedContentLength = String(document.contentLength);
  if (
    !hasExactHeaderValue(
      response.rawHeaders,
      "content-length",
      expectedContentLength
    ) ||
    !hasExactHeaderValue(
      response.rawHeaders,
      "content-type",
      policy.responseBoundary.requiredContentType
    ) ||
    !hasExactHeaderValue(
      response.rawHeaders,
      "content-disposition",
      `attachment; filename=${document.fileName}`
    ) ||
    !hasExactHeaderValue(
      response.rawHeaders,
      "cache-control",
      policy.responseBoundary.observedCacheControl
    ) ||
    !hasExactHeaderValue(
      response.rawHeaders,
      "pragma",
      policy.responseBoundary.observedPragma
    ) ||
    countRawHeaders(response.rawHeaders, "set-cookie") !==
      policy.responseBoundary.requiredSetCookieHeaderCount
  ) {
    throw responseRejected();
  }
  if (
    document.contentLength >
    policy.networkLimits.maximumResponseBodyByteLength
  ) {
    throw responseTooLarge();
  }
  const dates = readRawHeaderValues(response.rawHeaders, "date");
  const expires = readRawHeaderValues(response.rawHeaders, "expires");
  const responseDate = dates[0] ?? "";
  const responseDateMilliseconds = Date.parse(responseDate);
  if (
    dates.length !== 1 ||
    expires.length !== 1 ||
    responseDate !== expires[0] ||
    !Number.isFinite(responseDateMilliseconds) ||
    new Date(responseDateMilliseconds).toUTCString() !== responseDate
  ) {
    throw responseRejected();
  }
  return document.contentLength;
}

function hasExactHeaderValue(
  rawHeaders: string[],
  name: string,
  expectedValue: string
): boolean {
  const values = readRawHeaderValues(rawHeaders, name);
  return values.length === 1 && values[0] === expectedValue;
}

function readRawHeaderValues(rawHeaders: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name) {
      values.push(rawHeaders[index + 1] ?? "");
    }
  }
  return values;
}

function countRawHeaders(rawHeaders: string[], name: string): number {
  let count = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name) {
      count += 1;
    }
  }
  return count;
}

function normalizeTestOnlyNetworkConnector(
  connector: TestOnlyOfficialMarketCalendarKrxLegacyDownloadSocketConnector
): Readonly<TestOnlyOfficialMarketCalendarKrxLegacyDownloadSocketConnector> {
  if (connector === null || typeof connector !== "object") {
    throwInvalidNetworkConnector();
  }
  let dialAddress: unknown;
  let dialPort: unknown;
  let certificateAuthority: unknown;
  let deadlineMs: unknown;
  try {
    dialAddress = connector.dialAddress;
    dialPort = connector.dialPort;
    certificateAuthority = connector.certificateAuthority;
    deadlineMs = connector.deadlineMs;
  } catch {
    throwInvalidNetworkConnector();
  }
  const maximumDeadline =
    resolveDownloadNetworkPolicy().networkLimits.absoluteDeadlineMilliseconds;
  if (
    typeof dialAddress !== "string" ||
    !isLoopbackIp(dialAddress) ||
    !Number.isInteger(dialPort) ||
    (dialPort as number) < 1 ||
    (dialPort as number) > 65_535 ||
    typeof certificateAuthority !== "string" ||
    certificateAuthority.trim().length === 0 ||
    (deadlineMs !== undefined &&
      (!Number.isInteger(deadlineMs) ||
        (deadlineMs as number) < 1 ||
        (deadlineMs as number) > maximumDeadline))
  ) {
    throwInvalidNetworkConnector();
  }
  return Object.freeze({
    dialAddress,
    dialPort,
    certificateAuthority,
    ...(deadlineMs === undefined ? {} : { deadlineMs })
  }) as Readonly<TestOnlyOfficialMarketCalendarKrxLegacyDownloadSocketConnector>;
}

function resolveDownloadNetworkPolicy(): OfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition {
  return resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_NETWORK_POLICY_VERSION
  );
}

function encodeDownloadPostWireBody(
  rawOtpBytes: Uint8Array,
  maximumBodyByteLength: number
): Uint8Array {
  const workspace = new Uint8Array(maximumBodyByteLength);
  try {
    let offset = 0;
    for (const byte of [0x63, 0x6f, 0x64, 0x65, 0x3d]) {
      offset = appendLiteralByte(workspace, offset, byte);
    }
    for (const byte of rawOtpBytes) {
      offset = appendEncodedByte(workspace, offset, byte);
    }
    const encodedBody = new Uint8Array(offset);
    Uint8Array.prototype.set.call(
      encodedBody,
      Uint8Array.prototype.subarray.call(workspace, 0, offset)
    );
    return encodedBody;
  } finally {
    zeroizeBytes(workspace);
  }
}

function verifyDownloadPostWireBody(
  bodyBytes: Uint8Array,
  rawOtpBytes: Uint8Array,
  wirePolicy: ReturnType<
    typeof resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostWirePolicy
  >
): void {
  if (
    bodyBytes.byteLength < wirePolicy.wireLimits.minimumRequestBodyByteLength ||
    bodyBytes.byteLength > wirePolicy.wireLimits.maximumRequestBodyByteLength
  ) {
    throw new Error(
      "KRX legacy download POST wire body violates the registered byte limits"
    );
  }
  let offset = 0;
  for (const byte of [0x63, 0x6f, 0x64, 0x65, 0x3d]) {
    offset = expectLiteralByte(bodyBytes, offset, byte);
  }
  for (const byte of rawOtpBytes) {
    offset = expectEncodedByte(bodyBytes, offset, byte);
  }
  if (offset !== bodyBytes.byteLength) {
    throw new Error("KRX legacy download POST wire body has trailing bytes");
  }
}

function appendEncodedByte(
  destination: Uint8Array,
  offset: number,
  byte: number
): number {
  if (isUnreservedAscii(byte)) {
    return appendLiteralByte(destination, offset, byte);
  }
  let nextOffset = appendLiteralByte(destination, offset, 0x25);
  nextOffset = appendLiteralByte(
    destination,
    nextOffset,
    uppercaseHexNibble(byte >>> 4)
  );
  return appendLiteralByte(
    destination,
    nextOffset,
    uppercaseHexNibble(byte & 0x0f)
  );
}

function expectEncodedByte(
  bodyBytes: Uint8Array,
  offset: number,
  byte: number
): number {
  if (isUnreservedAscii(byte)) {
    return expectLiteralByte(bodyBytes, offset, byte);
  }
  let nextOffset = expectLiteralByte(bodyBytes, offset, 0x25);
  nextOffset = expectLiteralByte(
    bodyBytes,
    nextOffset,
    uppercaseHexNibble(byte >>> 4)
  );
  return expectLiteralByte(
    bodyBytes,
    nextOffset,
    uppercaseHexNibble(byte & 0x0f)
  );
}

function appendLiteralByte(
  destination: Uint8Array,
  offset: number,
  byte: number
): number {
  if (offset >= destination.byteLength) {
    throw new Error(
      "KRX legacy download POST wire body exceeds the registered byte limit"
    );
  }
  destination[offset] = byte;
  return offset + 1;
}

function expectLiteralByte(
  bodyBytes: Uint8Array,
  offset: number,
  expectedByte: number
): number {
  if (offset >= bodyBytes.byteLength || bodyBytes[offset] !== expectedByte) {
    throw new Error(
      "KRX legacy download POST wire body verification failed"
    );
  }
  return offset + 1;
}

function isUnreservedAscii(byte: number): boolean {
  return (
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a) ||
    (byte >= 0x30 && byte <= 0x39) ||
    byte === 0x2d ||
    byte === 0x2e ||
    byte === 0x5f ||
    byte === 0x7e
  );
}

function uppercaseHexNibble(value: number): number {
  return value < 10 ? 0x30 + value : 0x41 + value - 10;
}

function isLoopbackIp(value: string): boolean {
  return isIP(value) !== 0 && (value === "127.0.0.1" || value === "::1");
}

function throwInvalidNetworkConnector(): never {
  throw new OfficialMarketCalendarKrxLegacyDownloadNetworkError(
    "KRX_LEGACY_DOWNLOAD_NETWORK_INVALID_CONFIG",
    "KRX legacy download test-only network connector is invalid."
  );
}

function responseRejected(): OfficialMarketCalendarKrxLegacyDownloadNetworkError {
  return new OfficialMarketCalendarKrxLegacyDownloadNetworkError(
    "KRX_LEGACY_DOWNLOAD_NETWORK_RESPONSE_REJECTED",
    "KRX legacy download response was rejected."
  );
}

function responseTooLarge(): OfficialMarketCalendarKrxLegacyDownloadNetworkError {
  return new OfficialMarketCalendarKrxLegacyDownloadNetworkError(
    "KRX_LEGACY_DOWNLOAD_NETWORK_RESPONSE_TOO_LARGE",
    "KRX legacy download response exceeded the registered byte length."
  );
}

function incompleteResponse(): OfficialMarketCalendarKrxLegacyDownloadNetworkError {
  return new OfficialMarketCalendarKrxLegacyDownloadNetworkError(
    "KRX_LEGACY_DOWNLOAD_NETWORK_INCOMPLETE_RESPONSE",
    "KRX legacy download response was incomplete."
  );
}

function disposeBodyObject(handle: object): void {
  const state = bodyStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawResponseBytes);
  } finally {
    bodyStates.set(handle, { status: "disposed" });
  }
}

function disposeParametersObject(handle: object): void {
  const state = parameterStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawOtpBytes);
  } finally {
    parameterStates.set(handle, { status: "disposed" });
  }
}

function disposeWireBodyObject(handle: object): void {
  const state = wireBodyStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.bodyBytes);
  } finally {
    wireBodyStates.set(handle, { status: "disposed" });
  }
}

function disposeResponseObject(handle: object): void {
  const state = responseStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawResponseBytes);
  } finally {
    responseStates.set(handle, { status: "disposed" });
  }
}

function disposeIdentityVerifiedDocumentObject(handle: object): void {
  const state = identityVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    identityVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeOleHeaderVerifiedDocumentObject(handle: object): void {
  const state = oleHeaderVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    oleHeaderVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeDifatVerifiedDocumentObject(handle: object): void {
  const state = difatVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    difatVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeFatVerifiedDocumentObject(handle: object): void {
  const state = fatVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    fatVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeSystemChainsVerifiedDocumentObject(handle: object): void {
  const state = systemChainsVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    systemChainsVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeDirectoryEntriesVerifiedDocumentObject(handle: object): void {
  const state = directoryEntriesVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    directoryEntriesVerifiedDocumentStates.set(handle, {
      status: "disposed"
    });
  }
}

function disposeDirectoryTreeVerifiedDocumentObject(handle: object): void {
  const state = directoryTreeVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    directoryTreeVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeMiniFatEntriesVerifiedDocumentObject(handle: object): void {
  const state = miniFatEntriesVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    miniFatEntriesVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeRootMiniStreamVerifiedDocumentObject(handle: object): void {
  const state = rootMiniStreamVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    rootMiniStreamVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeUserStreamAllocationVerifiedDocumentObject(
  handle: object
): void {
  const state = userStreamAllocationVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    userStreamAllocationVerifiedDocumentStates.set(handle, {
      status: "disposed"
    });
  }
}

function disposeUserStreamBytesProjectedDocumentObject(handle: object): void {
  const state = userStreamBytesProjectedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeProjectedUserStreamBytes(state.userStreamBytes);
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    userStreamBytesProjectedDocumentStates.set(handle, {
      status: "disposed"
    });
  }
}

function disposeWordStreamsVerifiedDocumentObject(handle: object): void {
  const state = wordStreamsVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeWordStreamBytes(state.wordStreams);
    zeroizeProjectedUserStreamBytes(state.userStreamBytes);
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    wordStreamsVerifiedDocumentStates.set(handle, {
      status: "disposed"
    });
  }
}

function disposeWordFibVerifiedDocumentObject(handle: object): void {
  const state = wordFibVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeWordFibBytes(state.wordFib);
    zeroizeWordStreamBytes(state.wordStreams);
    zeroizeProjectedUserStreamBytes(state.userStreamBytes);
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    wordFibVerifiedDocumentStates.set(handle, {
      status: "disposed"
    });
  }
}

function disposeWordClxReferenceVerifiedDocumentObject(handle: object): void {
  const state = wordClxReferenceVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.clxReference.clxBytes);
    zeroizeWordFibBytes(state.wordFib);
    zeroizeWordStreamBytes(state.wordStreams);
    zeroizeProjectedUserStreamBytes(state.userStreamBytes);
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    wordClxReferenceVerifiedDocumentStates.set(handle, {
      status: "disposed"
    });
  }
}

function disposeWordClxVerifiedDocumentObject(handle: object): void {
  const state = wordClxVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") return;
  try {
    zeroizeBytes(state.clx.plcPcdBytes);
    zeroizeBytes(state.clxReference.clxBytes);
    zeroizeWordFibBytes(state.wordFib);
    zeroizeWordStreamBytes(state.wordStreams);
    zeroizeProjectedUserStreamBytes(state.userStreamBytes);
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    wordClxVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeWordPlcPcdVerifiedDocumentObject(handle: object): void {
  const state = wordPlcPcdVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.clx.plcPcdBytes);
    zeroizeBytes(state.clxReference.clxBytes);
    zeroizeWordFibBytes(state.wordFib);
    zeroizeWordStreamBytes(state.wordStreams);
    zeroizeProjectedUserStreamBytes(state.userStreamBytes);
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    wordPlcPcdVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeWordPcdPrmVerifiedDocumentObject(handle: object): void {
  const state = wordPcdPrmVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizePcdPrmBytes(state.pcdPrms);
    zeroizeBytes(state.clx.plcPcdBytes);
    zeroizeBytes(state.clxReference.clxBytes);
    zeroizeWordFibBytes(state.wordFib);
    zeroizeWordStreamBytes(state.wordStreams);
    zeroizeProjectedUserStreamBytes(state.userStreamBytes);
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    wordPcdPrmVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeWordPrcGrpPrlVerifiedDocumentObject(handle: object): void {
  const state = wordPrcGrpPrlVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") return;
  try {
    zeroizePrcGrpPrlBytes(state.prcGrpPrls);
    zeroizePcdPrmBytes(state.pcdPrms);
    zeroizeBytes(state.clx.plcPcdBytes);
    zeroizeBytes(state.clxReference.clxBytes);
    zeroizeWordFibBytes(state.wordFib);
    zeroizeWordStreamBytes(state.wordStreams);
    zeroizeProjectedUserStreamBytes(state.userStreamBytes);
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    wordPrcGrpPrlVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeWordDocumentCountsVerifiedDocumentObject(handle: object): void {
  const state = wordDocumentCountsVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") return;
  try {
    zeroizePrcGrpPrlBytes(state.prcGrpPrls);
    zeroizePcdPrmBytes(state.pcdPrms);
    zeroizeBytes(state.clx.plcPcdBytes);
    zeroizeBytes(state.clxReference.clxBytes);
    zeroizeWordFibBytes(state.wordFib);
    zeroizeWordStreamBytes(state.wordStreams);
    zeroizeProjectedUserStreamBytes(state.userStreamBytes);
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    wordDocumentCountsVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeWordTextRangesVerifiedDocumentObject(handle: object): void {
  const state = wordTextRangesVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") return;
  try {
    zeroizePrcGrpPrlBytes(state.prcGrpPrls);
    zeroizePcdPrmBytes(state.pcdPrms);
    zeroizeBytes(state.clx.plcPcdBytes);
    zeroizeBytes(state.clxReference.clxBytes);
    zeroizeWordFibBytes(state.wordFib);
    zeroizeWordStreamBytes(state.wordStreams);
    zeroizeProjectedUserStreamBytes(state.userStreamBytes);
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    wordTextRangesVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeWordTextBytesProjectedDocumentObject(handle: object): void {
  const state = wordTextBytesProjectedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") return;
  try {
    zeroizeTextPieceBytes(state.textBytes);
    zeroizePrcGrpPrlBytes(state.prcGrpPrls);
    zeroizePcdPrmBytes(state.pcdPrms);
    zeroizeBytes(state.clx.plcPcdBytes);
    zeroizeBytes(state.clxReference.clxBytes);
    zeroizeWordFibBytes(state.wordFib);
    zeroizeWordStreamBytes(state.wordStreams);
    zeroizeProjectedUserStreamBytes(state.userStreamBytes);
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    wordTextBytesProjectedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeWordTextDecodedDocumentObject(handle: object): void {
  const state = wordTextDecodedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") return;
  try {
    zeroizeTextPieceBytes(state.textBytes);
    zeroizePrcGrpPrlBytes(state.prcGrpPrls);
    zeroizePcdPrmBytes(state.pcdPrms);
    zeroizeBytes(state.clx.plcPcdBytes);
    zeroizeBytes(state.clxReference.clxBytes);
    zeroizeWordFibBytes(state.wordFib);
    zeroizeWordStreamBytes(state.wordStreams);
    zeroizeProjectedUserStreamBytes(state.userStreamBytes);
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    wordTextDecodedDocumentStates.set(handle, { status: "disposed" });
  }
}

function disposeWordMainDocumentVerifiedDocumentObject(handle: object): void {
  const state = wordMainDocumentVerifiedDocumentStates.get(handle);
  if (state === undefined || state.status === "disposed") return;
  try {
    zeroizeTextPieceBytes(state.textBytes);
    zeroizePrcGrpPrlBytes(state.prcGrpPrls);
    zeroizePcdPrmBytes(state.pcdPrms);
    zeroizeBytes(state.clx.plcPcdBytes);
    zeroizeBytes(state.clxReference.clxBytes);
    zeroizeWordFibBytes(state.wordFib);
    zeroizeWordStreamBytes(state.wordStreams);
    zeroizeProjectedUserStreamBytes(state.userStreamBytes);
    zeroizeBytes(state.rawDocumentBytes);
  } finally {
    wordMainDocumentVerifiedDocumentStates.set(handle, { status: "disposed" });
  }
}

function sameTextByteProjection(
  textRanges: VerifiedOfficialMarketCalendarKrxLegacyWordTextRanges,
  textBytes: ProjectedOfficialMarketCalendarKrxLegacyWordTextBytes
): boolean {
  return textBytes.pieces.every((piece, index) => {
    const range = textRanges.ranges[index];
    return range !== undefined &&
      piece.index === range.index &&
      piece.byteStart === range.byteStart &&
      piece.byteLength === range.byteLength &&
      piece.byteEnd === range.byteEnd &&
      piece.bytes.length === range.byteLength;
  });
}

function zeroizeTextPieceBytes(
  textBytes: ProjectedOfficialMarketCalendarKrxLegacyWordTextBytes
): void {
  for (const piece of textBytes.pieces) zeroizeBytes(piece.bytes);
}

function sameTextRangeProjection(
  plcPcd: VerifiedOfficialMarketCalendarKrxLegacyWordPlcPcd,
  textRanges: VerifiedOfficialMarketCalendarKrxLegacyWordTextRanges
): boolean {
  return textRanges.ranges.every((range, index) => {
    const piece = plcPcd.pieces[index];
    return piece !== undefined &&
      range.index === piece.index &&
      range.cpStart === piece.cpStart &&
      range.cpEnd === piece.cpEnd &&
      range.characterCount === piece.characterCount;
  });
}

function samePcdPrmProjection(
  pcdPrms: VerifiedOfficialMarketCalendarKrxLegacyWordPcdPrms,
  prcGrpPrls: VerifiedOfficialMarketCalendarKrxLegacyWordPrcGrpPrls
): boolean {
  return prcGrpPrls.pieces.every((piece, index) => {
    const expected = pcdPrms.pieces[index];
    return expected !== undefined &&
      piece.index === expected.index &&
      piece.cpStart === expected.cpStart &&
      piece.cpEnd === expected.cpEnd &&
      piece.rawPrm === expected.rawPrm;
  });
}

function samePrcGrpPrlProjection(
  pcdPrms: VerifiedOfficialMarketCalendarKrxLegacyWordPcdPrms,
  prcGrpPrls: VerifiedOfficialMarketCalendarKrxLegacyWordPrcGrpPrls
): boolean {
  return prcGrpPrls.prcs.every((prc, index) => {
    const expected = pcdPrms.prcs[index];
    return expected !== undefined &&
      prc.index === expected.index &&
      prc.clxByteOffset === expected.clxByteOffset &&
      prc.grpprlByteOffset === expected.grpprlByteOffset &&
      prc.grpprlByteLength === expected.grpprlByteLength &&
      prc.prlCount === prc.prls.length &&
      prc.prlCount === prc.paragraphPrlCount + prc.characterPrlCount + prc.otherPropertyGroupPrlCount;
  });
}

function zeroizePrcGrpPrlBytes(
  prcGrpPrls: VerifiedOfficialMarketCalendarKrxLegacyWordPrcGrpPrls
): void {
  for (const prc of prcGrpPrls.prcs) {
    zeroizeBytes(prc.grpprlBytes);
    for (const prl of prc.prls) zeroizeBytes(prl.operandBytes);
  }
}

function samePcdPrmRanges(
  plcPcd: VerifiedOfficialMarketCalendarKrxLegacyWordPlcPcd,
  pcdPrms: VerifiedOfficialMarketCalendarKrxLegacyWordPcdPrms
): boolean {
  return pcdPrms.pieces.every((piece, index) => {
    const plcPiece = plcPcd.pieces[index];
    return (
      plcPiece !== undefined &&
      piece.index === plcPiece.index &&
      piece.cpStart === plcPiece.cpStart &&
      piece.cpEnd === plcPiece.cpEnd
    );
  });
}

function zeroizePcdPrmBytes(
  pcdPrms: VerifiedOfficialMarketCalendarKrxLegacyWordPcdPrms
): void {
  for (const prc of pcdPrms.prcs) zeroizeBytes(prc.grpprlBytes);
}

function samePlcPcdRanges(
  plcPcd: VerifiedOfficialMarketCalendarKrxLegacyWordPlcPcd
): boolean {
  return plcPcd.pieces.every((piece, index) => {
    const cpStart = plcPcd.characterPositions[index];
    const cpEnd = plcPcd.characterPositions[index + 1];
    return (
      cpStart !== undefined &&
      cpEnd !== undefined &&
      piece.index === index &&
      piece.cpStart === cpStart &&
      piece.cpEnd === cpEnd &&
      piece.characterCount === cpEnd - cpStart
    );
  });
}

function sameByteRange(
  source: Uint8Array,
  offset: number,
  expected: Uint8Array
): boolean {
  return (
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    offset + expected.length <= source.length &&
    expected.every((value, index) => value === source[offset + index])
  );
}

function zeroizeWordFibBytes(
  wordFib: VerifiedOfficialMarketCalendarKrxLegacyWordFib
): void {
  zeroizeBytes(wordFib.wordDocumentBytes);
  zeroizeBytes(wordFib.tableStreamBytes);
}

function zeroizeWordStreamBytes(
  wordStreams: VerifiedOfficialMarketCalendarKrxLegacyWordBinaryFileStreams
): void {
  zeroizeBytes(wordStreams.wordDocumentBytes);
  zeroizeBytes(wordStreams.tableStreamBytes);
}

function sameSelectedWordStreamProjection(
  wordStreams: VerifiedOfficialMarketCalendarKrxLegacyWordBinaryFileStreams,
  projection: ProjectedOfficialMarketCalendarOleCompoundFileUserStreamBytes
): boolean {
  const wordDocument = projection.streams.find(
    (stream) => stream.streamId === wordStreams.wordDocumentStreamId
  );
  const tableStream = projection.streams.find(
    (stream) => stream.streamId === wordStreams.tableStreamId
  );
  return (
    wordDocument !== undefined &&
    wordDocument.name === "WordDocument" &&
    wordDocument.streamSize === wordStreams.wordDocumentSize &&
    sameByteSequence(wordDocument.bytes, wordStreams.wordDocumentBytes) &&
    tableStream !== undefined &&
    tableStream.name === wordStreams.tableStreamName &&
    tableStream.streamSize === wordStreams.tableStreamSize &&
    sameByteSequence(tableStream.bytes, wordStreams.tableStreamBytes)
  );
}

function sameByteSequence(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function zeroizeProjectedUserStreamBytes(
  projection: ProjectedOfficialMarketCalendarOleCompoundFileUserStreamBytes
): void {
  for (const stream of projection.streams) {
    zeroizeBytes(stream.bytes);
  }
}

function sameProjectedUserStreamSequence(
  projection: ProjectedOfficialMarketCalendarOleCompoundFileUserStreamBytes,
  allocation: VerifiedOfficialMarketCalendarOleCompoundFileUserStreamAllocation
): boolean {
  return (
    projection.streams.length === allocation.streams.length &&
    projection.streams.every((stream, index) => {
      const allocatedStream = allocation.streams[index];
      return (
        allocatedStream !== undefined &&
        stream.streamId === allocatedStream.streamId &&
        stream.name === allocatedStream.name &&
        stream.streamSize === allocatedStream.streamSize &&
        stream.allocation === allocatedStream.allocation &&
        stream.bytesOwnership === "caller_owned_copy" &&
        BigInt(stream.bytes.length) === BigInt(allocatedStream.streamSize)
      );
    })
  );
}

function sameUserStreamIdentitySequence(
  streams: VerifiedOfficialMarketCalendarOleCompoundFileUserStreamAllocation["streams"],
  directoryEntries: readonly VerifiedOfficialMarketCalendarOleDirectoryEntry[]
): boolean {
  return (
    streams.length === directoryEntries.length &&
    streams.every((stream, index) => {
      const entry = directoryEntries[index];
      return (
        entry !== undefined &&
        stream.streamId === entry.streamId &&
        stream.name === entry.name &&
        stream.streamSize === entry.streamSize
      );
    })
  );
}

function sameDirectoryEntrySequence(
  left: readonly VerifiedOfficialMarketCalendarOleDirectoryEntry[],
  right: readonly VerifiedOfficialMarketCalendarOleDirectoryEntry[]
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        entry.streamId === other.streamId &&
        entry.name === other.name &&
        entry.objectType === other.objectType &&
        entry.color === other.color &&
        entry.leftSiblingId === other.leftSiblingId &&
        entry.rightSiblingId === other.rightSiblingId &&
        entry.childId === other.childId &&
        entry.startingSector === other.startingSector &&
        entry.streamSize === other.streamSize
      );
    })
  );
}

function sameNumberSequence(
  left: readonly number[],
  right: readonly number[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function resolveRegisteredFileName(value: unknown): LegacyFileName {
  return resolveRegisteredDocument(value).fileName;
}

function resolveRegisteredDocument(value: unknown): LegacyDocument {
  const sourcePolicy =
    resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION
    );
  const document = sourcePolicy.documents.find(
    (candidate) => candidate.fileName === value
  );
  if (document === undefined) {
    throw new Error(
      "KRX legacy download OTP target must be a registered document file name"
    );
  }
  return document;
}

function createOpaqueHandle(toJSON: () => never): object {
  const handle = Object.create(null) as object;
  Object.defineProperty(handle, "toJSON", {
    enumerable: false,
    configurable: false,
    writable: false,
    value: toJSON
  });
  return Object.freeze(handle);
}

function assertHandleObject(value: unknown): object {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    throw new Error("KRX legacy download ephemeral handle is invalid");
  }
  return value;
}

function readTransferredByteLength(value: unknown): number {
  if (
    !(value instanceof Uint8Array) ||
    typedArrayByteLengthGetter === undefined ||
    typedArrayBufferGetter === undefined
  ) {
    throw new Error(
      "KRX legacy download OTP ephemeral bytes must be a Uint8Array"
    );
  }
  try {
    const buffer = typedArrayBufferGetter.call(value) as ArrayBufferLike;
    if (hasSharedArrayBufferBacking(buffer)) {
      throw new Error(
        "KRX legacy download OTP ephemeral bytes must not use shared backing memory"
      );
    }
    const byteLength = typedArrayByteLengthGetter.call(value) as number;
    if (byteLength !== 300) {
      throw new Error(
        "KRX legacy download OTP ephemeral bytes must be attached and exactly 300 bytes"
      );
    }
    return byteLength;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("shared") ||
        error.message.includes("exactly 300"))
    ) {
      throw error;
    }
    throw new Error(
      "KRX legacy download OTP ephemeral bytes must be attached and exactly 300 bytes"
    );
  }
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

function zeroizeBytes(value: Uint8Array): void {
  try {
    Uint8Array.prototype.fill.call(value, 0);
  } catch {
    // A detached transferred view owns no remaining bytes to clear.
  }
}
