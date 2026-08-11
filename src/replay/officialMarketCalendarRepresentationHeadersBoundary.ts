import { z } from "zod";

import {
  verifyOfficialMarketCalendarCanonicalJsonObject
} from "./officialMarketCalendarCanonicalJsonObject.js";

const lowercaseHeaderNameSchema = z
  .string()
  .regex(
    /^[!#$%&'*+\-.^_`|~0-9a-z]+$/,
    "representation header name must be a lowercase HTTP field name"
  );
const MAX_REPRESENTATION_HEADER_VALUE_LENGTH = 8_192;
const representationHeaderValueSchema = z
  .string()
  .max(
    MAX_REPRESENTATION_HEADER_VALUE_LENGTH,
    "representation header value must not exceed 8192 characters"
  )
  .regex(
    /^(?:|[\x21-\x7e](?:[\x09\x20-\x7e]*[\x21-\x7e])?)$/,
    "representation header value must use canonical safe ASCII HTTP field-value characters"
  );
const httpToken = "[!#$%&'*+\\-.^_`|~0-9A-Za-z]+";
const mediaTypeToken = "[!#$%&'+\\-.^_`|~0-9A-Za-z]+";
const mediaRange = `(?:\\*/\\*|${mediaTypeToken}/(?:\\*|${mediaTypeToken}))`;
const quotedString = '"(?:[\\x09\\x20-\\x21\\x23-\\x5b\\x5d-\\x7e]|\\\\[\\x09\\x20-\\x7e])*"';
const qValue = "(?:0(?:\\.[0-9]{0,3})?|1(?:\\.0{0,3})?)";
const nonWeightParameter = `;[\\t ]*(?![qQ]=)${httpToken}=(?:${httpToken}|${quotedString})`;
const weightParameter = `;[\\t ]*[qQ]=${qValue}`;
const mediaRangeWithParameters = `${mediaRange}(?:[\\t ]*${nonWeightParameter})*(?:[\\t ]*${weightParameter})?`;
const acceptHeaderValuePattern = new RegExp(
  `^${mediaRangeWithParameters}(?:[\\t ]*,[\\t ]*${mediaRangeWithParameters})*$`
);
const languageRange = "(?:\\*|[A-Za-z]{1,8}(?:-[0-9A-Za-z]{1,8})*)";
const languageRangeWithWeight = `${languageRange}(?:[\\t ]*${weightParameter})?`;
const acceptLanguageHeaderValuePattern = new RegExp(
  `^${languageRangeWithWeight}(?:[\\t ]*,[\\t ]*${languageRangeWithWeight})*$`
);

function hasDuplicateAcceptParameterName(value: string): boolean {
  let quoted = false;
  let escaped = false;
  let segmentStart = 0;
  let parameterNames = new Set<string>();

  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (character === ";" || character === "," || character === undefined)) {
      if (segmentStart > 0) {
        const parameterName = value
          .slice(segmentStart, index)
          .trimStart()
          .split("=", 1)[0]
          ?.toLowerCase();
        if (parameterName !== undefined && parameterNames.has(parameterName)) {
          return true;
        }
        if (parameterName !== undefined) {
          parameterNames.add(parameterName);
        }
      }
      if (character === ",") {
        parameterNames = new Set<string>();
        segmentStart = 0;
      } else {
        segmentStart = index + 1;
      }
    }
  }
  return false;
}

function hasDuplicateAcceptLanguageRange(value: string): boolean {
  const ranges = new Set<string>();
  for (const entry of value.split(",")) {
    const range = entry.split(";", 1)[0]?.trim().toLowerCase();
    if (range !== undefined && ranges.has(range)) {
      return true;
    }
    if (range !== undefined) {
      ranges.add(range);
    }
  }
  return false;
}

const effectiveRequestRepresentationHeadersSchema = z
  .object({
    representationHeaders: z.record(
      lowercaseHeaderNameSchema,
      representationHeaderValueSchema
    )
  })
  .strict();

const representationHeadersBoundarySchema = z
  .object({
    effectiveRequests: z
      .array(effectiveRequestRepresentationHeadersSchema)
      .min(1)
  })
  .strict();

export type OfficialMarketCalendarRepresentationHeadersBoundary = z.infer<
  typeof representationHeadersBoundarySchema
>;

export function verifyOfficialMarketCalendarRepresentationHeadersBoundary(
  value: unknown
): OfficialMarketCalendarRepresentationHeadersBoundary {
  const boundary = representationHeadersBoundarySchema.parse(value);
  for (const [index, request] of boundary.effectiveRequests.entries()) {
    verifyOfficialMarketCalendarCanonicalJsonObject(
      request.representationHeaders,
      `effectiveRequests[${index}].representationHeaders`
    );
    const accept = request.representationHeaders.accept;
    if (accept !== undefined && !acceptHeaderValuePattern.test(accept)) {
      throw new Error(
        `effectiveRequests[${index}].representationHeaders.accept must be a canonical Accept media-range list`
      );
    }
    if (accept !== undefined && hasDuplicateAcceptParameterName(accept)) {
      throw new Error(
        `effectiveRequests[${index}].representationHeaders.accept must not repeat case-insensitive parameter names within a media range`
      );
    }
    const acceptLanguage = request.representationHeaders["accept-language"];
    if (
      acceptLanguage !== undefined &&
      !acceptLanguageHeaderValuePattern.test(acceptLanguage)
    ) {
      throw new Error(
        `effectiveRequests[${index}].representationHeaders.accept-language must be a canonical Accept-Language language-range list`
      );
    }
    if (
      acceptLanguage !== undefined &&
      hasDuplicateAcceptLanguageRange(acceptLanguage)
    ) {
      throw new Error(
        `effectiveRequests[${index}].representationHeaders.accept-language must not repeat case-insensitive language ranges`
      );
    }
  }
  return boundary;
}
