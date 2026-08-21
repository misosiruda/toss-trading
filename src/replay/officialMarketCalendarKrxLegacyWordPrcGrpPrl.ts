import {
  verifyOfficialMarketCalendarKrxLegacyWordPcdPrms
} from "./officialMarketCalendarKrxLegacyWordPcdPrm.js";
import type {
  VerifiedOfficialMarketCalendarKrxLegacyWordPcdPrm
} from "./officialMarketCalendarKrxLegacyWordPcdPrm.js";
import {
  OfficialMarketCalendarKrxLegacyWordPrlError,
  parseOfficialMarketCalendarKrxLegacyWordPrls
} from "./officialMarketCalendarKrxLegacyWordPrl.js";
import type { VerifiedOfficialMarketCalendarKrxLegacyWordPrl } from "./officialMarketCalendarKrxLegacyWordPrl.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PRC_GRPPRL_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_prc_grpprl.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPrcGrpPrl {
  index: number;
  clxByteOffset: number;
  grpprlByteOffset: number;
  grpprlByteLength: number;
  grpprlBytes: Uint8Array;
  bytesOwnership: "caller_owned_copy";
  prls: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[];
  prlCount: number;
  paragraphPrlCount: number;
  characterPrlCount: number;
  otherPropertyGroupPrlCount: number;
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPrcGrpPrls {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PRC_GRPPRL_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  prcs: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrcGrpPrl[];
  pieces: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPcdPrm[];
  prcGrpprlFramingVerified: true;
  sprmFramingVerified: true;
  paragraphModifierSelectionStatus: "not_applied";
  tablePropertyApplicationStatus: "not_applied";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordPrcGrpPrlErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PRC_GRPPRL_INVALID";

export class OfficialMarketCalendarKrxLegacyWordPrcGrpPrlError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordPrcGrpPrlErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordPrcGrpPrlError";
  }
}

export function verifyOfficialMarketCalendarKrxLegacyWordPrcGrpPrls(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordPrcGrpPrls {
  const pcdPrms = verifyOfficialMarketCalendarKrxLegacyWordPcdPrms(input);
  const prcs: VerifiedOfficialMarketCalendarKrxLegacyWordPrcGrpPrl[] = [];
  let retainedBytes = false;
  try {
    for (const prc of pcdPrms.prcs) {
      let prls: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[];
      try {
        prls = parseOfficialMarketCalendarKrxLegacyWordPrls(prc.grpprlBytes);
      } catch (error) {
        if (error instanceof OfficialMarketCalendarKrxLegacyWordPrlError) {
          throw invalidPrcGrpPrl();
        }
        throw error;
      }
      let paragraphPrlCount = 0;
      let characterPrlCount = 0;
      for (const prl of prls) {
        if (prl.sgc === 1) paragraphPrlCount += 1;
        else if (prl.sgc === 2) characterPrlCount += 1;
      }
      prcs.push(Object.freeze({
        ...prc,
        prls,
        prlCount: prls.length,
        paragraphPrlCount,
        characterPrlCount,
        otherPropertyGroupPrlCount:
          prls.length - paragraphPrlCount - characterPrlCount
      }));
    }
    const result = Object.freeze({
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PRC_GRPPRL_SCHEMA_VERSION,
      nFib: pcdPrms.nFib,
      tableStreamName: pcdPrms.tableStreamName,
      prcs: Object.freeze(prcs),
      pieces: pcdPrms.pieces,
      prcGrpprlFramingVerified: true as const,
      sprmFramingVerified: true as const,
      paragraphModifierSelectionStatus: "not_applied" as const,
      tablePropertyApplicationStatus: "not_applied" as const,
      sourceRoleStatus: "candidate_not_accepted" as const
    });
    retainedBytes = true;
    return result;
  } finally {
    if (!retainedBytes) {
      for (const prc of pcdPrms.prcs) zeroizeBytes(prc.grpprlBytes);
      for (const prc of prcs) {
        for (const prl of prc.prls) zeroizeBytes(prl.operandBytes);
      }
    }
  }
}

function zeroizeBytes(bytes: Uint8Array): void {
  try {
    Uint8Array.prototype.fill.call(bytes, 0);
  } catch {
    // A detached caller-owned projection has no remaining bytes to clear.
  }
}

function invalidPrcGrpPrl(): OfficialMarketCalendarKrxLegacyWordPrcGrpPrlError {
  return new OfficialMarketCalendarKrxLegacyWordPrcGrpPrlError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PRC_GRPPRL_INVALID",
    "Official calendar KRX legacy Word Prc GrpPrl is invalid."
  );
}
