import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { withPublishedCurrentOpeningBudget } from "./currentPortfolioSizingSnapshotFiles.js";
import { withCurrentCapacityFixture, options } from "./currentSizingCapacityTestFixtures.js";
import { BucketSelectionRequestFileRepository } from "./bucketSelectionRequestFiles.js";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { CandidateSizingInputFileRepository } from "./candidateSizingInputFiles.js";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { CandidateAssignmentFileRepository } from "./candidateAssignmentFiles.js";
import { createCandidateAssignment } from "./candidateAssignment.js";
import { createSelectorOpeningCapacityReservationRecord } from "./selectorOpeningCapacityReservation.js";
import { SelectorOpeningCapacityReservationFileRepository, createSelectorOpeningCapacityReservationPaths } from "./selectorOpeningCapacityReservationFiles.js";
import { START } from "./storedManualOpeningCapacityTestFixtures.js";
import { snapshot } from "./storedManualOpeningCapacityTestFixtures.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

async function freshSelection(dir: string, policyHash: string, asOf: string) {
  const basis = createPortfolioSizingSnapshot({ ...snapshot(), policyHash, asOf, portfolioVersion: "synthetic-current-selection-basis" });
  await new PortfolioSizingSnapshotFileRepository(dir).append(basis);
  const requests = new BucketSelectionRequestFileRepository(dir);
  const { requestId: _requestId, requestHash: _requestHash, ...requestPayload } = (await requests.readAll())[0]!;
  const request = createBucketSelectionRequest({ ...requestPayload, cycleId: "synthetic-publication-regression", policyHash, asOf,
    evidenceCutoffAt: asOf, portfolioSnapshotId: basis.portfolioSnapshotId, portfolioSnapshotHash: basis.portfolioSnapshotHash, createdAt: new Date().toISOString() });
  await requests.append(request);
  const inputs = new CandidateSizingInputFileRepository(dir);
  const { sizingInputRecordId: _inputId, sizingInputHash: _inputHash, ...inputPayload } = (await inputs.readAll())[0]!.record;
  const input = createCandidateSizingInputRecord({ ...inputPayload, requestId: request.requestId, policyHash, asOf,
    portfolioSnapshotId: basis.portfolioSnapshotId, portfolioSnapshotHash: basis.portfolioSnapshotHash, createdAt: new Date().toISOString() });
  await inputs.append(input);
  const assignments = new CandidateAssignmentFileRepository(dir);
  const old = (await assignments.readAll()).find(origin => origin.kind === "assignment")!;
  assert.equal(old.kind, "assignment");
  const { assignmentId: _assignmentId, assignmentHash: _assignmentHash, sizingOutputHash: _outputHash, ...assignmentPayload } = old.record;
  const assignment = createCandidateAssignment({ ...assignmentPayload, requestId: request.requestId, policyHash, asOf,
    portfolioSnapshotId: basis.portfolioSnapshotId, portfolioSnapshotHash: basis.portfolioSnapshotHash,
    sizingInputRecordId: input.sizingInputRecordId, sizingInputHash: input.sizingInputHash, createdAt: new Date().toISOString() });
  await assignments.appendAssignment(assignment);
  const sealed = await assignments.sealRequest(request.requestId);
  return { request, assignment, sealed };
}

for (const unawaited of [false, true]) {
  test(`new publication selector snapshot survives restart and exact retry; unawaited=${unawaited}`, async context => {
    await withCurrentCapacityFixture(context, async ({ dir, request }) => {
      const selected = await freshSelection(dir, request.policyHash, request.asOf);
      const realOpen = fs.open;
      context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        context.mock.timers.tick(1);
        return realOpen(...args);
      });
      syncBuiltinESMExports();
      let pending!: ReturnType<import("./selectorOpeningCapacityReservationFiles.js").SelectorCapacityAppendSession["append"]>;
      let record!: ReturnType<typeof createSelectorOpeningCapacityReservationRecord>;
      try {
        await withPublishedCurrentOpeningBudget(request, async (publication, snapshots, sessions) => {
          assert.equal(publication.snapshot.policyHash, selected.assignment.policyHash, "synthetic selection policy must match current publication");
          record = createSelectorOpeningCapacityReservationRecord({ selectionRequestId: selected.request.requestId,
            selectionRequestHash: selected.request.requestHash, candidateAssignmentSetId: selected.sealed.record.candidateAssignmentSetId,
            candidateAssignmentSetHash: selected.sealed.record.candidateAssignmentSetHash,
            candidateAssignmentId: selected.assignment.assignmentId, candidateAssignmentHash: selected.assignment.assignmentHash,
            selectedRank: 1, portfolioId: selected.assignment.portfolioId, policyHash: selected.assignment.policyHash,
            bucket: selected.assignment.bucket, market: selected.assignment.market, symbol: selected.assignment.symbol,
            currentPortfolioSnapshotId: publication.snapshot.portfolioSnapshotId,
            currentPortfolioSnapshotHash: publication.snapshot.portfolioSnapshotHash, capacityLedgerVersion: 3,
            reservedSlotOrdinal: 20, reservedMaximumNotionalKrw: 100, resultingReservedNotionalKrw: 200,
            createdAt: new Date().toISOString() });
          pending = sessions!.selectorSession.append(record, snapshots);
          if (!unawaited) await pending;
        }, options);
        const first = await pending;
        const repo = new SelectorOpeningCapacityReservationFileRepository(dir);
        assert.deepEqual((await repo.readAll()).at(-1), first);
        const before = await fs.readFile(createSelectorOpeningCapacityReservationPaths(dir).recordsPath);
        await withPublishedCurrentOpeningBudget(request, async (_publication, snapshots, sessions) => {
          assert.deepEqual(await sessions!.selectorSession.append(record, snapshots), first);
        }, options);
        assert.deepEqual(await fs.readFile(createSelectorOpeningCapacityReservationPaths(dir).recordsPath), before);
        assert.ok(Date.parse(first.source.snapshotObservation.observedAt) <= Date.parse(first.source.sizingInputObservation.observedAt));
        assert.ok(Date.parse(first.source.publishedSnapshotObservation!.observedAt) > Date.parse(first.source.assignmentObservation.observedAt));
        const path = createSelectorOpeningCapacityReservationPaths(dir).recordsPath;
        for (const damage of ["regressed-publication", "wrong-prefix", "missing-publication"] as const) {
          const rows = before.toString("utf8").trim().split("\n").map(line => JSON.parse(line));
          const entry = rows.at(-2)!;
          if (damage === "regressed-publication") entry.source.publishedSnapshotObservation.observedAt = first.source.snapshotObservation.observedAt;
          if (damage === "wrong-prefix") entry.source.publishedSnapshotObservation.recordsHash = "sha256:" + "b".repeat(64);
          if (damage === "missing-publication") delete entry.source.publishedSnapshotObservation;
          const { entryHash: _oldEntryHash, ...payload } = entry;
          entry.entryHash = hashCanonicalPayload(payload);
          const marker = rows.at(-1)!;
          marker.entryHash = entry.entryHash;
          const { commitHash: _oldCommitHash, ...markerPayload } = marker;
          marker.commitHash = hashCanonicalPayload(markerPayload);
          const corrupt = rows.map(row => JSON.stringify(row)).join("\n") + "\n";
          await fs.writeFile(path, corrupt);
          await assert.rejects(new SelectorOpeningCapacityReservationFileRepository(dir).readAll(), /corrupt|chronology|prefix/i);
          assert.equal(await fs.readFile(path, "utf8"), corrupt);
          await fs.writeFile(path, before);
        }
      } finally { context.mock.restoreAll(); syncBuiltinESMExports(); }
    }, "selector", true);
  });
}

test("publication selector still rejects a regressed source clock before consumer", async context => {
  await withCurrentCapacityFixture(context, async ({ dir, request }) => {
    await freshSelection(dir, request.policyHash, request.asOf);
    context.mock.timers.setTime(START + 9);
    let called = false;
    await assert.rejects(withPublishedCurrentOpeningBudget(request, async () => { called = true; }, options), /observation predates a stored request/);
    assert.equal(called, false);
  }, "selector", true);
});

test("publication selector rejects a cloned extended snapshot lease without appending", async context => {
  await withCurrentCapacityFixture(context, async ({ dir, request }) => {
    const selected = await freshSelection(dir, request.policyHash, request.asOf);
    const repo = new SelectorOpeningCapacityReservationFileRepository(dir);
    const old = (await repo.readAll())[0]!.record;
    const path = createSelectorOpeningCapacityReservationPaths(dir).recordsPath;
    const before = await fs.readFile(path);
    await assert.rejects(withPublishedCurrentOpeningBudget(request, async (publication, snapshots, sessions) => {
      const { selectorCapacityReservationId: _id, selectorCapacityReservationHash: _hash, ...payload } = old;
      const record = createSelectorOpeningCapacityReservationRecord({ ...payload,
        selectionRequestId: selected.request.requestId, selectionRequestHash: selected.request.requestHash,
        candidateAssignmentSetId: selected.sealed.record.candidateAssignmentSetId,
        candidateAssignmentSetHash: selected.sealed.record.candidateAssignmentSetHash,
        candidateAssignmentId: selected.assignment.assignmentId, candidateAssignmentHash: selected.assignment.assignmentHash,
        policyHash: selected.assignment.policyHash, currentPortfolioSnapshotId: publication.snapshot.portfolioSnapshotId,
        currentPortfolioSnapshotHash: publication.snapshot.portfolioSnapshotHash, createdAt: new Date().toISOString() });
      await sessions!.selectorSession.append(record, structuredClone(snapshots));
    }, options), /durable observation lease/);
    assert.deepEqual(await fs.readFile(path), before);
  }, "selector", true);
});
