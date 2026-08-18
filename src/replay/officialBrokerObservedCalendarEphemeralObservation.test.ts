import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createOfficialBrokerObservedCalendarEvidence } from "./officialBrokerObservedCalendarEvidence.js";
import { createOfficialBrokerObservedCalendarEvidenceV2 } from "./officialBrokerObservedCalendarEvidenceV2.js";
import {
  consumeOfficialBrokerObservedCalendarEphemeralObservation,
  consumeOfficialBrokerObservedCalendarEphemeralObservations,
  createOfficialBrokerObservedCalendarCoverageReportEphemeralConsumer,
  createOfficialBrokerObservedCalendarEphemeralObservation,
  createOfficialBrokerObservedCalendarReplayInputEphemeralConsumer,
  disposeOfficialBrokerObservedCalendarEphemeralObservation,
  type OfficialBrokerObservedCalendarEphemeralConsumer,
  type OfficialBrokerObservedCalendarEphemeralObservation
} from "./officialBrokerObservedCalendarEphemeralObservation.js";
import { verifyOfficialTossOpenApiCalendarCompatibility } from "./officialBrokerObservedCalendarOpenApiCompatibility.js";
import {
  createOfficialBrokerObservedCalendarCoverageProbePlan,
  type OfficialBrokerObservedCalendarCoverageProbeReport
} from "./officialBrokerObservedCalendarCoverageProbe.js";
import type { OfficialBrokerObservedCalendarReplayInput } from "./officialBrokerObservedCalendarReplayAdapter.js";

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

test("consumes replay input through a revocable capability", () => {
  const { observation, transferredRawResponseBytes } = createObservation();
  let retainedInput: OfficialBrokerObservedCalendarReplayInput | undefined;
  let retainedEvidence:
    | OfficialBrokerObservedCalendarReplayInput["evidence"]
    | undefined;
  const consumer =
    createOfficialBrokerObservedCalendarReplayInputEphemeralConsumer({
      use: (input) => {
        retainedInput = input;
        retainedEvidence = input.evidence;
        assert.equal(input.mode, "paper_only");
        assert.equal(input.replayEvidenceClass, "observed_session_only");
        assert.equal(
          input.evidence.schemaVersion,
          "official_broker_observed_calendar_evidence.v2"
        );
        assert.equal(
          "rawResponseBytes" in input,
          false
        );
      }
    });

  assertZeroed(transferredRawResponseBytes);
  consumeOfficialBrokerObservedCalendarEphemeralObservation(observation, {
    asOf: "2026-03-25T01:00:30.000Z",
    consumer
  });

  assert.throws(() => retainedInput!.mode, /revoked/);
  assert.throws(() => retainedEvidence!.mode, /revoked/);
  assert.throws(() => JSON.stringify(retainedInput), /revoked/);
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(observation, {
        asOf: "2026-03-25T01:00:30.000Z",
        consumer
      }),
    /observation is disposed/
  );
});

test("consumes coverage report through a revocable capability", () => {
  const { observation } = createObservation();
  let retainedReport:
    | OfficialBrokerObservedCalendarCoverageProbeReport
    | undefined;
  let retainedPlan:
    | OfficialBrokerObservedCalendarCoverageProbeReport["plan"]
    | undefined;
  const consumer =
    createOfficialBrokerObservedCalendarCoverageReportEphemeralConsumer({
      plan: oneDayPlan(),
      use: (report) => {
        retainedReport = report;
        retainedPlan = report.plan;
        assert.equal(report.mode, "paper_only");
        assert.equal(report.status, "verified");
        assert.equal(report.summary.verifiedDateCount, 1);
        assert.equal(report.historicalCompletenessClaim, "not_claimed");
        assert.equal(report.officialExchangeReadiness, "not_established");
      }
    });

  consumeOfficialBrokerObservedCalendarEphemeralObservation(observation, {
    asOf: "2026-03-25T01:00:30.000Z",
    consumer
  });

  assert.throws(() => retainedReport!.status, /revoked/);
  assert.throws(() => retainedPlan!.market, /revoked/);
  assert.throws(() => JSON.stringify(retainedReport), /revoked/);
});

test("keeps transferable response bytes behind the observation boundary", () => {
  const { observation, transferredRawResponseBytes } = createObservation();
  const transferred = structuredClone(transferredRawResponseBytes, {
    transfer: [transferredRawResponseBytes.buffer]
  });
  let consumed = false;
  const consumer =
    createOfficialBrokerObservedCalendarReplayInputEphemeralConsumer({
      use: () => {
        consumed = true;
      }
    });

  assert.equal(transferredRawResponseBytes.byteLength, 0);
  assertZeroed(transferred);
  consumeOfficialBrokerObservedCalendarEphemeralObservation(observation, {
    asOf: "2026-03-25T01:00:30.000Z",
    consumer
  });
  assert.equal(consumed, true);
});

test("disposes observations when verification or a trusted consumer fails", () => {
  const consumerFailure = createObservation();
  const failingConsumer =
    createOfficialBrokerObservedCalendarReplayInputEphemeralConsumer({
      use: () => {
        throw new Error("synthetic consumer failure");
      }
    });
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(
        consumerFailure.observation,
        {
          asOf: "2026-03-25T01:00:30.000Z",
          consumer: failingConsumer
        }
      ),
    /synthetic consumer failure/
  );
  assertDisposed(consumerFailure.observation, failingConsumer);

  const stale = createObservation();
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(
        stale.observation,
        {
          asOf: "2026-03-25T01:01:00.000Z",
          consumer: failingConsumer
        }
      ),
    /stale/
  );
  assertDisposed(stale.observation, failingConsumer);
});

test("rejects returned and asynchronous derived outputs", async () => {
  const returned = createObservation();
  const returningConsumer =
    createOfficialBrokerObservedCalendarReplayInputEphemeralConsumer({
      use: (input) => input
    });
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(
        returned.observation,
        {
          asOf: "2026-03-25T01:00:30.000Z",
          consumer: returningConsumer
        }
      ),
    /must not return detached output/
  );

  const asynchronous = createObservation();
  let postAwaitStatus = "not_checked";
  const asyncConsumer =
    createOfficialBrokerObservedCalendarReplayInputEphemeralConsumer({
      use: async (input) => {
        const retainedInput = input;
        await Promise.resolve();
        try {
          void retainedInput.mode;
          postAwaitStatus = "active";
        } catch {
          postAwaitStatus = "revoked";
        }
      }
    });
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(
        asynchronous.observation,
        {
          asOf: "2026-03-25T01:00:30.000Z",
          consumer: asyncConsumer
        }
      ),
    /must not return detached output/
  );
  await Promise.resolve();
  assert.equal(postAwaitStatus, "revoked");
});

test("rejects observation, consumer, and derived JSON export", () => {
  const direct = createObservation();
  assert.throws(
    () => JSON.stringify(direct.observation),
    /observation cannot be serialized or exported/
  );

  const consumer =
    createOfficialBrokerObservedCalendarReplayInputEphemeralConsumer({
      use: () => undefined
    });
  assert.throws(
    () => JSON.stringify(consumer),
    /consumer cannot be serialized or exported/
  );

  const derived = createObservation();
  const serializingConsumer =
    createOfficialBrokerObservedCalendarReplayInputEphemeralConsumer({
      use: (input) => {
        JSON.stringify(input);
      }
    });
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(
        derived.observation,
        {
          asOf: "2026-03-25T01:00:30.000Z",
          consumer: serializingConsumer
        }
      ),
    /replay input cannot be serialized or exported/
  );
});

test("rejects legacy evidence and zeroizes transferred bytes", () => {
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

test("rejects forged capabilities and duplicate batch observations", () => {
  const forgedConsumerObservation = createObservation();
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(
        forgedConsumerObservation.observation,
        {
          asOf: "2026-03-25T01:00:30.000Z",
          consumer: {} as OfficialBrokerObservedCalendarEphemeralConsumer
        }
      ),
    /trusted process-local factory/
  );

  const consumer =
    createOfficialBrokerObservedCalendarReplayInputEphemeralConsumer({
      use: () => undefined
    });
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(
        {} as OfficialBrokerObservedCalendarEphemeralObservation,
        {
          asOf: "2026-03-25T01:00:30.000Z",
          consumer
        }
      ),
    /observation must come from the process-local factory/
  );

  const duplicate = createObservation();
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservations(
        [duplicate.observation, duplicate.observation],
        {
          asOf: "2026-03-25T01:00:30.000Z",
          consumer
        }
      ),
    /cannot be consumed twice/
  );
  assertDisposed(duplicate.observation, consumer);
});

test("explicit disposal is idempotent and prevents later consumption", () => {
  const { observation } = createObservation();
  const consumer =
    createOfficialBrokerObservedCalendarReplayInputEphemeralConsumer({
      use: () => undefined
    });

  disposeOfficialBrokerObservedCalendarEphemeralObservation(observation);
  disposeOfficialBrokerObservedCalendarEphemeralObservation(observation);

  assertDisposed(observation, consumer);
});

function createObservation() {
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
  return {
    transferredRawResponseBytes: rawResponseBytes,
    observation:
      createOfficialBrokerObservedCalendarEphemeralObservation({
        evidence,
        rawResponseBytes
      })
  };
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
  observation: OfficialBrokerObservedCalendarEphemeralObservation,
  consumer: OfficialBrokerObservedCalendarEphemeralConsumer
): void {
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(observation, {
        asOf: "2026-03-25T01:00:30.000Z",
        consumer
      }),
    /observation is disposed/
  );
}

function assertZeroed(value: Uint8Array): void {
  assert.equal(value.every((byte) => byte === 0), true);
}
