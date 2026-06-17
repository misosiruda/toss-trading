import {
  hideError,
  setStatus,
  setText,
  showError
} from "./dom.js";
import {
  formatDateTime,
  formatKrw
} from "./formatters.js";
import { replayProgressPortfolio } from "./replayProgressRenderers.js";
import { fileModeDashboardUrl } from "./state.js";

export function showDashboardLoadingStatus() {
  hideError();
  setStatus("api-status", "loading", "새로고침 중");
}

export function showDashboardEndpointResult(failures) {
  if (failures.length) {
    setStatus("api-status", "degraded", "부분 연결");
    showError(`부분 조회 실패: ${failures.join(", ")}`);
  } else {
    setStatus("api-status", "ok", "연결됨");
  }
}

export function showFileModeNotice() {
  setStatus("api-status", "degraded", "서버 URL 필요");
  showError(
    `대시보드는 로컬 운영 API가 필요합니다. ${fileModeDashboardUrl} 로 열어주세요.`
  );
}

export function renderDashboardMetrics(data) {
  const portfolio = data.portfolio?.portfolio ?? null;
  const reportPortfolio = data.report?.portfolio ?? null;
  const replayPortfolio = replayProgressPortfolio(data.replayProgress);
  const source = data.source ?? {};

  setText(
    "metric-net-worth",
    formatKrw(
      replayPortfolio?.virtualNetWorthKrw ?? reportPortfolio?.virtualNetWorthKrw
    )
  );
  setText(
    "metric-cash",
    formatKrw(
      replayPortfolio?.cashKrw ?? portfolio?.cashKrw ?? reportPortfolio?.cashKrw
    )
  );
  setText(
    "metric-positions",
    String(
      replayPortfolio?.positionCount ?? portfolio?.positions?.length ?? 0
    )
  );
  setText("metric-source", source.status ?? "unknown");
  setStatus(
    "source-status",
    source.status ?? "unknown",
    source.status ?? "unknown"
  );
  setText(
    "portfolio-updated",
    portfolio?.updatedAt
      ? `updated ${formatDateTime(portfolio.updatedAt)}`
      : "no portfolio"
  );
}
