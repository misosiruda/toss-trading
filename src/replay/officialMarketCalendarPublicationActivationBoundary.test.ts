import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";
import { createOfficialMarketCalendarEvidenceArtifactV2 } from "./officialMarketCalendarEvidenceArtifactV2.js";
import {
  LEGACY_OFFICIAL_MARKET_CALENDAR_PUBLICATION_ACTIVATION_PREFLIGHT_SCHEMA_VERSION,
  OFFICIAL_MARKET_CALENDAR_PUBLICATION_ACTIVATION_PREFLIGHT_SCHEMA_VERSION,
  assertOfficialMarketCalendarPublicationActivationPermitted,
  createOfficialMarketCalendarPublicationActivationPreflightHash,
  evaluateOfficialMarketCalendarPublicationActivationPreflight,
  parseOfficialMarketCalendarPublicationActivationPreflight
} from "./officialMarketCalendarPublicationActivationPreflight.js";
import { inspectOfficialMarketCalendarPublicationFilesystem } from "./officialMarketCalendarPublicationFilesystemPreflight.js";
import { createOfficialMarketCalendarPublicationPackagePlan } from "./officialMarketCalendarPublicationPackagePlan.js";
import { evidenceArtifactV2Fixture, hash } from "./officialMarketCalendarBoundaryTestFixtures.js";

test("calendar publication activation preflight follows verified filesystem capabilities", async () => {
  const fixture = evidenceArtifactV2Fixture();
  const artifact = createOfficialMarketCalendarEvidenceArtifactV2(
    fixture.input,
    fixture.options
  );
  const sidecars = artifact.sourceArchiveBindings
    .map(({ archivePath, sourceDocumentRef }) => ({
      archivePath,
      bytes:
        fixture.options.sourceBytesByExchange[sourceDocumentRef.exchange][
          sourceDocumentRef.documentId
        ]
    }))
    .sort((left, right) =>
      left.archivePath < right.archivePath ? -1 : 1
    );
  const { plan } = createOfficialMarketCalendarPublicationPackagePlan(
    { artifact, sidecars },
    fixture.options
  );
  const filesystemPreflight =
    await inspectOfficialMarketCalendarPublicationFilesystem({
      publicationRoot: tmpdir()
    });
  const decision =
    evaluateOfficialMarketCalendarPublicationActivationPreflight({
      packagePlan: plan,
      sidecars,
      filesystemPreflight
    }, fixture.options);

  assert.equal(
    decision.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_PUBLICATION_ACTIVATION_PREFLIGHT_SCHEMA_VERSION
  );
  assert.equal(decision.artifactHash, artifact.artifactHash);
  assert.equal(decision.packagePlanHash, plan.planHash);
  assert.equal(
    decision.filesystemPreflightHash,
    filesystemPreflight.preflightHash
  );
  assert.deepEqual(
    decision.blockers,
    [
      ...filesystemPreflight.blockers,
      "publication_record_writer_unavailable"
    ].sort()
  );
  assert.equal(decision.status, "blocked");
  assert.equal(decision.filesystemMutationAction, "none");
  assert.equal(decision.verifiedSetAction, "unchanged");
  assert.throws(
    () =>
      assertOfficialMarketCalendarPublicationActivationPermitted(decision),
    /publication activation is blocked/
  );
  assert.ok(Object.isFrozen(decision));
  assert.ok(Object.isFrozen(decision.blockers));
  assert.deepEqual(
    parseOfficialMarketCalendarPublicationActivationPreflight(decision),
    decision
  );
  const { decisionHash: _decisionHash, ...currentPayload } = decision;
  const legacyPayload = {
    ...currentPayload,
    schemaVersion:
      "official_market_calendar_publication_activation_preflight.v1" as const,
    blockers: currentPayload.blockers.map((blocker) =>
      blocker === "publication_record_writer_unavailable"
        ? "publication_writer_unavailable" as const
        : blocker
    )
  };
  const legacyDecision = {
    ...legacyPayload,
    decisionHash:
      createOfficialMarketCalendarPublicationActivationPreflightHash(
        legacyPayload
      )
  };
  const parsedLegacyDecision =
    parseOfficialMarketCalendarPublicationActivationPreflight(legacyDecision);
  assert.equal(
    parsedLegacyDecision.schemaVersion,
    LEGACY_OFFICIAL_MARKET_CALENDAR_PUBLICATION_ACTIVATION_PREFLIGHT_SCHEMA_VERSION
  );
  assert.deepEqual(parsedLegacyDecision, legacyDecision);
  assert.throws(
    () =>
      evaluateOfficialMarketCalendarPublicationActivationPreflight({
        packagePlan: { ...plan, planHash: hash("f") },
        sidecars,
        filesystemPreflight
      }, fixture.options),
    /does not match verified artifact and sidecars/
  );
  assert.throws(
    () =>
      evaluateOfficialMarketCalendarPublicationActivationPreflight({
        packagePlan: plan,
        sidecars,
        filesystemPreflight: {
          ...filesystemPreflight,
          preflightHash: hash("f")
        }
      }, fixture.options),
    /filesystem preflight hash mismatch/
  );
  assert.throws(
    () =>
      evaluateOfficialMarketCalendarPublicationActivationPreflight({
        packagePlan: plan,
        sidecars: [
          { ...sidecars[0], bytes: new Uint8Array(100).fill(90) },
          sidecars[1]
        ],
        filesystemPreflight
      }, fixture.options),
    /sidecar hash mismatch/
  );
});
