export type PaperFillStatus = "filled" | "partial" | "rejected";

export type PaperLiquidityStatus =
  | "not_modeled"
  | "sufficient"
  | "partial"
  | "rejected"
  | "stale";

export type PaperLiquidityRejectReason =
  | "stale_liquidity"
  | "insufficient_liquidity";

export interface PaperLiquidityPolicy {
  maxVolumeParticipationRate: number;
  minLiquidityFillRatio: number;
  rejectStaleLiquidity: boolean;
}

export interface PaperLiquidityInput {
  requestedNotionalKrw: number;
  sourcePriceKrw: number;
  volume?: number | undefined;
  averageVolume?: number | undefined;
  liquidityStale?: boolean | undefined;
  policy: PaperLiquidityPolicy;
}

export interface PaperLiquidityDecision {
  fillStatus: PaperFillStatus;
  liquidityStatus: PaperLiquidityStatus;
  requestedNotionalKrw: number;
  fillableNotionalKrw: number;
  participationRate?: number | undefined;
  maxParticipationRate: number;
  volume?: number | undefined;
  averageVolume?: number | undefined;
  rejectReason?: PaperLiquidityRejectReason | undefined;
}

export function buildPaperLiquidityDecision(
  input: PaperLiquidityInput
): PaperLiquidityDecision {
  const requestedNotionalKrw = Math.max(
    0,
    Math.round(input.requestedNotionalKrw)
  );
  const maxParticipationRate = normalizeRatio(
    input.policy.maxVolumeParticipationRate,
    0.1
  );
  const minFillRatio = normalizeRatio(input.policy.minLiquidityFillRatio, 0.1);
  const effectiveVolume = effectiveLiquidityVolume(input);
  const base = {
    requestedNotionalKrw,
    maxParticipationRate,
    ...(input.volume === undefined ? {} : { volume: input.volume }),
    ...(input.averageVolume === undefined
      ? {}
      : { averageVolume: input.averageVolume })
  };

  if (effectiveVolume === undefined) {
    return {
      ...base,
      fillStatus: "filled",
      liquidityStatus: "not_modeled",
      fillableNotionalKrw: requestedNotionalKrw
    };
  }

  if (input.liquidityStale === true && input.policy.rejectStaleLiquidity) {
    return {
      ...base,
      fillStatus: "rejected",
      liquidityStatus: "stale",
      fillableNotionalKrw: 0,
      rejectReason: "stale_liquidity"
    };
  }

  const marketNotionalKrw = effectiveVolume * input.sourcePriceKrw;
  const maxFillableNotionalKrw = Math.floor(
    marketNotionalKrw * maxParticipationRate
  );

  if (requestedNotionalKrw <= 0 || maxFillableNotionalKrw <= 0) {
    return {
      ...base,
      fillStatus: "rejected",
      liquidityStatus: "rejected",
      fillableNotionalKrw: 0,
      rejectReason: "insufficient_liquidity"
    };
  }

  const participationRate = requestedNotionalKrw / marketNotionalKrw;
  if (maxFillableNotionalKrw >= requestedNotionalKrw) {
    return {
      ...base,
      fillStatus: "filled",
      liquidityStatus: "sufficient",
      fillableNotionalKrw: requestedNotionalKrw,
      participationRate: roundRatio(participationRate)
    };
  }

  const fillRatio = maxFillableNotionalKrw / requestedNotionalKrw;
  if (fillRatio >= minFillRatio) {
    return {
      ...base,
      fillStatus: "partial",
      liquidityStatus: "partial",
      fillableNotionalKrw: maxFillableNotionalKrw,
      participationRate: roundRatio(maxParticipationRate)
    };
  }

  return {
    ...base,
    fillStatus: "rejected",
    liquidityStatus: "rejected",
    fillableNotionalKrw: 0,
    participationRate: roundRatio(maxParticipationRate),
    rejectReason: "insufficient_liquidity"
  };
}

function effectiveLiquidityVolume(
  input: Pick<PaperLiquidityInput, "volume" | "averageVolume">
): number | undefined {
  const volumes = [input.volume, input.averageVolume].filter(
    (value): value is number => value !== undefined
  );
  if (volumes.length === 0) {
    return undefined;
  }
  return Math.min(...volumes);
}

function normalizeRatio(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, value));
}

function roundRatio(value: number): number {
  return Number(value.toFixed(6));
}
