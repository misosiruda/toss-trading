import type { VirtualDecisionItem, VirtualPosition } from "../domain/schemas.js";

export const DUST_POSITION_QUANTITY_EPSILON = 0.000001;
export const DUST_POSITION_MARKET_VALUE_KRW = 1;

export function positionMarketValueKrw(
  position: Pick<VirtualPosition, "quantity" | "marketValueKrw" | "averagePriceKrw">,
  priceKrw: number | undefined
): number {
  if (priceKrw !== undefined) {
    return position.quantity * priceKrw;
  }

  return position.marketValueKrw ?? position.quantity * position.averagePriceKrw;
}

export function isDustPosition(
  position: Pick<VirtualPosition, "quantity" | "marketValueKrw" | "averagePriceKrw">,
  priceKrw: number | undefined
): boolean {
  return (
    position.quantity <= DUST_POSITION_QUANTITY_EPSILON ||
    positionMarketValueKrw(position, priceKrw) < DUST_POSITION_MARKET_VALUE_KRW
  );
}

export function isSellAllDustClose(input: {
  decision: Pick<VirtualDecisionItem, "action" | "sellAll">;
  position: Pick<VirtualPosition, "quantity" | "marketValueKrw" | "averagePriceKrw">;
  priceKrw: number | undefined;
}): boolean {
  return (
    input.decision.action === "VIRTUAL_SELL" &&
    input.decision.sellAll === true &&
    isDustPosition(input.position, input.priceKrw)
  );
}
