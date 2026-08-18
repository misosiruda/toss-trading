import { runTossOpenApiCredentialReadinessPreflight } from "../broker/tossOpenApiCredentialReadinessPreflight.js";

if (process.argv.length !== 2) {
  console.error("Toss Open API credential preflight accepts no arguments.");
  process.exitCode = 64;
} else {
  const result = await runTossOpenApiCredentialReadinessPreflight();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode =
    result.status === "ready_for_external_verification" ? 0 : 2;
}
