import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256HashSchema } from "../domain/schemas.js";
import { verifyPreparedPaperApplication, type PreparedPaperApplication } from "../paper/preparedApplication.js";

export function preparedPaperApplicationPath(portfolioPath: string, applicationHash: string): string {
  return join(`${portfolioPath}.applications`, `${sha256HashSchema.parse(applicationHash).slice(7)}.json`);
}

/** Caller holds the portfolio lock. Never overwrite or silently reuse an existing intent. */
export async function writePreparedPaperApplication(portfolioPath: string, value: PreparedPaperApplication): Promise<void> {
  const record = verifyPreparedPaperApplication(value);
  const path = preparedPaperApplicationPath(portfolioPath, record.applicationHash);
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx");
  try { await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  await syncDirectory(dirname(path));
  await syncDirectory(dirname(dirname(path)));
}

/** Also usable for offline inspection of an intent behind a failed portfolio lock. Not a commit receipt. */
export async function readPreparedPaperApplication(portfolioPath: string, applicationHash: string): Promise<PreparedPaperApplication> {
  const bytes = await readFile(preparedPaperApplicationPath(portfolioPath, applicationHash));
  const raw = bytes.toString("utf8");
  if (!bytes.equals(Buffer.from(raw, "utf8"))) throw new Error("prepared paper application is not valid UTF-8");
  const record = verifyPreparedPaperApplication(JSON.parse(raw));
  if (raw !== `${JSON.stringify(record)}\n` || record.applicationHash !== applicationHash) {
    throw new Error("prepared paper application canonical bytes or path hash mismatch");
  }
  return record;
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); }
  catch (error) { if (unsupported(error)) return; throw error; }
  try { await handle.sync(); } catch (error) { if (!unsupported(error)) throw error; }
  finally { await handle.close(); }
}
function unsupported(error: unknown) {
  return process.platform === "win32" && error instanceof Error && "code" in error && error.code === "EPERM";
}
