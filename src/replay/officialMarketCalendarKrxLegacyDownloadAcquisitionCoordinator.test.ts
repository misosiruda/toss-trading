import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  createOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator,
  createTestOnlyOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator,
  OfficialMarketCalendarKrxLegacyDownloadAcquisitionError
} from "./officialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator.js";
import {
  consumeOfficialMarketCalendarKrxLegacyDirectoryEntriesVerifiedDocumentToDirectoryTreeVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyDirectoryTreeVerifiedDocumentToMiniFatEntriesVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyDifatVerifiedDocumentToFatVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyFatVerifiedDocumentToSystemChainsVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyIdentityVerifiedDocumentToOleHeaderVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyMiniFatEntriesVerifiedDocumentToRootMiniStreamVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyOleHeaderVerifiedDocumentToDifatVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyRootMiniStreamVerifiedDocumentToUserStreamAllocationVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacySystemChainsVerifiedDocumentToDirectoryEntriesVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyUserStreamAllocationVerifiedDocumentToUserStreamBytesProjectedDocument,
  consumeOfficialMarketCalendarKrxLegacyUserStreamBytesProjectedDocumentToWordStreamsVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordStreamsVerifiedDocumentToWordFibVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordFibVerifiedDocumentToWordClxReferenceVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordClxReferenceVerifiedDocumentToWordClxVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordClxVerifiedDocumentToWordPlcPcdVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordPlcPcdVerifiedDocumentToWordPcdPrmVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordPcdPrmVerifiedDocumentToWordPrcGrpPrlVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordPrcGrpPrlVerifiedDocumentToWordDocumentCountsVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordDocumentCountsVerifiedDocumentToWordTextRangesVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordTextRangesVerifiedDocumentToWordTextBytesProjectedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordTextBytesProjectedDocumentToWordTextDecodedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordTextDecodedDocumentToWordMainDocumentVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordMainDocumentVerifiedDocumentToWordPlcBtePapxReferenceVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceVerifiedDocumentToWordPlcBtePapxVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxVerifiedDocumentToWordPapxFkpReferencesVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordPapxFkpReferencesVerifiedDocumentToWordPapxFkpVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordPapxFkpVerifiedDocumentToWordGrpPrlVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordGrpPrlVerifiedDocumentToWordParagraphBoundariesVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordParagraphBoundariesVerifiedDocumentToWordDirectParagraphPropertiesVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesVerifiedDocumentToWordTableTextMarksVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordTableTextMarksVerifiedDocumentToWordTableRowGroupingVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordTableRowGroupingVerifiedDocumentToWordSourceRowsVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordSourceRowsVerifiedDocumentToWordDocumentTitleVerifiedDocument,
  consumeOfficialMarketCalendarKrxLegacyWordDocumentTitleVerifiedDocumentToCandidateSummary,
  consumeOfficialMarketCalendarKrxLegacyDownloadResponseToWordDocumentTitleVerifiedDocument,
  consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument,
  consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToWordDocumentTitleVerifiedDocument,
  createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody,
  createTestOnlyOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer,
  disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralResponse,
  disposeOfficialMarketCalendarKrxLegacyDownloadDirectoryEntriesVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadDirectoryTreeVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadFatVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadIdentityVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadDifatVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadOleHeaderVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadSystemChainsVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadMiniFatEntriesVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadRootMiniStreamVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadUserStreamAllocationVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadUserStreamBytesProjectedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordStreamsVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordFibVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordClxReferenceVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordClxVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordPlcPcdVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordPcdPrmVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordPrcGrpPrlVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordDocumentCountsVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordTextRangesVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordTextBytesProjectedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordTextDecodedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordMainDocumentVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordPlcBtePapxReferenceVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordPlcBtePapxVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordPapxFkpReferencesVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordPapxFkpVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordGrpPrlVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordParagraphBoundariesVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordDirectParagraphPropertiesVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordTableTextMarksVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordTableRowGroupingVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordSourceRowsVerifiedDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadWordDocumentTitleVerifiedDocument,
  type OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody
} from "./officialMarketCalendarKrxLegacyDownloadOtpEphemeralBody.js";
import {
  createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier,
  OfficialMarketCalendarKrxLegacyDocumentIdentityError
} from "./officialMarketCalendarKrxLegacyDocumentIdentity.js";
import {
  KRX_LEGACY_DOWNLOAD_TEST_CA,
  KRX_LEGACY_DOWNLOAD_TEST_SERVER_OPTIONS
} from "./officialMarketCalendarKrxLegacyDownloadNetworkTestFixture.js";
import { OfficialMarketCalendarOleCompoundFileDifatError } from "./officialMarketCalendarOleCompoundFileDifat.js";
import { OfficialMarketCalendarOleCompoundFileDirectoryEntriesError } from "./officialMarketCalendarOleCompoundFileDirectoryEntries.js";
import { OfficialMarketCalendarOleCompoundFileDirectoryTreeError } from "./officialMarketCalendarOleCompoundFileDirectoryTree.js";
import { OfficialMarketCalendarOleCompoundFileFatError } from "./officialMarketCalendarOleCompoundFileFat.js";
import { OfficialMarketCalendarOleCompoundFileMiniFatEntriesError } from "./officialMarketCalendarOleCompoundFileMiniFatEntries.js";
import { OfficialMarketCalendarOleCompoundFileRootMiniStreamError } from "./officialMarketCalendarOleCompoundFileRootMiniStream.js";
import { OfficialMarketCalendarOleCompoundFileSystemChainsError } from "./officialMarketCalendarOleCompoundFileSystemChains.js";
import { OfficialMarketCalendarOleCompoundFileUserStreamAllocationError } from "./officialMarketCalendarOleCompoundFileUserStreamAllocation.js";
import { OfficialMarketCalendarKrxLegacyWordBinaryFileStreamsError } from "./officialMarketCalendarKrxLegacyWordBinaryFileStreams.js";
import { OfficialMarketCalendarKrxLegacyWordFibError } from "./officialMarketCalendarKrxLegacyWordFib.js";
import { OfficialMarketCalendarKrxLegacyWordClxReferenceError } from "./officialMarketCalendarKrxLegacyWordClxReference.js";
import { OfficialMarketCalendarKrxLegacyWordPlcPcdError } from "./officialMarketCalendarKrxLegacyWordPlcPcd.js";
import { OfficialMarketCalendarKrxLegacyWordDocumentTitleError } from "./officialMarketCalendarKrxLegacyWordDocumentTitle.js";
import { OfficialMarketCalendarKrxLegacyWordPcdPrmError } from "./officialMarketCalendarKrxLegacyWordPcdPrm.js";
import { OfficialMarketCalendarKrxLegacyWordPrcGrpPrlError } from "./officialMarketCalendarKrxLegacyWordPrcGrpPrl.js";
import { OfficialMarketCalendarKrxLegacyWordDocumentCountsError } from "./officialMarketCalendarKrxLegacyWordDocumentCounts.js";
import { OfficialMarketCalendarKrxLegacyWordTextRangesError } from "./officialMarketCalendarKrxLegacyWordTextRanges.js";
import { OfficialMarketCalendarKrxLegacyWordMainDocumentError } from "./officialMarketCalendarKrxLegacyWordMainDocument.js";
import { OfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceError } from "./officialMarketCalendarKrxLegacyWordPlcBtePapxReference.js";
import { OfficialMarketCalendarKrxLegacyWordPlcBtePapxError } from "./officialMarketCalendarKrxLegacyWordPlcBtePapx.js";
import { OfficialMarketCalendarKrxLegacyWordPapxFkpReferencesError } from "./officialMarketCalendarKrxLegacyWordPapxFkpReferences.js";
import { OfficialMarketCalendarKrxLegacyWordPapxFkpError } from "./officialMarketCalendarKrxLegacyWordPapxFkp.js";
import { OfficialMarketCalendarKrxLegacyWordGrpPrlError } from "./officialMarketCalendarKrxLegacyWordGrpPrl.js";
import { OfficialMarketCalendarKrxLegacyWordParagraphBoundariesError } from "./officialMarketCalendarKrxLegacyWordParagraphBoundaries.js";
import { OfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesError } from "./officialMarketCalendarKrxLegacyWordDirectParagraphProperties.js";
import { OfficialMarketCalendarKrxLegacyWordTableTextMarksError } from "./officialMarketCalendarKrxLegacyWordTableTextMarks.js";
import { OfficialMarketCalendarKrxLegacyWordTableRowGroupingError } from "./officialMarketCalendarKrxLegacyWordTableRowGrouping.js";

const FILE_NAME = "E_Trading_Calendar2013.doc";
const DOCUMENT_TITLE = "KRX Derivatives Trading Calendar 2013";
const MAIN_DOCUMENT_TEXT = `${DOCUMENT_TITLE}\r`;
const FILE_LENGTH = 195_584;

test("KRX legacy coordinator composes OTP through opaque document response", async () => {
  await withDownloadServer(
    (response) => sendValidResponse(response),
    async (port) => {
      const requestedFiles: unknown[] = [];
      const coordinator =
        createTestOnlyOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator(
          {
            otpConsumer: {
              async acquire(fileName) {
                requestedFiles.push(fileName);
                return createOtpHandle(fileName);
              }
            },
            downloadConsumer:
              createTestOnlyOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer(
                {
                  dialAddress: "127.0.0.1",
                  dialPort: port,
                  certificateAuthority: KRX_LEGACY_DOWNLOAD_TEST_CA,
                  deadlineMs: 1_000
                }
              )
          }
        );

      const responseHandle = await coordinator.acquire({
        fileName: FILE_NAME
      });
      assert.deepEqual(requestedFiles, [FILE_NAME]);
      assert.equal(Object.isFrozen(responseHandle), true);
      assert.deepEqual(Object.keys(responseHandle), []);
      disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralResponse(
        responseHandle
      );
    }
  );
});

test("KRX legacy response transfers only through the fixed verification lifecycle", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(
    documentBytes,
    [0x16, 0x24, 1],
    0,
    MAIN_DOCUMENT_TEXT.length
  );
  configureSyntheticWordDocumentCounts(documentBytes, MAIN_DOCUMENT_TEXT.length);
  configureSyntheticWordTextRange(documentBytes, 1536, MAIN_DOCUMENT_TEXT);
  configureSyntheticWordPlcBtePapxReference(
    documentBytes,
    100,
    12,
    920 + MAIN_DOCUMENT_TEXT.length * 2
  );
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const coordinator = createCoordinatorForPort(port);
      const responseHandle = await coordinator.acquire({ fileName: FILE_NAME });
      const verifier =
        createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier({
          fileName: FILE_NAME,
          targetYear: "2013",
          contentLength: documentBytes.byteLength,
          sha256: createHash("sha256").update(documentBytes).digest("hex"),
          oleCompoundFileSignature: "d0cf11e0a1b11ae1"
        });

      const verifiedHandle =
        consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
          responseHandle,
          verifier
        );
      assert.equal(Object.isFrozen(verifiedHandle), true);
      assert.deepEqual(Object.keys(verifiedHandle), []);
      assert.throws(
        () =>
          consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
            responseHandle,
            verifier
          ),
        /must be ready/
      );
      const oleHeaderVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyIdentityVerifiedDocumentToOleHeaderVerifiedDocument(
          verifiedHandle
        );
      assert.equal(Object.isFrozen(oleHeaderVerifiedHandle), true);
      assert.deepEqual(Object.keys(oleHeaderVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyIdentityVerifiedDocumentToOleHeaderVerifiedDocument(
            verifiedHandle
          ),
        /must be ready/
      );
      const difatVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyOleHeaderVerifiedDocumentToDifatVerifiedDocument(
          oleHeaderVerifiedHandle
        );
      assert.equal(Object.isFrozen(difatVerifiedHandle), true);
      assert.deepEqual(Object.keys(difatVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyOleHeaderVerifiedDocumentToDifatVerifiedDocument(
            oleHeaderVerifiedHandle
          ),
        /must be ready/
      );
      const fatVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyDifatVerifiedDocumentToFatVerifiedDocument(
          difatVerifiedHandle
        );
      assert.equal(Object.isFrozen(fatVerifiedHandle), true);
      assert.deepEqual(Object.keys(fatVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyDifatVerifiedDocumentToFatVerifiedDocument(
            difatVerifiedHandle
          ),
        /must be ready/
      );
      const systemChainsVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyFatVerifiedDocumentToSystemChainsVerifiedDocument(
          fatVerifiedHandle
        );
      assert.equal(Object.isFrozen(systemChainsVerifiedHandle), true);
      assert.deepEqual(Object.keys(systemChainsVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyFatVerifiedDocumentToSystemChainsVerifiedDocument(
            fatVerifiedHandle
          ),
        /must be ready/
      );
      const directoryEntriesVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacySystemChainsVerifiedDocumentToDirectoryEntriesVerifiedDocument(
          systemChainsVerifiedHandle
        );
      assert.equal(Object.isFrozen(directoryEntriesVerifiedHandle), true);
      assert.deepEqual(Object.keys(directoryEntriesVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacySystemChainsVerifiedDocumentToDirectoryEntriesVerifiedDocument(
            systemChainsVerifiedHandle
          ),
        /must be ready/
      );
      const directoryTreeVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyDirectoryEntriesVerifiedDocumentToDirectoryTreeVerifiedDocument(
          directoryEntriesVerifiedHandle
        );
      assert.equal(Object.isFrozen(directoryTreeVerifiedHandle), true);
      assert.deepEqual(Object.keys(directoryTreeVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyDirectoryEntriesVerifiedDocumentToDirectoryTreeVerifiedDocument(
            directoryEntriesVerifiedHandle
          ),
        /must be ready/
      );
      const miniFatEntriesVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyDirectoryTreeVerifiedDocumentToMiniFatEntriesVerifiedDocument(
          directoryTreeVerifiedHandle
        );
      assert.equal(Object.isFrozen(miniFatEntriesVerifiedHandle), true);
      assert.deepEqual(Object.keys(miniFatEntriesVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyDirectoryTreeVerifiedDocumentToMiniFatEntriesVerifiedDocument(
            directoryTreeVerifiedHandle
          ),
        /must be ready/
      );
      const rootMiniStreamVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyMiniFatEntriesVerifiedDocumentToRootMiniStreamVerifiedDocument(
          miniFatEntriesVerifiedHandle
        );
      assert.equal(Object.isFrozen(rootMiniStreamVerifiedHandle), true);
      assert.deepEqual(Object.keys(rootMiniStreamVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyMiniFatEntriesVerifiedDocumentToRootMiniStreamVerifiedDocument(
            miniFatEntriesVerifiedHandle
          ),
        /must be ready/
      );
      const userStreamAllocationVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyRootMiniStreamVerifiedDocumentToUserStreamAllocationVerifiedDocument(
          rootMiniStreamVerifiedHandle
        );
      assert.equal(Object.isFrozen(userStreamAllocationVerifiedHandle), true);
      assert.deepEqual(Object.keys(userStreamAllocationVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyRootMiniStreamVerifiedDocumentToUserStreamAllocationVerifiedDocument(
            rootMiniStreamVerifiedHandle
          ),
        /must be ready/
      );
      const userStreamBytesProjectedHandle =
        consumeOfficialMarketCalendarKrxLegacyUserStreamAllocationVerifiedDocumentToUserStreamBytesProjectedDocument(
          userStreamAllocationVerifiedHandle
        );
      assert.equal(Object.isFrozen(userStreamBytesProjectedHandle), true);
      assert.deepEqual(Object.keys(userStreamBytesProjectedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyUserStreamAllocationVerifiedDocumentToUserStreamBytesProjectedDocument(
            userStreamAllocationVerifiedHandle
          ),
        /must be ready/
      );
      const wordStreamsVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyUserStreamBytesProjectedDocumentToWordStreamsVerifiedDocument(
          userStreamBytesProjectedHandle
        );
      assert.equal(Object.isFrozen(wordStreamsVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordStreamsVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyUserStreamBytesProjectedDocumentToWordStreamsVerifiedDocument(
            userStreamBytesProjectedHandle
          ),
        /must be ready/
      );
      const wordFibVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyWordStreamsVerifiedDocumentToWordFibVerifiedDocument(
          wordStreamsVerifiedHandle
        );
      assert.equal(Object.isFrozen(wordFibVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordFibVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordStreamsVerifiedDocumentToWordFibVerifiedDocument(
            wordStreamsVerifiedHandle
          ),
        /must be ready/
      );
      const wordClxReferenceVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyWordFibVerifiedDocumentToWordClxReferenceVerifiedDocument(
          wordFibVerifiedHandle
        );
      assert.equal(Object.isFrozen(wordClxReferenceVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordClxReferenceVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordFibVerifiedDocumentToWordClxReferenceVerifiedDocument(
            wordFibVerifiedHandle
          ),
        /must be ready/
      );
      const wordClxVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyWordClxReferenceVerifiedDocumentToWordClxVerifiedDocument(
          wordClxReferenceVerifiedHandle
        );
      assert.equal(Object.isFrozen(wordClxVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordClxVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordClxReferenceVerifiedDocumentToWordClxVerifiedDocument(
            wordClxReferenceVerifiedHandle
          ),
        /must be ready/
      );
      const wordPlcPcdVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyWordClxVerifiedDocumentToWordPlcPcdVerifiedDocument(
          wordClxVerifiedHandle
        );
      assert.equal(Object.isFrozen(wordPlcPcdVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordPlcPcdVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordClxVerifiedDocumentToWordPlcPcdVerifiedDocument(
            wordClxVerifiedHandle
          ),
        /must be ready/
      );
      const wordPcdPrmVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyWordPlcPcdVerifiedDocumentToWordPcdPrmVerifiedDocument(
          wordPlcPcdVerifiedHandle
        );
      assert.equal(Object.isFrozen(wordPcdPrmVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordPcdPrmVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordPlcPcdVerifiedDocumentToWordPcdPrmVerifiedDocument(
            wordPlcPcdVerifiedHandle
          ),
        /must be ready/
      );
      const wordPrcGrpPrlVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyWordPcdPrmVerifiedDocumentToWordPrcGrpPrlVerifiedDocument(
          wordPcdPrmVerifiedHandle
        );
      assert.equal(Object.isFrozen(wordPrcGrpPrlVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordPrcGrpPrlVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordPcdPrmVerifiedDocumentToWordPrcGrpPrlVerifiedDocument(
            wordPcdPrmVerifiedHandle
          ),
        /must be ready/
      );
      const wordDocumentCountsVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyWordPrcGrpPrlVerifiedDocumentToWordDocumentCountsVerifiedDocument(
          wordPrcGrpPrlVerifiedHandle
        );
      assert.equal(Object.isFrozen(wordDocumentCountsVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordDocumentCountsVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordPrcGrpPrlVerifiedDocumentToWordDocumentCountsVerifiedDocument(
            wordPrcGrpPrlVerifiedHandle
          ),
        /must be ready/
      );
      const wordTextRangesVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyWordDocumentCountsVerifiedDocumentToWordTextRangesVerifiedDocument(
          wordDocumentCountsVerifiedHandle
        );
      assert.equal(Object.isFrozen(wordTextRangesVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordTextRangesVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordDocumentCountsVerifiedDocumentToWordTextRangesVerifiedDocument(
            wordDocumentCountsVerifiedHandle
          ),
        /must be ready/
      );
      const wordTextBytesProjectedHandle =
        consumeOfficialMarketCalendarKrxLegacyWordTextRangesVerifiedDocumentToWordTextBytesProjectedDocument(
          wordTextRangesVerifiedHandle
        );
      assert.equal(Object.isFrozen(wordTextBytesProjectedHandle), true);
      assert.deepEqual(Object.keys(wordTextBytesProjectedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordTextRangesVerifiedDocumentToWordTextBytesProjectedDocument(
            wordTextRangesVerifiedHandle
          ),
        /must be ready/
      );
      const wordTextDecodedHandle =
        consumeOfficialMarketCalendarKrxLegacyWordTextBytesProjectedDocumentToWordTextDecodedDocument(
          wordTextBytesProjectedHandle
        );
      assert.equal(Object.isFrozen(wordTextDecodedHandle), true);
      assert.deepEqual(Object.keys(wordTextDecodedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordTextBytesProjectedDocumentToWordTextDecodedDocument(
            wordTextBytesProjectedHandle
          ),
        /must be ready/
      );
      const wordMainDocumentVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyWordTextDecodedDocumentToWordMainDocumentVerifiedDocument(
          wordTextDecodedHandle
        );
      assert.equal(Object.isFrozen(wordMainDocumentVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordMainDocumentVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordTextDecodedDocumentToWordMainDocumentVerifiedDocument(
            wordTextDecodedHandle
          ),
        /must be ready/
      );
      const wordPlcBtePapxReferenceVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyWordMainDocumentVerifiedDocumentToWordPlcBtePapxReferenceVerifiedDocument(
          wordMainDocumentVerifiedHandle
        );
      assert.equal(Object.isFrozen(wordPlcBtePapxReferenceVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordPlcBtePapxReferenceVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordMainDocumentVerifiedDocumentToWordPlcBtePapxReferenceVerifiedDocument(
            wordMainDocumentVerifiedHandle
          ),
        /must be ready/
      );
      const wordPlcBtePapxVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceVerifiedDocumentToWordPlcBtePapxVerifiedDocument(
          wordPlcBtePapxReferenceVerifiedHandle
        );
      assert.equal(Object.isFrozen(wordPlcBtePapxVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordPlcBtePapxVerifiedHandle), []);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceVerifiedDocumentToWordPlcBtePapxVerifiedDocument(
            wordPlcBtePapxReferenceVerifiedHandle
          ),
        /must be ready/
      );
      const wordPapxFkpReferencesVerifiedHandle =
        consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxVerifiedDocumentToWordPapxFkpReferencesVerifiedDocument(wordPlcBtePapxVerifiedHandle);
      assert.equal(Object.isFrozen(wordPapxFkpReferencesVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordPapxFkpReferencesVerifiedHandle), []);
      assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxVerifiedDocumentToWordPapxFkpReferencesVerifiedDocument(wordPlcBtePapxVerifiedHandle), /must be ready/);
      const wordPapxFkpVerifiedHandle = consumeOfficialMarketCalendarKrxLegacyWordPapxFkpReferencesVerifiedDocumentToWordPapxFkpVerifiedDocument(wordPapxFkpReferencesVerifiedHandle);
      assert.equal(Object.isFrozen(wordPapxFkpVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordPapxFkpVerifiedHandle), []);
      assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordPapxFkpReferencesVerifiedDocumentToWordPapxFkpVerifiedDocument(wordPapxFkpReferencesVerifiedHandle), /must be ready/);
      const wordGrpPrlVerifiedHandle = consumeOfficialMarketCalendarKrxLegacyWordPapxFkpVerifiedDocumentToWordGrpPrlVerifiedDocument(wordPapxFkpVerifiedHandle);
      assert.equal(Object.isFrozen(wordGrpPrlVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordGrpPrlVerifiedHandle), []);
      assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordPapxFkpVerifiedDocumentToWordGrpPrlVerifiedDocument(wordPapxFkpVerifiedHandle), /must be ready/);
      const wordParagraphBoundariesVerifiedHandle = consumeOfficialMarketCalendarKrxLegacyWordGrpPrlVerifiedDocumentToWordParagraphBoundariesVerifiedDocument(wordGrpPrlVerifiedHandle);
      assert.equal(Object.isFrozen(wordParagraphBoundariesVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordParagraphBoundariesVerifiedHandle), []);
      assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordGrpPrlVerifiedDocumentToWordParagraphBoundariesVerifiedDocument(wordGrpPrlVerifiedHandle), /must be ready/);
      const wordDirectParagraphPropertiesVerifiedHandle = consumeOfficialMarketCalendarKrxLegacyWordParagraphBoundariesVerifiedDocumentToWordDirectParagraphPropertiesVerifiedDocument(wordParagraphBoundariesVerifiedHandle);
      assert.equal(Object.isFrozen(wordDirectParagraphPropertiesVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordDirectParagraphPropertiesVerifiedHandle), []);
      assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordParagraphBoundariesVerifiedDocumentToWordDirectParagraphPropertiesVerifiedDocument(wordParagraphBoundariesVerifiedHandle), /must be ready/);
      const wordTableTextMarksVerifiedHandle = consumeOfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesVerifiedDocumentToWordTableTextMarksVerifiedDocument(wordDirectParagraphPropertiesVerifiedHandle);
      assert.equal(Object.isFrozen(wordTableTextMarksVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordTableTextMarksVerifiedHandle), []);
      assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesVerifiedDocumentToWordTableTextMarksVerifiedDocument(wordDirectParagraphPropertiesVerifiedHandle), /must be ready/);
      const wordTableRowGroupingVerifiedHandle = consumeOfficialMarketCalendarKrxLegacyWordTableTextMarksVerifiedDocumentToWordTableRowGroupingVerifiedDocument(wordTableTextMarksVerifiedHandle);
      assert.equal(Object.isFrozen(wordTableRowGroupingVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordTableRowGroupingVerifiedHandle), []);
      assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordTableTextMarksVerifiedDocumentToWordTableRowGroupingVerifiedDocument(wordTableTextMarksVerifiedHandle), /must be ready/);
      const wordSourceRowsVerifiedHandle = consumeOfficialMarketCalendarKrxLegacyWordTableRowGroupingVerifiedDocumentToWordSourceRowsVerifiedDocument(wordTableRowGroupingVerifiedHandle);
      assert.equal(Object.isFrozen(wordSourceRowsVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordSourceRowsVerifiedHandle), []);
      assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordTableRowGroupingVerifiedDocumentToWordSourceRowsVerifiedDocument(wordTableRowGroupingVerifiedHandle), /must be ready/);
      const wordDocumentTitleVerifiedHandle = consumeOfficialMarketCalendarKrxLegacyWordSourceRowsVerifiedDocumentToWordDocumentTitleVerifiedDocument(wordSourceRowsVerifiedHandle);
      assert.equal(Object.isFrozen(wordDocumentTitleVerifiedHandle), true);
      assert.deepEqual(Object.keys(wordDocumentTitleVerifiedHandle), []);
      assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordSourceRowsVerifiedDocumentToWordDocumentTitleVerifiedDocument(wordSourceRowsVerifiedHandle), /must be ready/);
      assert.throws(
        () => JSON.stringify(wordDocumentTitleVerifiedHandle),
        /cannot be serialized or exported/
      );
      disposeOfficialMarketCalendarKrxLegacyDownloadWordDocumentTitleVerifiedDocument(wordDocumentTitleVerifiedHandle);

      const fixedConsumerResponse = await coordinator.acquire({
        fileName: FILE_NAME
      });
      const fixedConsumerTitle =
        consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToWordDocumentTitleVerifiedDocument(
          fixedConsumerResponse,
          verifier
        );
      assert.equal(Object.isFrozen(fixedConsumerTitle), true);
      assert.deepEqual(Object.keys(fixedConsumerTitle), []);
      assert.throws(
        () =>
          consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToWordDocumentTitleVerifiedDocument(
            fixedConsumerResponse,
            verifier
          ),
        /must be ready/
      );
      assert.throws(
        () => JSON.stringify(fixedConsumerTitle),
        /cannot be serialized or exported/
      );
      disposeOfficialMarketCalendarKrxLegacyDownloadWordDocumentTitleVerifiedDocument(
        fixedConsumerTitle
      );

      const authorityForgedResponse = await coordinator.acquire({
        fileName: FILE_NAME
      });
      assert.throws(
        () =>
          consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
            authorityForgedResponse,
            {
              verify(input) {
                return {
                  ...verifier.verify(input),
                  identityVerificationAuthority: "registered_source_policy"
                };
              }
            }
          ),
        /identity result did not match the network response/
      );
      assert.throws(
        () =>
          consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
            authorityForgedResponse,
            verifier
          ),
        /must be ready/
      );

      const coordinatorTitle = await createCoordinatorForPort(
        port,
        verifier
      ).acquireWordDocumentTitle({ fileName: FILE_NAME });
      assert.equal(Object.isFrozen(coordinatorTitle), true);
      assert.deepEqual(Object.keys(coordinatorTitle), []);
      assert.deepEqual(
        consumeOfficialMarketCalendarKrxLegacyWordDocumentTitleVerifiedDocumentToCandidateSummary(
          coordinatorTitle
        ),
        {
          schemaVersion:
            "official_market_calendar_krx_legacy_word_candidate_summary.v2",
          fileName: FILE_NAME,
          targetYear: "2013",
          nFib: 0x00c1,
          tableStreamName: "1Table",
          structuralSourceRowCount: 0,
          structuralSourceCellCount: 0,
          titleBindingVerified: true,
          identityVerificationAuthority: "test_only_expectation",
          calendarEventCount: null,
          holidayCount: null,
          columnSemanticsStatus: "not_interpreted",
          holidaySemanticsStatus: "not_interpreted",
          sourceRoleStatus: "candidate_not_accepted",
          durableEvidenceReuse: false,
          acceptedAcquisition: false
        }
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordDocumentTitleVerifiedDocumentToCandidateSummary(
            coordinatorTitle
          ),
        /must be ready/
      );

      assert.deepEqual(
        await createCoordinatorForPort(
          port,
          verifier
        ).acquireWordCandidateSummary({ fileName: FILE_NAME }),
        {
          schemaVersion:
            "official_market_calendar_krx_legacy_word_candidate_summary.v2",
          fileName: FILE_NAME,
          targetYear: "2013",
          nFib: 0x00c1,
          tableStreamName: "1Table",
          structuralSourceRowCount: 0,
          structuralSourceCellCount: 0,
          titleBindingVerified: true,
          identityVerificationAuthority: "test_only_expectation",
          calendarEventCount: null,
          holidayCount: null,
          columnSemanticsStatus: "not_interpreted",
          holidaySemanticsStatus: "not_interpreted",
          sourceRoleStatus: "candidate_not_accepted",
          durableEvidenceReuse: false,
          acceptedAcquisition: false
        }
      );

      const serializationTitle = await createCoordinatorForPort(
        port,
        verifier
      ).acquireWordDocumentTitle({ fileName: FILE_NAME });
      assert.throws(
        () => JSON.stringify(serializationTitle),
        /cannot be serialized or exported/
      );
      disposeOfficialMarketCalendarKrxLegacyDownloadWordDocumentTitleVerifiedDocument(
        serializationTitle
      );

      const productionResponse = await coordinator.acquire({
        fileName: FILE_NAME
      });
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyDownloadResponseToWordDocumentTitleVerifiedDocument(
            productionResponse
          ),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarKrxLegacyDocumentIdentityError &&
          error.code === "KRX_LEGACY_DOCUMENT_IDENTITY_HASH_MISMATCH"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
            productionResponse
          ),
        /must be ready/
      );
      await assert.rejects(
        () => coordinator.acquireWordDocumentTitle({ fileName: FILE_NAME }),
        (error: unknown) =>
          hasCode(
            error,
            "KRX_LEGACY_DOWNLOAD_ACQUISITION_DOCUMENT_VERIFICATION_REJECTED"
          )
      );
      await assert.rejects(
        () => coordinator.acquireWordCandidateSummary({ fileName: FILE_NAME }),
        (error: unknown) =>
          hasCode(
            error,
            "KRX_LEGACY_DOWNLOAD_ACQUISITION_DOCUMENT_VERIFICATION_REJECTED"
          )
      );
    }
  );
});

test("KRX legacy identity response consumer rejects forged handles and verifier config", () => {
  assert.throws(
    () =>
      consumeOfficialMarketCalendarKrxLegacyWordDocumentTitleVerifiedDocumentToCandidateSummary(
        {} as never
      ),
    /must be ready/
  );
  assert.throws(
    () =>
      consumeOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
        {} as never
      ),
    /must be ready/
  );
  assert.throws(
    () =>
      consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
        {} as never,
        null as never
      ),
    /test-only identity verifier is invalid/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadIdentityVerifiedDocument(
        {} as never
      ),
    /must come from the fixed response consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadOleHeaderVerifiedDocument(
        {} as never
      ),
    /must come from the fixed header consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadDifatVerifiedDocument(
        {} as never
      ),
    /must come from the fixed DIFAT consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadFatVerifiedDocument(
        {} as never
      ),
    /must come from the fixed FAT consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadSystemChainsVerifiedDocument(
        {} as never
      ),
    /must come from the fixed system chains consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadDirectoryEntriesVerifiedDocument(
        {} as never
      ),
    /must come from the fixed directory entries consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadDirectoryTreeVerifiedDocument(
        {} as never
      ),
    /must come from the fixed directory tree consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadMiniFatEntriesVerifiedDocument(
        {} as never
      ),
    /must come from the fixed mini FAT entries consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadRootMiniStreamVerifiedDocument(
        {} as never
      ),
    /must come from the fixed root mini stream consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadUserStreamAllocationVerifiedDocument(
        {} as never
      ),
    /must come from the fixed user stream allocation consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadUserStreamBytesProjectedDocument(
        {} as never
      ),
    /must come from the fixed user stream bytes consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadWordStreamsVerifiedDocument(
        {} as never
      ),
    /must come from the fixed Word stream consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadWordFibVerifiedDocument(
        {} as never
      ),
    /must come from the fixed Word FIB consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadWordClxReferenceVerifiedDocument(
        {} as never
      ),
    /must come from the fixed Word CLX reference consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadWordClxVerifiedDocument(
        {} as never
      ),
    /must come from the fixed Word CLX consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadWordPlcPcdVerifiedDocument(
        {} as never
      ),
    /must come from the fixed Word PlcPcd consumer/
  );
  assert.throws(
    () =>
      disposeOfficialMarketCalendarKrxLegacyDownloadWordPcdPrmVerifiedDocument(
        {} as never
      ),
    /must come from the fixed Word Pcd Prm consumer/
  );
  assert.throws(
    () => disposeOfficialMarketCalendarKrxLegacyDownloadWordPrcGrpPrlVerifiedDocument({} as never),
    /must come from the fixed Word Prc GrpPrl consumer/
  );
  assert.throws(
    () => disposeOfficialMarketCalendarKrxLegacyDownloadWordDocumentCountsVerifiedDocument({} as never),
    /must come from the fixed Word document counts consumer/
  );
  assert.throws(
    () => disposeOfficialMarketCalendarKrxLegacyDownloadWordTextRangesVerifiedDocument({} as never),
    /must come from the fixed Word text ranges consumer/
  );
  assert.throws(
    () => disposeOfficialMarketCalendarKrxLegacyDownloadWordTextBytesProjectedDocument({} as never),
    /must come from the fixed Word text bytes consumer/
  );
  assert.throws(
    () => disposeOfficialMarketCalendarKrxLegacyDownloadWordTextDecodedDocument({} as never),
    /must come from the fixed Word text decoding consumer/
  );
  assert.throws(
    () => disposeOfficialMarketCalendarKrxLegacyDownloadWordMainDocumentVerifiedDocument({} as never),
    /must come from the fixed Word main document consumer/
  );
  assert.throws(
    () => disposeOfficialMarketCalendarKrxLegacyDownloadWordPlcBtePapxReferenceVerifiedDocument({} as never),
    /must come from the fixed Word PlcBtePapx reference consumer/
  );
  assert.throws(
    () => disposeOfficialMarketCalendarKrxLegacyDownloadWordPlcBtePapxVerifiedDocument({} as never),
    /must come from the fixed Word PlcBtePapx consumer/
  );
  assert.throws(() => disposeOfficialMarketCalendarKrxLegacyDownloadWordPapxFkpReferencesVerifiedDocument({} as never), /must come from the fixed Word PapxFkp references consumer/);
  assert.throws(() => disposeOfficialMarketCalendarKrxLegacyDownloadWordPapxFkpVerifiedDocument({} as never), /must come from the fixed Word PapxFkp consumer/);
  assert.throws(() => disposeOfficialMarketCalendarKrxLegacyDownloadWordGrpPrlVerifiedDocument({} as never), /must come from the fixed Word GrpPrl consumer/);
  assert.throws(() => disposeOfficialMarketCalendarKrxLegacyDownloadWordParagraphBoundariesVerifiedDocument({} as never), /must come from the fixed Word paragraph boundaries consumer/);
  assert.throws(() => disposeOfficialMarketCalendarKrxLegacyDownloadWordDirectParagraphPropertiesVerifiedDocument({} as never), /must come from the fixed Word direct paragraph properties consumer/);
  assert.throws(() => disposeOfficialMarketCalendarKrxLegacyDownloadWordTableTextMarksVerifiedDocument({} as never), /must come from the fixed Word table text marks consumer/);
  assert.throws(() => disposeOfficialMarketCalendarKrxLegacyDownloadWordTableRowGroupingVerifiedDocument({} as never), /must come from the fixed Word table row grouping consumer/);
  assert.throws(() => disposeOfficialMarketCalendarKrxLegacyDownloadWordSourceRowsVerifiedDocument({} as never), /must come from the fixed Word source rows consumer/);
  assert.throws(() => disposeOfficialMarketCalendarKrxLegacyDownloadWordDocumentTitleVerifiedDocument({} as never), /must come from the fixed Word document title consumer/);
});

test("KRX legacy DIFAT consumer closes ownership when structure verification fails", async () => {
  const documentBytes = syntheticOleDocument();
  const view = new DataView(documentBytes.buffer);
  view.setUint32(44, 110, true);
  view.setUint32(48, 110, true);
  view.setUint32(68, 109, true);
  view.setUint32(72, 1, true);
  for (let index = 0; index < 109; index += 1) {
    view.setUint32(76 + index * 4, index, true);
  }
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const responseHandle = await createCoordinatorForPort(port).acquire({
        fileName: FILE_NAME
      });
      const verifier =
        createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier({
          fileName: FILE_NAME,
          targetYear: "2013",
          contentLength: documentBytes.byteLength,
          sha256: createHash("sha256").update(documentBytes).digest("hex"),
          oleCompoundFileSignature: "d0cf11e0a1b11ae1"
        });
      const identityHandle =
        consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
          responseHandle,
          verifier
        );
      const headerHandle =
        consumeOfficialMarketCalendarKrxLegacyIdentityVerifiedDocumentToOleHeaderVerifiedDocument(
          identityHandle
        );

      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyOleHeaderVerifiedDocumentToDifatVerifiedDocument(
            headerHandle
          ),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarOleCompoundFileDifatError &&
          error.code === "OFFICIAL_CALENDAR_OLE_DIFAT_INVALID_FAT_LOCATION"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyOleHeaderVerifiedDocumentToDifatVerifiedDocument(
            headerHandle
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy FAT consumer closes ownership when marker verification fails", async () => {
  const documentBytes = syntheticOleDocument();
  new DataView(documentBytes.buffer).setUint32(512, 0xffffffff, true);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const responseHandle = await createCoordinatorForPort(port).acquire({
        fileName: FILE_NAME
      });
      const verifier =
        createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier({
          fileName: FILE_NAME,
          targetYear: "2013",
          contentLength: documentBytes.byteLength,
          sha256: createHash("sha256").update(documentBytes).digest("hex"),
          oleCompoundFileSignature: "d0cf11e0a1b11ae1"
        });
      const identityHandle =
        consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
          responseHandle,
          verifier
        );
      const headerHandle =
        consumeOfficialMarketCalendarKrxLegacyIdentityVerifiedDocumentToOleHeaderVerifiedDocument(
          identityHandle
        );
      const difatHandle =
        consumeOfficialMarketCalendarKrxLegacyOleHeaderVerifiedDocumentToDifatVerifiedDocument(
          headerHandle
        );

      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyDifatVerifiedDocumentToFatVerifiedDocument(
            difatHandle
          ),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarOleCompoundFileFatError &&
          error.code === "OFFICIAL_CALENDAR_OLE_FAT_INVALID_SECTOR_MARKER"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyDifatVerifiedDocumentToFatVerifiedDocument(
            difatHandle
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy system chains consumer closes ownership when chain verification fails", async () => {
  const documentBytes = syntheticOleDocument();
  new DataView(documentBytes.buffer).setUint32(524, 0xffffffff, true);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const responseHandle = await createCoordinatorForPort(port).acquire({
        fileName: FILE_NAME
      });
      const verifier =
        createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier({
          fileName: FILE_NAME,
          targetYear: "2013",
          contentLength: documentBytes.byteLength,
          sha256: createHash("sha256").update(documentBytes).digest("hex"),
          oleCompoundFileSignature: "d0cf11e0a1b11ae1"
        });
      const identityHandle =
        consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
          responseHandle,
          verifier
        );
      const headerHandle =
        consumeOfficialMarketCalendarKrxLegacyIdentityVerifiedDocumentToOleHeaderVerifiedDocument(
          identityHandle
        );
      const difatHandle =
        consumeOfficialMarketCalendarKrxLegacyOleHeaderVerifiedDocumentToDifatVerifiedDocument(
          headerHandle
        );
      const fatHandle =
        consumeOfficialMarketCalendarKrxLegacyDifatVerifiedDocumentToFatVerifiedDocument(
          difatHandle
        );

      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyFatVerifiedDocumentToSystemChainsVerifiedDocument(
            fatHandle
          ),
        (error: unknown) =>
          error instanceof
            OfficialMarketCalendarOleCompoundFileSystemChainsError &&
          error.code === "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_INVALID_CHAIN"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyFatVerifiedDocumentToSystemChainsVerifiedDocument(
            fatHandle
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy directory entries consumer closes ownership when entry verification fails", async () => {
  const documentBytes = syntheticOleDocument();
  new DataView(documentBytes.buffer).setUint16(2048, "N".charCodeAt(0), true);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const responseHandle = await createCoordinatorForPort(port).acquire({
        fileName: FILE_NAME
      });
      const verifier =
        createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier({
          fileName: FILE_NAME,
          targetYear: "2013",
          contentLength: documentBytes.byteLength,
          sha256: createHash("sha256").update(documentBytes).digest("hex"),
          oleCompoundFileSignature: "d0cf11e0a1b11ae1"
        });
      const identityHandle =
        consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
          responseHandle,
          verifier
        );
      const headerHandle =
        consumeOfficialMarketCalendarKrxLegacyIdentityVerifiedDocumentToOleHeaderVerifiedDocument(
          identityHandle
        );
      const difatHandle =
        consumeOfficialMarketCalendarKrxLegacyOleHeaderVerifiedDocumentToDifatVerifiedDocument(
          headerHandle
        );
      const fatHandle =
        consumeOfficialMarketCalendarKrxLegacyDifatVerifiedDocumentToFatVerifiedDocument(
          difatHandle
        );
      const systemChainsHandle =
        consumeOfficialMarketCalendarKrxLegacyFatVerifiedDocumentToSystemChainsVerifiedDocument(
          fatHandle
        );

      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacySystemChainsVerifiedDocumentToDirectoryEntriesVerifiedDocument(
            systemChainsHandle
          ),
        (error: unknown) =>
          error instanceof
            OfficialMarketCalendarOleCompoundFileDirectoryEntriesError &&
          error.code === "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ROOT"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacySystemChainsVerifiedDocumentToDirectoryEntriesVerifiedDocument(
            systemChainsHandle
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy directory tree consumer closes ownership when tree verification fails", async () => {
  const documentBytes = syntheticOleDocument();
  new DataView(documentBytes.buffer).setUint32(2124, 1, true);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const responseHandle = await createCoordinatorForPort(port).acquire({
        fileName: FILE_NAME
      });
      const verifier =
        createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier({
          fileName: FILE_NAME,
          targetYear: "2013",
          contentLength: documentBytes.byteLength,
          sha256: createHash("sha256").update(documentBytes).digest("hex"),
          oleCompoundFileSignature: "d0cf11e0a1b11ae1"
        });
      const identityHandle =
        consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
          responseHandle,
          verifier
        );
      const headerHandle =
        consumeOfficialMarketCalendarKrxLegacyIdentityVerifiedDocumentToOleHeaderVerifiedDocument(
          identityHandle
        );
      const difatHandle =
        consumeOfficialMarketCalendarKrxLegacyOleHeaderVerifiedDocumentToDifatVerifiedDocument(
          headerHandle
        );
      const fatHandle =
        consumeOfficialMarketCalendarKrxLegacyDifatVerifiedDocumentToFatVerifiedDocument(
          difatHandle
        );
      const systemChainsHandle =
        consumeOfficialMarketCalendarKrxLegacyFatVerifiedDocumentToSystemChainsVerifiedDocument(
          fatHandle
        );
      const directoryEntriesHandle =
        consumeOfficialMarketCalendarKrxLegacySystemChainsVerifiedDocumentToDirectoryEntriesVerifiedDocument(
          systemChainsHandle
        );

      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyDirectoryEntriesVerifiedDocumentToDirectoryTreeVerifiedDocument(
            directoryEntriesHandle
          ),
        (error: unknown) =>
          error instanceof
            OfficialMarketCalendarOleCompoundFileDirectoryTreeError &&
          error.code === "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_NODE"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyDirectoryEntriesVerifiedDocumentToDirectoryTreeVerifiedDocument(
            directoryEntriesHandle
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy mini FAT entries consumer closes ownership when allocator verification fails", async () => {
  const documentBytes = syntheticOleDocument();
  const view = new DataView(documentBytes.buffer);
  view.setUint32(60, 4, true);
  view.setUint32(64, 1, true);
  view.setUint32(528, 0xfffffffe, true);
  view.setUint32(2560, 0xfffffffd, true);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const responseHandle = await createCoordinatorForPort(port).acquire({
        fileName: FILE_NAME
      });
      const verifier =
        createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier({
          fileName: FILE_NAME,
          targetYear: "2013",
          contentLength: documentBytes.byteLength,
          sha256: createHash("sha256").update(documentBytes).digest("hex"),
          oleCompoundFileSignature: "d0cf11e0a1b11ae1"
        });
      const identityHandle =
        consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
          responseHandle,
          verifier
        );
      const headerHandle =
        consumeOfficialMarketCalendarKrxLegacyIdentityVerifiedDocumentToOleHeaderVerifiedDocument(
          identityHandle
        );
      const difatHandle =
        consumeOfficialMarketCalendarKrxLegacyOleHeaderVerifiedDocumentToDifatVerifiedDocument(
          headerHandle
        );
      const fatHandle =
        consumeOfficialMarketCalendarKrxLegacyDifatVerifiedDocumentToFatVerifiedDocument(
          difatHandle
        );
      const systemChainsHandle =
        consumeOfficialMarketCalendarKrxLegacyFatVerifiedDocumentToSystemChainsVerifiedDocument(
          fatHandle
        );
      const directoryEntriesHandle =
        consumeOfficialMarketCalendarKrxLegacySystemChainsVerifiedDocumentToDirectoryEntriesVerifiedDocument(
          systemChainsHandle
        );
      const directoryTreeHandle =
        consumeOfficialMarketCalendarKrxLegacyDirectoryEntriesVerifiedDocumentToDirectoryTreeVerifiedDocument(
          directoryEntriesHandle
        );

      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyDirectoryTreeVerifiedDocumentToMiniFatEntriesVerifiedDocument(
            directoryTreeHandle
          ),
        (error: unknown) =>
          error instanceof
            OfficialMarketCalendarOleCompoundFileMiniFatEntriesError &&
          error.code === "OFFICIAL_CALENDAR_OLE_MINI_FAT_ENTRIES_INVALID_ENTRY"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyDirectoryTreeVerifiedDocumentToMiniFatEntriesVerifiedDocument(
            directoryTreeHandle
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy root mini stream consumer closes ownership when root allocation verification fails", async () => {
  const documentBytes = syntheticOleDocument();
  new DataView(documentBytes.buffer).setUint32(2164, 4, true);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const responseHandle = await createCoordinatorForPort(port).acquire({
        fileName: FILE_NAME
      });
      const verifier =
        createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier({
          fileName: FILE_NAME,
          targetYear: "2013",
          contentLength: documentBytes.byteLength,
          sha256: createHash("sha256").update(documentBytes).digest("hex"),
          oleCompoundFileSignature: "d0cf11e0a1b11ae1"
        });
      const identityHandle =
        consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
          responseHandle,
          verifier
        );
      const headerHandle =
        consumeOfficialMarketCalendarKrxLegacyIdentityVerifiedDocumentToOleHeaderVerifiedDocument(
          identityHandle
        );
      const difatHandle =
        consumeOfficialMarketCalendarKrxLegacyOleHeaderVerifiedDocumentToDifatVerifiedDocument(
          headerHandle
        );
      const fatHandle =
        consumeOfficialMarketCalendarKrxLegacyDifatVerifiedDocumentToFatVerifiedDocument(
          difatHandle
        );
      const systemChainsHandle =
        consumeOfficialMarketCalendarKrxLegacyFatVerifiedDocumentToSystemChainsVerifiedDocument(
          fatHandle
        );
      const directoryEntriesHandle =
        consumeOfficialMarketCalendarKrxLegacySystemChainsVerifiedDocumentToDirectoryEntriesVerifiedDocument(
          systemChainsHandle
        );
      const directoryTreeHandle =
        consumeOfficialMarketCalendarKrxLegacyDirectoryEntriesVerifiedDocumentToDirectoryTreeVerifiedDocument(
          directoryEntriesHandle
        );
      const miniFatEntriesHandle =
        consumeOfficialMarketCalendarKrxLegacyDirectoryTreeVerifiedDocumentToMiniFatEntriesVerifiedDocument(
          directoryTreeHandle
        );

      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyMiniFatEntriesVerifiedDocumentToRootMiniStreamVerifiedDocument(
            miniFatEntriesHandle
          ),
        (error: unknown) =>
          error instanceof
            OfficialMarketCalendarOleCompoundFileRootMiniStreamError &&
          error.code ===
            "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_LENGTH_MISMATCH"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyMiniFatEntriesVerifiedDocumentToRootMiniStreamVerifiedDocument(
            miniFatEntriesHandle
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy user stream allocation consumer closes ownership when allocation verification fails", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticInvalidUserStream(documentBytes);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const responseHandle = await createCoordinatorForPort(port).acquire({
        fileName: FILE_NAME
      });
      const verifier =
        createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier({
          fileName: FILE_NAME,
          targetYear: "2013",
          contentLength: documentBytes.byteLength,
          sha256: createHash("sha256").update(documentBytes).digest("hex"),
          oleCompoundFileSignature: "d0cf11e0a1b11ae1"
        });
      const identityHandle =
        consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
          responseHandle,
          verifier
        );
      const headerHandle =
        consumeOfficialMarketCalendarKrxLegacyIdentityVerifiedDocumentToOleHeaderVerifiedDocument(
          identityHandle
        );
      const difatHandle =
        consumeOfficialMarketCalendarKrxLegacyOleHeaderVerifiedDocumentToDifatVerifiedDocument(
          headerHandle
        );
      const fatHandle =
        consumeOfficialMarketCalendarKrxLegacyDifatVerifiedDocumentToFatVerifiedDocument(
          difatHandle
        );
      const systemChainsHandle =
        consumeOfficialMarketCalendarKrxLegacyFatVerifiedDocumentToSystemChainsVerifiedDocument(
          fatHandle
        );
      const directoryEntriesHandle =
        consumeOfficialMarketCalendarKrxLegacySystemChainsVerifiedDocumentToDirectoryEntriesVerifiedDocument(
          systemChainsHandle
        );
      const directoryTreeHandle =
        consumeOfficialMarketCalendarKrxLegacyDirectoryEntriesVerifiedDocumentToDirectoryTreeVerifiedDocument(
          directoryEntriesHandle
        );
      const miniFatEntriesHandle =
        consumeOfficialMarketCalendarKrxLegacyDirectoryTreeVerifiedDocumentToMiniFatEntriesVerifiedDocument(
          directoryTreeHandle
        );
      const rootMiniStreamHandle =
        consumeOfficialMarketCalendarKrxLegacyMiniFatEntriesVerifiedDocumentToRootMiniStreamVerifiedDocument(
          miniFatEntriesHandle
        );

      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyRootMiniStreamVerifiedDocumentToUserStreamAllocationVerifiedDocument(
            rootMiniStreamHandle
          ),
        (error: unknown) =>
          error instanceof
            OfficialMarketCalendarOleCompoundFileUserStreamAllocationError &&
          error.code === "OFFICIAL_CALENDAR_OLE_USER_STREAM_INVALID_START"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyRootMiniStreamVerifiedDocumentToUserStreamAllocationVerifiedDocument(
            rootMiniStreamHandle
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy Word stream consumer closes ownership when required streams are missing", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticFatUserStream(documentBytes);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const userStreamBytesHandle =
        await acquireUserStreamBytesProjectedHandle(port, documentBytes);

      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyUserStreamBytesProjectedDocumentToWordStreamsVerifiedDocument(
            userStreamBytesHandle
          ),
        (error: unknown) =>
          error instanceof
            OfficialMarketCalendarKrxLegacyWordBinaryFileStreamsError &&
          error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STREAM_MISSING"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyUserStreamBytesProjectedDocumentToWordStreamsVerifiedDocument(
            userStreamBytesHandle
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy Word FIB consumer closes ownership when count structure is invalid", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  new DataView(documentBytes.buffer).setUint16((4 + 1) * 512 + 32, 13, true);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const wordStreamsHandle = await acquireWordStreamsVerifiedHandle(
        port,
        documentBytes
      );

      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordStreamsVerifiedDocumentToWordFibVerifiedDocument(
            wordStreamsHandle
          ),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarKrxLegacyWordFibError &&
          error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_FIB_STRUCTURE_INVALID"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordStreamsVerifiedDocumentToWordFibVerifiedDocument(
            wordStreamsHandle
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy Word CLX reference consumer closes ownership when range is empty", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  new DataView(documentBytes.buffer).setUint32(
    (4 + 1) * 512 + 154 + 33 * 8 + 4,
    0,
    true
  );
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const wordFibHandle = await acquireWordFibVerifiedHandle(
        port,
        documentBytes
      );

      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordFibVerifiedDocumentToWordClxReferenceVerifiedDocument(
            wordFibHandle
          ),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarKrxLegacyWordClxReferenceError &&
          error.code ===
            "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_CLX_REFERENCE_INVALID"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordFibVerifiedDocumentToWordClxReferenceVerifiedDocument(
            wordFibHandle
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy Word PlcPcd consumer closes ownership when the first CP is invalid", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  new DataView(documentBytes.buffer).setUint32((12 + 1) * 512 + 7 + 5, 1, true);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const wordClxHandle = await acquireWordClxVerifiedHandle(port, documentBytes);
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordClxVerifiedDocumentToWordPlcPcdVerifiedDocument(
            wordClxHandle
          ),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarKrxLegacyWordPlcPcdError &&
          error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PLC_PCD_INVALID"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordClxVerifiedDocumentToWordPlcPcdVerifiedDocument(
            wordClxHandle
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy Word Pcd Prm consumer closes ownership for an unsupported simple modifier", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPcdPrm(documentBytes, 2);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const wordClxHandle = await acquireWordClxVerifiedHandle(port, documentBytes);
      const wordPlcPcdHandle =
        consumeOfficialMarketCalendarKrxLegacyWordClxVerifiedDocumentToWordPlcPcdVerifiedDocument(
          wordClxHandle
        );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordPlcPcdVerifiedDocumentToWordPcdPrmVerifiedDocument(
            wordPlcPcdHandle
          ),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarKrxLegacyWordPcdPrmError &&
          error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PCD_PRM_INVALID"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordPlcPcdVerifiedDocumentToWordPcdPrmVerifiedDocument(
            wordPlcPcdHandle
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy Word Prc GrpPrl consumer closes ownership for invalid inner framing", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(documentBytes, [0x16, 0x24]);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const wordClxHandle = await acquireWordClxVerifiedHandle(port, documentBytes);
      const wordPlcPcdHandle =
        consumeOfficialMarketCalendarKrxLegacyWordClxVerifiedDocumentToWordPlcPcdVerifiedDocument(wordClxHandle);
      const wordPcdPrmHandle =
        consumeOfficialMarketCalendarKrxLegacyWordPlcPcdVerifiedDocumentToWordPcdPrmVerifiedDocument(wordPlcPcdHandle);
      assert.throws(
        () => consumeOfficialMarketCalendarKrxLegacyWordPcdPrmVerifiedDocumentToWordPrcGrpPrlVerifiedDocument(wordPcdPrmHandle),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarKrxLegacyWordPrcGrpPrlError &&
          error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PRC_GRPPRL_INVALID"
      );
      assert.throws(
        () => consumeOfficialMarketCalendarKrxLegacyWordPcdPrmVerifiedDocumentToWordPrcGrpPrlVerifiedDocument(wordPcdPrmHandle),
        /must be ready/
      );
    }
  );
});

test("KRX legacy Word document counts consumer closes ownership for a final CP mismatch", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(documentBytes, [0x16, 0x24, 1]);
  configureSyntheticWordDocumentCounts(documentBytes, 0);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const wordClxHandle = await acquireWordClxVerifiedHandle(port, documentBytes);
      const wordPlcPcdHandle = consumeOfficialMarketCalendarKrxLegacyWordClxVerifiedDocumentToWordPlcPcdVerifiedDocument(wordClxHandle);
      const wordPcdPrmHandle = consumeOfficialMarketCalendarKrxLegacyWordPlcPcdVerifiedDocumentToWordPcdPrmVerifiedDocument(wordPlcPcdHandle);
      const wordPrcGrpPrlHandle = consumeOfficialMarketCalendarKrxLegacyWordPcdPrmVerifiedDocumentToWordPrcGrpPrlVerifiedDocument(wordPcdPrmHandle);
      assert.throws(
        () => consumeOfficialMarketCalendarKrxLegacyWordPrcGrpPrlVerifiedDocumentToWordDocumentCountsVerifiedDocument(wordPrcGrpPrlHandle),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarKrxLegacyWordDocumentCountsError &&
          error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_COUNTS_INVALID"
      );
      assert.throws(
        () => consumeOfficialMarketCalendarKrxLegacyWordPrcGrpPrlVerifiedDocumentToWordDocumentCountsVerifiedDocument(wordPrcGrpPrlHandle),
        /must be ready/
      );
    }
  );
});

test("KRX legacy Word text ranges consumer closes ownership when cbMac excludes a piece", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(documentBytes, [0x16, 0x24, 1]);
  configureSyntheticWordDocumentCounts(documentBytes, 1);
  configureSyntheticWordTextRange(documentBytes, 921);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const clx = await acquireWordClxVerifiedHandle(port, documentBytes);
      const plc = consumeOfficialMarketCalendarKrxLegacyWordClxVerifiedDocumentToWordPlcPcdVerifiedDocument(clx);
      const prm = consumeOfficialMarketCalendarKrxLegacyWordPlcPcdVerifiedDocumentToWordPcdPrmVerifiedDocument(plc);
      const prc = consumeOfficialMarketCalendarKrxLegacyWordPcdPrmVerifiedDocumentToWordPrcGrpPrlVerifiedDocument(prm);
      const counts = consumeOfficialMarketCalendarKrxLegacyWordPrcGrpPrlVerifiedDocumentToWordDocumentCountsVerifiedDocument(prc);
      assert.throws(
        () => consumeOfficialMarketCalendarKrxLegacyWordDocumentCountsVerifiedDocumentToWordTextRangesVerifiedDocument(counts),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarKrxLegacyWordTextRangesError &&
          error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TEXT_RANGE_INVALID"
      );
      assert.throws(
        () => consumeOfficialMarketCalendarKrxLegacyWordDocumentCountsVerifiedDocumentToWordTextRangesVerifiedDocument(counts),
        /must be ready/
      );
    }
  );
});

test("KRX legacy Word main document consumer closes ownership without a paragraph mark", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(documentBytes, [0x16, 0x24, 1]);
  configureSyntheticWordDocumentCounts(documentBytes, 1);
  configureSyntheticWordTextRange(documentBytes, 922);
  documentBytes[(4 + 1) * 512 + 920] = 0x41;
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const decoded = await acquireWordTextDecodedHandle(port, documentBytes);
      assert.throws(
        () => consumeOfficialMarketCalendarKrxLegacyWordTextDecodedDocumentToWordMainDocumentVerifiedDocument(decoded),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarKrxLegacyWordMainDocumentError &&
          error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_MAIN_DOCUMENT_INVALID"
      );
      assert.throws(
        () => consumeOfficialMarketCalendarKrxLegacyWordTextDecodedDocumentToWordMainDocumentVerifiedDocument(decoded),
        /must be ready/
      );
    }
  );
});

test("KRX legacy Word PlcBtePapx reference consumer closes ownership for an out-of-bounds table range", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(documentBytes, [0x16, 0x24, 1]);
  configureSyntheticWordDocumentCounts(documentBytes, 1);
  configureSyntheticWordTextRange(documentBytes, 922);
  configureSyntheticWordPlcBtePapxReference(documentBytes, 100, 4097);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const mainDocument = await acquireWordMainDocumentVerifiedHandle(
        port,
        documentBytes
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordMainDocumentVerifiedDocumentToWordPlcBtePapxReferenceVerifiedDocument(
            mainDocument
          ),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceError &&
          error.code ===
            "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_REFERENCE_INVALID"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordMainDocumentVerifiedDocumentToWordPlcBtePapxReferenceVerifiedDocument(
            mainDocument
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy Word PlcBtePapx consumer closes ownership for invalid framing", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(documentBytes, [0x16, 0x24, 1]);
  configureSyntheticWordDocumentCounts(documentBytes, 1);
  configureSyntheticWordTextRange(documentBytes, 922);
  configureSyntheticWordPlcBtePapxReference(documentBytes, 100, 3);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const reference = await acquireWordPlcBtePapxReferenceVerifiedHandle(
        port,
        documentBytes
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceVerifiedDocumentToWordPlcBtePapxVerifiedDocument(
            reference
          ),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarKrxLegacyWordPlcBtePapxError &&
          error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_INVALID"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceVerifiedDocumentToWordPlcBtePapxVerifiedDocument(
            reference
          ),
        /must be ready/
      );
    }
  );
});

test("KRX legacy Word PapxFkp references consumer closes ownership without descriptors", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(documentBytes, [0x16, 0x24, 1]);
  configureSyntheticWordDocumentCounts(documentBytes, 1);
  configureSyntheticWordTextRange(documentBytes, 922);
  configureSyntheticWordPlcBtePapxReference(documentBytes);
  await withDownloadServer((response) => sendValidResponse(response, documentBytes), async (port) => {
    const reference = await acquireWordPlcBtePapxReferenceVerifiedHandle(port, documentBytes);
    const plc = consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceVerifiedDocumentToWordPlcBtePapxVerifiedDocument(reference);
    assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxVerifiedDocumentToWordPapxFkpReferencesVerifiedDocument(plc), (error: unknown) => error instanceof OfficialMarketCalendarKrxLegacyWordPapxFkpReferencesError && error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_REFERENCE_INVALID");
    assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxVerifiedDocumentToWordPapxFkpReferencesVerifiedDocument(plc), /must be ready/);
  });
});

test("KRX legacy Word PapxFkp consumer closes ownership for invalid cpara", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(documentBytes, [0x16, 0x24, 1]);
  configureSyntheticWordDocumentCounts(documentBytes, 1);
  configureSyntheticWordTextRange(documentBytes, 1536);
  configureSyntheticWordPlcBtePapxReference(documentBytes, 100, 12);
  documentBytes[(4 + 1) * 512 + 1024 + 511] = 0;
  await withDownloadServer((response) => sendValidResponse(response, documentBytes), async (port) => {
    const reference = await acquireWordPlcBtePapxReferenceVerifiedHandle(port, documentBytes);
    const plc = consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceVerifiedDocumentToWordPlcBtePapxVerifiedDocument(reference);
    const fkpReferences = consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxVerifiedDocumentToWordPapxFkpReferencesVerifiedDocument(plc);
    assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordPapxFkpReferencesVerifiedDocumentToWordPapxFkpVerifiedDocument(fkpReferences), (error: unknown) => error instanceof OfficialMarketCalendarKrxLegacyWordPapxFkpError && error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_INVALID");
    assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordPapxFkpReferencesVerifiedDocumentToWordPapxFkpVerifiedDocument(fkpReferences), /must be ready/);
  });
});

test("KRX legacy Word GrpPrl consumer closes ownership for incomplete Sprm framing", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(documentBytes, [0x16, 0x24, 1]);
  configureSyntheticWordDocumentCounts(documentBytes, 1);
  configureSyntheticWordTextRange(documentBytes, 1536);
  configureSyntheticWordPlcBtePapxReference(documentBytes, 100, 12);
  const fkpOffset = (4 + 1) * 512 + 1024;
  documentBytes[fkpOffset + 8] = 20;
  documentBytes.set([2, 0x34, 0x12, 0x01], fkpOffset + 40);
  await withDownloadServer((response) => sendValidResponse(response, documentBytes), async (port) => {
    const reference = await acquireWordPlcBtePapxReferenceVerifiedHandle(port, documentBytes);
    const plc = consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceVerifiedDocumentToWordPlcBtePapxVerifiedDocument(reference);
    const fkpReferences = consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxVerifiedDocumentToWordPapxFkpReferencesVerifiedDocument(plc);
    const fkp = consumeOfficialMarketCalendarKrxLegacyWordPapxFkpReferencesVerifiedDocumentToWordPapxFkpVerifiedDocument(fkpReferences);
    assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordPapxFkpVerifiedDocumentToWordGrpPrlVerifiedDocument(fkp), (error: unknown) => error instanceof OfficialMarketCalendarKrxLegacyWordGrpPrlError && error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_GRPPRL_INVALID");
    assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordPapxFkpVerifiedDocumentToWordGrpPrlVerifiedDocument(fkp), /must be ready/);
  });
});

test("KRX legacy Word paragraph boundaries consumer closes ownership beyond main CP", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(documentBytes, [0x16, 0x24, 1]);
  configureSyntheticWordDocumentCounts(documentBytes, 1);
  configureSyntheticWordTextRange(documentBytes, 1536);
  configureSyntheticWordPlcBtePapxReference(documentBytes, 100, 12);
  const wordOffset = (4 + 1) * 512;
  const tableOffset = (12 + 1) * 512 + 100;
  const view = new DataView(documentBytes.buffer);
  view.setUint32(tableOffset + 4, 924, true);
  view.setUint32(wordOffset + 1024 + 4, 924, true);
  await withDownloadServer((response) => sendValidResponse(response, documentBytes), async (port) => {
    const reference = await acquireWordPlcBtePapxReferenceVerifiedHandle(port, documentBytes);
    const plc = consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceVerifiedDocumentToWordPlcBtePapxVerifiedDocument(reference);
    const fkpReferences = consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxVerifiedDocumentToWordPapxFkpReferencesVerifiedDocument(plc);
    const fkp = consumeOfficialMarketCalendarKrxLegacyWordPapxFkpReferencesVerifiedDocumentToWordPapxFkpVerifiedDocument(fkpReferences);
    const groups = consumeOfficialMarketCalendarKrxLegacyWordPapxFkpVerifiedDocumentToWordGrpPrlVerifiedDocument(fkp);
    assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordGrpPrlVerifiedDocumentToWordParagraphBoundariesVerifiedDocument(groups), (error: unknown) => error instanceof OfficialMarketCalendarKrxLegacyWordParagraphBoundariesError && error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PARAGRAPH_BOUNDARY_INVALID");
    assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordGrpPrlVerifiedDocumentToWordParagraphBoundariesVerifiedDocument(groups), /must be ready/);
  });
});

test("KRX legacy Word direct paragraph properties consumer closes ownership for invalid merged semantics", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(documentBytes, [0x16, 0x24, 1], 0x0132);
  configureSyntheticWordDocumentCounts(documentBytes, 1);
  configureSyntheticWordTextRange(documentBytes, 1536);
  configureSyntheticWordPlcBtePapxReference(documentBytes, 100, 12);
  await withDownloadServer((response) => sendValidResponse(response, documentBytes), async (port) => {
    const reference = await acquireWordPlcBtePapxReferenceVerifiedHandle(port, documentBytes);
    const plc = consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceVerifiedDocumentToWordPlcBtePapxVerifiedDocument(reference);
    const fkpReferences = consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxVerifiedDocumentToWordPapxFkpReferencesVerifiedDocument(plc);
    const fkp = consumeOfficialMarketCalendarKrxLegacyWordPapxFkpReferencesVerifiedDocumentToWordPapxFkpVerifiedDocument(fkpReferences);
    const groups = consumeOfficialMarketCalendarKrxLegacyWordPapxFkpVerifiedDocumentToWordGrpPrlVerifiedDocument(fkp);
    const boundaries = consumeOfficialMarketCalendarKrxLegacyWordGrpPrlVerifiedDocumentToWordParagraphBoundariesVerifiedDocument(groups);
    assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordParagraphBoundariesVerifiedDocumentToWordDirectParagraphPropertiesVerifiedDocument(boundaries), (error: unknown) => error instanceof OfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesError && error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DIRECT_PARAGRAPH_PROPERTIES_INVALID");
    assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordParagraphBoundariesVerifiedDocumentToWordDirectParagraphPropertiesVerifiedDocument(boundaries), /must be ready/);
  });
});

test("KRX legacy Word table text marks consumer closes ownership for a depth-one TTP paragraph mark", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(documentBytes, [0x16, 0x24, 1], 0x0130);
  configureSyntheticWordDocumentCounts(documentBytes, 1);
  configureSyntheticWordTextRange(documentBytes, 1536);
  configureSyntheticWordPlcBtePapxReference(documentBytes, 100, 12);
  const fkpOffset = (4 + 1) * 512 + 1024;
  documentBytes[fkpOffset + 8] = 20;
  documentBytes.set([3, 0, 0, 0x17, 0x24, 1], fkpOffset + 40);
  await withDownloadServer((response) => sendValidResponse(response, documentBytes), async (port) => {
    const reference = await acquireWordPlcBtePapxReferenceVerifiedHandle(port, documentBytes);
    const plc = consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceVerifiedDocumentToWordPlcBtePapxVerifiedDocument(reference);
    const fkpReferences = consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxVerifiedDocumentToWordPapxFkpReferencesVerifiedDocument(plc);
    const fkp = consumeOfficialMarketCalendarKrxLegacyWordPapxFkpReferencesVerifiedDocumentToWordPapxFkpVerifiedDocument(fkpReferences);
    const groups = consumeOfficialMarketCalendarKrxLegacyWordPapxFkpVerifiedDocumentToWordGrpPrlVerifiedDocument(fkp);
    const boundaries = consumeOfficialMarketCalendarKrxLegacyWordGrpPrlVerifiedDocumentToWordParagraphBoundariesVerifiedDocument(groups);
    const properties = consumeOfficialMarketCalendarKrxLegacyWordParagraphBoundariesVerifiedDocumentToWordDirectParagraphPropertiesVerifiedDocument(boundaries);
    assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesVerifiedDocumentToWordTableTextMarksVerifiedDocument(properties), (error: unknown) => error instanceof OfficialMarketCalendarKrxLegacyWordTableTextMarksError && error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TABLE_TEXT_MARK_INVALID");
    assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesVerifiedDocumentToWordTableTextMarksVerifiedDocument(properties), /must be ready/);
  });
});

test("KRX legacy Word table row grouping consumer closes ownership for an unclosed row", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(documentBytes, [0x16, 0x24, 1], 0x0130);
  configureSyntheticWordDocumentCounts(documentBytes, 1);
  configureSyntheticWordTextRange(documentBytes, 1536);
  configureSyntheticWordPlcBtePapxReference(documentBytes, 100, 12);
  await withDownloadServer((response) => sendValidResponse(response, documentBytes), async (port) => {
    const reference = await acquireWordPlcBtePapxReferenceVerifiedHandle(port, documentBytes);
    const plc = consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceVerifiedDocumentToWordPlcBtePapxVerifiedDocument(reference);
    const fkpReferences = consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxVerifiedDocumentToWordPapxFkpReferencesVerifiedDocument(plc);
    const fkp = consumeOfficialMarketCalendarKrxLegacyWordPapxFkpReferencesVerifiedDocumentToWordPapxFkpVerifiedDocument(fkpReferences);
    const groups = consumeOfficialMarketCalendarKrxLegacyWordPapxFkpVerifiedDocumentToWordGrpPrlVerifiedDocument(fkp);
    const boundaries = consumeOfficialMarketCalendarKrxLegacyWordGrpPrlVerifiedDocumentToWordParagraphBoundariesVerifiedDocument(groups);
    const properties = consumeOfficialMarketCalendarKrxLegacyWordParagraphBoundariesVerifiedDocumentToWordDirectParagraphPropertiesVerifiedDocument(boundaries);
    const marks = consumeOfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesVerifiedDocumentToWordTableTextMarksVerifiedDocument(properties);
    assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordTableTextMarksVerifiedDocumentToWordTableRowGroupingVerifiedDocument(marks), (error: unknown) => error instanceof OfficialMarketCalendarKrxLegacyWordTableRowGroupingError && error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TABLE_ROW_GROUPING_INVALID");
    assert.throws(() => consumeOfficialMarketCalendarKrxLegacyWordTableTextMarksVerifiedDocumentToWordTableRowGroupingVerifiedDocument(marks), /must be ready/);
  });
});

test("KRX legacy Word document title consumer closes ownership when the registered title is missing", async () => {
  const documentBytes = syntheticOleDocument();
  configureSyntheticWordStreams(documentBytes);
  configureSyntheticWordPrcGrpPrl(documentBytes, [0x16, 0x24, 1]);
  configureSyntheticWordDocumentCounts(documentBytes, 1);
  configureSyntheticWordTextRange(documentBytes, 1536);
  configureSyntheticWordPlcBtePapxReference(documentBytes, 100, 12);
  await withDownloadServer(
    (response) => sendValidResponse(response, documentBytes),
    async (port) => {
      const sourceRows = await acquireWordSourceRowsVerifiedHandle(
        port,
        documentBytes
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordSourceRowsVerifiedDocumentToWordDocumentTitleVerifiedDocument(
            sourceRows
          ),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarKrxLegacyWordDocumentTitleError &&
          error.code ===
            "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_TITLE_INVALID"
      );
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyWordSourceRowsVerifiedDocumentToWordDocumentTitleVerifiedDocument(
            sourceRows
          ),
        /must be ready/
      );

      const responseHandle = await createCoordinatorForPort(port).acquire({
        fileName: FILE_NAME
      });
      const verifier =
        createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier({
          fileName: FILE_NAME,
          targetYear: "2013",
          contentLength: documentBytes.byteLength,
          sha256: createHash("sha256").update(documentBytes).digest("hex"),
          oleCompoundFileSignature: "d0cf11e0a1b11ae1"
        });
      assert.throws(
        () =>
          consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToWordDocumentTitleVerifiedDocument(
            responseHandle,
            verifier
          ),
        (error: unknown) =>
          error instanceof OfficialMarketCalendarKrxLegacyWordDocumentTitleError &&
          error.code ===
            "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_TITLE_INVALID"
      );
      assert.throws(
        () =>
          consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToWordDocumentTitleVerifiedDocument(
            responseHandle,
            verifier
          ),
        /must be ready/
      );
      await assert.rejects(
        () =>
          createCoordinatorForPort(
            port,
            verifier
          ).acquireWordDocumentTitle({ fileName: FILE_NAME }),
        (error: unknown) =>
          hasCode(
            error,
            "KRX_LEGACY_DOWNLOAD_ACQUISITION_DOCUMENT_VERIFICATION_REJECTED"
          )
      );
    }
  );
});

test("KRX legacy coordinator rejects invalid requests before dependencies", async () => {
  let calls = 0;
  const throwingRequest = Object.defineProperty({}, "fileName", {
    enumerable: true,
    get() {
      throw new Error("must not escape");
    }
  });
  const coordinator =
    createTestOnlyOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator(
      {
        otpConsumer: {
          async acquire() {
            calls += 1;
            return createOtpHandle(FILE_NAME);
          }
        },
        downloadConsumer: {
          async consume() {
            throw new Error("must not run");
          }
        }
      }
    );
  for (const request of [
    {},
    { fileName: "E_Trading_Calendar2012.doc" },
    { fileName: FILE_NAME, extra: true },
    throwingRequest,
    null
  ]) {
    await assert.rejects(
      () => coordinator.acquire(request as never),
      (error: unknown) => hasCode(error, "KRX_LEGACY_DOWNLOAD_ACQUISITION_INVALID_REQUEST")
    );
  }
  assert.equal(calls, 0);
});

test("KRX legacy coordinator maps each stage without provider detail", async () => {
  const otpFailure =
    createTestOnlyOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator(
      {
        otpConsumer: {
          async acquire() {
            throw new Error("secret provider detail");
          }
        },
        downloadConsumer: {
          async consume() {
            throw new Error("must not run");
          }
        }
      }
    );
  const otpError = await rejected(otpFailure);
  assert.equal(otpError.code, "KRX_LEGACY_DOWNLOAD_ACQUISITION_OTP_REJECTED");
  assert.equal(otpError.message.includes("secret"), false);

  const bodyFailure =
    createTestOnlyOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator(
      {
        otpConsumer: {
          async acquire() {
            return {} as OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody;
          }
        },
        downloadConsumer: {
          async consume() {
            throw new Error("must not run");
          }
        }
      }
    );
  assert.equal(
    (await rejected(bodyFailure)).code,
    "KRX_LEGACY_DOWNLOAD_ACQUISITION_REQUEST_BODY_REJECTED"
  );

  const documentFailure =
    createTestOnlyOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator(
      {
        otpConsumer: {
          async acquire(fileName) {
            return createOtpHandle(fileName);
          }
        },
        downloadConsumer: {
          async consume() {
            throw new Error("raw network detail");
          }
        }
      }
    );
  const documentError = await rejected(documentFailure);
  assert.equal(
    documentError.code,
    "KRX_LEGACY_DOWNLOAD_ACQUISITION_DOCUMENT_REJECTED"
  );
  assert.equal(documentError.message.includes("raw"), false);
});

test("KRX legacy coordinator validates and snapshots test dependencies", async () => {
  for (const dependencies of [
    null,
    {},
    { otpConsumer: {}, downloadConsumer: {} },
    {
      otpConsumer: { async acquire() {} },
      downloadConsumer: { async consume() {} },
      documentIdentityVerifier: {}
    }
  ]) {
    assert.throws(
      () =>
        createTestOnlyOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator(
          dependencies as never
        ),
      (error: unknown) => hasCode(error, "KRX_LEGACY_DOWNLOAD_ACQUISITION_INVALID_CONFIG")
    );
  }
  const production =
    createOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator();
  assert.equal(Object.isFrozen(production), true);
  assert.deepEqual(Object.keys(production), [
    "acquire",
    "acquireWordDocumentTitle",
    "acquireWordCandidateSummary"
  ]);
  assert.equal(
    createOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator.length,
    0
  );

  let originalOtpCalls = 0;
  let originalDownloadCalls = 0;
  let replacementCalls = 0;
  const otpConsumer = {
    async acquire(fileName: unknown) {
      originalOtpCalls += 1;
      return createOtpHandle(fileName);
    }
  };
  const downloadConsumer = {
    async consume() {
      originalDownloadCalls += 1;
      throw new Error("original failure");
    }
  };
  const snapshotted =
    createTestOnlyOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator(
      { otpConsumer, downloadConsumer }
    );
  otpConsumer.acquire = async () => {
    replacementCalls += 1;
    return createOtpHandle(FILE_NAME);
  };
  downloadConsumer.consume = async () => {
    replacementCalls += 1;
    throw new Error("replacement failure");
  };

  assert.equal(
    (await rejected(snapshotted)).code,
    "KRX_LEGACY_DOWNLOAD_ACQUISITION_DOCUMENT_REJECTED"
  );
  assert.equal(originalOtpCalls, 1);
  assert.equal(originalDownloadCalls, 1);
  assert.equal(replacementCalls, 0);
});

function createOtpHandle(
  fileName: unknown
): OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody {
  return createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody({
    rawResponseBytes: canonicalOtpBytes(),
    requestedFileName: fileName
  });
}

function createCoordinatorForPort(
  port: number,
  documentIdentityVerifier?: ReturnType<
    typeof createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier
  >
) {
  return createTestOnlyOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator(
    {
      otpConsumer: {
        async acquire(fileName) {
          return createOtpHandle(fileName);
        }
      },
      downloadConsumer:
        createTestOnlyOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer({
          dialAddress: "127.0.0.1",
          dialPort: port,
          certificateAuthority: KRX_LEGACY_DOWNLOAD_TEST_CA,
          deadlineMs: 1_000
        }),
      ...(documentIdentityVerifier === undefined
        ? {}
        : { documentIdentityVerifier })
    }
  );
}

function syntheticOleDocument(): Uint8Array {
  const bytes = new Uint8Array(FILE_LENGTH);
  bytes.set(Buffer.from("d0cf11e0a1b11ae1", "hex"), 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(24, 62, true);
  view.setUint16(26, 3, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setUint16(32, 6, true);
  view.setUint32(40, 0, true);
  view.setUint32(44, 3, true);
  view.setUint32(48, 3, true);
  view.setUint32(56, 4096, true);
  view.setUint32(60, 0xfffffffe, true);
  view.setUint32(64, 0, true);
  view.setUint32(68, 0xfffffffe, true);
  view.setUint32(72, 0, true);
  for (let index = 0; index < 109; index += 1) {
    view.setUint32(76 + index * 4, index < 3 ? index : 0xffffffff, true);
  }
  bytes.fill(0xff, 512, 2048);
  view.setUint32(512, 0xfffffffd, true);
  view.setUint32(516, 0xfffffffd, true);
  view.setUint32(520, 0xfffffffd, true);
  view.setUint32(524, 0xfffffffe, true);
  initializeSyntheticDirectorySector(bytes);
  return bytes;
}

async function acquireUserStreamBytesProjectedHandle(
  port: number,
  documentBytes: Uint8Array
) {
  const responseHandle = await createCoordinatorForPort(port).acquire({
    fileName: FILE_NAME
  });
  const verifier =
    createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier({
      fileName: FILE_NAME,
      targetYear: "2013",
      contentLength: documentBytes.byteLength,
      sha256: createHash("sha256").update(documentBytes).digest("hex"),
      oleCompoundFileSignature: "d0cf11e0a1b11ae1"
    });
  const identityHandle =
    consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
      responseHandle,
      verifier
    );
  const headerHandle =
    consumeOfficialMarketCalendarKrxLegacyIdentityVerifiedDocumentToOleHeaderVerifiedDocument(
      identityHandle
    );
  const difatHandle =
    consumeOfficialMarketCalendarKrxLegacyOleHeaderVerifiedDocumentToDifatVerifiedDocument(
      headerHandle
    );
  const fatHandle =
    consumeOfficialMarketCalendarKrxLegacyDifatVerifiedDocumentToFatVerifiedDocument(
      difatHandle
    );
  const systemChainsHandle =
    consumeOfficialMarketCalendarKrxLegacyFatVerifiedDocumentToSystemChainsVerifiedDocument(
      fatHandle
    );
  const directoryEntriesHandle =
    consumeOfficialMarketCalendarKrxLegacySystemChainsVerifiedDocumentToDirectoryEntriesVerifiedDocument(
      systemChainsHandle
    );
  const directoryTreeHandle =
    consumeOfficialMarketCalendarKrxLegacyDirectoryEntriesVerifiedDocumentToDirectoryTreeVerifiedDocument(
      directoryEntriesHandle
    );
  const miniFatEntriesHandle =
    consumeOfficialMarketCalendarKrxLegacyDirectoryTreeVerifiedDocumentToMiniFatEntriesVerifiedDocument(
      directoryTreeHandle
    );
  const rootMiniStreamHandle =
    consumeOfficialMarketCalendarKrxLegacyMiniFatEntriesVerifiedDocumentToRootMiniStreamVerifiedDocument(
      miniFatEntriesHandle
    );
  const userStreamAllocationHandle =
    consumeOfficialMarketCalendarKrxLegacyRootMiniStreamVerifiedDocumentToUserStreamAllocationVerifiedDocument(
      rootMiniStreamHandle
    );
  return consumeOfficialMarketCalendarKrxLegacyUserStreamAllocationVerifiedDocumentToUserStreamBytesProjectedDocument(
    userStreamAllocationHandle
  );
}

async function acquireWordStreamsVerifiedHandle(
  port: number,
  documentBytes: Uint8Array
) {
  const userStreamBytesHandle = await acquireUserStreamBytesProjectedHandle(
    port,
    documentBytes
  );
  return consumeOfficialMarketCalendarKrxLegacyUserStreamBytesProjectedDocumentToWordStreamsVerifiedDocument(
    userStreamBytesHandle
  );
}

async function acquireWordFibVerifiedHandle(
  port: number,
  documentBytes: Uint8Array
) {
  const wordStreamsHandle = await acquireWordStreamsVerifiedHandle(
    port,
    documentBytes
  );
  return consumeOfficialMarketCalendarKrxLegacyWordStreamsVerifiedDocumentToWordFibVerifiedDocument(
    wordStreamsHandle
  );
}

function initializeSyntheticDirectorySector(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer);
  const directoryOffset = 2048;
  const rootName = "Root Entry";
  for (let index = 0; index < rootName.length; index += 1) {
    view.setUint16(
      directoryOffset + index * 2,
      rootName.charCodeAt(index),
      true
    );
  }
  view.setUint16(directoryOffset + rootName.length * 2, 0, true);
  view.setUint16(directoryOffset + 64, (rootName.length + 1) * 2, true);
  view.setUint8(directoryOffset + 66, 5);
  view.setUint8(directoryOffset + 67, 1);
  view.setUint32(directoryOffset + 68, 0xffffffff, true);
  view.setUint32(directoryOffset + 72, 0xffffffff, true);
  view.setUint32(directoryOffset + 76, 0xffffffff, true);
  view.setUint32(directoryOffset + 116, 0xfffffffe, true);
  for (let streamId = 1; streamId < 4; streamId += 1) {
    const entryOffset = directoryOffset + streamId * 128;
    view.setUint32(entryOffset + 68, 0xffffffff, true);
    view.setUint32(entryOffset + 72, 0xffffffff, true);
    view.setUint32(entryOffset + 76, 0xffffffff, true);
  }
}

function configureSyntheticFatUserStream(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer);
  const rootOffset = 2048;
  const streamOffset = rootOffset + 128;
  const streamName = "Payload";
  view.setUint32(rootOffset + 76, 1, true);
  bytes.fill(0, streamOffset, streamOffset + 128);
  for (let index = 0; index < streamName.length; index += 1) {
    view.setUint16(
      streamOffset + index * 2,
      streamName.charCodeAt(index),
      true
    );
  }
  view.setUint16(streamOffset + streamName.length * 2, 0, true);
  view.setUint16(streamOffset + 64, (streamName.length + 1) * 2, true);
  view.setUint8(streamOffset + 66, 2);
  view.setUint8(streamOffset + 67, 1);
  view.setUint32(streamOffset + 68, 0xffffffff, true);
  view.setUint32(streamOffset + 72, 0xffffffff, true);
  view.setUint32(streamOffset + 76, 0xffffffff, true);
  view.setUint32(streamOffset + 116, 4, true);
  view.setUint32(streamOffset + 120, 4096, true);
  for (let sector = 4; sector <= 11; sector += 1) {
    view.setUint32(
      512 + sector * 4,
      sector === 11 ? 0xfffffffe : sector + 1,
      true
    );
    bytes.fill(0x5a, (sector + 1) * 512, (sector + 2) * 512);
  }
}

function configureSyntheticWordStreams(bytes: Uint8Array): void {
  configureSyntheticFatUserStream(bytes);
  const view = new DataView(bytes.buffer);
  const wordEntryOffset = 2048 + 128;
  const tableEntryOffset = wordEntryOffset + 128;
  writeSyntheticDirectoryName(bytes, wordEntryOffset, "WordDocument");
  view.setUint32(wordEntryOffset + 68, 2, true);
  bytes.fill(0, tableEntryOffset, tableEntryOffset + 128);
  writeSyntheticDirectoryName(bytes, tableEntryOffset, "1Table");
  view.setUint8(tableEntryOffset + 66, 2);
  view.setUint8(tableEntryOffset + 67, 0);
  view.setUint32(tableEntryOffset + 68, 0xffffffff, true);
  view.setUint32(tableEntryOffset + 72, 0xffffffff, true);
  view.setUint32(tableEntryOffset + 76, 0xffffffff, true);
  view.setUint32(tableEntryOffset + 116, 12, true);
  view.setUint32(tableEntryOffset + 120, 4096, true);
  for (let sector = 12; sector <= 19; sector += 1) {
    view.setUint32(
      512 + sector * 4,
      sector === 19 ? 0xfffffffe : sector + 1,
      true
    );
    bytes.fill(0x33, (sector + 1) * 512, (sector + 2) * 512);
  }
  const wordOffset = (4 + 1) * 512;
  view.setUint16(wordOffset, 0xa5ec, true);
  view.setUint16(wordOffset + 2, 0x00c1, true);
  view.setUint16(wordOffset + 8, 0, true);
  view.setUint16(wordOffset + 10, 0x1200, true);
  view.setUint16(wordOffset + 12, 0x00bf, true);
  view.setUint32(wordOffset + 14, 0, true);
  view.setUint8(wordOffset + 18, 0);
  view.setUint8(wordOffset + 19, 0);
  view.setUint16(wordOffset + 20, 0, true);
  view.setUint16(wordOffset + 22, 0, true);
  view.setUint16(wordOffset + 32, 0x000e, true);
  view.setUint16(wordOffset + 62, 0x0016, true);
  view.setUint16(wordOffset + 152, 0x005d, true);
  view.setUint16(wordOffset + 898, 0, true);
  view.setUint32(wordOffset + 154 + 33 * 8, 7, true);
  view.setUint32(wordOffset + 154 + 33 * 8 + 4, 9, true);
  const clxOffset = (12 + 1) * 512 + 7;
  bytes.set(Uint8Array.from([2, 4, 0, 0, 0, 0, 0, 0, 0]), clxOffset);
  configureSyntheticWordDefaultParagraphStyle(bytes);
}

function configureSyntheticWordPcdPrm(
  bytes: Uint8Array,
  rawPrm: number
): void {
  const wordOffset = (4 + 1) * 512;
  const clxOffset = (12 + 1) * 512 + 7;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(wordOffset + 154 + 33 * 8 + 4, 21, true);
  bytes.set(
    Uint8Array.from([
      2,
      16, 0, 0, 0,
      0, 0, 0, 0,
      1, 0, 0, 0,
      0, 0,
      0, 0, 0, 0,
      rawPrm & 0xff, (rawPrm >>> 8) & 0xff
    ]),
    clxOffset
  );
}

function configureSyntheticWordPrcGrpPrl(
  bytes: Uint8Array,
  grpprlBytes: readonly number[],
  rawPrm = 0,
  finalCp = 1
): void {
  const wordOffset = (4 + 1) * 512;
  const clxOffset = (12 + 1) * 512 + 7;
  const clxByteLength = 3 + grpprlBytes.length + 21;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(wordOffset + 154 + 33 * 8 + 4, clxByteLength, true);
  bytes.set(
    Uint8Array.from([
      1, grpprlBytes.length & 0xff, (grpprlBytes.length >>> 8) & 0xff,
      ...grpprlBytes,
      2, 16, 0, 0, 0,
      0, 0, 0, 0,
      finalCp & 0xff,
      (finalCp >>> 8) & 0xff,
      (finalCp >>> 16) & 0xff,
      (finalCp >>> 24) & 0xff,
      0, 0,
      0x98, 0x03, 0, 0,
      rawPrm & 0xff, (rawPrm >>> 8) & 0xff
    ]),
    clxOffset
  );
}

function configureSyntheticWordDocumentCounts(
  bytes: Uint8Array,
  ccpText: number
): void {
  const wordOffset = (4 + 1) * 512;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setInt32(wordOffset + 76, ccpText, true);
  for (const offset of [80, 84, 88, 92, 96, 100, 104]) {
    view.setUint32(wordOffset + offset, 0, true);
  }
}

function configureSyntheticWordTextRange(
  bytes: Uint8Array,
  cbMac: number,
  text = "\r"
): void {
  const wordOffset = (4 + 1) * 512;
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    wordOffset + 64,
    cbMac,
    true
  );
  for (let index = 0; index < text.length; index += 1) {
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(
      wordOffset + 920 + index * 2,
      text.charCodeAt(index),
      true
    );
  }
}

function configureSyntheticWordPlcBtePapxReference(
  bytes: Uint8Array,
  tableOffset = 100,
  byteLength = 4,
  paragraphFcEnd = 922
): void {
  const wordOffset = (4 + 1) * 512;
  const tableStreamOffset = (12 + 1) * 512;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(wordOffset + 154 + 13 * 8, tableOffset, true);
  view.setUint32(wordOffset + 154 + 13 * 8 + 4, byteLength, true);
  if (tableOffset + 4 <= 4096) {
    view.setUint32(tableStreamOffset + tableOffset, 920, true);
    if (byteLength >= 12) {
      view.setUint32(tableStreamOffset + tableOffset + 4, paragraphFcEnd, true);
      view.setUint32(tableStreamOffset + tableOffset + 8, 2, true);
      const fkpByteOffset = wordOffset + 1024;
      bytes.fill(0, fkpByteOffset, fkpByteOffset + 512);
      view.setUint32(fkpByteOffset, 920, true);
      view.setUint32(fkpByteOffset + 4, paragraphFcEnd, true);
      view.setUint8(fkpByteOffset + 511, 1);
    }
  }
}

function configureSyntheticWordDefaultParagraphStyle(bytes: Uint8Array): void {
  const wordOffset = (4 + 1) * 512;
  const tableStreamOffset = (12 + 1) * 512;
  const tableOffset = 200;
  const cbStshi = 18;
  const cstd = 15;
  const styleBody = Uint8Array.from([
    1, 0, 0x41, 0, 0, 0,
    2, 0, 0, 0,
    0, 0
  ]);
  const styleRecord = new Uint8Array(10 + styleBody.length);
  const recordView = new DataView(styleRecord.buffer);
  recordView.setUint16(0, 0, true);
  recordView.setUint16(2, 1 | (0x0fff << 4), true);
  recordView.setUint16(4, 2, true);
  recordView.setUint16(6, styleRecord.length, true);
  styleRecord.set(styleBody, 10);

  const stsh = new Uint8Array(2 + cbStshi + cstd * 2 + styleRecord.length);
  const stshView = new DataView(stsh.buffer);
  stshView.setUint16(0, cbStshi, true);
  stshView.setUint16(2, cstd, true);
  stshView.setUint16(4, 10, true);
  stshView.setUint16(6, 1, true);
  stshView.setUint16(10, cstd, true);
  let offset = 2 + cbStshi;
  stshView.setInt16(offset, styleRecord.length, true);
  stsh.set(styleRecord, offset + 2);
  offset += 2 + styleRecord.length;
  while (offset < stsh.length) {
    stshView.setInt16(offset, 0, true);
    offset += 2;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(wordOffset + 154 + 8, tableOffset, true);
  view.setUint32(wordOffset + 154 + 12, stsh.length, true);
  bytes.set(stsh, tableStreamOffset + tableOffset);
}

async function acquireWordClxVerifiedHandle(
  port: number,
  documentBytes: Uint8Array
) {
  const wordFibHandle = await acquireWordFibVerifiedHandle(port, documentBytes);
  const clxReferenceHandle =
    consumeOfficialMarketCalendarKrxLegacyWordFibVerifiedDocumentToWordClxReferenceVerifiedDocument(
      wordFibHandle
    );
  return consumeOfficialMarketCalendarKrxLegacyWordClxReferenceVerifiedDocumentToWordClxVerifiedDocument(
    clxReferenceHandle
  );
}

async function acquireWordTextDecodedHandle(
  port: number,
  documentBytes: Uint8Array
) {
  const clx = await acquireWordClxVerifiedHandle(port, documentBytes);
  const plc = consumeOfficialMarketCalendarKrxLegacyWordClxVerifiedDocumentToWordPlcPcdVerifiedDocument(clx);
  const prm = consumeOfficialMarketCalendarKrxLegacyWordPlcPcdVerifiedDocumentToWordPcdPrmVerifiedDocument(plc);
  const prc = consumeOfficialMarketCalendarKrxLegacyWordPcdPrmVerifiedDocumentToWordPrcGrpPrlVerifiedDocument(prm);
  const counts = consumeOfficialMarketCalendarKrxLegacyWordPrcGrpPrlVerifiedDocumentToWordDocumentCountsVerifiedDocument(prc);
  const ranges = consumeOfficialMarketCalendarKrxLegacyWordDocumentCountsVerifiedDocumentToWordTextRangesVerifiedDocument(counts);
  const bytes = consumeOfficialMarketCalendarKrxLegacyWordTextRangesVerifiedDocumentToWordTextBytesProjectedDocument(ranges);
  return consumeOfficialMarketCalendarKrxLegacyWordTextBytesProjectedDocumentToWordTextDecodedDocument(bytes);
}

async function acquireWordMainDocumentVerifiedHandle(
  port: number,
  documentBytes: Uint8Array
) {
  const decoded = await acquireWordTextDecodedHandle(port, documentBytes);
  return consumeOfficialMarketCalendarKrxLegacyWordTextDecodedDocumentToWordMainDocumentVerifiedDocument(
    decoded
  );
}

async function acquireWordPlcBtePapxReferenceVerifiedHandle(
  port: number,
  documentBytes: Uint8Array
) {
  const mainDocument = await acquireWordMainDocumentVerifiedHandle(
    port,
    documentBytes
  );
  return consumeOfficialMarketCalendarKrxLegacyWordMainDocumentVerifiedDocumentToWordPlcBtePapxReferenceVerifiedDocument(
    mainDocument
  );
}

async function acquireWordSourceRowsVerifiedHandle(
  port: number,
  documentBytes: Uint8Array
) {
  const reference =
    await acquireWordPlcBtePapxReferenceVerifiedHandle(port, documentBytes);
  const plc =
    consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceVerifiedDocumentToWordPlcBtePapxVerifiedDocument(
      reference
    );
  const fkpReferences =
    consumeOfficialMarketCalendarKrxLegacyWordPlcBtePapxVerifiedDocumentToWordPapxFkpReferencesVerifiedDocument(
      plc
    );
  const fkp =
    consumeOfficialMarketCalendarKrxLegacyWordPapxFkpReferencesVerifiedDocumentToWordPapxFkpVerifiedDocument(
      fkpReferences
    );
  const grpPrl =
    consumeOfficialMarketCalendarKrxLegacyWordPapxFkpVerifiedDocumentToWordGrpPrlVerifiedDocument(
      fkp
    );
  const boundaries =
    consumeOfficialMarketCalendarKrxLegacyWordGrpPrlVerifiedDocumentToWordParagraphBoundariesVerifiedDocument(
      grpPrl
    );
  const properties =
    consumeOfficialMarketCalendarKrxLegacyWordParagraphBoundariesVerifiedDocumentToWordDirectParagraphPropertiesVerifiedDocument(
      boundaries
    );
  const marks =
    consumeOfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesVerifiedDocumentToWordTableTextMarksVerifiedDocument(
      properties
    );
  const grouping =
    consumeOfficialMarketCalendarKrxLegacyWordTableTextMarksVerifiedDocumentToWordTableRowGroupingVerifiedDocument(
      marks
    );
  return consumeOfficialMarketCalendarKrxLegacyWordTableRowGroupingVerifiedDocumentToWordSourceRowsVerifiedDocument(
    grouping
  );
}

function writeSyntheticDirectoryName(
  bytes: Uint8Array,
  entryOffset: number,
  name: string
): void {
  const view = new DataView(bytes.buffer);
  bytes.fill(0, entryOffset, entryOffset + 64);
  for (let index = 0; index < name.length; index += 1) {
    view.setUint16(entryOffset + index * 2, name.charCodeAt(index), true);
  }
  view.setUint16(entryOffset + name.length * 2, 0, true);
  view.setUint16(entryOffset + 64, (name.length + 1) * 2, true);
}

function configureSyntheticInvalidUserStream(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer);
  const rootOffset = 2048;
  const streamOffset = rootOffset + 128;
  const streamName = "Small";
  view.setUint32(rootOffset + 76, 1, true);
  bytes.fill(0, streamOffset, streamOffset + 128);
  for (let index = 0; index < streamName.length; index += 1) {
    view.setUint16(
      streamOffset + index * 2,
      streamName.charCodeAt(index),
      true
    );
  }
  view.setUint16(streamOffset + streamName.length * 2, 0, true);
  view.setUint16(streamOffset + 64, (streamName.length + 1) * 2, true);
  view.setUint8(streamOffset + 66, 2);
  view.setUint8(streamOffset + 67, 1);
  view.setUint32(streamOffset + 68, 0xffffffff, true);
  view.setUint32(streamOffset + 72, 0xffffffff, true);
  view.setUint32(streamOffset + 76, 0xffffffff, true);
  view.setUint32(streamOffset + 116, 0xfffffffe, true);
  view.setUint32(streamOffset + 120, 1, true);
}

function canonicalOtpBytes(): Uint8Array {
  const decoded = Uint8Array.from(
    { length: 224 },
    (_, index) => (index * 73 + 19) % 256
  );
  return Uint8Array.from(
    Buffer.from(decoded).toString("base64"),
    (character) => character.charCodeAt(0)
  );
}

async function withDownloadServer<T>(
  handler: (response: ServerResponse) => void,
  run: (port: number) => Promise<T>
): Promise<T> {
  const server = createServer(
    KRX_LEGACY_DOWNLOAD_TEST_SERVER_OPTIONS,
    (_request, response) => handler(response)
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    return await run(address.port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function sendValidResponse(
  response: ServerResponse,
  body: Uint8Array = new Uint8Array(FILE_LENGTH)
): void {
  response.writeHead(200, {
    "Content-Length": String(FILE_LENGTH),
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename=${FILE_NAME}`,
    "Cache-Control": "max-age=0, no-cache, no-store",
    Pragma: "no-cache",
    Date: "Thu, 20 Aug 2026 00:00:00 GMT",
    Expires: "Thu, 20 Aug 2026 00:00:00 GMT"
  });
  response.end(body);
}

async function rejected(
  coordinator: ReturnType<
    typeof createTestOnlyOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator
  >
): Promise<OfficialMarketCalendarKrxLegacyDownloadAcquisitionError> {
  try {
    await coordinator.acquire({ fileName: FILE_NAME });
    throw new Error("expected rejection");
  } catch (error) {
    assert.equal(
      error instanceof OfficialMarketCalendarKrxLegacyDownloadAcquisitionError,
      true
    );
    return error as OfficialMarketCalendarKrxLegacyDownloadAcquisitionError;
  }
}

function hasCode(
  error: unknown,
  code: OfficialMarketCalendarKrxLegacyDownloadAcquisitionError["code"]
): boolean {
  return (
    error instanceof OfficialMarketCalendarKrxLegacyDownloadAcquisitionError &&
    error.code === code
  );
}
