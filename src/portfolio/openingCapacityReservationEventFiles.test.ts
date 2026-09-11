import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs, { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createOpeningCapacityReservationEvent, type OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { replayOpeningCapacityReservationEvents } from "./openingCapacityReservationEventReplay.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths,
  getDurableOpeningCapacityEventObservedAt, resolveStoredOpeningCapacityEventOrigin,
  type VerifiedOpeningCapacityEventHistory } from "./openingCapacityReservationEventFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const HASH = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;
const START = Date.parse("2026-09-01T00:00:00.000Z");
const scope = { portfolioId: "portfolio", policyHash: HASH, bucket: "swing" as const };
type EventInput = Parameters<typeof createOpeningCapacityReservationEvent>[0];

test("capacity journal persists every transition and restarts with exact immutable storage origins", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    const repo = new OpeningCapacityReservationEventFileRepository(dir);
    const empty = await repo.readVerifiedHistory();
    assert.equal(empty.generationHash, null);
    assert.deepEqual(empty.events, []);
    await assert.rejects(readFile(createOpeningCapacityReservationEventPaths(dir).eventsPath), { code: "ENOENT" });
    const events: OpeningCapacityReservationEvent[] = [];
    for (let version = 1; version <= 6; version++) {
      context.mock.timers.setTime(START + version * 1000);
      const previous = events.at(-1);
      const event = version === 1 ? root("one", 1) : version === 2 ? bind(previous!, 2)
        : version === 3 ? consume(previous!, 3, 60) : version === 4 ? consume(previous!, 4, 40, true)
          : version === 5 ? consume(previous!, 5, 20) : release(previous!, 6, true);
      const origin = await repo.append(event);
      events.push(event);
      assert.deepEqual(origin.event, event);
      const history = await new OpeningCapacityReservationEventFileRepository(dir).readVerifiedHistory();
      assert.deepEqual(history.events, events);
      assert.deepEqual(history.ledgers, [replayOpeningCapacityReservationEvents({ ...scope, events })]);
      assert.deepEqual(resolveStoredOpeningCapacityEventOrigin(history, event.capacityReservationEventId), origin);
      assert.equal(history.generationHash, origin.commitHash);
      assert.equal(history.verificationScope, "stored_opening_capacity_event_history_only");
      for (const object of [history, history.events, history.ledgers, history.ledgers[0], origin, origin.event]) assert.ok(Object.isFrozen(object));
      assert.throws(() => getDurableOpeningCapacityEventObservedAt(history), /lease/);
    }
    const path = createOpeningCapacityReservationEventPaths(dir).eventsPath;
    const raw = await readFile(path, "utf8");
    const old = await repo.readVerifiedHistory();
    context.mock.timers.setTime(START + 10_000);
    assert.deepEqual(await repo.append(events[0]), resolveStoredOpeningCapacityEventOrigin(old, events[0]!.capacityReservationEventId));
    await assert.rejects(repo.append({ ...events[0], createdAt: new Date().toISOString() }), /ID collision/);
    assert.equal(await readFile(path, "utf8"), raw);
    assert.equal(raw.trim().split("\n").length, 12);
    assert.equal(old.ledgers[0]!.remainingReservedNotionalKrw, 0);
    assert.equal(old.ledgers[0]!.reservations[0]!.consumedNotionalKrw, 80);
    assert.equal(old.ledgers[0]!.reservations[0]!.releasedNotionalKrw, 20);
  });
});

test("capacity journal serializes competing versions and exact retries across instances", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    const first = root("one", 1);
    const retries = await Promise.all(Array.from({ length: 8 }, () => new OpeningCapacityReservationEventFileRepository(dir).append(first)));
    for (const origin of retries) assert.deepEqual(origin, retries[0]);
    const contenders = await Promise.allSettled([root("two", 2), root("three", 2)].map((event) =>
      new OpeningCapacityReservationEventFileRepository(dir).append(event)));
    assert.equal(contenders.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(contenders.filter((item) => item.status === "rejected").length, 1);
    const repo = new OpeningCapacityReservationEventFileRepository(dir);
    assert.equal((await repo.readAll()).length, 2);
    await assert.rejects(repo.append(root("four", 4)), /version gap/);
    await assert.rejects(repo.append(bind(first, 3, { previousCapacityReservationEventId: "unknown" })), /wrong predecessor/);
    assert.equal((await repo.readAll()).length, 2);
  });
});

test("capacity journal separates scope versions and keeps historical observations immutable", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    const repo = new OpeningCapacityReservationEventFileRepository(dir);
    const first = root("one", 1);
    await repo.append(first);
    const history = await repo.readVerifiedHistory();
    for (const patch of [{ portfolioId: "other" }, { policyHash: OTHER }, { bucket: "intraday" }]) await repo.append(rebuild(first, patch));
    const later = await repo.readVerifiedHistory();
    assert.equal(later.ledgers.length, 4);
    assert.equal(history.events.length, 1);
    assert.throws(() => resolveStoredOpeningCapacityEventOrigin(history, later.events[1]!.capacityReservationEventId), /absent/);
    for (const clone of [{ ...history }, JSON.parse(JSON.stringify(history))]) {
      assert.throws(() => resolveStoredOpeningCapacityEventOrigin(clone, first.capacityReservationEventId), /storage origin/);
    }
    for (const id of ["missing", "__proto__", "constructor"]) assert.throws(() => resolveStoredOpeningCapacityEventOrigin(later, id), /absent/);
    assert.notEqual(later.generationHash, history.generationHash);
  });
});

test("capacity journal rejects future creation and ledger state claimed before predecessor commit", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    const repo = new OpeningCapacityReservationEventFileRepository(dir);
    await assert.rejects(repo.append(root("one", 1, { createdAt: "9999-01-01T00:00:00.000Z" })), /not yet available/);
    const first = root("one", 1);
    context.mock.timers.setTime(START + 1000);
    await repo.append(first);
    await assert.rejects(repo.append(bind(first, 2, { asOf: new Date(START).toISOString() })), /predates/);
    context.mock.timers.setTime(START - 1000);
    await assert.rejects(repo.readAll(), /corrupt/);
    context.mock.timers.setTime(START + 2000);
    await repo.append(release(first, 2, false));
    await assert.rejects(repo.append(bind(first, 3)), /wrong predecessor|terminal/);
  });
});

test("capacity journal rejects fully rehashed semantic corruption and malformed pairs without truncation", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    const repo = new OpeningCapacityReservationEventFileRepository(dir);
    const first = root("one", 1);
    await repo.append(first);
    const path = createOpeningCapacityReservationEventPaths(dir).eventsPath;
    const valid = await readFile(path, "utf8");
    const [entry, marker] = valid.trim().split("\n").map((line) => JSON.parse(line));
    const pair = (patch: Record<string, unknown>, markerPatch: Record<string, unknown> = {}) => {
      const { entryHash: _entryHash, ...payload } = { ...entry, ...patch };
      const next = { ...payload, entryHash: hashCanonicalPayload(payload) };
      const { commitHash: _commitHash, ...commitPayload } = { ...marker, ...markerPatch, entryHash: next.entryHash };
      return `${JSON.stringify(next)}\n${JSON.stringify({ ...commitPayload, commitHash: hashCanonicalPayload(commitPayload) })}\n`;
    };
    const corruptions = [valid.trimEnd(), valid + "\n", valid + "{bad}\n", `${JSON.stringify(entry)}\n`,
      pair({ previousCommitHash: OTHER }), pair({ unknown: true }), pair({ event: { ...first, capacityReservationEventHash: OTHER } }),
      pair({ event: rebuild(first, { capacityLedgerVersion: 2 }) }), pair({ event: bind(first, 1) }),
      pair({ appendStartedAt: "9999-01-01T00:00:00.000Z" }), pair({}, { committedAt: "9999-01-01T00:00:00.000Z" }),
      valid + pair({ previousCommitHash: marker.commitHash }),
      valid + pair({ previousCommitHash: marker.commitHash, event: root("foreign", 2, { portfolioId: "other" }) }),
      `${JSON.stringify({ ...entry, entryHash: OTHER })}\n${JSON.stringify(marker)}\n`];
    for (const raw of corruptions) {
      await writeFile(path, raw);
      await assert.rejects(repo.readAll());
      await assert.rejects(repo.append(first));
      assert.equal(await readFile(path, "utf8"), raw);
    }
    const invalidUtf8 = Buffer.concat([Buffer.from(valid), Buffer.from([0xff, 10])]);
    await writeFile(path, invalidUtf8);
    await assert.rejects(repo.readAll());
    assert.deepEqual(await readFile(path), invalidUtf8);
    await writeFile(path, valid);
    assert.deepEqual(await repo.readAll(), [first]);
  });
});

test("capacity journal interrupted writes keep a barrier and reject retries after reopening", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  for (const failure of ["pending_sync", "entry_write", "entry_sync", "marker_write", "marker_sync", "pending_remove"] as const) await temporary(async (dir) => {
    const paths = createOpeningCapacityReservationEventPaths(dir);
    const originalOpen = fs.open;
    const originalUnlink = fs.unlink;
    let ordinal = 0;
    let injected = false;
    const fail = () => { injected = true; throw new Error(`injected ${failure}`); };
    const opened = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === paths.pendingPath && failure === "pending_sync") context.mock.method(handle, "sync", async () => fail());
      if (args[0] === paths.eventsPath && args[1] === "a") {
        const current = ++ordinal;
        if ((current === 1 && failure === "entry_write") || (current === 2 && failure === "marker_write")) context.mock.method(handle, "writeFile", async () => fail());
        if ((current === 1 && failure === "entry_sync") || (current === 2 && failure === "marker_sync")) context.mock.method(handle, "sync", async () => fail());
      }
      return handle;
    });
    const unlinked = context.mock.method(fs, "unlink", async (...args: Parameters<typeof fs.unlink>) => {
      if (args[0] === paths.pendingPath && failure === "pending_remove") fail();
      return originalUnlink(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(new OpeningCapacityReservationEventFileRepository(dir).append(root("one", 1)), /injected/); assert.ok(injected); }
    finally { opened.mock.restore(); unlinked.mock.restore(); syncBuiltinESMExports(); }
    assert.ok(await readFile(paths.pendingPath, "utf8"));
    const repo = new OpeningCapacityReservationEventFileRepository(dir);
    await assert.rejects(repo.readAll(), /explicit recovery/);
    await assert.rejects(repo.append(root("one", 1)), /explicit recovery/);
    await assert.rejects(readFile(paths.lockPath), { code: "ENOENT" });
  });
});

test("capacity journal live observations hold the lock and expire after success and failure", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    const repo = new OpeningCapacityReservationEventFileRepository(dir);
    const contender = new OpeningCapacityReservationEventFileRepository(dir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 });
    let captured: VerifiedOpeningCapacityEventHistory | undefined;
    for (const throws of [false, true]) {
      const operation = repo.withDurableVerifiedHistory(async (history) => {
        captured = history;
        assert.equal(getDurableOpeningCapacityEventObservedAt(history), new Date().toISOString());
        assert.throws(() => getDurableOpeningCapacityEventObservedAt({ ...history }), /lease/);
        await assert.rejects(contender.append(root("one", 1)), /lock is unavailable/);
        if (throws) throw new Error("consumer failure");
      });
      if (throws) await assert.rejects(operation, /consumer failure/); else await operation;
      assert.throws(() => getDurableOpeningCapacityEventObservedAt(captured!), /lease/);
      assert.deepEqual(await repo.readAll(), []);
    }
    await contender.append(root("one", 1));
  });
});

test("capacity journal locks retain abandoned and failed-initialization barriers under frozen wall time", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    const paths = createOpeningCapacityReservationEventPaths(dir);
    const repo = new OpeningCapacityReservationEventFileRepository(dir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 });
    await writeFile(paths.lockPath, "foreign");
    await assert.rejects(repo.readAll(), /lock is unavailable/);
    assert.equal(await readFile(paths.lockPath, "utf8"), "foreign");
  });
  for (const method of ["writeFile", "sync"] as const) await temporary(async (dir) => {
    const paths = createOpeningCapacityReservationEventPaths(dir);
    const originalOpen = fs.open;
    const opened = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === paths.lockPath && args[1] === "wx") context.mock.method(handle, method, async () => { throw new Error("initialization failure"); });
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(new OpeningCapacityReservationEventFileRepository(dir).readAll(), /initialization failure/); }
    finally { opened.mock.restore(); syncBuiltinESMExports(); }
    await readFile(paths.lockPath);
    await assert.rejects(new OpeningCapacityReservationEventFileRepository(dir, { lockTimeoutMs: 40 }).readAll(), /lock is unavailable/);
  });
});

test("capacity journal rejects mutated durable bytes before exposing a consumer", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    const repo = new OpeningCapacityReservationEventFileRepository(dir);
    await repo.append(root("one", 1));
    const path = createOpeningCapacityReservationEventPaths(dir).eventsPath;
    const originalOpen = fs.open;
    const opened = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === path && args[1] === "r+") {
        const originalSync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => { await originalSync(); await writeFile(path, "\n"); });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(repo.withDurableVerifiedHistory(async () => assert.fail("must not expose changed source")), /changed during observation/); }
    finally { opened.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(await readFile(path, "utf8"), "\n");
  });
});

test("capacity journal concurrent processes converge on one exact persisted pair", async () => {
  await temporary(async (dir) => {
    const event = root("process-retry", 1);
    const script = `import { OpeningCapacityReservationEventFileRepository } from ${JSON.stringify(new URL("./openingCapacityReservationEventFiles.js", import.meta.url).href)};
      await new OpeningCapacityReservationEventFileRepository(process.argv[1]).append(JSON.parse(process.argv[2]));`;
    await Promise.all(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath,
      ["--input-type=module", "-e", script, dir, JSON.stringify(event)], { windowsHide: true })));
    const repo = new OpeningCapacityReservationEventFileRepository(dir);
    assert.deepEqual(await repo.readAll(), [event]);
    assert.equal((await readFile(createOpeningCapacityReservationEventPaths(dir).eventsPath, "utf8")).trim().split("\n").length, 2);
  });
});

test("capacity journal captures caller input and supports selector and existing-position claims without granting source authority", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    const repo = new OpeningCapacityReservationEventFileRepository(dir);
    const first = root("selector", 1, { reservationSource: { sourceKind: "selector", candidateAssignmentSetId: "set",
      candidateAssignmentSetHash: HASH, candidateAssignmentId: "candidate", reservedSlotOrdinal: 0 } });
    const input = JSON.parse(JSON.stringify(first));
    const append = repo.append(input);
    input.reservationSource.candidateAssignmentId = "mutated";
    input.remainingReservedNotionalKrw = 1;
    await append;
    assert.deepEqual(await repo.readAll(), [first]);
    await assert.rejects(repo.append({ ...first, unknown: true }));
    const bound = bind(first, 2);
    await repo.append(bound);
    const consumed = consume(bound, 3, 0);
    await repo.append(consumed);
    assert.equal((await repo.readVerifiedHistory()).ledgers[0]!.remainingReservedNotionalKrw, 0);
    await assert.rejects(repo.append(release(consumed, 4, true)), /terminal/);
    const increase = root("increase", 4, { occupiesNewPositionSlot: false });
    await repo.append(increase);
    const increaseBound = bind(increase, 5, { mandateId: "increase-mandate" });
    await repo.append(increaseBound);
    await repo.append(rebuild(consume(increaseBound, 6, 40, true), { mandateId: "increase-mandate" }));
    const history = await repo.readVerifiedHistory();
    assert.equal(history.ledgers[0]!.remainingReservedNotionalKrw, 40);
    assert.equal(history.ledgers[0]!.pendingNewPositionSlotCount, 0);
    assert.equal(history.ledgers[0]!.boundUnusedNewPositionSlotCount, 0);
    assert.equal(history.verificationScope, "stored_opening_capacity_event_history_only");
  });
});

test("capacity journal acquisition retries only lock contention and preserves ownership changes", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  for (const code of ["EEXIST", "EPERM", "EACCES"]) await temporary(async (dir) => {
    const paths = createOpeningCapacityReservationEventPaths(dir);
    const originalOpen = fs.open;
    let attempts = 0;
    const opened = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === paths.lockPath && args[1] === "wx" && ++attempts === 1) throw Object.assign(new Error("injected acquisition"), { code });
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    try {
      const operation = new OpeningCapacityReservationEventFileRepository(dir).readAll();
      if (code === "EEXIST" || (code === "EPERM" && process.platform === "win32")) {
        assert.deepEqual(await operation, []); assert.equal(attempts, 2);
      } else { await assert.rejects(operation, /injected acquisition/); assert.equal(attempts, 1); }
    } finally { opened.mock.restore(); syncBuiltinESMExports(); }
  });
  await temporary(async (dir) => {
    const repo = new OpeningCapacityReservationEventFileRepository(dir);
    const paths = createOpeningCapacityReservationEventPaths(dir);
    await assert.rejects(repo.withDurableVerifiedHistory(async () => { await writeFile(paths.lockPath, "replacement"); }), /ownership changed/);
    assert.equal(await readFile(paths.lockPath, "utf8"), "replacement");
  });
});

function root(id: string, version: number, patch: Record<string, unknown> = {}) {
  return createOpeningCapacityReservationEvent({ ...scope, eventType: "reserved", reservationId: id, reservationHash: HASH,
    reservationSource: { sourceKind: "manual", manualCapacityReservationId: id, manualCapacityReservationHash: HASH },
    capacityLedgerVersion: version, remainingReservedNotionalKrw: 100, occupiesNewPositionSlot: true,
    asOf: new Date().toISOString(), createdAt: new Date().toISOString(), ...patch } as EventInput);
}
function successor(previous: OpeningCapacityReservationEvent, version: number) {
  return { ...scope, reservationId: previous.reservationId, reservationHash: previous.reservationHash,
    previousCapacityReservationEventId: previous.capacityReservationEventId, capacityLedgerVersion: version,
    remainingReservedNotionalKrw: previous.remainingReservedNotionalKrw, occupiesNewPositionSlot: previous.occupiesNewPositionSlot,
    asOf: new Date().toISOString(), createdAt: new Date().toISOString() };
}
function bind(previous: OpeningCapacityReservationEvent, version: number, patch: Record<string, unknown> = {}) {
  return createOpeningCapacityReservationEvent({ ...successor(previous, version), eventType: "bound_to_mandate",
    mandateId: "mandate", mandateHash: HASH, ...patch } as EventInput);
}
function consume(previous: OpeningCapacityReservationEvent, version: number, remaining: number, partial = false) {
  const input = { ...successor(previous, version), remainingReservedNotionalKrw: remaining, occupiesNewPositionSlot: false as const,
    mandateId: "mandate", mandateHash: HASH, fillId: `fill-${version}`, paperFillRecordId: `paper-${version}`, paperFillHash: HASH };
  return createOpeningCapacityReservationEvent(partial ? { ...input, eventType: "partially_consumed" }
    : { ...input, eventType: "consumed_by_position", resultingPositionRef: "position" });
}
function release(previous: OpeningCapacityReservationEvent, version: number, bound: boolean) {
  return createOpeningCapacityReservationEvent({ ...successor(previous, version), eventType: "released", remainingReservedNotionalKrw: 0,
    occupiesNewPositionSlot: false, releaseReasonCode: "cancelled", releaseOrigin: bound
      ? { originKind: "mandate_terminal", mandateId: "mandate", mandateHash: HASH, mandateEventId: "terminal", mandateEventHash: HASH }
      : { originKind: "request_cancelled", requestOrManualEventId: "request" } });
}
function rebuild(event: OpeningCapacityReservationEvent, patch: Record<string, unknown>) {
  const { capacityReservationEventId: _id, capacityReservationEventHash: _hash, ...input } = event;
  return createOpeningCapacityReservationEvent({ ...input, ...patch } as EventInput);
}
async function temporary(operation: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "opening-capacity-events-"));
  try { await operation(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
