import {
  appendEmptyRow,
  cell,
  clear,
  emptyState,
  paragraph,
  setText
} from "./dom.js";
import {
  formatDateTime,
  formatKrw,
  formatQuantity,
  formatRatio,
  formatSignedKrw,
  formatSignedRatio,
  valueToneClass
} from "./formatters.js";
import {
  symbolCodeText,
  symbolDisplayName,
  symbolDisplayText
} from "./metadata.js";
import {
  displayActionLabel,
  tagList
} from "./decisionRenderers.js";
import {
  positionCostBasis,
  positionMarketValue
} from "./portfolioModel.js";

export function renderPositions(positions, netWorthKrw = null) {
  const body = document.getElementById("positions-body");
  clear(body);

  if (!positions.length) {
    appendEmptyRow(body, 8, "보유 포지션 없음");
    return;
  }

  for (const position of positions) {
    const marketValueKrw = positionMarketValue(position);
    const currentPriceKrw =
      Number(position.quantity) > 0
        ? Math.round(marketValueKrw / Number(position.quantity))
        : null;
    const costBasisKrw = positionCostBasis(position);
    const unrealizedPnlKrw = marketValueKrw - costBasisKrw;
    const unrealizedPnlRatio =
      costBasisKrw > 0 ? unrealizedPnlKrw / costBasisKrw : null;
    const weightRatio =
      netWorthKrw && netWorthKrw > 0 ? marketValueKrw / netWorthKrw : null;
    const row = document.createElement("tr");
    row.append(
      symbolCell(position.market, position.symbol, position),
      cell(formatQuantity(position.quantity), "numeric"),
      cell(formatKrw(position.averagePriceKrw), "numeric"),
      cell(formatKrw(currentPriceKrw), "numeric"),
      cell(formatKrw(marketValueKrw), "numeric"),
      cell(formatSignedKrw(unrealizedPnlKrw), valueToneClass(unrealizedPnlKrw, "numeric")),
      cell(formatSignedRatio(unrealizedPnlRatio), valueToneClass(unrealizedPnlRatio, "numeric")),
      cell(formatRatio(weightRatio), "numeric")
    );
    body.append(row);
  }
}

export function renderTrades(trades) {
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
      symbolCell(trade.market, trade.symbol, trade),
      cell(displayActionLabel(trade.action)),
      cell(formatKrw(trade.priceKrw), "numeric"),
      cell(formatKrw(trade.amountKrw), "numeric")
    );
    body.append(row);
  }
}

export function renderPackets(packets) {
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
    item.append(paragraph(`${packet.candidates?.length ?? 0}개 후보 · 만료 ${formatDateTime(packet.expiresAt)}`));
    item.append(tagList((packet.candidates ?? []).slice(0, 6).map((candidate) => symbolDisplayText(candidate.market, candidate.symbol, candidate)), "후보"));
    list.append(item);
  }
}

export function symbolCell(market, symbol, item = {}) {
  const td = document.createElement("td");
  const wrap = document.createElement("div");
  wrap.className = "symbol-cell";
  const name = document.createElement("strong");
  name.textContent = symbolDisplayName(market, symbol, item);
  const marketText = document.createElement("span");
  marketText.className = "market";
  marketText.textContent = symbolCodeText(market, symbol);
  wrap.append(name, marketText);
  td.append(wrap);
  return td;
}
