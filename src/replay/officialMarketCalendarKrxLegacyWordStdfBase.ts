import { verifyOfficialMarketCalendarKrxLegacyWordStsh } from "./officialMarketCalendarKrxLegacyWordStsh.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STDF_BASE_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_stdf_base.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordStdfBaseStyle {
  istd: number;
  status: "base_verified_body_not_parsed";
  sti: number;
  stk: 1 | 2 | 3 | 4;
  istdBase: number | null;
  cupx: number;
  istdNext: number;
  bchUpe: number;
  stdfPost2000: {
    istdLink: number | null;
    fHasOriginalStyle: boolean;
    rsid: number;
    iftcHtml: number;
    iPriority: number;
  } | null;
  styleBodyBytes: Uint8Array;
}

export interface EmptyOfficialMarketCalendarKrxLegacyWordStdfBaseStyle {
  istd: number;
  status: "empty";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordStdfBases {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STDF_BASE_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  cbSTDBaseInFile: 0x000a | 0x0012;
  styles: readonly (
    | VerifiedOfficialMarketCalendarKrxLegacyWordStdfBaseStyle
    | EmptyOfficialMarketCalendarKrxLegacyWordStdfBaseStyle
  )[];
  stdfBaseVerified: true;
  inheritanceReferencesVerified: true;
  cupxStatus: "style_type_and_revision_mark_verified";
  styleBodyStatus: "xstz_name_and_upx_not_parsed";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordStdfBaseErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STDF_BASE_INVALID";

export class OfficialMarketCalendarKrxLegacyWordStdfBaseError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordStdfBaseErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordStdfBaseError";
  }
}

const NO_BASE_STYLE = 0x0fff;
const FIXED_STYLE_IDENTIFIERS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 65, 105, 107
] as const;

export function verifyOfficialMarketCalendarKrxLegacyWordStdfBases(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordStdfBases {
  const stsh = verifyOfficialMarketCalendarKrxLegacyWordStsh(input);
  const ownedBodyBytes: Uint8Array[] = [];
  let completed = false;
  try {
    const styles: (
      | VerifiedOfficialMarketCalendarKrxLegacyWordStdfBaseStyle
      | EmptyOfficialMarketCalendarKrxLegacyWordStdfBaseStyle
    )[] = [];
    for (const definition of stsh.styleDefinitions) {
      if (definition.styleDefinitionStatus === "empty") {
        styles.push(Object.freeze({ istd: definition.istd, status: "empty" }));
        continue;
      }
      const bytes = definition.stdBytes;
      if (definition.cbStd < stsh.cbSTDBaseInFile) {
        throw invalidStdfBase();
      }
      const first = readUint16(bytes, 0);
      const second = readUint16(bytes, 2);
      const third = readUint16(bytes, 4);
      const sti = first & 0x0fff;
      const stk = second & 0x000f;
      const rawIstdBase = second >>> 4;
      const cupx = third & 0x000f;
      const istdNext = third >>> 4;
      const bchUpe = readUint16(bytes, 6);
      const stdfPost2000 =
        stsh.cbSTDBaseInFile === 0x0012
          ? parseStdfPost2000(bytes)
          : null;
      if (
        sti === 0x0fff ||
        stk < 1 ||
        stk > 4 ||
        bchUpe !== definition.cbStd ||
        (definition.istd < FIXED_STYLE_IDENTIFIERS.length &&
          sti !== FIXED_STYLE_IDENTIFIERS[definition.istd])
      ) {
        throw invalidStdfBase();
      }
      verifyCupx(stk, cupx, stdfPost2000?.fHasOriginalStyle ?? false);
      const bodyLength = definition.cbStd - stsh.cbSTDBaseInFile;
      const styleBodyBytes = new Uint8Array(bodyLength);
      styleBodyBytes.set(bytes.subarray(stsh.cbSTDBaseInFile));
      ownedBodyBytes.push(styleBodyBytes);
      styles.push(
        Object.freeze({
          istd: definition.istd,
          status: "base_verified_body_not_parsed",
          sti,
          stk: stk as 1 | 2 | 3 | 4,
          istdBase: rawIstdBase === NO_BASE_STYLE ? null : rawIstdBase,
          cupx,
          istdNext,
          bchUpe,
          stdfPost2000,
          styleBodyBytes
        })
      );
    }

    verifyReferences(styles);
    const result = Object.freeze({
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STDF_BASE_SCHEMA_VERSION,
      nFib: stsh.nFib,
      tableStreamName: stsh.tableStreamName,
      cbSTDBaseInFile: stsh.cbSTDBaseInFile,
      styles: Object.freeze(styles),
      stdfBaseVerified: true,
      inheritanceReferencesVerified: true,
      cupxStatus: "style_type_and_revision_mark_verified",
      styleBodyStatus: "xstz_name_and_upx_not_parsed",
      sourceRoleStatus: "candidate_not_accepted"
    });
    completed = true;
    return result;
  } finally {
    for (const definition of stsh.styleDefinitions) {
      zeroizeBytes(definition.stdBytes);
    }
    if (!completed) {
      for (const bytes of ownedBodyBytes) {
        zeroizeBytes(bytes);
      }
    }
  }
}

function verifyReferences(
  styles: readonly (
    | VerifiedOfficialMarketCalendarKrxLegacyWordStdfBaseStyle
    | EmptyOfficialMarketCalendarKrxLegacyWordStdfBaseStyle
  )[]
): void {
  const nonEmpty = new Map<number, VerifiedOfficialMarketCalendarKrxLegacyWordStdfBaseStyle>();
  for (const style of styles) {
    if (style.status === "base_verified_body_not_parsed") {
      nonEmpty.set(style.istd, style);
    }
  }
  for (const style of nonEmpty.values()) {
    if (!nonEmpty.has(style.istdNext)) {
      throw invalidStdfBase();
    }
    const seen = new Set<number>();
    let current: VerifiedOfficialMarketCalendarKrxLegacyWordStdfBaseStyle | undefined =
      style;
    while (current?.istdBase !== null) {
      if (seen.has(current.istd) || current.istdBase === current.istd) {
        throw invalidStdfBase();
      }
      seen.add(current.istd);
      current = nonEmpty.get(current.istdBase);
      if (current === undefined) {
        throw invalidStdfBase();
      }
    }
    if (
      style.stdfPost2000 !== null &&
      style.stdfPost2000.istdLink !== null &&
      !nonEmpty.has(style.stdfPost2000.istdLink)
    ) {
      throw invalidStdfBase();
    }
  }
}

function parseStdfPost2000(
  bytes: Uint8Array
): NonNullable<VerifiedOfficialMarketCalendarKrxLegacyWordStdfBaseStyle["stdfPost2000"]> {
  const linkAndFlags = readUint16(bytes, 10);
  const istdLink = linkAndFlags & 0x0fff;
  const fHasOriginalStyle = (linkAndFlags & 0x1000) !== 0;
  const reserved = linkAndFlags >>> 13;
  const rsid = readUint32(bytes, 12);
  const htmlAndPriority = readUint16(bytes, 16);
  const iftcHtml = htmlAndPriority & 0x0007;
  const unused = (htmlAndPriority & 0x0008) !== 0;
  const iPriority = htmlAndPriority >>> 4;
  if (reserved !== 0 || unused || iPriority > 0x0063) {
    throw invalidStdfBase();
  }
  return Object.freeze({
    istdLink: istdLink === 0 ? null : istdLink,
    fHasOriginalStyle,
    rsid,
    iftcHtml,
    iPriority
  });
}

function verifyCupx(
  stk: number,
  cupx: number,
  fHasOriginalStyle: boolean
): void {
  const expected =
    stk === 1
      ? fHasOriginalStyle
        ? 3
        : 2
      : stk === 2
        ? fHasOriginalStyle
          ? 2
          : 1
        : stk === 3
          ? 3
          : 1;
  if (cupx !== expected || (fHasOriginalStyle && (stk === 3 || stk === 4))) {
    throw invalidStdfBase();
  }
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw invalidStdfBase();
  }
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw invalidStdfBase();
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    true
  );
}

function zeroizeBytes(bytes: Uint8Array): void {
  try {
    Uint8Array.prototype.fill.call(bytes, 0);
  } catch {
    // A detached caller-owned projection has no remaining bytes to clear.
  }
}

function invalidStdfBase(): OfficialMarketCalendarKrxLegacyWordStdfBaseError {
  return new OfficialMarketCalendarKrxLegacyWordStdfBaseError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STDF_BASE_INVALID",
    "Official calendar KRX legacy Word StdfBase is invalid."
  );
}
