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
  currentPage: "live",
  selectedBatchRunIndex: 0,
  selectedBatchRunBatchKey: null,
  pendingSimulationBatchId: null,
  refreshStartedAt: null,
  lastEndpointData: null,
  batchRunsTimer: null,
  batchRunsInFlight: false,
  replayProgressTimer: null,
  replayProgressInFlight: false,
  replayProgressStatus: null
};

export const replayProgressPollMs = 3000;
export const batchRunsPollMs = 1000;
export const fileModeDashboardUrl = "http://127.0.0.1:8787/dashboard";

export const fallbackSymbolMetadata = new Map([
  ["KR:000270", { name: "기아", sector: "경기소비재", industry: "자동차" }],
  ["KR:000810", { name: "삼성화재", sector: "금융", industry: "손해보험" }],
  ["KR:000660", { name: "SK하이닉스", sector: "정보기술", industry: "반도체" }],
  ["KR:005930", { name: "삼성전자", sector: "정보기술", industry: "반도체" }],
  ["KR:009150", { name: "삼성전기", sector: "정보기술", industry: "전자부품" }],
  ["KR:009540", { name: "HD한국조선해양", sector: "산업재", industry: "조선" }],
  ["KR:010130", { name: "고려아연", sector: "소재", industry: "비철금속" }],
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
  ["KR:039030", { name: "이오테크닉스", sector: "정보기술", industry: "반도체장비" }],
  ["KR:042660", { name: "한화오션", sector: "산업재", industry: "조선" }],
  ["KR:058470", { name: "리노공업", sector: "정보기술", industry: "반도체부품" }],
  ["KR:078340", { name: "컴투스", sector: "커뮤니케이션서비스", industry: "게임" }],
  ["KR:196170", { name: "알테오젠", sector: "헬스케어", industry: "바이오/제약" }],
  ["KR:251270", { name: "넷마블", sector: "커뮤니케이션서비스", industry: "게임" }],
  [
    "KR:252670",
    { name: "KODEX 200선물인버스2X", sector: "ETF", industry: "인버스/레버리지" }
  ],
  ["KR:259960", { name: "크래프톤", sector: "커뮤니케이션서비스", industry: "게임" }],
  ["KR:267260", { name: "HD현대일렉트릭", sector: "산업재", industry: "전력기기" }],
  ["KR:277810", { name: "레인보우로보틱스", sector: "산업재", industry: "로봇" }],
  ["KR:278240", { name: "미국나스닥100 ETF", sector: "ETF", industry: "미국 주식" }],
  ["KR:293490", { name: "카카오게임즈", sector: "커뮤니케이션서비스", industry: "게임" }],
  ["KR:373220", { name: "LG에너지솔루션", sector: "정보기술", industry: "배터리" }],
  ["US:ACN", { name: "Accenture", sector: "정보기술", industry: "IT 서비스" }],
  ["US:ARKK", { name: "ARK Innovation ETF", sector: "ETF", industry: "혁신 성장주" }],
  ["US:AVGO", { name: "Broadcom", sector: "정보기술", industry: "반도체" }],
  ["US:EWJ", { name: "iShares MSCI Japan ETF", sector: "ETF", industry: "일본 주식" }],
  ["US:INTC", { name: "Intel", sector: "정보기술", industry: "반도체" }],
  ["US:PLTR", { name: "Palantir", sector: "정보기술", industry: "데이터/AI" }],
  ["US:TSLA", { name: "Tesla", sector: "경기소비재", industry: "전기차" }],
  ["US:UNG", { name: "United States Natural Gas Fund", sector: "ETF", industry: "천연가스" }]
]);
