import { valueToneClass } from "./formatters.js";

export function cell(value, className) {
  const td = document.createElement("td");
  if (className) {
    td.className = className;
  }
  td.textContent = value ?? "-";
  return td;
}

export function paragraph(value) {
  const node = document.createElement("p");
  node.className = "decision-text";
  node.textContent = value ?? "-";
  return node;
}

export function appendDefinition(list, term, description) {
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = description ?? "-";
  list.append(dt, dd);
}

export function appendEmptyRow(body, colspan, message) {
  const row = document.createElement("tr");
  const empty = document.createElement("td");
  empty.colSpan = colspan;
  empty.append(emptyState(message));
  row.append(empty);
  body.append(row);
}

export function emptyState(message) {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = message;
  return node;
}

export function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value ?? "-";
  }
}

export function setStatus(id, status, text) {
  const node = document.getElementById(id);
  if (!node) {
    return;
  }
  node.className = `status-pill ${statusClass(status)}`;
  node.textContent = text;
}

export function setProgressBar(id, percent) {
  const node = document.getElementById(id);
  if (node) {
    node.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  }
}

export function statusClass(status) {
  if (status === "ok" || status === "completed") {
    return "ok";
  }
  if (
    status === "degraded" ||
    status === "loading" ||
    status === "unknown" ||
    status === "running" ||
    status === "skipped" ||
    status === "completed_with_failures"
  ) {
    return "degraded";
  }
  if (
    status === "error" ||
    status === "blocked" ||
    status === "corrupt" ||
    status === "failed"
  ) {
    return "error";
  }
  return "neutral";
}

export function clear(node) {
  if (node) {
    node.replaceChildren();
  }
}

export function showError(message) {
  const banner = document.getElementById("error-banner");
  if (!banner) {
    return;
  }
  banner.textContent = message;
  banner.hidden = false;
}

export function hideError() {
  const banner = document.getElementById("error-banner");
  if (banner) {
    banner.hidden = true;
  }
}

export function setValueTone(id, value) {
  const node = document.getElementById(id);
  if (!node) {
    return;
  }
  node.classList.remove("positive", "negative");
  const tone = valueToneClass(value);
  if (tone) {
    node.classList.add(tone);
  }
}

export function svgNode(name, attributes) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }
  return node;
}
