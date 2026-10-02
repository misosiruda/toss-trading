import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN } from "../storage/artifactPaths.js";
import { assertExperimentPath, assertExperimentPathSyntax, ensureExperimentDirectory, requireExperimentStorage,
  storageError, writeExclusiveExperimentFile } from "../storage/paperExperimentFilesystem.js";
import { inspectPaperExperimentAttempt, type PaperExperimentStoreLocation } from "../storage/paperExperimentStore.js";
import { createPaperExperimentReview, renderPaperExperimentReviewMarkdown, safePaperExperimentReviewValue } from "./paperExperimentReview.js";

/** New generation only; no source/replay writes, deletion, replacement, repair, or existing output overwrite. */
export async function writePaperExperimentReview(location: PaperExperimentStoreLocation, attemptId: string,
  compareAttemptId?: string) {
  try {
    assertExperimentPathSyntax(location.rootDir);
    requireExperimentStorage(PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN.test(attemptId)
      && (compareAttemptId === undefined || PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN.test(compareAttemptId)), "INVALID_REQUEST");
    const inspection = await inspectPaperExperimentAttempt(location, attemptId);
    requireExperimentStorage(!["PATH_UNSAFE", "PATH_OVERLAP", "INVALID_REQUEST"].includes(inspection.errorCode ?? ""), "PATH_UNSAFE");
    const attemptDir = join(location.rootDir, attemptId);
    await assertExperimentPath(attemptDir);
    requireExperimentStorage((await lstat(attemptDir)).isDirectory(), "PATH_UNSAFE");
    const review = safePaperExperimentReviewValue(await createPaperExperimentReview(location, attemptId,
      compareAttemptId === undefined ? undefined : { location, attemptId: compareAttemptId }));
    const directory = join(attemptDir, "review");
    await ensureExperimentDirectory(directory);
    const reviewId = `review-${randomUUID()}`;
    const generation = join(directory, reviewId);
    await mkdir(generation); // Exclusive generation; collisions fail, never reuse.
    const json = `${JSON.stringify(review, null, 2)}\n`;
    const markdown = renderPaperExperimentReviewMarkdown(review);
    async function publish(name: string, text: string) {
      const temporary = join(generation, `${name}.tmp`);
      await writeExclusiveExperimentFile(temporary, text);
      await assertExperimentPath(generation);
      // Both names live in a freshly allocated, backend-owned directory. Failed temps are retained.
      await rename(temporary, join(generation, name));
    }
    await publish("review.json", json);
    await publish("review.md", markdown);
    const marker = safePaperExperimentReviewValue({ schemaVersion: "paper_experiment_review_output.v1",
      reviewId, attemptId, files: ["review.json", "review.md"],
      jsonDigest: createReplayResearchHash(review), markdownDigest: createReplayResearchHash(markdown) });
    await publish("review-complete.json", JSON.stringify(marker) + "\n");
    return safePaperExperimentReviewValue({ review, reviewId, files: { json: `review/${reviewId}/review.json`, markdown: `review/${reviewId}/review.md`,
      completion: `review/${reviewId}/review-complete.json` } });
  } catch (error) { throw storageError(error); }
}
