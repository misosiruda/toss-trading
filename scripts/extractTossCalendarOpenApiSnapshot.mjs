import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";

const SOURCE_SHA256 =
  "d29f9079a557c0b6affcec330aa131f93b09fd49932354668e3dc4524cd42180";
const MAX_SOURCE_BYTES = 1_000_000;
const OUTPUT_PATH = "src/replay/officialTossCalendarOpenApi-1.2.14.json";
const CALENDAR_PATHS = [
  "/api/v1/market-calendar/KR",
  "/api/v1/market-calendar/US"
];

const [sourcePath, ...unexpectedArguments] = process.argv.slice(2);
if (sourcePath === undefined || unexpectedArguments.length > 0) {
  throw new Error(
    "usage: node scripts/extractTossCalendarOpenApiSnapshot.mjs <pinned-openapi.json>"
  );
}
const sourceStats = await stat(sourcePath);
if (!sourceStats.isFile() || sourceStats.size > MAX_SOURCE_BYTES) {
  throw new Error(
    "OpenAPI source must be a regular file no larger than 1000000 bytes"
  );
}
const sourceBytes = await readFile(sourcePath);
const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
if (sourceHash !== SOURCE_SHA256) {
  throw new Error("OpenAPI source hash mismatch; refusing to extract");
}

const source = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes));
const snapshot = {
  snapshotSchemaVersion: "official_toss_open_api_calendar_snapshot.v1",
  sourceDocumentSha256: `sha256:${SOURCE_SHA256}`,
  openapi: source.openapi,
  info: { version: source.info?.version },
  servers: source.servers?.map(({ url }) => ({ url })),
  paths: Object.fromEntries(
    CALENDAR_PATHS.map((path) => {
      if (source.paths?.[path] === undefined) {
        throw new Error(`OpenAPI calendar path missing: ${path}`);
      }
      return [path, source.paths[path]];
    })
  )
};

const generatedBytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`);
let existingBytes;
try {
  existingBytes = await readFile(OUTPUT_PATH);
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

if (existingBytes === undefined) {
  await writeFile(OUTPUT_PATH, generatedBytes, { flag: "wx" });
} else if (!existingBytes.equals(generatedBytes)) {
  throw new Error("committed calendar snapshot differs from verified extraction");
}
