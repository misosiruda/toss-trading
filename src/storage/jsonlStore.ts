import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { z } from "zod";

import { parseWithSchema } from "../domain/schemas.js";

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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
