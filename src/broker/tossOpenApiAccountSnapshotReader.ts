import { maskObject } from "../security/masking.js";
import type {
  TossOpenApiReadOnlyQueryValue,
  TossOpenApiReadOnlyRequestInput
} from "./tossOpenApiReadOnlyHttpClient.js";

export type TossOpenApiAccountSnapshotStatus = "ok" | "degraded";

export type TossOpenApiAccountSnapshotReaderErrorCode =
  | "TOSS_OPEN_API_ACCOUNT_READER_INVALID_ACCOUNT_SEQ"
  | "TOSS_OPEN_API_ACCOUNT_READER_INVALID_SYMBOL"
  | "TOSS_OPEN_API_ACCOUNT_READER_INVALID_RESPONSE";

export interface TossOpenApiAccountReadOnlyClientOptions {
  query?: TossOpenApiReadOnlyRequestInput["query"];
  accountSeq?: number;
}

export interface TossOpenApiAccountReadOnlyJsonClient {
  getJson(
    path: string,
    options?: TossOpenApiAccountReadOnlyClientOptions
  ): Promise<unknown>;
}

export interface TossOpenApiMaskedAccountSummary {
  accountRef: string;
  accountNoMasked?: "****";
  accountSeqMasked?: "****";
  accountType?: string;
}

export interface TossOpenApiHoldingsSnapshot {
  accountSeqMasked: "****";
  holdings: unknown;
  itemCount?: number;
  symbol?: string;
}

export interface TossOpenApiAccountSourceStatus {
  status: TossOpenApiAccountSnapshotStatus;
  accountCount: number;
  holdingsStatus: "ok" | "skipped";
  warnings: string[];
}

export interface TossOpenApiAccountSnapshot {
  status: TossOpenApiAccountSnapshotStatus;
  accounts: TossOpenApiMaskedAccountSummary[];
  sourceStatus: TossOpenApiAccountSourceStatus;
  holdings?: TossOpenApiHoldingsSnapshot;
}

export interface TossOpenApiAccountSnapshotInput {
  accountSeq?: number;
  symbol?: string;
}

export class TossOpenApiAccountSnapshotReaderError extends Error {
  constructor(
    readonly code: TossOpenApiAccountSnapshotReaderErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TossOpenApiAccountSnapshotReaderError";
  }
}

export class TossOpenApiAccountSnapshotReader {
  constructor(private readonly client: TossOpenApiAccountReadOnlyJsonClient) {}

  async readSnapshot(
    input: TossOpenApiAccountSnapshotInput = {}
  ): Promise<TossOpenApiAccountSnapshot> {
    const accountSeq = normalizeOptionalAccountSeq(input.accountSeq);
    const symbol = normalizeOptionalSymbol(input.symbol);
    const accounts = await this.readAccounts();

    if (accountSeq === undefined) {
      return {
        status: "degraded",
        accounts,
        sourceStatus: {
          status: "degraded",
          accountCount: accounts.length,
          holdingsStatus: "skipped",
          warnings: [
            "holdings skipped: accountSeq is required for GET /api/v1/holdings"
          ]
        }
      };
    }

    const holdings = await this.readHoldings({ accountSeq, symbol });
    return {
      status: "ok",
      accounts,
      holdings,
      sourceStatus: {
        status: "ok",
        accountCount: accounts.length,
        holdingsStatus: "ok",
        warnings: []
      }
    };
  }

  private async readAccounts(): Promise<TossOpenApiMaskedAccountSummary[]> {
    const body = await this.client.getJson("/api/v1/accounts");
    const result = readResult(body);
    if (!Array.isArray(result)) {
      throwInvalidResponse();
    }

    return result.map(toMaskedAccountSummary);
  }

  private async readHoldings(input: {
    accountSeq: number;
    symbol: string | undefined;
  }): Promise<TossOpenApiHoldingsSnapshot> {
    const query = buildHoldingsQuery(input.symbol);
    const body = await this.client.getJson("/api/v1/holdings", {
      accountSeq: input.accountSeq,
      ...(query === undefined ? {} : { query })
    });
    const result = readResult(body);
    const maskedResult = maskObject(result);
    const itemCount = readHoldingsItemCount(maskedResult);

    return {
      accountSeqMasked: "****",
      holdings: maskedResult,
      ...(itemCount === undefined ? {} : { itemCount }),
      ...(input.symbol === undefined ? {} : { symbol: input.symbol })
    };
  }
}

function buildHoldingsQuery(
  symbol: string | undefined
): ReadonlyArray<readonly [string, TossOpenApiReadOnlyQueryValue]> | undefined {
  if (symbol === undefined) {
    return undefined;
  }

  return [["symbol", symbol]];
}

function normalizeOptionalAccountSeq(
  accountSeq: number | undefined
): number | undefined {
  if (accountSeq === undefined) {
    return undefined;
  }
  if (!Number.isInteger(accountSeq) || accountSeq <= 0) {
    throw new TossOpenApiAccountSnapshotReaderError(
      "TOSS_OPEN_API_ACCOUNT_READER_INVALID_ACCOUNT_SEQ",
      "Toss Open API accountSeq must be a positive integer."
    );
  }

  return accountSeq;
}

function normalizeOptionalSymbol(symbol: string | undefined): string | undefined {
  const normalized = symbol?.trim().toUpperCase();
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }
  if (!/^[A-Z0-9.-]+$/.test(normalized)) {
    throw new TossOpenApiAccountSnapshotReaderError(
      "TOSS_OPEN_API_ACCOUNT_READER_INVALID_SYMBOL",
      "Toss Open API holdings symbol must contain only letters, numbers, dot, or dash."
    );
  }

  return normalized;
}

function readResult(body: unknown): unknown {
  if (!isRecord(body) || !("result" in body)) {
    throwInvalidResponse();
  }

  return body.result;
}

function toMaskedAccountSummary(
  account: unknown,
  index: number
): TossOpenApiMaskedAccountSummary {
  if (!isRecord(account)) {
    throwInvalidResponse();
  }

  const summary: TossOpenApiMaskedAccountSummary = {
    accountRef: `account:${index + 1}`
  };
  if (account.accountNo !== undefined) {
    summary.accountNoMasked = "****";
  }
  if (account.accountSeq !== undefined) {
    summary.accountSeqMasked = "****";
  }
  if (typeof account.accountType === "string") {
    summary.accountType = account.accountType;
  }

  return summary;
}

function readHoldingsItemCount(holdings: unknown): number | undefined {
  if (!isRecord(holdings)) {
    throwInvalidResponse();
  }

  const items = holdings.items;
  if (items === undefined) {
    return undefined;
  }
  if (!Array.isArray(items)) {
    throwInvalidResponse();
  }

  return items.length;
}

function throwInvalidResponse(): never {
  throw new TossOpenApiAccountSnapshotReaderError(
    "TOSS_OPEN_API_ACCOUNT_READER_INVALID_RESPONSE",
    "Toss Open API account snapshot response is invalid."
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
