// Test-only file observations; neither an executable-memory attestation nor a sandbox.
import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";

export const EXECUTABLE_FILE_LIMIT = 128 * 1024 * 1024;
export class ExecutableFileObservationError extends Error {
  constructor(readonly reason: "FILE_UNSAFE" | "FILE_LIMIT" | "FILE_CHANGED" | "FILE_READ_FAILED") {
    super(reason);
  }
}
export interface ExecutableFileSnapshot {
  digest: string;
  bytes: number;
  dev: number;
  ino: number;
  links: number;
}
const fail = (reason: ExecutableFileObservationError["reason"]): never => {
  throw new ExecutableFileObservationError(reason);
};

/** The caller owns and closes the descriptor. The offset never depends on its shared cursor. */
export async function hashOpenedExecutableFileForTest(handle: FileHandle): Promise<ExecutableFileSnapshot> {
  try {
    const before = await handle.stat();
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 0) fail("FILE_UNSAFE");
    if (before.size > EXECUTABLE_FILE_LIMIT) fail("FILE_LIMIT");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0;
    while (bytes <= EXECUTABLE_FILE_LIMIT) {
      const size = Math.min(buffer.length, EXECUTABLE_FILE_LIMIT + 1 - bytes);
      const part = await handle.read(buffer, 0, size, bytes);
      if (part.bytesRead === 0) break;
      bytes += part.bytesRead;
      if (bytes > EXECUTABLE_FILE_LIMIT) fail("FILE_LIMIT");
      hash.update(buffer.subarray(0, part.bytesRead));
    }
    const after = await handle.stat();
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== bytes || after.size !== bytes || before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs || before.nlink !== after.nlink) fail("FILE_CHANGED");
    return { digest: "sha256:" + hash.digest("hex"), bytes, dev: after.dev, ino: after.ino, links: after.nlink };
  } catch (error) {
    if (error instanceof ExecutableFileObservationError) throw error;
    throw new ExecutableFileObservationError("FILE_READ_FAILED");
  }
}

/** Only the literal self-executable proc link has the intentional symlink exception. */
export async function readExecutableFileForTest(path: string): Promise<ExecutableFileSnapshot> {
  let handle: FileHandle | undefined;
  try {
    const proc = path === "/proc/self/exe";
    const before = proc ? null : await lstat(path);
    if (before !== null && (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)) fail("FILE_UNSAFE");
    handle = await open(path, constants.O_RDONLY | (proc ? 0 : constants.O_NOFOLLOW));
    const result = await hashOpenedExecutableFileForTest(handle);
    if (before !== null) {
      const after = await lstat(path);
      if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || result.links !== 1 ||
        result.dev !== before.dev || result.ino !== before.ino || after.dev !== result.dev ||
        after.ino !== result.ino || before.size !== result.bytes || after.size !== result.bytes ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail("FILE_CHANGED");
    }
    return result;
  } catch (error) {
    if (error instanceof ExecutableFileObservationError) throw error;
    throw new ExecutableFileObservationError("FILE_READ_FAILED");
  } finally {
    if (handle !== undefined) {
      try { await handle.close(); } catch { throw new ExecutableFileObservationError("FILE_READ_FAILED"); }
    }
  }
}
