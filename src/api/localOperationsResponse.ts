import type { ServerResponse } from "node:http";

import { maskObject } from "../security/masking.js";

export function writeJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
  headOnly = false
): void {
  const body = JSON.stringify(maskObject(value), null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(headOnly ? undefined : `${body}\n`);
}
