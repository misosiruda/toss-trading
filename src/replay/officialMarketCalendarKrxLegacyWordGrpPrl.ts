import { verifyOfficialMarketCalendarKrxLegacyWordPapxFkp } from "./officialMarketCalendarKrxLegacyWordPapxFkp.js";
import {
  OfficialMarketCalendarKrxLegacyWordPrlError,
  parseOfficialMarketCalendarKrxLegacyWordPrls
} from "./officialMarketCalendarKrxLegacyWordPrl.js";
import type { VerifiedOfficialMarketCalendarKrxLegacyWordPrl } from "./officialMarketCalendarKrxLegacyWordPrl.js";

export type { VerifiedOfficialMarketCalendarKrxLegacyWordPrl } from "./officialMarketCalendarKrxLegacyWordPrl.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_GRPPRL_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_grpprl.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordGrpPrl {
  pageIndex: number;
  paragraphIndex: number;
  fcStart: number;
  fcEnd: number;
  istd: number | null;
  prls: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[];
  propertiesStatus: "default" | "framing_verified";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordGrpPrls {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_GRPPRL_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  groups: readonly VerifiedOfficialMarketCalendarKrxLegacyWordGrpPrl[];
  grpprlAndIstdFramingVerified: true;
  sprmFramingVerified: true;
  tDefTableLengthStatus: "supported";
  pChgTabs255Status: "rejected_unsupported";
  sprmSemanticsStatus: "not_verified";
  tableSemanticsStatus: "not_verified";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordGrpPrlErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_GRPPRL_INVALID";

export class OfficialMarketCalendarKrxLegacyWordGrpPrlError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordGrpPrlErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordGrpPrlError";
  }
}

const ISTD_BYTE_LENGTH = 2;

export function verifyOfficialMarketCalendarKrxLegacyWordGrpPrls(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordGrpPrls {
  const papxFkp = verifyOfficialMarketCalendarKrxLegacyWordPapxFkp(input);
  const groups: VerifiedOfficialMarketCalendarKrxLegacyWordGrpPrl[] = [];
  for (const page of papxFkp.pages) {
    for (const paragraph of page.paragraphs) {
      if (paragraph.propertiesStatus === "default") {
        groups.push(
          Object.freeze({
            pageIndex: page.index,
            paragraphIndex: paragraph.paragraphIndex,
            fcStart: paragraph.fcStart,
            fcEnd: paragraph.fcEnd,
            istd: null,
            prls: Object.freeze([]),
            propertiesStatus: "default"
          })
        );
        continue;
      }
      const bytes = paragraph.grpprlAndIstdBytes;
      if (bytes.length < ISTD_BYTE_LENGTH) {
        throw invalidGrpPrl();
      }
      const istd = readUint16(bytes, 0);
      let prls: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[];
      try {
        prls = parseOfficialMarketCalendarKrxLegacyWordPrls(
          bytes,
          ISTD_BYTE_LENGTH
        );
      } catch (error) {
        if (error instanceof OfficialMarketCalendarKrxLegacyWordPrlError) {
          throw invalidGrpPrl();
        }
        throw error;
      }
      groups.push(
        Object.freeze({
          pageIndex: page.index,
          paragraphIndex: paragraph.paragraphIndex,
          fcStart: paragraph.fcStart,
          fcEnd: paragraph.fcEnd,
          istd,
          prls,
          propertiesStatus: "framing_verified"
        })
      );
    }
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_GRPPRL_SCHEMA_VERSION,
    nFib: papxFkp.nFib,
    tableStreamName: papxFkp.tableStreamName,
    groups: Object.freeze(groups),
    grpprlAndIstdFramingVerified: true,
    sprmFramingVerified: true,
    tDefTableLengthStatus: "supported",
    pChgTabs255Status: "rejected_unsupported",
    sprmSemanticsStatus: "not_verified",
    tableSemanticsStatus: "not_verified",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw invalidGrpPrl();
  }
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function invalidGrpPrl(): OfficialMarketCalendarKrxLegacyWordGrpPrlError {
  return new OfficialMarketCalendarKrxLegacyWordGrpPrlError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_GRPPRL_INVALID",
    "Official calendar KRX legacy Word GrpPrlAndIstd is invalid."
  );
}
