import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const BUCKET_VALUATION_APPLICATION_TRANSACTION_FILE_NAME =
  ".bucket-valuation-application-transaction.json";

export function createBucketValuationApplicationTransactionPath(
  baseDir: string
): string {
  return join(baseDir, BUCKET_VALUATION_APPLICATION_TRANSACTION_FILE_NAME);
}

/** Prevents single-repository readers from exposing a partial aggregate commit. */
export async function assertNoPendingBucketValuationApplicationTransaction(
  transactionPath: string
): Promise<void> {
  try {
    await readFile(transactionPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(
    "bucket valuation application transaction requires aggregate recovery"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
