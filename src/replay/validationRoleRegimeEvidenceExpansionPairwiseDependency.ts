import type {
  EvidenceExpansionDependencyCandidateEvidence,
  EvidenceExpansionDependencyCandidateIntervalInput
} from "./validationRoleRegimeEvidenceExpansionDependencyCandidateInterval.js";
import {
  buildEvidenceExpansionDependencyCandidateEvidence,
  getVerifiedEvidenceExpansionDependencyCandidateContext
} from "./validationRoleRegimeEvidenceExpansionDependencyCandidateInterval.js";
import {
  evidenceExpansionPairwiseDependencySchema,
  type EvidenceExpansionPairwiseDependency
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

export function buildEvidenceExpansionPairwiseDependency(input: {
  leftGroup: EvidenceExpansionDependencyCandidateIntervalInput["group"];
  rightGroup: EvidenceExpansionDependencyCandidateIntervalInput["group"];
  source: EvidenceExpansionDependencyCandidateIntervalInput["source"];
  calendarClassifier:
    EvidenceExpansionDependencyCandidateIntervalInput["calendarClassifier"];
}): EvidenceExpansionPairwiseDependency {
  const left = buildEvidenceExpansionDependencyCandidateEvidence({
    group: input.leftGroup,
    source: input.source,
    calendarClassifier: input.calendarClassifier
  });
  const right = buildEvidenceExpansionDependencyCandidateEvidence({
    group: input.rightGroup,
    source: input.source,
    calendarClassifier: input.calendarClassifier
  });
  return buildEvidenceExpansionPairwiseDependencyFromEvidence({
    left,
    right
  });
}

export function buildEvidenceExpansionPairwiseDependencyFromEvidence(input: {
  left: EvidenceExpansionDependencyCandidateEvidence;
  right: EvidenceExpansionDependencyCandidateEvidence;
}): EvidenceExpansionPairwiseDependency {
  const leftContext =
    getVerifiedEvidenceExpansionDependencyCandidateContext(input.left);
  const rightContext =
    getVerifiedEvidenceExpansionDependencyCandidateContext(input.right);
  if (
    leftContext.officialCalendarArtifactHash !==
      rightContext.officialCalendarArtifactHash ||
    leftContext.requiredMarkets.join(",") !==
      rightContext.requiredMarkets.join(",")
  ) {
    throw new Error(
      "pairwise dependency candidate contexts must match"
    );
  }
  const { left, right } = input;
  const [canonicalLeft, canonicalRight] =
    left.interval.evidenceGroupHash <
    right.interval.evidenceGroupHash
      ? [left, right]
      : [right, left];
  if (
    canonicalLeft.interval.evidenceGroupHash ===
    canonicalRight.interval.evidenceGroupHash
  ) {
    throw new Error(
      "pairwise dependency must not compare an interval to itself"
    );
  }

  const leftTradingDates = new Set(
    canonicalLeft.canonicalTradingDates.sessions.map(tradingDateKey)
  );
  const rightTradingDates = new Set(
    canonicalRight.canonicalTradingDates.sessions.map(tradingDateKey)
  );
  const tradingDateOverlapCount = [...leftTradingDates].filter((key) =>
    rightTradingDates.has(key)
  ).length;
  const tradingDateUnionCount = new Set([
    ...leftTradingDates,
    ...rightTradingDates
  ]).size;
  if (tradingDateUnionCount === 0) {
    throw new Error(
      "pairwise dependency requires canonical trading dates"
    );
  }

  const adjacencyTradingDayGap =
    tradingDateOverlapCount > 0
      ? null
      : calculateAdjacencyTradingDayGap({
          left: canonicalLeft,
          right: canonicalRight,
          officialCalendarSessions:
            leftContext.officialCalendarSessions,
          requiredMarkets: new Set(leftContext.requiredMarkets)
        });
  const leftMembers = new Set(
    canonicalLeft.combinedUniverseMembership.members.map(memberKey)
  );
  const sharedUniverse =
    canonicalRight.combinedUniverseMembership.members.some((member) =>
      leftMembers.has(memberKey(member))
    );

  return evidenceExpansionPairwiseDependencySchema.parse({
    leftEvidenceGroupHash:
      canonicalLeft.interval.evidenceGroupHash,
    rightEvidenceGroupHash:
      canonicalRight.interval.evidenceGroupHash,
    tradingDateOverlapCount,
    tradingDateUnionCount,
    tradingDateOverlapRatio:
      tradingDateOverlapCount / tradingDateUnionCount,
    adjacencyTradingDayGap,
    sharedUniverse,
    sameRegime:
      canonicalLeft.interval.targetRegime ===
      canonicalRight.interval.targetRegime,
    crossRole:
      new Set([
        ...canonicalLeft.interval.splitRoles,
        ...canonicalRight.interval.splitRoles
      ]).size > 1
  });
}

function calculateAdjacencyTradingDayGap(input: {
  left: EvidenceExpansionDependencyCandidateEvidence;
  right: EvidenceExpansionDependencyCandidateEvidence;
  officialCalendarSessions: readonly {
    sessionId: string;
    market: string;
    sessionDate: string;
    sessionType: string;
    marketOpen: string | null;
  }[];
  requiredMarkets: ReadonlySet<string>;
}): number {
  const openTimesByTradingDate = new Map<string, number>();
  for (const session of input.officialCalendarSessions) {
    if (
      !input.requiredMarkets.has(session.market) ||
      (session.sessionType !== "regular" &&
        session.sessionType !== "early_close")
    ) {
      continue;
    }
    if (session.marketOpen === null) {
      throw new Error(
        `pairwise official open session is missing marketOpen: ${session.sessionId}`
      );
    }
    const key = tradingDateKey(session);
    if (openTimesByTradingDate.has(key)) {
      throw new Error(
        `pairwise official calendar has duplicate trading date: ${key}`
      );
    }
    const marketOpen = Date.parse(session.marketOpen);
    if (!Number.isFinite(marketOpen)) {
      throw new Error(
        `pairwise official session marketOpen is invalid: ${session.sessionId}`
      );
    }
    openTimesByTradingDate.set(key, marketOpen);
  }

  const leftRange = tradingTimeRange(
    input.left.canonicalTradingDates.sessions,
    openTimesByTradingDate
  );
  const rightRange = tradingTimeRange(
    input.right.canonicalTradingDates.sessions,
    openTimesByTradingDate
  );
  if (
    leftRange.start <= rightRange.end &&
    rightRange.start <= leftRange.end
  ) {
    return 0;
  }
  const earlierEnd = Math.min(leftRange.end, rightRange.end);
  const laterStart = Math.max(leftRange.start, rightRange.start);
  return [...openTimesByTradingDate.values()].filter(
    (marketOpen) =>
      marketOpen > earlierEnd && marketOpen < laterStart
  ).length;
}

function tradingTimeRange(
  sessions: readonly { market: string; sessionDate: string }[],
  openTimesByTradingDate: ReadonlyMap<string, number>
): { start: number; end: number } {
  if (sessions.length === 0) {
    throw new Error(
      "pairwise dependency requires non-empty canonical trading dates"
    );
  }
  const marketOpenTimes = sessions.map((session) => {
    const key = tradingDateKey(session);
    const marketOpen = openTimesByTradingDate.get(key);
    if (marketOpen === undefined) {
      throw new Error(
        `pairwise official calendar is missing trading date: ${key}`
      );
    }
    return marketOpen;
  });
  return {
    start: Math.min(...marketOpenTimes),
    end: Math.max(...marketOpenTimes)
  };
}

function tradingDateKey(value: {
  market: string;
  sessionDate: string;
}): string {
  return `${value.market}:${value.sessionDate}`;
}

function memberKey(value: {
  market: string;
  symbol: string;
}): string {
  return `${value.market}:${value.symbol}`;
}
