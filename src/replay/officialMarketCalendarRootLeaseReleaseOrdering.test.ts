import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createOfficialMarketCalendarWindowsPublicationRootLease as createLease } from "./officialMarketCalendarWindowsPublicationRootLease.js";

for (const scenario of ["ack-before-callback", "missing-ack", "nonzero-exit", "signal-exit", "input-failure", "stdin-error"] as const) {
  test(`root lease release preserves protocol proof under ${scenario}`, { skip: process.platform !== "win32" }, async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "calendar-release-order-"));
    const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
    let killed = false;
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, exitCode: null as number | null,
      kill: () => { killed = true; child.exitCode = 1; child.emit("close", 1, null); return true; } });
    const mock = context.mock.method(childProcess, "spawn", () => {
      queueMicrotask(() => stdout.write("PUBLICATION_ROOT_LEASE_READY:1:2\n"));
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    });
    context.mock.method(stdin, "end", (value: string, callback: (error?: Error) => void) => {
      assert.equal(value, "RELEASE\n");
      setImmediate(() => {
        if (scenario === "input-failure") { callback(Object.assign(new Error("denied"), { code: "EPIPE" })); return; }
        if (scenario !== "missing-ack") stdout.write("PUBLICATION_ROOT_LEASE_RELEASED\n");
        if (scenario === "stdin-error") stdin.emit("error", Object.assign(new Error("denied"), { code: "EPIPE" }));
        const code = scenario === "nonzero-exit" ? 1 : scenario === "signal-exit" ? null : 0;
        child.exitCode = code;
        child.emit("exit", code, scenario === "signal-exit" ? "SIGTERM" : null);
        callback(Object.assign(new Error("stream closed after helper exit"), { code: "ERR_STREAM_DESTROYED" }));
        child.emit("close", code, scenario === "signal-exit" ? "SIGTERM" : null);
      });
      return stdin;
    });
    syncBuiltinESMExports();
    try {
      const lease = await createLease(directory);
      assert.equal(await lease.release(), scenario === "ack-before-callback");
      assert.equal(await lease.release(), false);
      assert.equal(killed, scenario === "input-failure" || scenario === "signal-exit");
    } finally {
      mock.mock.restore(); syncBuiltinESMExports();
      stdin.destroy(); stdout.destroy(); stderr.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
