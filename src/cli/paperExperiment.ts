import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { writePaperExperimentReview } from "../reports/paperExperimentReviewOutput.js";
import { safePaperExperimentReviewValue } from "../reports/paperExperimentReview.js";
import { PAPER_EXPERIMENT_LIMITS, parsePaperExperimentInput, PaperExperimentValidationError } from "../replay/paperExperimentInput.js";
import { PaperExperimentRuntimeError, verifyPaperExperimentBuild } from "../replay/paperExperimentRuntime.js";
import { PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN } from "../storage/artifactPaths.js";
import { PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH, paperExperimentExecutionFacts, paperExperimentExecutionReceiptSchema } from "../storage/paperExperimentExecutionReceipt.js";
import { assertExperimentPathSyntax, PaperExperimentStorageError, readExperimentFile } from "../storage/paperExperimentFilesystem.js";
import { inspectPaperExperimentAttempt, PaperExperimentPreparationError } from "../storage/paperExperimentStore.js";
import { PaperExperimentExecutionError, runPaperExperimentWorkflow } from "../workflows/paperExperimentWorkflow.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const location = { rootDir: join(repositoryRoot, "data/paper-experiments"),
  protectedPaths: [join(repositoryRoot, "src"), join(repositoryRoot, "data/paper"), join(repositoryRoot, "data/historical")] };
export const PAPER_EXPERIMENT_HELP = "validate|run --input <fixture.json> | inspect|retry --attempt <id> | review --attempt <id> [--compare-attempt <id>]\nFixture only. cancel/resume unsupported; Ctrl+C leaves partial artifacts. retry creates a new attempt.";

export function parsePaperExperimentArguments(args: string[]): { command: "help" } | { command: "run"; input: string } | { command: "validate"; input: string } | { command: "inspect"; attempt: string } | { command: "retry"; attempt: string } | { command: "review"; attempt: string; compareAttempt?: string } {
  if (args.length === 0 || (args.length === 1 && ["help", "--help"].includes(args[0]!))) return { command: "help" as const };
  const [command, flag, value] = args;
  if (command === "review" && flag === "--attempt" && value && PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN.test(value)) {
    if (args.length === 3) return { command, attempt: value };
    if (args.length === 5 && args[3] === "--compare-attempt" && PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN.test(args[4]!)) {
      return { command, attempt: value, compareAttempt: args[4]! };
    }
  }
  if (args.length !== 3 || !value || value.startsWith("-")) throw new PaperExperimentStorageError("INVALID_REQUEST");
  if ((command === "run" || command === "validate") && flag === "--input") return { command, input: value };
  if ((command === "inspect" || command === "retry") && flag === "--attempt" && PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN.test(value)) return { command, attempt: value };
  throw new PaperExperimentStorageError("INVALID_REQUEST");
}

/** No loadEnv, AI config, broker, HTTP or raw process surface is imported by this entry point. */
export async function paperExperimentMain(args: string[]): Promise<number> {
  const output = (value: unknown) => console.log(JSON.stringify(value));
  try {
    const parsed = parsePaperExperimentArguments(args);
    if (parsed.command === "help") { console.log(PAPER_EXPERIMENT_HELP); return 0; }
    if (parsed.command === "review") {
      const result = await writePaperExperimentReview(location, parsed.attempt, parsed.compareAttempt);
      output(safePaperExperimentReviewValue({ attemptId: parsed.attempt, ...result }));
      return result.review.execution.integrity === "verified"
        && (!result.review.comparison || result.review.comparison.status === "identical") ? 0 : 1;
    }
    if (parsed.command === "inspect") {
      const inspection = await inspectPaperExperimentAttempt(location, parsed.attempt);
      if (inspection.status !== "completed" || !inspection.state?.executionReceiptRequired) {
        output({ attemptId: parsed.attempt, status: inspection.status === "completed" ? "incomplete" : inspection.status,
          storedStatus: inspection.storedStatus, errorCode: inspection.errorCode
            ?? (inspection.status === "completed" ? "EXECUTION_RECEIPT_REQUIRED" : null),
          terminationReason: inspection.state?.terminationReason ?? null });
        return 1;
      }
      const artifactRoot = join(location.rootDir, parsed.attempt);
      const receipt = paperExperimentExecutionReceiptSchema.parse(JSON.parse(await readExperimentFile(
        join(artifactRoot, PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH), 16 * 1024 * 1024)));
      const facts = paperExperimentExecutionFacts(receipt);
      output({ status: "completed", storedStatus: inspection.storedStatus, attemptId: parsed.attempt, artifactRoot,
        inputHash: inspection.state.inputHash, runtimeIdentity: inspection.state.runtimeIdentity,
        quality: facts.providerFailureCount > 0 ? "provider_failure"
          : inspection.input?.preflight.status === "insufficient_data" ? "insufficient_data" : "usable_fixture", ...facts });
      return 0;
    }
    const runtimeIdentity = await verifyPaperExperimentBuild(repositoryRoot);
    const createdAt = new Date();
    const onPrepared = (attempt: { attemptId: string; artifactRoot: string }) => output({ event: "attempt_prepared", ...attempt,
      notice: "cancel/resume unsupported; Ctrl+C leaves partial artifacts; retry creates a new attempt" });
    if (parsed.command === "retry") {
      const result = await runPaperExperimentWorkflow({ ...location, runtimeIdentity, createdAt, parentAttemptId: parsed.attempt }, { onPrepared });
      output({ status: result.status, attemptId: result.attemptId, artifactRoot: result.artifactRoot, inputHash: result.inputHash });
      return 0;
    }
    assertExperimentPathSyntax(parsed.input);
    const sourcePath = resolve(parsed.input);
    const inputJson = await readExperimentFile(sourcePath, PAPER_EXPERIMENT_LIMITS.inputBytes, "INPUT_INTEGRITY");
    const input = parsePaperExperimentInput(inputJson, { implementationRevision: runtimeIdentity.implementationRevision });
    if (parsed.command === "validate") {
      output({ status: "valid", inputHash: input.inputHash, runtimeIdentity, preflight: input.preflight,
        provider: input.normalizedInput.provider, primaryBenchmark: input.normalizedInput.evaluation.primaryBenchmark }); return 0;
    }
    const result = await runPaperExperimentWorkflow({ ...location, protectedPaths: [...location.protectedPaths, sourcePath],
      inputJson, runtimeIdentity, createdAt }, { onPrepared });
    output({ status: result.status, attemptId: result.attemptId, artifactRoot: result.artifactRoot, inputHash: result.inputHash });
    return 0;
  } catch (error) {
    if (error instanceof PaperExperimentExecutionError || error instanceof PaperExperimentPreparationError) {
      output({ error: error.code, stage: error instanceof PaperExperimentPreparationError ? "preparation" : "execution",
        attemptId: error.attemptId, artifactRoot: error.artifactRoot, failureRecorded: error.failureRecorded });
    } else if (error instanceof PaperExperimentValidationError || error instanceof PaperExperimentRuntimeError || error instanceof PaperExperimentStorageError) {
      output({ error: error.code });
    } else output({ error: "IO_OR_ARTIFACT_FAILURE" });
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await paperExperimentMain(process.argv.slice(2));
}
