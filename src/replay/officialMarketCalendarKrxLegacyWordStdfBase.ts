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
  cupxStatus: "projected_semantics_not_verified";
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
      cupxStatus: "projected_semantics_not_verified",
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
  }
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw invalidStdfBase();
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

function invalidStdfBase(): OfficialMarketCalendarKrxLegacyWordStdfBaseError {
  return new OfficialMarketCalendarKrxLegacyWordStdfBaseError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STDF_BASE_INVALID",
    "Official calendar KRX legacy Word StdfBase is invalid."
  );
}
