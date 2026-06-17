import {
  appendDefinition,
  clear,
  emptyState,
  paragraph,
  setText,
  setValueTone
} from "./dom.js";
import {
  average,
  formatDateTime,
  formatKrw,
  formatPercent,
  formatRatio,
  formatSignedRatio,
  valueToneClass
} from "./formatters.js";
import {
  metadataForSymbol,
  symbolDisplayName,
  symbolDisplayText
} from "./metadata.js";
import { state } from "./state.js";

export function flattenDecisionRecords(records) {
  return records.flatMap((record, recordIndex) =>
    (record.decisions ?? []).map((decision, decisionIndex) => ({
      ...decision,
      packetId: record.packetId,
      summary: record.summary,
      recordIndex,
      decisionIndex
    }))
  );
}

export function bindDecisionFilterControls() {
  document.querySelectorAll("[data-action-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filters.action = button.getAttribute("data-action-filter") ?? "ALL";
      updateFilterControls();
      renderDecisionTimeline();
    });
  });

  document.getElementById("symbol-filter")?.addEventListener("input", (event) => {
    const target = event.target;
    state.filters.symbol = target instanceof HTMLInputElement ? target.value : "";
    renderDecisionTimeline();
  });
}

export function renderDecisionTimeline() {
  const list = document.getElementById("decision-list");
  clear(list);

  const filteredItems = filterDecisionItems(state.decisionItems);
  setText(
    "decision-count",
    `${filteredItems.length}/${state.decisionItems.length} items`
  );
  renderDecisionGroups(filteredItems);

  if (!filteredItems.length) {
    list.append(emptyState("AI 판단 기록 없음"));
    return;
  }

  for (const item of filteredItems.slice(0, 10)) {
    const article = document.createElement("article");
    article.className = "decision-item";

    const top = document.createElement("div");
    top.className = "decision-topline";

    const symbol = document.createElement("div");
    symbol.className = "decision-symbol";
    symbol.append(actionPill(item.action), document.createTextNode(symbolDisplayText(item.market, item.symbol, item)));

    const meta = document.createElement("div");
    meta.className = "decision-meta";
    meta.textContent = `확신도 ${formatPercent(item.confidence)} · 예산 ${formatKrw(item.budgetKrw)} · ${decisionFreshness(item.expiresAt)}`;
    if (isExpired(item.expiresAt)) {
      meta.classList.add("expired");
    }

    top.append(symbol, meta);
    article.append(top);
    article.append(decisionOutcomeRow(item));
    article.append(decisionRationale(item));
    list.append(article);
  }
}

export function renderDecisionPerformance(data) {
  const list = document.getElementById("decision-performance-list");
  clear(list);

  const outcomes = buildDecisionPerformanceOutcomes(data);
  const evaluated = outcomes.filter((item) => item.isEvaluated);
  setText(
    "decision-performance-count",
    `${evaluated.length}/${outcomes.length} 평가`
  );

  const buyOutcomes = evaluated.filter((item) => item.action === "VIRTUAL_BUY");
  const sellOutcomes = evaluated.filter((item) => item.action === "VIRTUAL_SELL");
  const holdOutcomes = evaluated.filter((item) => item.action === "VIRTUAL_HOLD");
  const averageDecisionReturn = average(
    evaluated.map((item) => item.decisionReturnRatio)
  );
  const holdOpportunity = average(
    holdOutcomes.map((item) => item.holdOpportunityRatio)
  );

  setText("decision-performance-average", formatSignedRatio(averageDecisionReturn));
  setText(
    "decision-performance-buy-hit-rate",
    hitRateText(buyOutcomes)
  );
  setText(
    "decision-performance-sell-hit-rate",
    hitRateText(sellOutcomes)
  );
  setText(
    "decision-performance-hold-opportunity",
    formatRatio(holdOpportunity)
  );
  setValueTone("decision-performance-average", averageDecisionReturn);

  if (!outcomes.length) {
    list.append(emptyState("AI 판단 성과 데이터 없음"));
    return;
  }

  for (const item of outcomes.slice(0, 8)) {
    const article = document.createElement("article");
    article.className = "decision-performance-item";
    const top = document.createElement("div");
    top.className = "decision-performance-topline";
    const symbol = document.createElement("div");
    symbol.className = "decision-performance-symbol";
    symbol.append(actionPill(item.action), document.createTextNode(symbolDisplayText(item.market, item.symbol, item)));
    const result = document.createElement("strong");
    result.className = valueToneClass(item.decisionReturnRatio);
    result.textContent = item.isEvaluated
      ? formatSignedRatio(item.decisionReturnRatio)
      : "평가 대기";
    top.append(symbol, result);

    const detail = document.createElement("p");
    detail.className = "decision-performance-detail";
    detail.textContent = item.isEvaluated
      ? [
          `판단가 ${formatKrw(item.decisionPriceKrw)}`,
          `최신가 ${formatKrw(item.latestPriceKrw)}`,
          `가격변화 ${formatSignedRatio(item.priceMoveRatio)}`,
          item.action === "VIRTUAL_HOLD"
            ? `기회비용 ${formatRatio(item.holdOpportunityRatio)}`
            : item.isHit
              ? "적중"
              : "미적중",
          item.packetId
        ].join(" · ")
      : [
          "판단 시점 또는 최신 가격 데이터 부족",
          item.packetId
        ].join(" · ");

    article.append(top, detail);
    list.append(article);
  }
}

function buildDecisionPerformanceOutcomes(data) {
  const progress = data?.replayProgress?.progress ?? null;
  const records = progress?.recentDecisions ?? data?.decisions?.decisions ?? [];
  const packets = progress?.recentPackets ?? data?.packets?.packets ?? [];
  const packetById = new Map(
    packets.map((packet) => [packet.packetId, packet])
  );
  const latestPrices = latestPricesBySymbol(packets);

  return flattenDecisionRecords(records).map((item) => {
    const packet = packetById.get(item.packetId);
    const candidate = packet?.candidates?.find(
      (entry) => entry.market === item.market && entry.symbol === item.symbol
    );
    const latest = latestPrices.get(`${item.market}:${item.symbol}`);
    const decisionPriceKrw = Number(candidate?.lastPriceKrw);
    const latestPriceKrw = Number(latest?.priceKrw);
    const isEvaluated =
      Number.isFinite(decisionPriceKrw) &&
      decisionPriceKrw > 0 &&
      Number.isFinite(latestPriceKrw);
    const priceMoveRatio = isEvaluated
      ? (latestPriceKrw - decisionPriceKrw) / decisionPriceKrw
      : null;
    const decisionReturnRatio = decisionPerformanceReturn(
      item.action,
      priceMoveRatio
    );
    const holdOpportunityRatio =
      item.action === "VIRTUAL_HOLD" && priceMoveRatio !== null
        ? Math.max(priceMoveRatio, 0)
        : null;

    return {
      market: item.market,
      symbol: item.symbol,
      name: metadataForSymbol(item.market, item.symbol, candidate ?? item).name,
      action: item.action,
      packetId: item.packetId,
      isEvaluated,
      decisionPriceKrw: isEvaluated ? decisionPriceKrw : null,
      latestPriceKrw: isEvaluated ? latestPriceKrw : null,
      priceMoveRatio,
      decisionReturnRatio,
      holdOpportunityRatio,
      isHit: decisionReturnRatio !== null ? decisionReturnRatio > 0 : false
    };
  });
}

function latestPricesBySymbol(packets) {
  const latest = new Map();
  const sorted = [...packets].sort(
    (left, right) => new Date(right.generatedAt) - new Date(left.generatedAt)
  );
  for (const packet of sorted) {
    for (const candidate of packet.candidates ?? []) {
      const key = `${candidate.market}:${candidate.symbol}`;
      if (!latest.has(key)) {
        latest.set(key, {
          priceKrw: candidate.lastPriceKrw,
          generatedAt: packet.generatedAt
        });
      }
    }
  }
  return latest;
}

function decisionPerformanceReturn(action, priceMoveRatio) {
  if (priceMoveRatio === null || Number.isNaN(Number(priceMoveRatio))) {
    return null;
  }
  if (action === "VIRTUAL_BUY") {
    return priceMoveRatio;
  }
  if (action === "VIRTUAL_SELL" || action === "VIRTUAL_HOLD") {
    return -priceMoveRatio;
  }
  return null;
}

function hitRateText(outcomes) {
  if (!outcomes.length) {
    return "-";
  }
  const hits = outcomes.filter((item) => item.isHit).length;
  return `${formatRatio(hits / outcomes.length)} (${hits}/${outcomes.length})`;
}

function decisionOutcomeRow(item) {
  const row = document.createElement("div");
  row.className = "decision-outcome";
  const riskEvent = findRiskEvent(item);
  const trade = findTrade(item);

  row.append(
    outcomeBadge(
      riskOutcomeLabel(riskEvent),
      riskEvent?.eventType
    ),
    outcomeBadge(
      tradeOutcomeLabel(trade),
      trade?.status
    )
  );
  return row;
}

function outcomeBadge(label, status) {
  const badge = document.createElement("span");
  badge.className = `outcome-badge ${outcomeClass(status)}`;
  badge.textContent = label;
  return badge;
}

function outcomeClass(status) {
  if (status === "VIRTUAL_RISK_APPROVED" || status === "VIRTUAL_FILLED") {
    return "ok";
  }
  if (status === "VIRTUAL_RISK_REJECTED" || status === "VIRTUAL_REJECTED") {
    return "error";
  }
  return "neutral";
}

function findRiskEvent(item) {
  const riskDecision = state.riskDecisions.find((decision) => {
    return (
      decision.packetId === item.packetId &&
      (!decision.symbol || decision.symbol === item.symbol)
    );
  });
  if (riskDecision) {
    return {
      eventType: riskDecision.approved
        ? "VIRTUAL_RISK_APPROVED"
        : "VIRTUAL_RISK_REJECTED",
      summary: `${item.market}:${item.symbol} ${item.action}`
    };
  }

  const summary = `${item.market}:${item.symbol} ${item.action}`;
  return state.auditEvents.find((event) => {
    return (
      (event.eventType === "VIRTUAL_RISK_APPROVED" ||
        event.eventType === "VIRTUAL_RISK_REJECTED") &&
      String(event.summary ?? "").startsWith(summary)
    );
  });
}

function findTrade(item) {
  return state.trades.find((trade) => {
    return (
      trade.packetId === item.packetId &&
      trade.market === item.market &&
      trade.symbol === item.symbol &&
      trade.action === item.action
    );
  });
}

function decisionRationale(item) {
  const wrap = document.createElement("div");
  wrap.className = "decision-rationale";
  wrap.append(
    evidenceBlock(`${displayActionLabel(item.action)} 판단 근거`, paragraph(item.thesis)),
    evidenceBlock(
      "리스크 요인",
      item.riskFactors?.length
        ? bulletList(item.riskFactors)
        : paragraph("none")
    ),
    evidenceBlock(
      "데이터 근거",
      item.dataRefs?.length ? tagList(item.dataRefs, "data") : paragraph("none")
    ),
    evidenceBlock(
      "판단 컨텍스트",
      detailLine([
        `확신도 ${formatPercent(item.confidence)}`,
        `예산 ${formatKrw(item.budgetKrw)}`,
        decisionFreshness(item.expiresAt),
        item.packetId
      ])
    )
  );
  return wrap;
}

function evidenceBlock(title, content) {
  const block = document.createElement("section");
  block.className = "evidence-block";
  const heading = document.createElement("h3");
  heading.textContent = title;
  block.append(heading, content);
  return block;
}

function bulletList(values) {
  const list = document.createElement("ul");
  list.className = "evidence-list";
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  }
  return list;
}

function detailLine(values) {
  const node = document.createElement("p");
  node.className = "decision-meta detail-line";
  node.textContent = values.filter(Boolean).join(" · ");
  return node;
}

function filterDecisionItems(items) {
  const action = state.filters.action;
  const symbol = state.filters.symbol.trim().toUpperCase();
  return items.filter((item) => {
    if (action !== "ALL" && item.action !== `VIRTUAL_${action}`) {
      return false;
    }
    const fullSymbol = `${item.market}:${item.symbol}`.toUpperCase();
    const shortSymbol = String(item.symbol).toUpperCase();
    const displayName = symbolDisplayName(item.market, item.symbol, item).toUpperCase();
    if (
      symbol &&
      !fullSymbol.includes(symbol) &&
      !shortSymbol.includes(symbol) &&
      !displayName.includes(symbol)
    ) {
      return false;
    }
    return true;
  });
}

function renderDecisionGroups(items) {
  const groups = document.getElementById("decision-groups");
  clear(groups);

  const bySymbol = new Map();
  for (const item of items) {
    const key = `${item.market}:${item.symbol}`;
    const current = bySymbol.get(key) ?? { total: 0, buy: 0, sell: 0, hold: 0 };
    current.total += 1;
    if (item.action === "VIRTUAL_BUY") {
      current.buy += 1;
    } else if (item.action === "VIRTUAL_SELL") {
      current.sell += 1;
    } else if (item.action === "VIRTUAL_HOLD") {
      current.hold += 1;
    }
    bySymbol.set(key, current);
  }

  for (const [symbol, summary] of Array.from(bySymbol.entries()).slice(0, 8)) {
    const item = document.createElement("div");
    item.className = "decision-group";
    const title = document.createElement("strong");
    const [market, code] = symbol.split(":");
    title.textContent = symbolDisplayText(market, code);
    const meta = document.createElement("span");
    meta.textContent = `${summary.total}개 · 매수 ${summary.buy} · 매도 ${summary.sell} · 보류 ${summary.hold}`;
    item.append(title, meta);
    groups.append(item);
  }
}

export function updateFilterControls() {
  const counts = countActions(state.decisionItems);
  document.querySelectorAll("[data-action-filter]").forEach((button) => {
    const filter = button.getAttribute("data-action-filter") ?? "ALL";
    button.classList.toggle("active", filter === state.filters.action);
    const count = counts[filter] ?? 0;
    button.textContent =
      filter === "ALL" ? `전체 ${count}` : `${displayFilterLabel(filter)} ${count}`;
  });
}

function countActions(items) {
  const counts = { ALL: items.length, BUY: 0, SELL: 0, HOLD: 0 };
  for (const item of items) {
    const action = String(item.action ?? "").replace("VIRTUAL_", "");
    if (action in counts) {
      counts[action] += 1;
    }
  }
  return counts;
}

export function renderRiskSummary(riskSummary, decisionOutcome) {
  const list = document.getElementById("risk-summary");
  clear(list);
  appendDefinition(list, "승인", String(riskSummary?.approvedCount ?? 0));
  appendDefinition(list, "거절", String(riskSummary?.rejectedCount ?? 0));
  appendDefinition(list, "판단 수", String(decisionOutcome?.decisionItemCount ?? 0));
  appendDefinition(list, "액션", summarizeActionRecord(decisionOutcome?.byAction));
  appendDefinition(
    list,
    "최근 거절",
    (riskSummary?.recentRejectedSummaries ?? []).join(" | ") || "none"
  );
}

function actionPill(action) {
  const pill = document.createElement("span");
  const normalized = actionLabel(action).toLowerCase();
  pill.className = `action-pill ${normalized}`;
  pill.textContent = displayActionLabel(action);
  return pill;
}

function actionLabel(action) {
  return String(action ?? "UNKNOWN").replace("VIRTUAL_", "");
}

export function displayActionLabel(action) {
  const normalized = actionLabel(action);
  if (normalized === "BUY") {
    return "매수";
  }
  if (normalized === "SELL") {
    return "매도";
  }
  if (normalized === "HOLD") {
    return "보류";
  }
  return normalized;
}

function displayFilterLabel(filter) {
  if (filter === "BUY") {
    return "매수";
  }
  if (filter === "SELL") {
    return "매도";
  }
  if (filter === "HOLD") {
    return "보류";
  }
  return String(filter ?? "-");
}

function riskOutcomeLabel(riskEvent) {
  if (!riskEvent) {
    return "리스크 미확인";
  }
  if (riskEvent.eventType === "VIRTUAL_RISK_APPROVED") {
    return "리스크 승인";
  }
  if (riskEvent.eventType === "VIRTUAL_RISK_REJECTED") {
    return "리스크 반려";
  }
  return String(riskEvent.eventType ?? "-");
}

function tradeOutcomeLabel(trade) {
  if (!trade) {
    return "가상 체결 없음";
  }
  return `${tradeStatusLabel(trade.status)} ${formatKrw(trade.amountKrw)}`;
}

function tradeStatusLabel(status) {
  if (status === "VIRTUAL_FILLED") {
    return "체결";
  }
  if (status === "VIRTUAL_REJECTED") {
    return "반려";
  }
  if (status === "VIRTUAL_PENDING") {
    return "대기";
  }
  if (status === "VIRTUAL_EXPIRED") {
    return "만료";
  }
  return String(status ?? "-");
}

export function tagList(values, prefix) {
  const wrap = document.createElement("div");
  wrap.className = "tag-list";
  for (const value of values) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = `${prefix}: ${value}`;
    wrap.append(tag);
  }
  return wrap;
}

function decisionFreshness(expiresAt) {
  return isExpired(expiresAt)
    ? `만료 ${formatDateTime(expiresAt)}`
    : `만료 예정 ${formatDateTime(expiresAt)}`;
}

function isExpired(value) {
  if (!value) {
    return false;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() < Date.now();
}

function summarizeActionRecord(value) {
  if (!value || typeof value !== "object") {
    return "none";
  }
  const entries = Object.entries(value);
  if (!entries.length) {
    return "none";
  }
  return entries
    .map(([key, count]) => `${displayActionLabel(key)}:${count}`)
    .join(", ");
}
