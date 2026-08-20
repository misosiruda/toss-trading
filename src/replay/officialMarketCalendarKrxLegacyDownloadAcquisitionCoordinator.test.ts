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
  consumeOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument,
  consumeTestOnlyOfficialMarketCalendarKrxLegacyDownloadResponseToIdentityVerifiedDocument,
  createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody,
  createTestOnlyOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer,
  disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralResponse,
  disposeOfficialMarketCalendarKrxLegacyDownloadIdentityVerifiedDocument,
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

test("KRX legacy response transfers only through document identity verification", async () => {
  const documentBytes = syntheticOleDocument();
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
      assert.throws(
        () => JSON.stringify(verifiedHandle),
        /cannot be serialized or exported/
      );
      disposeOfficialMarketCalendarKrxLegacyDownloadIdentityVerifiedDocument(
        verifiedHandle
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
  const bytes = Uint8Array.from(
    { length: FILE_LENGTH },
    (_, index) => (index * 31 + 17) % 256
  );
  bytes.set(Buffer.from("d0cf11e0a1b11ae1", "hex"), 0);
  return bytes;
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
