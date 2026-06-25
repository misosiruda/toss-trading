# Toss Trading MCP Backend

이 프로젝트는 개인 브로커리지/트레이딩 백엔드와 Codex MCP 운영 인터페이스를 분리해서 설계하기 위한 문서 중심 프로젝트입니다. 대상 브로커의 primary source는 Toss Securities Open API입니다. 비공식 `tossinvest-cli` fork는 공식 API에 없는 시장 정보 표면을 검토하기 위한 optional read-only intelligence source로만 다룹니다.

> Codex is not the trading engine. Codex is an MCP-based operations interface for inspecting, explaining, and safely controlling a deterministic trading backend.

## Project Summary

이 저장소의 목표는 "Codex로 자동매매"를 만드는 것이 아닙니다. 목표는 결정론적 트레이딩 백엔드가 시장 데이터 수집, 스크리닝, 전략 평가, 리스크 검증, 주문 라우팅, 체결 추적, 포지션 정합성 확인, 감사 로그를 담당하고, Codex는 MCP를 통해 이를 조회하고 설명하고 제한적으로 제어하는 운영 인터페이스로만 사용하는 구조를 문서화하는 것입니다. 단, 실거래와 분리된 paper trading에서는 Codex CLI를 `virtual_decision` 생성 provider로 사용할 수 있습니다.

초기 단계에서는 실제 브로커 연동이 아니라 `mock` provider를 기준으로 설계합니다. 실거래 기능은 명시적인 사용자 지시, 공식 API adapter 설계, 리스크 정책 테스트, 감사 로그 설계가 갖춰진 뒤에만 검토할 수 있습니다. 비공식 정보 수집 source는 후보 enrichment와 관측성에만 사용하고 주문 실행 경로에는 연결하지 않습니다.

## Why This Project Exists

- 개인 트레이딩 시스템에서 LLM과 실시간 매매 루프의 책임을 명확히 분리합니다.
- 브로커 API 연동 전에도 백엔드 아키텍처, 리스크 정책, MCP tool 노출 정책을 먼저 고정합니다.
- 나중에 백엔드 개발자 포트폴리오로 사용할 수 있도록 안전성, 결정론, 감사 가능성, 운영 관측성을 중심으로 설계합니다.
- 계좌 정보, API key, 주문/체결 데이터 같은 민감 정보가 코드와 문서에 들어가지 않도록 기본 원칙을 세웁니다.

## Non-goals

- Codex가 실시간 trading loop를 소유하지 않습니다.
- Codex가 실계좌 최종 buy/sell 결정을 내리지 않습니다.
- 자연어 요청을 바로 실주문으로 변환하지 않습니다.
- LLM이 Risk Engine을 우회하거나 리스크 정책을 런타임에 완화하지 않습니다.
- Codex CLI가 생성한 `virtual_decision`을 실거래 `TradingSignal` 또는 `OrderIntent`로 승격하지 않습니다.
- 수익률, 알파, 투자 성과를 보장하거나 암시하지 않습니다.
- 비공식 Toss web API 또는 `tossinvest-cli` fork를 live trading adapter로 사용하지 않습니다.

## Architecture Overview

주요 구성요소는 다음과 같습니다.

- `Trading Engine`: Codex와 독립적으로 실행되는 결정론적 런타임입니다.
- `MarketDataCollector`: 브로커 또는 market data provider에서 시세와 호가 데이터를 수집합니다.
- `ExternalIntelligenceCollector`: 선택적으로 비공식 read-only source에서 보조 시장 정보를 수집하되 provenance와 stale policy를 기록합니다.
- `Screener`: 정량 규칙으로 후보 종목을 선별하고 `CandidateStore`에 저장합니다.
- `CodexCliDecisionProvider`: paper trading 전용으로 압축된 `market_packet`을 읽고 `virtual_decision` JSON을 생성합니다.
- `PaperOrderEngine`: `virtual_decision`을 실제 주문이 아닌 가상 체결과 `VirtualLedger` 기록으로 처리합니다.
- `StrategyEngine`: 후보와 market snapshot을 입력받아 구조화된 `TradingSignal`을 생성합니다.
- `RiskEngine`: 모든 주문 직전의 최종 gate입니다.
- `OrderRouter`: 승인된 주문만 브로커 API로 전달하고 idempotency, retry, timeout, reconciliation을 처리합니다.
- `ExecutionTracker`: 주문 상태와 체결 내역을 추적합니다.
- `PositionService`: 보유 포지션과 현금, 노출도를 계산합니다.
- `AuditLogger`: 신호, 리스크 판단, 주문 요청, 체결, 운영 제어 이벤트를 기록합니다.
- `MCP Server`: Codex가 사용할 운영 tool을 노출하되 read-only tools를 기본으로 합니다.
- `Codex`: 조회, 설명, 분석, 보고서 생성, 승인 기반 운영 제어를 수행하는 MCP 기반 운영 인터페이스입니다.

## Safety Model

기본 정책은 다음과 같습니다.

- `BROKER_PROVIDER=mock`
- `TRADING_ENABLED=false`
- `TOSSINVEST_CLI_ENABLED=false`
- `TOSSINVEST_CLI_READ_ONLY=true`
- `TOSS_OPEN_API_AUTH_ENABLED=false`
- `AI_DECISION_PROVIDER=codex_cli`
- `AI_DECISION_MODE=paper_only`
- `AI_DECISION_ENABLED=false`
- `PAPER_TRADING_ENABLED=true`
- MCP tools는 read-only by default
- `place_order`, `place_market_order`, `enable_live_trading`, `update_risk_policy`는 기본 비활성화
- 제한적 운영 tool은 `prompt` approval을 요구
- 모든 리스크 관련 로직은 테스트 대상
- 모든 주문 관련 이벤트는 audit log 대상
- 계좌번호, token, order ID, execution data는 문서와 로그에서 masking

Codex is not the trading engine. Codex is an MCP-based operations interface for inspecting, explaining, and safely controlling a deterministic trading backend.

## Portfolio Positioning

이 프로젝트는 투자 성과를 보여주기 위한 프로젝트가 아니라, 금융성 도메인에서 백엔드 시스템 경계를 안전하게 설계하는 능력을 보여주는 프로젝트입니다.

강조할 수 있는 역량은 다음과 같습니다.

- deterministic backend runtime 설계
- MCP 기반 운영 인터페이스 설계
- read-only first tool exposure policy
- risk gate, kill switch, audit logging
- idempotent order routing 설계
- mock provider 기반 안전한 개발 흐름
- optional read-only intelligence source 격리
- Codex CLI 기반 paper-only AI decision provider
- 계좌/주문/체결 데이터 masking 원칙

## Current Status

- TypeScript 기반 paper trading backend vertical slice가 구현되어 있습니다.
- 실제 Toss Securities Open API network transport와 order adapter는 구현하지 않았습니다. 현재는 [official Toss Open API adapter 설계](docs/official-toss-open-api-adapter-design.md), [official token auth 설계](docs/official-token-auth-design.md), safe-disabled token auth config parser, injected issuer 기반 mocked token auth client, injected transport 기반 authenticated read-only HTTP client, mocked HTTP client 기반 read-only market data adapter, masked read-only account snapshot reader만 존재합니다.
- `tossinvest-cli` fork 연동은 allowlist 기반 read-only collector, normalizer, stored market packet 기반 paper run까지 구현되어 있으며, 주문/account/portfolio source of truth로 사용하지 않습니다.
- Codex CLI paper trading provider는 `AI_DECISION_ENABLED=false`를 기본값으로 두며, paper-only `virtual_decision` JSON만 받습니다.
- MCP server는 virtual portfolio 조회 tool만 노출합니다.
- scheduler는 one-shot gate이며 OS service나 실시간 trading loop를 설치하지 않습니다.
- daily paper report CLI는 local virtual state를 요약하고 투자 조언/성과 보장 문구를 포함하지 않습니다.
- 실거래 기능은 비활성화 상태를 기본으로 전제합니다.
- 현재 문서에는 real account data, real API keys, real brokerage credentials가 없습니다.

## Paper-only Demo

아래 명령은 실제 주문을 만들지 않고 mock packet과 static decision으로 가상 포트폴리오만 갱신합니다.

```powershell
npm install
$dataDir = Join-Path $env:TEMP "toss-trading-paper-demo"
npm run paper:scheduler:run:dry -- $dataDir
npm run paper:report -- $dataDir --date 2026-06-11
```

샘플 출력은 다음 형태입니다.

```text
# Paper Trading Daily Report

date: 2026-06-11
mode: paper_only

## Portfolio
portfolio_present: true
position_count: 1

## Decision Outcome
decision_items: 1
by_action: {"VIRTUAL_BUY":1}

## Virtual Risk
approved_count: 1
rejected_count: 0

Paper-only virtual simulation. This is not financial advice, not a performance guarantee, and cannot place live orders.
```

TossInvest read-only 조회 결과를 이미 수집했다면 아래처럼 저장된 `market_packet` 기반 paper-only 경로를 실행할 수 있습니다.
CLI와 MCP server 진입점은 프로젝트 루트의 `.env`를 자동으로 읽습니다. `.env`는 Git에서 제외되므로 로컬의 `TOSSINVEST_CLI_PATH`, `TOSSCTL_AUTH_HELPER_PYTHON`, `CODEX_EXEC_PATH` 같은 실행 경로를 넣어도 repository에 올라가지 않습니다.

```powershell
$dataDir = "data/paper"
npm run tossinvest:collect -- --data-dir $dataDir
npm run market:ingest -- --data-dir $dataDir
npm run paper:run-from-market-packet:dry -- --data-dir $dataDir
```

Codex CLI 판단을 사용할 때도 이 경로는 paper-only `virtual_decision`만 저장하고 실제 주문을 만들지 않습니다.

```powershell
npm run paper:run-from-market-packet -- --data-dir data/paper
```

Yahoo snapshot을 쓰지 않고 TossInvest read-only `day:1` chart 캔들을 historical replay 입력으로 만들 수도 있습니다. 이 경로는 주문/계좌 mutation 없이 public search POST와 chart GET만 사용하며 `historical-market-snapshots.jsonl`을 생성합니다.

```powershell
npm run historical:tossctl:ingest -- --enable --data-dir data/tossinvest-daily-global-broad-2024-01-01-2026-06-17 --universe-path docs/historical-universe.global-broad.json --interval 1d --start-date 2024-01-01 --end-date 2026-06-17 --count 450 --allow-partial
```

저장된 `historical-market-snapshots.jsonl`이 있다면 과거 데이터를 simulated time으로 빠르게 흘려보내는 historical replay report를 만들 수 있습니다. dry-run은 AI 호출 없이 deterministic fixture decision으로 `historical-replay-report.json`을 생성합니다.

```powershell
npm run historical:replay:dry -- data/paper 2025-01-02T09:00:00+09:00 2025-01-02T15:30:00+09:00 60 5
```

Codex CLI를 historical replay decision provider로 사용할 때도 `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=true`, `CODEX_EXEC_PATH` 같은 로컬 `.env` 설정을 사용하며 `codex exec --sandbox read-only` 경계를 유지합니다.

```powershell
npm run historical:replay -- data/paper 2025-01-02T09:00:00+09:00 2025-01-02T15:30:00+09:00 60 5
```

가상 투자 상태는 같은 local operations server에서 read-only dashboard로 볼 수 있습니다.

```powershell
npm run dashboard -- --data-dir data/paper
```

기본 URL은 `http://127.0.0.1:8787/dashboard`입니다. `/dashboard`는 live trading disabled 상태를 보여주는 shell이고, 가상 투자 실험 화면은 `/dashboard/virtual` 아래에 있습니다. 조회 화면은 `/virtual/portfolio`, `/virtual/decisions`, `/virtual/trades`, `/paper/report`, `/replay/report`, `/source/health`, `/market/packets`, `/audit/events`, `/dashboard/view-model/portfolio-compliance`, `/dashboard/view-model/strategy-test-lab`, `/dashboard/view-model/risk-gate-trace`, `/dashboard/view-model/validation-lab` 같은 read-only endpoint를 호출합니다. 새 가상 투자 화면의 `Run 생성`은 same-origin, JSON body, 전용 operation header를 요구하는 guarded `POST /paper/simulations`만 사용하며, 내부적으로 allowlisted paper-only historical batch replay runner에 typed config를 전달합니다. Strategy bucket test create endpoint는 validation을 통과한 설정을 queued record와 audit event로만 저장하며 replay runner를 시작하지 않습니다. live order, raw `codex exec`, raw `tossctl` 실행 endpoint는 노출하지 않습니다. 일부 endpoint 조회가 실패해도 dashboard는 가능한 데이터를 먼저 렌더링하고 실패한 조회 그룹을 상단 상태와 오류 배너에 표시합니다.

Dashboard를 live 투자 관제와 paper-only simulation 제품 흐름으로 재구성하는 기존 정적 dashboard 계획은 [docs/paper-simulation-dashboard-plan.md](docs/paper-simulation-dashboard-plan.md)를 참고합니다. strategy bucket, dynamic cash reserve, hedge, validation lab을 policy 중심으로 포용하는 Next.js 전환 계획은 [docs/nextjs-dashboard-architecture-plan.md](docs/nextjs-dashboard-architecture-plan.md)를 참고합니다. 두 계획 모두 실투자 활성화가 아니라 paper-only simulation과 read-only/live-disabled 관제 경계를 유지하는 방향을 다룹니다.

## Roadmap

1. Documentation and architecture
2. Mock MCP server
3. Mock trading runtime
4. Screener and signal store
5. Risk engine
6. Official Toss Open API adapter design
7. Optional read-only intelligence source
8. Codex CLI paper trading decision provider
9. Portfolio polish

자세한 계획은 [docs/roadmap.md](docs/roadmap.md)를 참고합니다.
Official Toss Open API adapter 설계는 [docs/official-toss-open-api-adapter-design.md](docs/official-toss-open-api-adapter-design.md)를 참고합니다.
Official Toss Open API token auth 설계는 [docs/official-token-auth-design.md](docs/official-token-auth-design.md)를 참고합니다.
Codex CLI paper trading 설계는 [docs/codex-cli-paper-trading.md](docs/codex-cli-paper-trading.md)를 참고합니다.
Historical replay 실행과 안전 경계는 [docs/historical-replay.md](docs/historical-replay.md)를 참고합니다.
Codex AI paper run과 batch replay 운영 절차는 [docs/ai-paper-trading-runbook.md](docs/ai-paper-trading-runbook.md)를 참고합니다.
퀀트 연구 기반 paper simulation 검토와 개선 TODO는 [docs/quant-research-paper-simulation-review.md](docs/quant-research-paper-simulation-review.md)를 참고합니다.
퀀트 연구 기반 paper simulation 구현 기획은 [docs/quant-research-paper-simulation-plan.md](docs/quant-research-paper-simulation-plan.md)를 참고합니다.
구현 PR 단위 계획은 [docs/pr-implementation-plan.md](docs/pr-implementation-plan.md)를 참고합니다.
코드 위치와 책임 경계는 [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)를 참고합니다.
코드 컨벤션과 레이어 규칙은 [docs/CODE_CONVENTION.md](docs/CODE_CONVENTION.md)를 참고합니다.
대규모 리팩토링 진행 기준은 [docs/REFACTORING_GUIDE.md](docs/REFACTORING_GUIDE.md)를 참고합니다.
AI paper-only 투자 판단 프로세스 리팩토링 계획은 [docs/ai-investment-process-refactoring-plan.md](docs/ai-investment-process-refactoring-plan.md)를 참고합니다.
Paper simulation dashboard 기획은 [docs/paper-simulation-dashboard-plan.md](docs/paper-simulation-dashboard-plan.md)를 참고합니다.
Next.js 기반 dashboard 전환 기획은 [docs/nextjs-dashboard-architecture-plan.md](docs/nextjs-dashboard-architecture-plan.md)를 참고합니다.

## Disclaimer

이 프로젝트는 Toss Securities와 제휴되었거나 보증받은 프로젝트가 아닙니다. `tossinvest-cli` 같은 비공식 도구를 언급하더라도 이는 시스템 설계와 read-only 정보 수집 가능성을 검토하기 위한 것이며 투자 조언이나 실거래 권유가 아닙니다. 모든 예시는 시스템 설계를 설명하기 위한 placeholder이며 실제 계좌, 실제 주문, 실제 투자 판단을 포함하지 않습니다.
