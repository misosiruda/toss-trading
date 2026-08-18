import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createOfficialBrokerObservedCalendarEvidence } from "./officialBrokerObservedCalendarEvidence.js";
import { createOfficialBrokerObservedCalendarEvidenceV2 } from "./officialBrokerObservedCalendarEvidenceV2.js";
import {
  consumeOfficialBrokerObservedCalendarEphemeralCoverageReport,
  consumeOfficialBrokerObservedCalendarEphemeralReplayInput,
  createOfficialBrokerObservedCalendarEphemeralObservation,
  disposeOfficialBrokerObservedCalendarEphemeralObservation,
  type CreateOfficialBrokerObservedCalendarEphemeralObservationInput,
  type OfficialBrokerObservedCalendarEphemeralObservation
} from "./officialBrokerObservedCalendarEphemeralObservation.js";
import { verifyOfficialTossOpenApiCalendarCompatibility } from "./officialBrokerObservedCalendarOpenApiCompatibility.js";
import { createOfficialBrokerObservedCalendarCoverageProbePlan } from "./officialBrokerObservedCalendarCoverageProbe.js";

const PINNED_OPENAPI_BYTES = Buffer.from(
  readFileSync(
    "src/replay/officialTossCalendarOpenApi-1.2.14.json",
    "utf8"
  ).replaceAll("\r\n", "\n"),
  "utf8"
);
const PINNED_OPENAPI_DOCUMENT = JSON.parse(
  PINNED_OPENAPI_BYTES.toString("utf8")
) as {
  paths: Record<
    string,
    {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                examples: Record<string, { value: unknown }>;
              };
            };
          };
        };
      };
    }
  >;
};

test("consumes replay input through a fixed non-exporting operation", () => {
  const { observation, transferredRawResponseBytes } = createObservation();

  assertZeroed(transferredRawResponseBytes);
  assert.equal(
    consumeOfficialBrokerObservedCalendarEphemeralReplayInput(observation, {
      asOf: "2026-03-25T01:00:30.000Z"
    }),
    undefined
  );
  assertDisposed(observation);
});

test("consumes coverage report through a fixed non-exporting operation", () => {
  const { observation } = createObservation();

  assert.equal(
    consumeOfficialBrokerObservedCalendarEphemeralCoverageReport(
      [observation],
      {
        asOf: "2026-03-25T01:00:30.000Z",
        plan: oneDayPlan()
      }
    ),
    undefined
  );
  assertDisposed(observation);
});

test("keeps transferable response bytes behind the observation boundary", () => {
  const { observation, transferredRawResponseBytes } = createObservation();
  const transferred = structuredClone(transferredRawResponseBytes, {
    transfer: [transferredRawResponseBytes.buffer]
  });

  assert.equal(transferredRawResponseBytes.byteLength, 0);
  assertZeroed(transferred);
  consumeOfficialBrokerObservedCalendarEphemeralReplayInput(observation, {
    asOf: "2026-03-25T01:00:30.000Z"
  });
});

test("captures and zeroizes the exact caller byte view once", () => {
  const { evidence, rawResponseBytes } = createEvidenceAndBytes();
  const decoyRawResponseBytes = Uint8Array.from(pinnedResponseBytes());
  let rawResponseBytesReadCount = 0;
  let evidenceReadCount = 0;
  const input = {
    get evidence() {
      evidenceReadCount += 1;
      assertZeroed(rawResponseBytes);
      return evidence;
    },
    get rawResponseBytes() {
      rawResponseBytesReadCount += 1;
      return rawResponseBytesReadCount === 1
        ? rawResponseBytes
        : decoyRawResponseBytes;
    }
  } satisfies CreateOfficialBrokerObservedCalendarEphemeralObservationInput;

  const observation =
    createOfficialBrokerObservedCalendarEphemeralObservation(input);

  assert.equal(rawResponseBytesReadCount, 1);
  assert.equal(evidenceReadCount, 1);
  assertZeroed(rawResponseBytes);
  assert.equal(decoyRawResponseBytes.some((byte) => byte !== 0), true);
  consumeOfficialBrokerObservedCalendarEphemeralReplayInput(observation, {
    asOf: "2026-03-25T01:00:30.000Z"
  });
});

test("disposes observations when verification or a fixed operation fails", () => {
  const stale = createObservation();
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralReplayInput(
        stale.observation,
        {
          asOf: "2026-03-25T01:01:00.000Z"
        }
      ),
    /stale/
  );
  assertDisposed(stale.observation);

  const invalidPlan = createObservation();
  assert.throws(() =>
    consumeOfficialBrokerObservedCalendarEphemeralCoverageReport(
      [invalidPlan.observation],
      {
        asOf: "2026-03-25T01:00:30.000Z",
        plan: {}
      }
    )
  );
  assertDisposed(invalidPlan.observation);
});

test("rejects observation JSON export and disposes the handle", () => {
  const direct = createObservation();
  assert.throws(
    () => JSON.stringify(direct.observation),
    /observation cannot be serialized or exported/
  );
  assertDisposed(direct.observation);
});

test("rejects legacy evidence and zeroizes the accepted bytes", () => {
  const rawResponseBytes = Uint8Array.from(pinnedResponseBytes());
  const legacyEvidence = createOfficialBrokerObservedCalendarEvidence({
    market: "KR",
    requestedDate: "2026-03-25",
    retrievedAt: "2026-03-25T01:00:10.000Z",
    evaluatedAt: "2026-03-25T01:00:30.000Z",
    rawResponseBytes
  });

  assert.throws(() =>
    createOfficialBrokerObservedCalendarEphemeralObservation({
      evidence: legacyEvidence,
      rawResponseBytes
    })
  );
  assertZeroed(rawResponseBytes);
});

test("rejects forged and duplicate observations", () => {
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralReplayInput(
        {} as OfficialBrokerObservedCalendarEphemeralObservation,
        {
          asOf: "2026-03-25T01:00:30.000Z"
        }
      ),
    /observation must come from the process-local factory/
  );

  const duplicate = createObservation();
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralCoverageReport(
        [duplicate.observation, duplicate.observation],
        {
          asOf: "2026-03-25T01:00:30.000Z",
          plan: oneDayPlan()
        }
      ),
    /cannot be consumed twice/
  );
  assertDisposed(duplicate.observation);
});

test("explicit disposal is idempotent and prevents later consumption", () => {
  const { observation } = createObservation();

  disposeOfficialBrokerObservedCalendarEphemeralObservation(observation);
  disposeOfficialBrokerObservedCalendarEphemeralObservation(observation);

  assertDisposed(observation);
});

function createObservation() {
  const { evidence, rawResponseBytes } = createEvidenceAndBytes();
  return {
    transferredRawResponseBytes: rawResponseBytes,
    observation:
      createOfficialBrokerObservedCalendarEphemeralObservation({
        evidence,
        rawResponseBytes
      })
  };
}

function createEvidenceAndBytes() {
  const rawResponseBytes = Uint8Array.from(pinnedResponseBytes());
  const evidence = createOfficialBrokerObservedCalendarEvidenceV2({
    compatibilityResult: verifyOfficialTossOpenApiCalendarCompatibility({
      market: "KR",
      requestedDate: "2026-03-25",
      rawOpenApiDocumentBytes: PINNED_OPENAPI_BYTES,
      rawResponseBytes
    }),
    requestedDate: "2026-03-25",
    completedAt: "2026-03-25T01:00:10.000Z",
    responseDelayMilliseconds: 250,
    responseCacheHeaders: {
      dateHeaderValues: ["Wed, 25 Mar 2026 01:00:00 GMT"],
      ageHeaderValues: ["5"],
      expiresHeaderValues: []
    },
    responseCacheControl: {
      cacheControlHeaderValues: ["public, max-age=60"]
    },
    rawResponseBytes
  });
  return { evidence, rawResponseBytes };
}

function oneDayPlan() {
  return createOfficialBrokerObservedCalendarCoverageProbePlan({
    market: "KR",
    rangeStartDate: "2026-03-25",
    rangeEndDate: "2026-03-25"
  });
}

function pinnedResponseBytes(): Buffer {
  const value = PINNED_OPENAPI_DOCUMENT.paths[
    "/api/v1/market-calendar/KR"
  ]!.get.responses["200"].content["application/json"].examples.businessDay!
    .value;
  return Buffer.from(JSON.stringify(value), "utf8");
}

function assertDisposed(
  observation: OfficialBrokerObservedCalendarEphemeralObservation
): void {
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralReplayInput(observation, {
        asOf: "2026-03-25T01:00:30.000Z"
      }),
    /observation is disposed/
  );
}

function assertZeroed(value: Uint8Array): void {
  assert.equal(value.every((byte) => byte === 0), true);
}
