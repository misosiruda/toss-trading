export const state = {
  decisionItems: [],
  filters: {
    action: "ALL",
    symbol: ""
  },
  auditEvents: [],
  riskDecisions: [],
  trades: [],
  performancePoints: [],
  symbolMetadata: new Map(),
  currentPage: "overview",
  selectedBatchRunIndex: 0,
  refreshStartedAt: null,
  batchRunsTimer: null,
  batchRunsInFlight: false,
  replayProgressTimer: null,
  replayProgressInFlight: false,
  replayProgressStatus: null
};

export const replayProgressPollMs = 3000;
export const batchRunsPollMs = 5000;
export const fileModeDashboardUrl = "http://127.0.0.1:8787/dashboard";

export const fallbackSymbolMetadata = new Map([
  ["KR:000660", { name: "SK하이닉스", sector: "정보기술", industry: "반도체" }],
  ["KR:005930", { name: "삼성전자", sector: "정보기술", industry: "반도체" }],
  ["KR:028300", { name: "HLB", sector: "헬스케어", industry: "바이오/제약" }],
  [
    "KR:035420",
    { name: "NAVER", sector: "커뮤니케이션서비스", industry: "인터넷/플랫폼" }
  ],
  [
    "KR:035900",
    {
      name: "JYP Ent.",
      sector: "커뮤니케이션서비스",
      industry: "엔터테인먼트"
    }
  ],
  ["KR:042660", { name: "한화오션", sector: "산업재", industry: "조선" }]
]);
