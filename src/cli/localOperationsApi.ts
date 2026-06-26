import "../config/loadEnv.js";

import { startLocalOperationsServer } from "../api/localOperationsServer.js";

const args = process.argv.slice(2);
const dataDir = readArgValue("--data-dir") ?? readFirstPositionalArg() ?? "data/paper";
const host = readArgValue("--host") ?? process.env.OPS_API_HOST ?? "127.0.0.1";
const port = Number(readArgValue("--port") ?? process.env.OPS_API_PORT ?? 8787);

await startLocalOperationsServer({
  storageBaseDir: dataDir,
  host,
  port
});

console.log(`Local operations API listening on http://${host}:${port}`);
console.log(
  `Legacy static dashboard compatibility view available at http://${host}:${port}/dashboard`
);
console.log(
  "Next.js dashboard is the primary operator UI: npm --prefix apps/dashboard run dev"
);
console.log("mode=paper_only read_only=true");

function readArgValue(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return undefined;
  }
  return value;
}

function readFirstPositionalArg(): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === undefined) {
      continue;
    }
    if (value.startsWith("--")) {
      if (args[index + 1] !== undefined && !args[index + 1]!.startsWith("--")) {
        index += 1;
      }
      continue;
    }
    return value;
  }
  return undefined;
}
