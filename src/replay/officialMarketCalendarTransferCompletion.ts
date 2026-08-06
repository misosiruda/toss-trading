import { z } from "zod";

import { officialMarketCalendarHttpProtocolVersionSchema } from "./officialMarketCalendarHttpProtocolVersion.js";

const transferFramingSchema = z.enum([
  "content_length",
  "chunked",
  "stream_end"
]);
const contentLengthSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const transferCompletionSchema = z
  .object({
    httpProtocolVersion: officialMarketCalendarHttpProtocolVersionSchema,
    transferFraming: transferFramingSchema,
    transferCompleted: z.boolean(),
    declaredContentLength: contentLengthSchema.nullable(),
    contentLength: contentLengthSchema
  })
  .strict();

export type OfficialMarketCalendarTransferCompletion = z.infer<
  typeof transferCompletionSchema
>;

export function verifyOfficialMarketCalendarTransferCompletion(
  value: unknown
): OfficialMarketCalendarTransferCompletion {
  const completion = transferCompletionSchema.parse(value);
  if (!isAllowedProtocolFraming(completion)) {
    throw new Error(
      "official calendar transfer protocol and framing combination is invalid"
    );
  }
  if (!completion.transferCompleted) {
    throw new Error("official calendar transfer must be complete");
  }
  if (
    completion.transferFraming === "content_length" &&
    completion.declaredContentLength === null
  ) {
    throw new Error(
      "official calendar content-length framing requires declared length"
    );
  }
  if (
    completion.declaredContentLength !== null &&
    completion.declaredContentLength !== completion.contentLength
  ) {
    throw new Error(
      "official calendar declared and stored content length must match"
    );
  }
  return completion;
}

function isAllowedProtocolFraming(
  value: OfficialMarketCalendarTransferCompletion
): boolean {
  switch (value.httpProtocolVersion) {
    case "http_1_0":
      return value.transferFraming === "content_length";
    case "http_1_1":
      return (
        value.transferFraming === "content_length" ||
        value.transferFraming === "chunked"
      );
    case "http_2":
    case "http_3":
      return value.transferFraming === "stream_end";
  }
}
