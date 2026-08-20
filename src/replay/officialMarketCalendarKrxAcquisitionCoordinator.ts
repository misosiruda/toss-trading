import { isDeepStrictEqual } from "node:util";

import {
  consumeOfficialMarketCalendarKrxHolidayDataPostParametersToWireBody,
  consumeOfficialMarketCalendarKrxOtpForHolidayDataPost,
  createOfficialMarketCalendarKrxHolidayDataNetworkConsumer,
  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralParameters,
  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody,
  disposeOfficialMarketCalendarKrxOtpEphemeralBody,
  type OfficialMarketCalendarKrxHolidayDataNetworkConsumer,
  type OfficialMarketCalendarKrxHolidayDataPostEphemeralParameters,
  type OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody,
  type OfficialMarketCalendarKrxOtpEphemeralBody
} from "./officialMarketCalendarKrxOtpEphemeralBody.js";
import {
  consumeOfficialMarketCalendarKrxHolidayDataEphemeralResponse,
  disposeOfficialMarketCalendarKrxHolidayDataEphemeralResponse,
  type OfficialMarketCalendarKrxHolidayDataEphemeralResponse
} from "./officialMarketCalendarKrxHolidayDataEphemeralResponse.js";
import type { OfficialMarketCalendarKrxHolidayDataResponseSemantics } from "./officialMarketCalendarKrxHolidayDataResponseBody.js";
import {
  parseOfficialMarketCalendarKrxHolidayTargetYear,
  type OfficialMarketCalendarKrxHolidayTargetYear
} from "./officialMarketCalendarKrxHolidayTargetYear.js";
import {
  createOfficialMarketCalendarKrxOtpNetworkConsumer,
  type OfficialMarketCalendarKrxOtpNetworkConsumer
} from "./officialMarketCalendarKrxOtpNetworkConsumer.js";

export interface OfficialMarketCalendarKrxAcquisitionRequest {
  targetYear: OfficialMarketCalendarKrxHolidayTargetYear;
}

export interface OfficialMarketCalendarKrxAcquisitionCoordinator {
  acquire(
    request: OfficialMarketCalendarKrxAcquisitionRequest
  ): Promise<OfficialMarketCalendarKrxHolidayDataResponseSemantics>;
}

export interface TestOnlyOfficialMarketCalendarKrxAcquisitionDependencies {
  otpConsumer: OfficialMarketCalendarKrxOtpNetworkConsumer;
  holidayDataConsumer: OfficialMarketCalendarKrxHolidayDataNetworkConsumer;
}

export type OfficialMarketCalendarKrxAcquisitionErrorCode =
  | "KRX_ACQUISITION_INVALID_CONFIG"
  | "KRX_ACQUISITION_INVALID_REQUEST"
  | "KRX_ACQUISITION_OTP_REJECTED"
  | "KRX_ACQUISITION_REQUEST_BODY_REJECTED"
  | "KRX_ACQUISITION_HOLIDAY_DATA_REJECTED"
  | "KRX_ACQUISITION_SEMANTICS_REJECTED";

export class OfficialMarketCalendarKrxAcquisitionError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxAcquisitionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxAcquisitionError";
  }
}

interface AcquisitionOperations {
  acquireOtp(): Promise<OfficialMarketCalendarKrxOtpEphemeralBody>;
  consumeHolidayData(
    handle: OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody
  ): Promise<OfficialMarketCalendarKrxHolidayDataEphemeralResponse>;
}

export function createOfficialMarketCalendarKrxAcquisitionCoordinator(): OfficialMarketCalendarKrxAcquisitionCoordinator {
  return createCoordinator(
    snapshotOperations({
      otpConsumer: createOfficialMarketCalendarKrxOtpNetworkConsumer(),
      holidayDataConsumer:
        createOfficialMarketCalendarKrxHolidayDataNetworkConsumer()
    })
  );
}

export function createTestOnlyOfficialMarketCalendarKrxAcquisitionCoordinator(
  dependencies: TestOnlyOfficialMarketCalendarKrxAcquisitionDependencies
): OfficialMarketCalendarKrxAcquisitionCoordinator {
  return createCoordinator(snapshotOperations(dependencies));
}

function createCoordinator(
  operations: AcquisitionOperations
): OfficialMarketCalendarKrxAcquisitionCoordinator {
  return Object.freeze({
    acquire: (request: OfficialMarketCalendarKrxAcquisitionRequest) =>
      acquireHolidaySummary(request, operations)
  });
}

async function acquireHolidaySummary(
  input: OfficialMarketCalendarKrxAcquisitionRequest,
  operations: AcquisitionOperations
): Promise<OfficialMarketCalendarKrxHolidayDataResponseSemantics> {
  const request = parseAcquisitionRequest(input);
  let otpHandle: OfficialMarketCalendarKrxOtpEphemeralBody | undefined;
  let parametersHandle:
    | OfficialMarketCalendarKrxHolidayDataPostEphemeralParameters
    | undefined;
  let wireBodyHandle:
    | OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody
    | undefined;
  let responseHandle:
    | OfficialMarketCalendarKrxHolidayDataEphemeralResponse
    | undefined;

  try {
    try {
      otpHandle = await operations.acquireOtp();
    } catch {
      throw acquisitionError(
        "KRX_ACQUISITION_OTP_REJECTED",
        "KRX OTP acquisition was rejected."
      );
    }

    try {
      parametersHandle =
        consumeOfficialMarketCalendarKrxOtpForHolidayDataPost(
          otpHandle,
          request.targetYear
        );
      wireBodyHandle =
        consumeOfficialMarketCalendarKrxHolidayDataPostParametersToWireBody(
          parametersHandle
        );
    } catch {
      throw acquisitionError(
        "KRX_ACQUISITION_REQUEST_BODY_REJECTED",
        "KRX holiday data request body composition was rejected."
      );
    }

    try {
      responseHandle = await operations.consumeHolidayData(wireBodyHandle);
    } catch {
      throw acquisitionError(
        "KRX_ACQUISITION_HOLIDAY_DATA_REJECTED",
        "KRX holiday data acquisition was rejected."
      );
    }

    try {
      const summary =
        consumeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(
          responseHandle
        );
      if (
        summary.targetYear !== request.targetYear ||
        summary.returnedRowValues !== false ||
        summary.historicalCompletenessClaim !== "not_claimed" ||
        summary.durableEvidenceReusable !== false ||
        summary.acceptedAcquisition !== false
      ) {
        throw new Error("KRX holiday data summary boundary mismatch");
      }
      return summary;
    } catch {
      throw acquisitionError(
        "KRX_ACQUISITION_SEMANTICS_REJECTED",
        "KRX holiday data semantics were rejected."
      );
    }
  } finally {
    safeDispose(responseHandle, disposeOfficialMarketCalendarKrxHolidayDataEphemeralResponse);
    safeDispose(
      wireBodyHandle,
      disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody
    );
    safeDispose(
      parametersHandle,
      disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralParameters
    );
    safeDispose(otpHandle, disposeOfficialMarketCalendarKrxOtpEphemeralBody);
  }
}

function parseAcquisitionRequest(
  value: unknown
): Readonly<OfficialMarketCalendarKrxAcquisitionRequest> {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !isDeepStrictEqual(Object.keys(value), ["targetYear"])
    ) {
      throw new Error("invalid request shape");
    }
    const targetYear = parseOfficialMarketCalendarKrxHolidayTargetYear(
      (value as Record<string, unknown>).targetYear
    );
    return Object.freeze({ targetYear });
  } catch {
    throw acquisitionError(
      "KRX_ACQUISITION_INVALID_REQUEST",
      "KRX calendar acquisition request is invalid."
    );
  }
}

function snapshotOperations(
  value: TestOnlyOfficialMarketCalendarKrxAcquisitionDependencies
): AcquisitionOperations {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid dependencies");
    }
    const otpConsumer = value.otpConsumer;
    const holidayDataConsumer = value.holidayDataConsumer;
    const acquireOtp = otpConsumer?.acquire;
    const consumeHolidayData = holidayDataConsumer?.consume;
    if (
      typeof acquireOtp !== "function" ||
      typeof consumeHolidayData !== "function"
    ) {
      throw new Error("invalid dependency methods");
    }
    return Object.freeze({
      acquireOtp: () => acquireOtp.call(otpConsumer),
      consumeHolidayData: (
        handle: OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody
      ) => consumeHolidayData.call(holidayDataConsumer, handle)
    });
  } catch {
    throw acquisitionError(
      "KRX_ACQUISITION_INVALID_CONFIG",
      "KRX calendar test-only acquisition dependencies are invalid."
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
    // Preserve the stage error while refusing to retain any accessible handle.
  }
}

function acquisitionError(
  code: OfficialMarketCalendarKrxAcquisitionErrorCode,
  message: string
): OfficialMarketCalendarKrxAcquisitionError {
  return new OfficialMarketCalendarKrxAcquisitionError(code, message);
}
