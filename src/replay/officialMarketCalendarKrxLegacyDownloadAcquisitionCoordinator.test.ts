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
  consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument,
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

const FILE_NAME = "E_Trading_Calendar2013.doc";
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
      assert.throws(
        () => JSON.stringify(wordStreamsVerifiedHandle),
        /cannot be serialized or exported/
      );
      disposeOfficialMarketCalendarKrxLegacyDownloadWordStreamsVerifiedDocument(
        wordStreamsVerifiedHandle
      );

      const productionResponse = await coordinator.acquire({
        fileName: FILE_NAME
      });
      assert.throws(
        () =>
          consumeOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument(
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
    }
  );
});

test("KRX legacy identity response consumer rejects forged handles and verifier config", () => {
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
  for (const dependencies of [null, {}, { otpConsumer: {}, downloadConsumer: {} }]) {
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
  assert.deepEqual(Object.keys(production), ["acquire"]);
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

function createCoordinatorForPort(port: number) {
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
        })
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
