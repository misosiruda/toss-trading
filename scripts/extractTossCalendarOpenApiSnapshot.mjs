import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const SOURCE_URL =
  "https://openapi.tossinvest.com/openapi-docs/latest/openapi.json";
const SOURCE_SHA256 =
  "d29f9079a557c0b6affcec330aa131f93b09fd49932354668e3dc4524cd42180";
const OUTPUT_PATH = "src/replay/officialTossCalendarOpenApi-1.2.14.json";
const CALENDAR_PATHS = [
  "/api/v1/market-calendar/KR",
  "/api/v1/market-calendar/US"
];

const response = await fetch(SOURCE_URL, { redirect: "error" });
if (!response.ok) {
  throw new Error(`OpenAPI fetch failed with status ${response.status}`);
}
const sourceBytes = new Uint8Array(await response.arrayBuffer());
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

await writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, {
  flag: "wx"
});
