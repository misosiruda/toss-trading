const state = {
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
  packets: "/market/packets?limit=5"
};

document.getElementById("refresh-button")?.addEventListener("click", () => {
  void loadDashboard().catch(() => undefined);
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
  renderDecisions(data.decisions?.decisions ?? []);
  renderRiskSummary(report.riskSummary, report.decisionOutcome);
  renderTrades(data.trades?.trades ?? []);
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

function renderDecisions(records) {
  const list = document.getElementById("decision-list");
  clear(list);

  const items = records.flatMap((record) =>
    (record.decisions ?? []).map((decision) => ({
      ...decision,
      packetId: record.packetId,
      summary: record.summary
    }))
  );
  setText("decision-count", `${items.length} items`);

  if (!items.length) {
    list.append(emptyState("AI 판단 기록 없음"));
    return;
  }

  for (const item of items.slice(0, 10)) {
    const article = document.createElement("article");
    article.className = "decision-item";

    const top = document.createElement("div");
    top.className = "decision-topline";

    const symbol = document.createElement("div");
    symbol.className = "decision-symbol";
    symbol.append(actionPill(item.action), document.createTextNode(`${item.market}:${item.symbol}`));

    const meta = document.createElement("div");
    meta.className = "decision-meta";
    meta.textContent = `confidence ${formatPercent(item.confidence)} · budget ${formatKrw(item.budgetKrw)}`;

    top.append(symbol, meta);
    article.append(top);
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
