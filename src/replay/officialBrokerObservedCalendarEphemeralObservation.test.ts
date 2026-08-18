import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createOfficialBrokerObservedCalendarEvidence } from "./officialBrokerObservedCalendarEvidence.js";
import { createOfficialBrokerObservedCalendarEvidenceV2 } from "./officialBrokerObservedCalendarEvidenceV2.js";
import {
  consumeOfficialBrokerObservedCalendarEphemeralObservation,
  createOfficialBrokerObservedCalendarEphemeralObservation,
  disposeOfficialBrokerObservedCalendarEphemeralObservation,
  type OfficialBrokerObservedCalendarEphemeralObservationScope
} from "./officialBrokerObservedCalendarEphemeralObservation.js";
import { verifyOfficialTossOpenApiCalendarCompatibility } from "./officialBrokerObservedCalendarOpenApiCompatibility.js";
import {
  buildOfficialBrokerObservedCalendarCoverageProbeReport,
  createOfficialBrokerObservedCalendarCoverageProbePlan
} from "./officialBrokerObservedCalendarCoverageProbe.js";
import { buildOfficialBrokerObservedCalendarReplayInput } from "./officialBrokerObservedCalendarReplayAdapter.js";

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

test("consumes a network-derived v2 observation once and disposes owned bytes", () => {
  const { observation, rawResponseBytes } = createObservation();
  let retainedScope:
    | OfficialBrokerObservedCalendarEphemeralObservationScope
    | undefined;
  let retainedEvidence:
    | OfficialBrokerObservedCalendarEphemeralObservationScope["evidence"]
    | undefined;
  let retainedSource:
    | OfficialBrokerObservedCalendarEphemeralObservationScope["evidence"]["source"]
    | undefined;
  let retainedBytes: Uint8Array | undefined;

  consumeOfficialBrokerObservedCalendarEphemeralObservation(observation, {
    asOf: "2026-03-25T01:00:30.000Z",
    consumer: (scope) => {
      retainedScope = scope;
      retainedEvidence = scope.evidence;
      retainedSource = scope.evidence.source;
      retainedBytes = scope.rawResponseBytes;
      assert.strictEqual(scope.rawResponseBytes, rawResponseBytes);
      assert.equal(scope.asOf, "2026-03-25T01:00:30.000Z");
      assert.equal(scope.evidence.mode, "paper_only");
      assert.equal(
        scope.evidence.replayEvidenceClass,
        "observed_session_only"
      );
      assert.deepEqual(Object.keys(scope), []);

      const replayInput = buildOfficialBrokerObservedCalendarReplayInput({
        evidence: scope.evidence,
        asOf: scope.asOf,
        rawResponseBytes: scope.rawResponseBytes
      });
      assert.equal(replayInput.mode, "paper_only");
      assert.equal(
        replayInput.replayEvidenceClass,
        "observed_session_only"
      );
    }
  });

  assertZeroed(rawResponseBytes);
  assertZeroed(retainedBytes);
  assert.throws(() => retainedScope!.evidence, /scope is disposed/);
  assert.throws(() => retainedEvidence!.mode, /revoked/);
  assert.throws(() => retainedSource!.publisher, /revoked/);
  assert.throws(() => JSON.stringify(retainedEvidence), /revoked/);
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(observation, {
        asOf: "2026-03-25T01:00:30.000Z",
        consumer: () => undefined
      }),
    /observation is disposed/
  );
});

test("disposes exact bytes when the consumer or freshness verification fails", () => {
  const consumerFailure = createObservation();
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(
        consumerFailure.observation,
        {
          asOf: "2026-03-25T01:00:30.000Z",
          consumer: () => {
            throw new Error("synthetic consumer failure");
          }
        }
      ),
    /synthetic consumer failure/
  );
  assertZeroed(consumerFailure.rawResponseBytes);

  const stale = createObservation();
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(
        stale.observation,
        {
          asOf: "2026-03-25T01:01:00.000Z",
          consumer: () => undefined
        }
      ),
    /stale/
  );
  assertZeroed(stale.rawResponseBytes);
});

test("rejects an asynchronous consumer before its scope can outlive the chain", async () => {
  const { observation, rawResponseBytes } = createObservation();
  let postAwaitScopeStatus = "not_checked";

  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(observation, {
        asOf: "2026-03-25T01:00:30.000Z",
        consumer: async (scope) => {
          const retainedEvidence = scope.evidence;
          await Promise.resolve();
          try {
            void retainedEvidence.mode;
            postAwaitScopeStatus = "active";
          } catch {
            postAwaitScopeStatus = "disposed";
          }
        }
      }),
    /must not return detached output/
  );
  await Promise.resolve();

  assert.equal(postAwaitScopeStatus, "disposed");
  assertZeroed(rawResponseBytes);
});

test("fails closed when transferred exact bytes change before consumption", () => {
  const { observation, rawResponseBytes } = createObservation();
  rawResponseBytes[0] = rawResponseBytes[0]! ^ 1;

  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(observation, {
        asOf: "2026-03-25T01:00:30.000Z",
        consumer: () => undefined
      }),
    /response hash mismatch|Unexpected token|JSON/
  );
  assertZeroed(rawResponseBytes);
});

for (const detachedOutput of [
  {
    name: "v2 evidence",
    build: (
      scope: OfficialBrokerObservedCalendarEphemeralObservationScope
    ) => scope.evidence
  },
  {
    name: "replay input",
    build: (
      scope: OfficialBrokerObservedCalendarEphemeralObservationScope
    ) =>
      buildOfficialBrokerObservedCalendarReplayInput({
        evidence: scope.evidence,
        asOf: scope.asOf,
        rawResponseBytes: scope.rawResponseBytes
      })
  },
  {
    name: "coverage report",
    build: (
      scope: OfficialBrokerObservedCalendarEphemeralObservationScope
    ) =>
      buildOfficialBrokerObservedCalendarCoverageProbeReport({
        plan: createOfficialBrokerObservedCalendarCoverageProbePlan({
          market: "KR",
          rangeStartDate: "2026-03-25",
          rangeEndDate: "2026-03-25"
        }),
        evaluatedAt: scope.asOf,
        observations: [
          {
            status: "verified",
            requestedDate: "2026-03-25",
            evidence: scope.evidence,
            rawResponseBytes: scope.rawResponseBytes
          }
        ]
      })
  }
]) {
  test(`rejects detached ${detachedOutput.name} output`, () => {
    const { observation, rawResponseBytes } = createObservation();

    assert.throws(
      () =>
        consumeOfficialBrokerObservedCalendarEphemeralObservation(
          observation,
          {
            asOf: "2026-03-25T01:00:30.000Z",
            consumer: (scope) => detachedOutput.build(scope)
          }
        ),
      /must not return detached output/
    );
    assertZeroed(rawResponseBytes);
  });
}

test("rejects observation and scope JSON export and disposes owned bytes", () => {
  const direct = createObservation();
  assert.throws(
    () => JSON.stringify(direct.observation),
    /cannot be serialized or exported/
  );
  assertZeroed(direct.rawResponseBytes);

  const scoped = createObservation();
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(
        scoped.observation,
        {
          asOf: "2026-03-25T01:00:30.000Z",
          consumer: (scope) => {
            JSON.stringify(scope);
          }
        }
      ),
    /scope cannot be serialized or exported/
  );
  assertZeroed(scoped.rawResponseBytes);

  const evidence = createObservation();
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(
        evidence.observation,
        {
          asOf: "2026-03-25T01:00:30.000Z",
          consumer: (scope) => {
            JSON.stringify(scope.evidence);
          }
        }
      ),
    /evidence cannot be serialized or exported/
  );
  assertZeroed(evidence.rawResponseBytes);
});

test("rejects legacy evidence and disposes transferred bytes", () => {
  const rawResponseBytes = pinnedResponseBytes();
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

test("explicit disposal is idempotent and prevents later consumption", () => {
  const { observation, rawResponseBytes } = createObservation();

  disposeOfficialBrokerObservedCalendarEphemeralObservation(observation);
  disposeOfficialBrokerObservedCalendarEphemeralObservation(observation);

  assertZeroed(rawResponseBytes);
  assert.throws(
    () =>
      consumeOfficialBrokerObservedCalendarEphemeralObservation(observation, {
        asOf: "2026-03-25T01:00:30.000Z",
        consumer: () => undefined
      }),
    /observation is disposed/
  );
});

function createObservation() {
  const rawResponseBytes = pinnedResponseBytes();
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
    rawResponseBytes,
    observation:
      createOfficialBrokerObservedCalendarEphemeralObservation({
        evidence,
        rawResponseBytes
      })
  };
}

function pinnedResponseBytes(): Buffer {
  const value = PINNED_OPENAPI_DOCUMENT.paths[
    "/api/v1/market-calendar/KR"
  ]!.get.responses["200"].content["application/json"].examples.businessDay!
    .value;
  return Buffer.from(JSON.stringify(value), "utf8");
}

function assertZeroed(value: Uint8Array | undefined): void {
  assert.ok(value);
  assert.equal(value.every((byte) => byte === 0), true);
}
