import { z } from "zod";

const headerValueSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    (value) => /^[\x21-\x7e]+$/.test(value),
    "response representation header value must use visible ASCII without whitespace"
  );
const contentEncodingSchema = z.enum(["gzip", "deflate", "br"]);
const contentTypeSchema = z
  .string()
  .regex(
    /^[!#$%&'*+.^_`|~0-9a-z-]+\/[!#$%&'*+.^_`|~0-9a-z-]+$/,
    "content type must use canonical lowercase media type grammar"
  );
const responseRepresentationHeadersInputSchema = z
  .object({
    contentTypeHeaderValues: z.array(headerValueSchema),
    contentEncodingHeaderValues: z.array(headerValueSchema)
  })
  .strict();

export const officialMarketCalendarResponseRepresentationHeadersSchema =
  responseRepresentationHeadersInputSchema
    .safeExtend({
      contentType: contentTypeSchema,
      contentEncoding: contentEncodingSchema.nullable()
    })
    .strict();

export type OfficialMarketCalendarResponseRepresentationHeaders = z.infer<
  typeof officialMarketCalendarResponseRepresentationHeadersSchema
>;

export function parseOfficialMarketCalendarResponseRepresentationHeaders(
  value: unknown
): OfficialMarketCalendarResponseRepresentationHeaders {
  const input = responseRepresentationHeadersInputSchema.parse(value);
  if (input.contentTypeHeaderValues.length !== 1) {
    throw new Error(
      "official calendar response must contain exactly one Content-Type"
    );
  }
  const rawContentType = input.contentTypeHeaderValues[0]!;
  if (
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(
      rawContentType
    )
  ) {
    throw new Error(
      "official calendar response Content-Type must be a single parameter-free media type"
    );
  }
  if (input.contentEncodingHeaderValues.length > 1) {
    throw new Error(
      "official calendar response must not contain duplicate Content-Encoding"
    );
  }
  const rawContentEncoding = input.contentEncodingHeaderValues[0];
  const contentEncoding =
    rawContentEncoding === undefined
      ? null
      : contentEncodingSchema.parse(rawContentEncoding.toLowerCase());
  return officialMarketCalendarResponseRepresentationHeadersSchema.parse({
    ...input,
    contentType: rawContentType.toLowerCase(),
    contentEncoding
  });
}
