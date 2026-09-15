import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { z } from "zod";

import { parseWithSchema } from "../domain/schemas.js";
import { withPaperExecutionLogAppend } from "./paperExecutionLogLocks.js";

export interface JsonlReadResult<T> {
  records: T[];
  corruptLineCount: number;
}

export class JsonlStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly schema: z.ZodType<T>,
    private readonly label: string
  ) {}

  async append(value: T): Promise<void> {
    const parsed = parseWithSchema(this.schema, value, this.label);
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(parsed)}\n`, "utf8");
  }

  /** Serialize cooperating writers and await write/fsync/close plus parent directory sync.
   * Joins a held paper batch when present. Failed bytes/lock remain for explicit recovery.
   * Not an atomic read snapshot, commit receipt or rollback protocol.
   */
  async appendDurably(value: T): Promise<void> {
    const parsed = parseWithSchema(this.schema, value, this.label);
    const line = `${JSON.stringify(parsed)}\n`;
    await withPaperExecutionLogAppend(this.filePath, async () => {
      const handle = await open(this.filePath, "a");
      try { await handle.writeFile(line, "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      await syncDirectory(dirname(this.filePath));
    });
  }

  async readAll(): Promise<JsonlReadResult<T>> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { records: [], corruptLineCount: 0 };
      }

      throw error;
    }

    const records: T[] = [];
    let corruptLineCount = 0;

    for (const line of raw.split(/\r?\n/)) {
      if (line.trim().length === 0) {
        continue;
      }

      try {
        records.push(parseWithSchema(this.schema, JSON.parse(line), this.label));
      } catch {
        corruptLineCount += 1;
      }
    }

    return { records, corruptLineCount };
  }
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); }
  catch (error) { if (unsupportedDirectorySync(error)) return; throw error; }
  try { await handle.sync(); }
  catch (error) { if (!unsupportedDirectorySync(error)) throw error; }
  finally { await handle.close(); }
}
function unsupportedDirectorySync(error: unknown): boolean {
  return process.platform === "win32" && isNodeError(error) && error.code === "EPERM";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
