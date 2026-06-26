import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(scriptDir, "../..");
const dataDir = resolve(dashboardRoot, ".e2e-data", "paper");

await rm(dataDir, { force: true, recursive: true });
await mkdir(dataDir, { recursive: true });
