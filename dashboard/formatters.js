export function formatKrw(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${new Intl.NumberFormat("ko-KR").format(Number(value))}원`;
}

export function formatSignedKrw(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  const number = Number(value);
  const prefix = number > 0 ? "+" : "";
  return `${prefix}${formatKrw(number)}`;
}

export function compactKrw(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(Number(value))}원`;
}

export function formatExposureBreakdown(values) {
  const entries = Object.entries(values ?? {})
    .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) {
    return "-";
  }
  return entries
    .map(([key, value]) => `${key} ${compactKrw(value)}`)
    .join(" · ");
}

export function formatQuantity(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 6
  }).format(Number(value));
}

export function formatPercent(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${Math.round(Number(value) * 100)}%`;
}

export function formatRatio(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${(Number(value) * 100).toFixed(2)}%`;
}

export function formatDurationMs(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  const milliseconds = Number(value);
  if (milliseconds < 1_000) {
    return `${Math.round(milliseconds)}ms`;
  }
  const seconds = milliseconds / 1_000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}초`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return `${minutes}분 ${remainingSeconds}초`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}시간 ${remainingMinutes}분`;
}

export function performanceBottleneckLabel(value) {
  if (value === "packet_build") {
    return "packet build";
  }
  if (value === "sampling") {
    return "sampling";
  }
  if (value === "decision_provider") {
    return "AI 판단";
  }
  if (value === "order_execution") {
    return "리스크/체결";
  }
  if (value === "none") {
    return "없음";
  }
  return "-";
}

export function formatSignedRatio(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  const number = Number(value);
  const prefix = number > 0 ? "+" : "";
  return `${prefix}${(number * 100).toFixed(2)}%`;
}

export function formatDateTime(value) {
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

export function formatDateOnly(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function average(values) {
  const finiteValues = values.filter(
    (value) =>
      value !== null &&
      value !== undefined &&
      Number.isFinite(Number(value))
  );
  if (!finiteValues.length) {
    return null;
  }
  return (
    finiteValues.reduce((sum, value) => sum + Number(value), 0) /
    finiteValues.length
  );
}

export function valueToneClass(value, baseClass = "") {
  const number = Number(value);
  const tone =
    Number.isFinite(number) && number > 0
      ? "positive"
      : Number.isFinite(number) && number < 0
        ? "negative"
        : "";
  return [baseClass, tone].filter(Boolean).join(" ");
}
