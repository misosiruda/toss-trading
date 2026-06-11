const state = {
  decisionItems: [],
  filters: {
    action: "ALL",
    symbol: ""
  },
  auditEvents: [],
  trades: [],
  refreshStartedAt: null
};

const endpoints = {
  health: "/health",
  portfolio: "/virtual/portfolio",
  decisions: "/virtual/decisions?limit=20",
  trades: "/virtual/trades?limit=20",
  report: "/paper/report",
  scheduler: "/scheduler/status",
  source: "/source/health",
  packets: "/market/packets?limit=5",
  audit: "/audit/events?limit=100"
};

document.getElementById("refresh-button")?.addEventListener("click", () => {
  void loadDashboard().catch(() => undefined);
});

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

void loadDashboard().catch(() => undefined);

async function loadDashboard() {
  state.refreshStartedAt = new Date();
  hideError();
  setStatus("api-status", "loading", "새로고침 중");

  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([key, path]) => {
      return [key, await fetchJson(path)];
    })
  );
  const data = Object.fromEntries(entries);

  renderDashboard(data);
  setStatus("api-status", "ok", "연결됨");
}

async function fetchJson(path) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`${path} returned ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    setStatus("api-status", "error", "연결 실패");
    showError(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function renderDashboard(data) {
  const portfolio = data.portfolio?.portfolio ?? null;
  const reportPortfolio = data.report?.portfolio ?? null;
  const source = data.source ?? {};
  const report = data.report ?? {};

  setText("metric-net-worth", formatKrw(reportPortfolio?.virtualNetWorthKrw));
  setText("metric-cash", formatKrw(portfolio?.cashKrw ?? reportPortfolio?.cashKrw));
  setText("metric-positions", String(portfolio?.positions?.length ?? 0));
  setText("metric-source", source.status ?? "unknown");
  setStatus("source-status", source.status ?? "unknown", source.status ?? "unknown");
  setText(
    "portfolio-updated",
    portfolio?.updatedAt ? `updated ${formatDateTime(portfolio.updatedAt)}` : "no portfolio"
  );

  renderPositions(portfolio?.positions ?? []);
  renderSourceSummary(source, data.scheduler);
  state.auditEvents = data.audit?.events ?? [];
  state.trades = data.trades?.trades ?? [];
  state.decisionItems = flattenDecisionRecords(data.decisions?.decisions ?? []);
  updateFilterControls();
  renderDecisionTimeline();
  renderRiskSummary(report.riskSummary, report.decisionOutcome);
  renderTrades(state.trades);
  renderPackets(data.packets?.packets ?? []);
}

function renderPositions(positions) {
  const body = document.getElementById("positions-body");
  clear(body);

  if (!positions.length) {
    appendEmptyRow(body, 5, "보유 포지션 없음");
    return;
  }

  for (const position of positions) {
    const row = document.createElement("tr");
    row.append(
      symbolCell(position.market, position.symbol),
      cell(formatQuantity(position.quantity), "numeric"),
      cell(formatKrw(position.averagePriceKrw), "numeric"),
      cell(formatKrw(position.marketValueKrw), "numeric"),
      cell(formatKrw(position.unrealizedPnlKrw), "numeric")
    );
    body.append(row);
  }
}

function renderSourceSummary(source, scheduler) {
  const list = document.getElementById("source-summary");
  clear(list);
  appendDefinition(list, "수집 건수", String(source.totalCount ?? 0));
  appendDefinition(list, "최근 수집", formatDateTime(source.lastCollectedAt));
  appendDefinition(list, "오류 라인", String(source.corruptLineCount ?? 0));
  appendDefinition(list, "명령", summarizeRecord(source.byCommandKey));
  appendDefinition(list, "스케줄러", scheduler?.stateStatus ?? "unknown");
}

function flattenDecisionRecords(records) {
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

function renderDecisionTimeline() {
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
    symbol.append(actionPill(item.action), document.createTextNode(`${item.market}:${item.symbol}`));

    const meta = document.createElement("div");
    meta.className = "decision-meta";
    meta.textContent = `confidence ${formatPercent(item.confidence)} · budget ${formatKrw(item.budgetKrw)} · ${decisionFreshness(item.expiresAt)}`;
    if (isExpired(item.expiresAt)) {
      meta.classList.add("expired");
    }

    top.append(symbol, meta);
    article.append(top);
    article.append(decisionOutcomeRow(item));
    article.append(paragraph(item.thesis));

    if (item.riskFactors?.length) {
      article.append(tagList(item.riskFactors, "risk"));
    }
    if (item.dataRefs?.length) {
      article.append(tagList(item.dataRefs, "data"));
    }

    const packet = document.createElement("p");
    packet.className = "decision-meta";
    packet.textContent = `${item.packetId} · expires ${formatDateTime(item.expiresAt)}`;
    article.append(packet);
    list.append(article);
  }
}

function decisionOutcomeRow(item) {
  const row = document.createElement("div");
  row.className = "decision-outcome";
  const riskEvent = findRiskEvent(item);
  const trade = findTrade(item);

  row.append(
    outcomeBadge(
      riskEvent
        ? riskEvent.eventType.replace("VIRTUAL_RISK_", "risk ")
        : "risk not found",
      riskEvent?.eventType
    ),
    outcomeBadge(
      trade ? `${trade.status} ${formatKrw(trade.amountKrw)}` : "no virtual trade",
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

function filterDecisionItems(items) {
  const action = state.filters.action;
  const symbol = state.filters.symbol.trim().toUpperCase();
  return items.filter((item) => {
    if (action !== "ALL" && item.action !== `VIRTUAL_${action}`) {
      return false;
    }
    const fullSymbol = `${item.market}:${item.symbol}`.toUpperCase();
    const shortSymbol = String(item.symbol).toUpperCase();
    if (
      symbol &&
      !fullSymbol.includes(symbol) &&
      !shortSymbol.includes(symbol)
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
    title.textContent = symbol;
    const meta = document.createElement("span");
    meta.textContent = `${summary.total} total · B ${summary.buy} · S ${summary.sell} · H ${summary.hold}`;
    item.append(title, meta);
    groups.append(item);
  }
}

function updateFilterControls() {
  const counts = countActions(state.decisionItems);
  document.querySelectorAll("[data-action-filter]").forEach((button) => {
    const filter = button.getAttribute("data-action-filter") ?? "ALL";
    button.classList.toggle("active", filter === state.filters.action);
    const count = counts[filter] ?? 0;
    button.textContent = filter === "ALL" ? `All ${count}` : `${titleCase(filter)} ${count}`;
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

function renderRiskSummary(riskSummary, decisionOutcome) {
  const list = document.getElementById("risk-summary");
  clear(list);
  appendDefinition(list, "승인", String(riskSummary?.approvedCount ?? 0));
  appendDefinition(list, "거절", String(riskSummary?.rejectedCount ?? 0));
  appendDefinition(list, "판단 수", String(decisionOutcome?.decisionItemCount ?? 0));
  appendDefinition(list, "액션", summarizeRecord(decisionOutcome?.byAction));
  appendDefinition(
    list,
    "최근 거절",
    (riskSummary?.recentRejectedSummaries ?? []).join(" | ") || "none"
  );
}

function renderTrades(trades) {
  const body = document.getElementById("trades-body");
  clear(body);
  setText("trade-count", `${trades.length} items`);

  if (!trades.length) {
    appendEmptyRow(body, 5, "가상 체결 없음");
    return;
  }

  for (const trade of trades) {
    const row = document.createElement("tr");
    row.append(
      cell(formatDateTime(trade.executedAt)),
      symbolCell(trade.market, trade.symbol),
      cell(trade.action),
      cell(formatKrw(trade.priceKrw), "numeric"),
      cell(formatKrw(trade.amountKrw), "numeric")
    );
    body.append(row);
  }
}

function renderPackets(packets) {
  const list = document.getElementById("packet-list");
  clear(list);

  if (!packets.length) {
    list.append(emptyState("Market packet 없음"));
    return;
  }

  for (const packet of packets) {
    const item = document.createElement("article");
    item.className = "packet-item";
    const title = document.createElement("strong");
    title.textContent = packet.packetId;
    item.append(title);
    item.append(paragraph(`${packet.candidates?.length ?? 0} candidates · expires ${formatDateTime(packet.expiresAt)}`));
    item.append(tagList((packet.candidates ?? []).slice(0, 6).map((candidate) => `${candidate.market}:${candidate.symbol}`), "candidate"));
    list.append(item);
  }
}

function actionPill(action) {
  const pill = document.createElement("span");
  const normalized = String(action ?? "").replace("VIRTUAL_", "").toLowerCase();
  pill.className = `action-pill ${normalized}`;
  pill.textContent = String(action ?? "UNKNOWN").replace("VIRTUAL_", "");
  return pill;
}

function tagList(values, prefix) {
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

function symbolCell(market, symbol) {
  const td = document.createElement("td");
  const wrap = document.createElement("div");
  wrap.className = "symbol-cell";
  const code = document.createElement("strong");
  code.textContent = symbol ?? "-";
  const marketText = document.createElement("span");
  marketText.className = "market";
  marketText.textContent = market ?? "-";
  wrap.append(code, marketText);
  td.append(wrap);
  return td;
}

function cell(value, className) {
  const td = document.createElement("td");
  if (className) {
    td.className = className;
  }
  td.textContent = value ?? "-";
  return td;
}

function paragraph(value) {
  const node = document.createElement("p");
  node.className = "decision-text";
  node.textContent = value ?? "-";
  return node;
}

function appendDefinition(list, term, description) {
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = description ?? "-";
  list.append(dt, dd);
}

function appendEmptyRow(body, colspan, message) {
  const row = document.createElement("tr");
  const empty = document.createElement("td");
  empty.colSpan = colspan;
  empty.append(emptyState(message));
  row.append(empty);
  body.append(row);
}

function emptyState(message) {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = message;
  return node;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value ?? "-";
  }
}

function setStatus(id, status, text) {
  const node = document.getElementById(id);
  if (!node) {
    return;
  }
  node.className = `status-pill ${statusClass(status)}`;
  node.textContent = text;
}

function statusClass(status) {
  if (status === "ok") {
    return "ok";
  }
  if (status === "degraded" || status === "loading" || status === "unknown") {
    return "degraded";
  }
  if (status === "error" || status === "blocked" || status === "corrupt") {
    return "error";
  }
  return "neutral";
}

function clear(node) {
  if (node) {
    node.replaceChildren();
  }
}

function showError(message) {
  const banner = document.getElementById("error-banner");
  if (!banner) {
    return;
  }
  banner.textContent = message;
  banner.hidden = false;
}

function hideError() {
  const banner = document.getElementById("error-banner");
  if (banner) {
    banner.hidden = true;
  }
}

function formatKrw(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${new Intl.NumberFormat("ko-KR").format(Number(value))}원`;
}

function formatQuantity(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 6
  }).format(Number(value));
}

function formatPercent(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${Math.round(Number(value) * 100)}%`;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function decisionFreshness(expiresAt) {
  return isExpired(expiresAt)
    ? `expired ${formatDateTime(expiresAt)}`
    : `expires ${formatDateTime(expiresAt)}`;
}

function isExpired(value) {
  if (!value) {
    return false;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() < Date.now();
}

function titleCase(value) {
  const lower = String(value).toLowerCase();
  return `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
}

function summarizeRecord(value) {
  if (!value || typeof value !== "object") {
    return "none";
  }
  const entries = Object.entries(value);
  if (!entries.length) {
    return "none";
  }
  return entries.map(([key, count]) => `${key}:${count}`).join(", ");
}
