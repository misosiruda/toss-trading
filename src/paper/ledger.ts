import type {
  VirtualPortfolio,
  VirtualRiskDecision,
  VirtualTrade
} from "../domain/schemas.js";

export interface VirtualLedgerEntry {
  trade: VirtualTrade;
  riskDecision: VirtualRiskDecision;
  resultingPortfolio: VirtualPortfolio;
}

export class VirtualLedger {
  private readonly entries: VirtualLedgerEntry[] = [];

  record(entry: VirtualLedgerEntry): void {
    this.entries.push(cloneEntry(entry));
  }

  list(): VirtualLedgerEntry[] {
    return this.entries.map((entry) => cloneEntry(entry));
  }
}

function cloneEntry(entry: VirtualLedgerEntry): VirtualLedgerEntry {
  return {
    trade: { ...entry.trade },
    riskDecision: {
      ...entry.riskDecision,
      rejectCodes: [...entry.riskDecision.rejectCodes],
      checkedRules: [...entry.riskDecision.checkedRules]
    },
    resultingPortfolio: {
      ...entry.resultingPortfolio,
      positions: entry.resultingPortfolio.positions.map((position) => ({
        ...position
      }))
    }
  };
}
