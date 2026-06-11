import "../config/loadEnv.js";

import { startLocalOperationsServer } from "../api/localOperationsServer.js";

const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const dataDir = readArgValue("--data-dir") ?? positionalArgs[0] ?? "data/paper";
const host = readArgValue("--host") ?? process.env.OPS_API_HOST ?? "127.0.0.1";
const port = Number(readArgValue("--port") ?? process.env.OPS_API_PORT ?? 8787);

await startLocalOperationsServer({
  storageBaseDir: dataDir,
  host,
  port
});

console.log(`Local operations API listening on http://${host}:${port}`);
console.log(`Paper dashboard available at http://${host}:${port}/dashboard`);
console.log("mode=paper_only read_only=true");

function readArgValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}
