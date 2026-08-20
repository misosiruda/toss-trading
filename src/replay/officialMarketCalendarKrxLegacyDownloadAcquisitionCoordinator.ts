import { isDeepStrictEqual } from "node:util";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy
} from "./officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy.js";
import {
  consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument,
  consumeOfficialMarketCalendarKrxLegacyDownloadParametersToWireBody,
  createOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer,
  disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralParameters,
  disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralResponse,
  disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody,
  disposeOfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody,
  type OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters,
  type OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse,
  type OfficialMarketCalendarKrxLegacyDownloadNetworkConsumer,
  type OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody,
  type OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody
} from "./officialMarketCalendarKrxLegacyDownloadOtpEphemeralBody.js";
import {
  createOfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer,
  type OfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer
} from "./officialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer.js";

type LegacyFileName = ReturnType<
  typeof resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy
>["documents"][number]["fileName"];

export interface OfficialMarketCalendarKrxLegacyDownloadAcquisitionRequest {
  fileName: LegacyFileName;
}

export interface OfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator {
  acquire(
    request: OfficialMarketCalendarKrxLegacyDownloadAcquisitionRequest
  ): Promise<OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse>;
}

export interface TestOnlyOfficialMarketCalendarKrxLegacyDownloadAcquisitionDependencies {
  otpConsumer: OfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer;
  downloadConsumer: OfficialMarketCalendarKrxLegacyDownloadNetworkConsumer;
}

export type OfficialMarketCalendarKrxLegacyDownloadAcquisitionErrorCode =
  | "KRX_LEGACY_DOWNLOAD_ACQUISITION_INVALID_CONFIG"
  | "KRX_LEGACY_DOWNLOAD_ACQUISITION_INVALID_REQUEST"
  | "KRX_LEGACY_DOWNLOAD_ACQUISITION_OTP_REJECTED"
  | "KRX_LEGACY_DOWNLOAD_ACQUISITION_REQUEST_BODY_REJECTED"
  | "KRX_LEGACY_DOWNLOAD_ACQUISITION_DOCUMENT_REJECTED";

export class OfficialMarketCalendarKrxLegacyDownloadAcquisitionError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyDownloadAcquisitionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyDownloadAcquisitionError";
  }
}

interface AcquisitionOperations {
  acquireOtp(
    fileName: LegacyFileName
  ): Promise<OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody>;
  consumeDownload(
    handle: OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody
  ): Promise<OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse>;
}

export function createOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator(): OfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator {
  return createCoordinator(
    snapshotOperations({
      otpConsumer:
        createOfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer(),
      downloadConsumer:
        createOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer()
    })
  );
}

export function createTestOnlyOfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator(
  dependencies: TestOnlyOfficialMarketCalendarKrxLegacyDownloadAcquisitionDependencies
): OfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator {
  return createCoordinator(snapshotOperations(dependencies));
}

function createCoordinator(
  operations: AcquisitionOperations
): OfficialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator {
  return Object.freeze({
    acquire: (
      request: OfficialMarketCalendarKrxLegacyDownloadAcquisitionRequest
    ) => acquireDocument(request, operations)
  });
}

async function acquireDocument(
  input: OfficialMarketCalendarKrxLegacyDownloadAcquisitionRequest,
  operations: AcquisitionOperations
): Promise<OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse> {
  const request = parseAcquisitionRequest(input);
  let otpHandle:
    | OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody
    | undefined;
  let parametersHandle:
    | OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters
    | undefined;
  let wireBodyHandle:
    | OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody
    | undefined;
  let responseHandle:
    | OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse
    | undefined;

  try {
    try {
      otpHandle = await operations.acquireOtp(request.fileName);
    } catch {
      throw acquisitionError(
        "KRX_LEGACY_DOWNLOAD_ACQUISITION_OTP_REJECTED",
        "KRX legacy download OTP acquisition was rejected."
      );
    }
    try {
      parametersHandle =
        consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument(
          otpHandle
        );
      wireBodyHandle =
        consumeOfficialMarketCalendarKrxLegacyDownloadParametersToWireBody(
          parametersHandle
        );
    } catch {
      throw acquisitionError(
        "KRX_LEGACY_DOWNLOAD_ACQUISITION_REQUEST_BODY_REJECTED",
        "KRX legacy download request body composition was rejected."
      );
    }
    try {
      responseHandle = await operations.consumeDownload(wireBodyHandle);
    } catch {
      throw acquisitionError(
        "KRX_LEGACY_DOWNLOAD_ACQUISITION_DOCUMENT_REJECTED",
        "KRX legacy document acquisition was rejected."
      );
    }
    const result = responseHandle;
    responseHandle = undefined;
    return result;
  } finally {
    safeDispose(
      responseHandle,
      disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralResponse
    );
    safeDispose(
      wireBodyHandle,
      disposeOfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody
    );
    safeDispose(
      parametersHandle,
      disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralParameters
    );
    safeDispose(
      otpHandle,
      disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody
    );
  }
}

function parseAcquisitionRequest(
  value: unknown
): Readonly<OfficialMarketCalendarKrxLegacyDownloadAcquisitionRequest> {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !isDeepStrictEqual(Object.keys(value), ["fileName"])
    ) {
      throw new Error("invalid request shape");
    }
    const inputFileName = (value as Record<string, unknown>).fileName;
    const sourcePolicy =
      resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION
      );
    const document = sourcePolicy.documents.find(
      (candidate) => candidate.fileName === inputFileName
    );
    if (document === undefined) {
      throw new Error("unregistered file name");
    }
    return Object.freeze({ fileName: document.fileName });
  } catch {
    throw acquisitionError(
      "KRX_LEGACY_DOWNLOAD_ACQUISITION_INVALID_REQUEST",
      "KRX legacy download acquisition request is invalid."
    );
  }
}

function snapshotOperations(
  value: TestOnlyOfficialMarketCalendarKrxLegacyDownloadAcquisitionDependencies
): AcquisitionOperations {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid dependencies");
    }
    const otpConsumer = value.otpConsumer;
    const downloadConsumer = value.downloadConsumer;
    const acquireOtp = otpConsumer?.acquire;
    const consumeDownload = downloadConsumer?.consume;
    if (
      typeof acquireOtp !== "function" ||
      typeof consumeDownload !== "function"
    ) {
      throw new Error("invalid dependency methods");
    }
    return Object.freeze({
      acquireOtp: (fileName: LegacyFileName) =>
        acquireOtp.call(otpConsumer, fileName),
      consumeDownload: (
        handle: OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody
      ) => consumeDownload.call(downloadConsumer, handle)
    });
  } catch {
    throw acquisitionError(
      "KRX_LEGACY_DOWNLOAD_ACQUISITION_INVALID_CONFIG",
      "KRX legacy download test-only dependencies are invalid."
    );
  }
}

function safeDispose<T>(
  handle: T | undefined,
  dispose: (value: T) => void
): void {
  if (handle === undefined) {
    return;
  }
  try {
    dispose(handle);
  } catch {
    // Preserve the stage error while closing every accessible handle.
  }
}

function acquisitionError(
  code: OfficialMarketCalendarKrxLegacyDownloadAcquisitionErrorCode,
  message: string
): OfficialMarketCalendarKrxLegacyDownloadAcquisitionError {
  return new OfficialMarketCalendarKrxLegacyDownloadAcquisitionError(
    code,
    message
  );
}
