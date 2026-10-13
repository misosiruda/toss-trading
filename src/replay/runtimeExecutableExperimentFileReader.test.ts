import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, open, rm, symlink, link, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EXECUTABLE_FILE_LIMIT, readExecutableFileForTest, hashOpenedExecutableFileForTest,
} from "./runtimeExecutableExperimentFileReaderTestFixtures.js";
test("executable bounded reader hashes the observed bytes and preserves a held descriptor cursor", { skip: process.platform !== "linux" ? "Linux file observation contract" : false }, async () => {
  const root = await mkdtemp(join(tmpdir(), "executable-reader-"));
  try {
    const path = join(root, "fixture");
    await writeFile(path, "synthetic-observation");
    const value = await readExecutableFileForTest(path);
    assert.equal(value.digest, "sha256:" + createHash("sha256").update("synthetic-observation").digest("hex"));
    assert.equal(value.bytes, 21);
    const handle = await open(path, "r");
    try {
      await handle.read(Buffer.alloc(5), 0, 5, null);
      assert.deepEqual(await hashOpenedExecutableFileForTest(handle), value);
      const next = Buffer.alloc(1); await handle.read(next, 0, 1, null);
      assert.equal(next.toString(), "e");
    } finally { await handle.close(); }
  } finally { await rm(root, { recursive: true, force: false }); }
});
test("executable bounded reader rejects directories, symlinks and hardlinked normal paths", { skip: process.platform !== "linux" ? "Linux file observation contract" : false }, async () => {
  const root = await mkdtemp(join(tmpdir(), "executable-reader-"));
  try {
    const file = join(root, "file"); await writeFile(file, "fixture");
    await assert.rejects(readExecutableFileForTest(root), { message: "FILE_UNSAFE" });
    await symlink(file, join(root, "link"));
    await assert.rejects(readExecutableFileForTest(join(root, "link")), { message: "FILE_UNSAFE" });
    await link(file, join(root, "hard"));
    await assert.rejects(readExecutableFileForTest(file), { message: "FILE_UNSAFE" });
    await assert.rejects(readExecutableFileForTest(join(root, "hard")), { message: "FILE_UNSAFE" });
    await assert.rejects(readExecutableFileForTest(join(root, "missing")), { message: "FILE_READ_FAILED" });
  } finally { await rm(root, { recursive: true, force: false }); }
});
test("executable reader accepts exactly 128 MiB and rejects one byte above before reading", { skip: process.platform !== "linux" ? "Linux file observation contract" : false }, async () => {
  const root = await mkdtemp(join(tmpdir(), "executable-reader-"));
  try {
    const file = join(root, "sparse"); const handle = await open(file, "wx");
    await handle.truncate(EXECUTABLE_FILE_LIMIT); await handle.close();
    const observed = await readExecutableFileForTest(file);
    assert.equal(observed.bytes, 134217728);
    const expected = createHash("sha256"), zero = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < 128; i++) expected.update(zero);
    assert.equal(observed.digest, "sha256:" + expected.digest("hex"));
    const bigger = await open(file, "r+"); await bigger.truncate(EXECUTABLE_FILE_LIMIT + 1); await bigger.close();
    await assert.rejects(readExecutableFileForTest(file), { message: "FILE_LIMIT" });
  } finally { await rm(root, { recursive: true, force: false }); }
});
test("executable descriptor reader rejects mutation, overflow and I/O faults in deterministic unit seams", async () => {
  const root = await mkdtemp(join(tmpdir(), "executable-reader-"));
  try {
    const path = join(root, "base"); await writeFile(path, "x"); const base = await stat(path);
    for (const mode of ["changed", "limit", "io"] as const) {
      let stats = 0, reads = 0;
      const fake = {
        stat: async () => { stats++; return { ...base, isFile: () => true,
          size: mode === "limit" ? EXECUTABLE_FILE_LIMIT + 1 : 1,
          mtimeMs: base.mtimeMs + (mode === "changed" && stats > 1 ? 1 : 0) }; },
        read: async (buffer: Buffer) => { reads++; if (mode === "io") throw new Error("PRIVATE_PATH");
          if (reads > 1) return { bytesRead: 0 }; buffer[0] = 120; return { bytesRead: 1 }; },
      } as unknown as Parameters<typeof hashOpenedExecutableFileForTest>[0];
      await assert.rejects(hashOpenedExecutableFileForTest(fake),
        { message: mode === "changed" ? "FILE_CHANGED" : mode === "limit" ? "FILE_LIMIT" : "FILE_READ_FAILED" });
      if (mode === "limit") assert.equal(reads, 0);
    }
  } finally { await rm(root, { recursive: true, force: false }); }
});
