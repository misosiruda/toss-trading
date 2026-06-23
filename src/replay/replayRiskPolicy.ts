import type { HistoricalMarketSnapshot, MarketPacket } from "../domain/schemas.js";
import {
  classifyDynamicCashReserveRegime
} from "../paper/dynamicCashReservePolicy.js";
import type { VirtualRiskPolicy } from "../paper/riskPolicy.js";

export interface ReplayRiskPolicyForTickInput {
  policy?: Partial<VirtualRiskPolicy> | undefined;
  now: Date;
  packet: MarketPacket;
  snapshots: HistoricalMarketSnapshot[];
  simulatedAt: Date;
}

export function riskPolicyForReplayTick(
  input: ReplayRiskPolicyForTickInput
): Partial<VirtualRiskPolicy> {
  const scheduledExposureCeilingRatio =
    input.packet.portfolioAllocation?.scheduledExposureCeilingRatio;
  const dynamicCashReservePolicy = input.policy?.dynamicCashReservePolicy;

  return {
    ...(input.policy ?? {}),
    ...(scheduledExposureCeilingRatio === undefined
      ? {}
      : { targetExposureRatio: scheduledExposureCeilingRatio }),
    ...(dynamicCashReservePolicy === undefined
      ? {}
      : {
          dynamicCashReserveMarketRegime: classifyDynamicCashReserveRegime({
            policy: dynamicCashReservePolicy,
            snapshots: input.snapshots,
            simulatedAt: input.simulatedAt
          })
        }),
    now: input.now
  };
}
