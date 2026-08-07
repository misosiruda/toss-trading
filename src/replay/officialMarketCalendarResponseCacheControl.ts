import { z } from "zod";

const responseCacheControlInputSchema = z
  .object({
    cacheControlHeaderValues: z.array(z.string())
  })
  .strict();

export interface OfficialMarketCalendarResponseCacheControl {
  responseCacheControl: string[] | null;
}

interface ParsedDirective {
  name: string;
  canonical: string;
}

export function parseOfficialMarketCalendarResponseCacheControl(
  value: unknown
): OfficialMarketCalendarResponseCacheControl {
  const input = responseCacheControlInputSchema.parse(value);
  if (input.cacheControlHeaderValues.length === 0) {
    return { responseCacheControl: null };
  }

  const directives = input.cacheControlHeaderValues.flatMap(parseFieldValue);
  const names = new Set<string>();
  for (const directive of directives) {
    if (names.has(directive.name)) {
      throw new Error(
        "official calendar response Cache-Control must not contain duplicate directives"
      );
    }
    names.add(directive.name);
  }

  return {
    responseCacheControl: directives
      .map((directive) => directive.canonical)
      .sort(compareCanonicalStrings)
  };
}

function parseFieldValue(value: string): ParsedDirective[] {
  const directives: ParsedDirective[] = [];
  let index = skipOptionalWhitespace(value, 0);
  if (index === value.length) {
    throw invalidCacheControl();
  }

  while (index < value.length) {
    const nameToken = readToken(value, index);
    const name = nameToken.value.toLowerCase();
    index = skipOptionalWhitespace(value, nameToken.nextIndex);

    let argument: string | null = null;
    if (value[index] === "=") {
      index = skipOptionalWhitespace(value, index + 1);
      if (value[index] === '"') {
        const quoted = readQuotedString(value, index);
        argument = quoted.canonical;
        index = quoted.nextIndex;
      } else {
        const token = readToken(value, index);
        argument = token.value;
        index = token.nextIndex;
      }
      index = skipOptionalWhitespace(value, index);
    }

    directives.push({
      name,
      canonical: argument === null ? name : `${name}=${argument}`
    });

    if (index === value.length) {
      break;
    }
    if (value[index] !== ",") {
      throw invalidCacheControl();
    }
    index = skipOptionalWhitespace(value, index + 1);
    if (index === value.length) {
      throw invalidCacheControl();
    }
  }

  return directives;
}

function readToken(
  value: string,
  startIndex: number
): { value: string; nextIndex: number } {
  let index = startIndex;
  while (index < value.length && isTokenCharacter(value[index]!)) {
    index += 1;
  }
  if (index === startIndex) {
    throw invalidCacheControl();
  }
  return { value: value.slice(startIndex, index), nextIndex: index };
}

function readQuotedString(
  value: string,
  startIndex: number
): { canonical: string; nextIndex: number } {
  let index = startIndex + 1;
  let decoded = "";

  while (index < value.length) {
    const character = value[index]!;
    if (character === '"') {
      return {
        canonical: `"${decoded
          .replaceAll("\\", "\\\\")
          .replaceAll('"', '\\"')}"`,
        nextIndex: index + 1
      };
    }
    if (character === "\\") {
      index += 1;
      if (index >= value.length || !isQuotedPairCharacter(value[index]!)) {
        throw invalidCacheControl();
      }
      decoded += value[index]!;
      index += 1;
      continue;
    }
    if (!isQuotedTextCharacter(character)) {
      throw invalidCacheControl();
    }
    decoded += character;
    index += 1;
  }

  throw invalidCacheControl();
}

function skipOptionalWhitespace(value: string, startIndex: number): number {
  let index = startIndex;
  while (value[index] === " " || value[index] === "\t") {
    index += 1;
  }
  return index;
}

function isTokenCharacter(character: string): boolean {
  return /^[!#$%&'*+\-.^_`|A-Za-z0-9\x7e]$/.test(character);
}

function isQuotedTextCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    code === 0x09 ||
    code === 0x20 ||
    code === 0x21 ||
    (code >= 0x23 && code <= 0x5b) ||
    (code >= 0x5d && code <= 0x7e) ||
    (code >= 0x80 && code <= 0xff)
  );
}

function isQuotedPairCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    code === 0x09 ||
    code === 0x20 ||
    (code >= 0x21 && code <= 0x7e) ||
    (code >= 0x80 && code <= 0xff)
  );
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalidCacheControl(): Error {
  return new Error(
    "official calendar response Cache-Control must use valid directive syntax"
  );
}
