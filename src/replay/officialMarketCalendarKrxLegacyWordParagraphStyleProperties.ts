import {
  OfficialMarketCalendarKrxLegacyWordPrlError,
  parseOfficialMarketCalendarKrxLegacyWordPrls
} from "./officialMarketCalendarKrxLegacyWordPrl.js";
import type { VerifiedOfficialMarketCalendarKrxLegacyWordPrl } from "./officialMarketCalendarKrxLegacyWordPrl.js";
import {
  verifyOfficialMarketCalendarKrxLegacyWordStdfBases
} from "./officialMarketCalendarKrxLegacyWordStdfBase.js";
import type {
  VerifiedOfficialMarketCalendarKrxLegacyWordStdfBaseStyle
} from "./officialMarketCalendarKrxLegacyWordStdfBase.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PARAGRAPH_STYLE_PROPERTIES_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_paragraph_style_properties.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordParagraphStyle {
  istd: number;
  istdBase: number | null;
  styleNameCharacterCount: number;
  directParagraphPrls: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[];
  resolvedParagraphPrls: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[];
  inheritanceChain: readonly number[];
  upxCount: number;
  paragraphUpxIstdStatus: "present_and_matched" | "omitted";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordParagraphStyleProperties {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PARAGRAPH_STYLE_PROPERTIES_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  styles: readonly VerifiedOfficialMarketCalendarKrxLegacyWordParagraphStyle[];
  xstzNameFramingVerified: true;
  lpUpxFramingVerified: true;
  paragraphUpxPapxVerified: true;
  inheritanceOrderVerified: true;
  nonParagraphUpxSemanticsStatus: "framing_only";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordParagraphStylePropertiesErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PARAGRAPH_STYLE_PROPERTIES_INVALID";

export class OfficialMarketCalendarKrxLegacyWordParagraphStylePropertiesError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordParagraphStylePropertiesErrorCode,
    message: string
  ) {
    super(message);
    this.name =
      "OfficialMarketCalendarKrxLegacyWordParagraphStylePropertiesError";
  }
}

interface ParsedParagraphStyle {
  style: VerifiedOfficialMarketCalendarKrxLegacyWordStdfBaseStyle;
  styleNameCharacterCount: number;
  directParagraphPrls: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[];
  upxCount: number;
  paragraphUpxIstdStatus: "present_and_matched" | "omitted";
}

const LP_UPX_HEADER_BYTE_LENGTH = 2;

export function verifyOfficialMarketCalendarKrxLegacyWordParagraphStyleProperties(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordParagraphStyleProperties {
  const bases = verifyOfficialMarketCalendarKrxLegacyWordStdfBases(input);
  const parsed = new Map<number, ParsedParagraphStyle>();
  const ownedPrls: VerifiedOfficialMarketCalendarKrxLegacyWordPrl[] = [];
  let completed = false;
  try {
    for (const style of bases.styles) {
      if (style.status === "empty") continue;
      const body = style.styleBodyBytes;
      const nameEnd = verifyXstzName(body);
      const upxFrames = parseLpUpxFrames(body, nameEnd, style.cupx);
      if (style.stk !== 1) continue;

      const paragraphUpx = upxFrames[0];
      if (paragraphUpx === undefined) throw invalidParagraphStyleProperties();
      const parsedPapx = parseParagraphUpx(style.istd, paragraphUpx);
      ownedPrls.push(...parsedPapx.prls);
      parsed.set(style.istd, {
        style,
        styleNameCharacterCount: readUint16(body, 0),
        directParagraphPrls: parsedPapx.prls,
        upxCount: upxFrames.length,
        paragraphUpxIstdStatus: parsedPapx.istdStatus
      });
    }

    const styles = [...parsed.values()].map((entry) => {
      const inheritanceChain = resolveInheritanceChain(entry.style, parsed);
      const resolvedParagraphPrls = Object.freeze(
        inheritanceChain.flatMap(
          (istd) => parsed.get(istd)?.directParagraphPrls ?? []
        )
      );
      return Object.freeze({
        istd: entry.style.istd,
        istdBase: entry.style.istdBase,
        styleNameCharacterCount: entry.styleNameCharacterCount,
        directParagraphPrls: entry.directParagraphPrls,
        resolvedParagraphPrls,
        inheritanceChain: Object.freeze(inheritanceChain),
        upxCount: entry.upxCount,
        paragraphUpxIstdStatus: entry.paragraphUpxIstdStatus
      });
    });

    const result = Object.freeze({
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PARAGRAPH_STYLE_PROPERTIES_SCHEMA_VERSION,
      nFib: bases.nFib,
      tableStreamName: bases.tableStreamName,
      styles: Object.freeze(styles),
      xstzNameFramingVerified: true,
      lpUpxFramingVerified: true,
      paragraphUpxPapxVerified: true,
      inheritanceOrderVerified: true,
      nonParagraphUpxSemanticsStatus: "framing_only",
      sourceRoleStatus: "candidate_not_accepted"
    });
    completed = true;
    return result;
  } finally {
    for (const style of bases.styles) {
      if (style.status !== "empty") zeroizeBytes(style.styleBodyBytes);
    }
    if (!completed) {
      for (const prl of ownedPrls) zeroizeBytes(prl.operandBytes);
    }
  }
}

function verifyXstzName(bytes: Uint8Array): number {
  const characterCount = readUint16(bytes, 0);
  if (characterCount === 0) throw invalidParagraphStyleProperties();
  const terminatorOffset = 2 + characterCount * 2;
  if (
    !Number.isSafeInteger(terminatorOffset) ||
    readUint16(bytes, terminatorOffset) !== 0
  ) {
    throw invalidParagraphStyleProperties();
  }
  return terminatorOffset + 2;
}

function parseLpUpxFrames(
  bytes: Uint8Array,
  startOffset: number,
  cupx: number
): readonly Uint8Array[] {
  const frames: Uint8Array[] = [];
  let offset = startOffset;
  for (let index = 0; index < cupx; index += 1) {
    const cbUpx = readUint16(bytes, offset);
    const contentOffset = offset + LP_UPX_HEADER_BYTE_LENGTH;
    const contentEnd = contentOffset + cbUpx;
    const paddedEnd = contentEnd + (cbUpx % 2);
    if (
      !Number.isSafeInteger(paddedEnd) ||
      paddedEnd > bytes.length ||
      (cbUpx % 2 === 1 && bytes[contentEnd] !== 0)
    ) {
      throw invalidParagraphStyleProperties();
    }
    frames.push(bytes.subarray(contentOffset, contentEnd));
    offset = paddedEnd;
  }
  if (offset !== bytes.length) throw invalidParagraphStyleProperties();
  return Object.freeze(frames);
}

function parseParagraphUpx(
  istd: number,
  bytes: Uint8Array
): {
  prls: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[];
  istdStatus: "present_and_matched" | "omitted";
} {
  const hasIstd = bytes.length >= 2 && readUint16(bytes, 0) === istd;
  try {
    const prls = parseOfficialMarketCalendarKrxLegacyWordPrls(
      bytes,
      hasIstd ? 2 : 0
    );
    if (prls.some((prl) => prl.sgc !== 1)) {
      for (const prl of prls) zeroizeBytes(prl.operandBytes);
      throw invalidParagraphStyleProperties();
    }
    return {
      prls,
      istdStatus: hasIstd ? "present_and_matched" : "omitted"
    };
  } catch (error) {
    if (error instanceof OfficialMarketCalendarKrxLegacyWordPrlError) {
      throw invalidParagraphStyleProperties();
    }
    throw error;
  }
}

function resolveInheritanceChain(
  style: VerifiedOfficialMarketCalendarKrxLegacyWordStdfBaseStyle,
  parsed: ReadonlyMap<number, ParsedParagraphStyle>
): number[] {
  const chain: number[] = [];
  let current: VerifiedOfficialMarketCalendarKrxLegacyWordStdfBaseStyle | undefined =
    style;
  while (current !== undefined) {
    chain.unshift(current.istd);
    if (current.istdBase === null) break;
    current = parsed.get(current.istdBase)?.style;
    if (current === undefined) throw invalidParagraphStyleProperties();
  }
  return chain;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw invalidParagraphStyleProperties();
  }
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function zeroizeBytes(bytes: Uint8Array): void {
  try {
    Uint8Array.prototype.fill.call(bytes, 0);
  } catch {
    // A detached caller-owned projection has no remaining bytes to clear.
  }
}

function invalidParagraphStyleProperties(): OfficialMarketCalendarKrxLegacyWordParagraphStylePropertiesError {
  return new OfficialMarketCalendarKrxLegacyWordParagraphStylePropertiesError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PARAGRAPH_STYLE_PROPERTIES_INVALID",
    "Official calendar KRX legacy Word paragraph style properties are invalid."
  );
}
