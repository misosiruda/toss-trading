/** Operator configuration only; never accept a query, API response, or browser value. */
export type LegacyCompatibility = { status: "configured"; origin: string } | { status: "missing" | "invalid" };

export function resolveLegacyCompatibility(value: string | undefined): LegacyCompatibility {
  if (value === undefined || value === "") return { status: "missing" };
  // Check raw origin shape before URL parsing can erase dot-path segments.
  if (value.length > 2048 || /[\s\\%?#]/.test(value) || !/^https?:\/\/[^/?#]+\/?$/.test(value)) return { status: "invalid" };
  try {
    const url = new URL(value);
    const loopback = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[1-9]\d{0,4})?\/?$/.test(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.port === "0" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) return { status: "invalid" };
    return { status: "configured", origin: url.origin };
  } catch {
    return { status: "invalid" };
  }
}

export const LEGACY_DESTINATIONS = {
  overview: { path: "/dashboard", label: "기존 운영 호환 화면" },
  current: { path: "/dashboard/virtual/simulations/current", label: "기존 실험 기록 호환 화면" },
  validation: { path: "/dashboard/virtual/validation", label: "기존 검증 자료 호환 화면" }
} as const;
