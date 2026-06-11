import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { z } from "zod";

import { parseWithSchema } from "../domain/schemas.js";

export class JsonFileStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly schema: z.ZodType<T>,
    private readonly label: string
  ) {}

  async read(): Promise<T | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return parseWithSchema(this.schema, JSON.parse(raw), this.label);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async write(value: T): Promise<void> {
    const parsed = parseWithSchema(this.schema, value, this.label);
    await mkdir(dirname(this.filePath), { recursive: true });

    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
