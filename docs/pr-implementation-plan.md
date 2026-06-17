# PR Implementation Plan

> Codex is not the trading engine. PRs must preserve `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, and read-only-first tool exposure until an explicit later milestone changes the boundary.

## 원칙

이 계획은 작은 PR 단위로 vertical slice를 쌓기 위한 작업 순서입니다. 각 PR은 독립적으로 review 가능해야 하며, 실거래 기능을 열지 않습니다.

공통 완료 조건:

- `BROKER_PROVIDER=mock`
- `TRADING_ENABLED=false`
- `AI_DECISION_MODE=paper_only`
- raw `tossctl` 실행 MCP tool 없음
- raw `codex exec` 실행 MCP tool 없음
- 계좌번호, token, order ID, execution data 원문 저장 없음
- paper trading 결과를 투자 조언이나 수익 보장처럼 표현하지 않음

공통 제외 범위:

- live order placement
- live `TradingSignal` 자동 생성
- official Toss Open API adapter 구현
- `tossinvest-cli` fork vendoring
- Codex가 shell command를 직접 고르는 agent loop

## PR-00: Repository Baseline

목표:

- 현재 문서 작업을 Git baseline으로 고정합니다.
- 이후 PR 단위 review가 가능하도록 repository를 초기화합니다.

작업 범위:

- `git init`
- 현재 문서 commit
- 기본 `.gitignore` 추가
- README에서 implementation plan 링크 확인

검증:

- `git status --short`가 clean
- 문서에 real credential 없음
- `.env.example`만 존재하고 real `.env`는 commit하지 않음

제외:

- runtime code
- package manager 설정
- MCP server 구현

## PR-01: TypeScript Runtime Scaffold

목표:

- backend worker와 MCP server 구현을 위한 최소 TypeScript/Node 프로젝트를 만듭니다.

작업 범위:

- `package.json`
- `tsconfig.json`
- test runner 설정
- `src/` 디렉터리
- `src/index.ts` placeholder
- build/test script
- `.gitignore` 보강

검증:

- `npm install`
- `npm run build`
- `npm test`

제외:

- domain logic
- Codex CLI 호출
- `tossctl` 호출
- MCP tool 구현

## PR-02: Domain Schemas and Validation

목표:

- paper trading과 read-only intelligence의 핵심 contract를 먼저 고정합니다.

작업 범위:

- `MarketPacket`
- `MarketCandidate`
- `VirtualDecision`
- `VirtualRiskDecision`
- `VirtualPortfolio`
- `VirtualTrade`
- `AuditEvent`
- schema validation helper
- fixture 기반 schema tests

검증:

- valid fixture 통과
- invalid action reject
- missing `data_ref` reject
- stale timestamp reject helper test
- `npm test`

제외:

- 파일 저장소
- Codex CLI 호출
- paper order 체결 로직

## PR-03: Local Store and Audit Log

목표:

- paper state와 audit event를 local persistent store에 저장합니다.

작업 범위:

- append-only JSONL audit store
- virtual portfolio store
- virtual decision store
- virtual trade store
- masking helper
- repository interfaces
- file path config

검증:

- audit append/read test
- portfolio read/write test
- corrupted JSONL line handling test
- sensitive field masking test

제외:

- MCP tools
- Codex CLI 호출
- `tossctl` collector

## PR-04: Paper Trading Core

목표:

- AI 없이도 `virtual_decision` fixture를 검증하고 가상 체결까지 처리합니다.

작업 범위:

- `VirtualRiskEngine`
- `PaperOrderEngine`
- `VirtualLedger`
- virtual cash/position update
- average price calculation
- realized/unrealized PnL placeholder
- reject code mapping

검증:

- cash 부족 reject
- max symbol exposure reject
- stale decision reject
- valid `VIRTUAL_BUY` fills virtual trade
- `VIRTUAL_SELL` updates virtual position
- rejected decision does not mutate portfolio

제외:

- Codex CLI
- real order router
- broker adapter

## PR-05: Market Packet Builder with Mock Data

목표:

- mock candidates와 virtual portfolio에서 Codex input인 compact `market_packet`을 생성합니다.

작업 범위:

- `MarketPacketBuilder`
- top N candidate trimming
- source refs inclusion
- constraints inclusion
- packet expiry
- fixture generator

검증:

- packet max candidates 적용
- packet expiry 생성
- missing source ref reject 또는 warning
- virtual portfolio snapshot 포함
- snapshot에 sensitive data 없음

제외:

- `tossctl` collector
- Codex CLI 호출
- MCP tools

## PR-06: Codex CLI Decision Provider Dry Run

목표:

- `market_packet`을 `codex exec`에 전달하고 `virtual_decision` JSON을 받아 검증하는 provider를 구현합니다.

작업 범위:

- `CodexCliDecisionProvider`
- command construction
- stdin input support
- `--sandbox read-only`
- `--output-schema` support
- timeout
- run budget guard
- invalid output handling
- provider disabled mode

검증:

- `AI_DECISION_ENABLED=false`이면 실행하지 않음
- command args에 `read-only` sandbox 포함
- timeout은 `AI_DECISION_FAILED`
- invalid JSON은 no paper order
- mocked process runner로 success path test

제외:

- scheduled run
- real Codex 호출을 CI 필수로 만들기
- MCP raw execution tool

## PR-07: End-to-End Paper Decision CLI

목표:

- 한 명령으로 mock packet 생성, Codex decision dry-run, schema validation, paper order 기록까지 실행합니다.

작업 범위:

- local CLI command 또는 script
- `paper:run-once`
- dry-run mode
- output paths
- summary report
- audit event chain

검증:

- mocked Codex provider로 end-to-end test
- 실패 시 portfolio 불변
- 성공 시 virtual trade와 audit event 생성
- report에 paper trading 문구 포함

제외:

- cron/scheduler
- `tossctl` live data
- MCP server

## PR-08: Read-only TossInvest CLI Collector

목표:

- `tossctl` read-only command allowlist wrapper를 구현합니다.

작업 범위:

- `TossInvestCliReadOnlyCollector`
- command key enum
- mutation blocklist
- `--execute` 차단
- output JSON parsing
- timeout
- source metadata
- degraded status

검증:

- allowlisted command만 실행
- `order`, `auth`, `config`, `watchlist` mutation 차단
- argv에 `--execute` 포함 시 차단
- timeout은 degraded status
- mocked process runner tests

제외:

- real `tossctl auth login`
- real credentials/session handling
- live order/preview execution

## PR-09: Market Packet from TossInvest Data

목표:

- `tossctl` read-only output을 normalized candidate로 변환해 paper decision packet에 포함합니다.

작업 범위:

- parser/normalizer per selected command
- market ranking to candidate
- market signals to reason codes
- quote fields normalization
- stale policy
- source refs

검증:

- sample `tossctl` JSON fixture parse
- malformed output degraded
- stale source excluded
- generated packet remains compact

제외:

- live `tossctl` dependency in tests
- order/account/portfolio source of truth

## PR-10: MCP Read-only Virtual Portfolio Tools

목표:

- Codex가 paper trading 결과를 조회할 수 있는 MCP read-only tools를 구현합니다.

작업 범위:

- MCP server scaffold completion
- `get_virtual_portfolio`
- `get_virtual_positions`
- `get_virtual_decisions`
- `get_virtual_trades`
- `get_virtual_performance`
- masking and output contracts

검증:

- tools are read-only
- no `run_codex_exec`
- no `run_tossctl`
- no `place_order`
- sample MCP call tests or handler unit tests

제외:

- side-effect tools
- direct collector execution through MCP
- direct Codex CLI execution through MCP

## PR-11: Scheduler and Run Budget

목표:

- paper decision run을 낮은 빈도로 자동 실행할 수 있게 합니다.

작업 범위:

- scheduler abstraction
- daily run budget
- market close run config
- manual run command
- lock file or idempotency key
- failure backoff

검증:

- max runs per day enforced
- concurrent run blocked
- failed run audit logged
- disabled provider does not run

제외:

- OS-level service installer
- cloud deployment
- live trading scheduler

## PR-12: Reports and Portfolio Polish

목표:

- paper trading 결과를 운영 리포트와 포트폴리오 설명 자료로 정리합니다.

작업 범위:

- daily paper report
- decision outcome summary
- rejected virtual risk summary
- source status summary
- README demo section
- sample anonymized output

검증:

- report includes paper trading disclaimer
- no investment advice wording
- no real account data
- sample report generated from fixtures

제외:

- performance guarantee
- backtest overclaim
- live account reporting

## PR-13: TossInvest Collector Execution CLI

목표:

- `tossinvest-cli` read-only collector를 실제 backend command에서 실행할 수 있게 합니다.

작업 범위:

- env 기반 collector config
- command allowlist validation
- selected command batch 실행
- collected source JSONL store
- masked source payload persistence
- collection summary CLI

검증:

- disabled config는 실행하지 않음
- allowlisted commands만 실행
- mutation command는 저장/실행되지 않음
- failed/degraded source도 summary와 audit 가능 형태로 저장
- real `tossctl` dependency 없이 mocked runner tests

제외:

- `tossctl auth login`
- account/order/portfolio command
- MCP raw collector execution

## PR-14: Market Data Ingestion Workflow

목표:

- 저장된 read-only collector 결과를 `market_packet`으로 만드는 ingestion workflow를 구현합니다.

작업 범위:

- source store read
- collector result validation
- TossInvest normalizer 연결
- market packet store
- ingestion audit events
- CLI command

검증:

- stored source fixture에서 market packet 생성
- stale/degraded source warning 유지
- empty candidates fail-closed
- repo-local `data/` 생성 없음

제외:

- live `tossctl` 호출
- Codex decision 실행
- live trading signal 생성

## PR-15: AI Decision Prompt and Schema Pack

목표:

- Codex CLI가 더 일관된 paper-only 판단을 내리도록 prompt/schema pack을 고정합니다.

작업 범위:

- prompt template
- virtual decision JSON schema artifact
- prompt version metadata
- provider prompt injection
- hallucination guard text
- hold-first / risk-first instruction

검증:

- prompt includes paper-only and no-command boundaries
- prompt requires dataRefs from packet
- output schema path support works
- provider command test 업데이트

제외:

- real Codex CLI call in tests
- trading recommendation wording
- live signal generation

## PR-16: Paper Portfolio Analytics

목표:

- 가상 포트폴리오 분석 지표를 별도 계산 계층으로 분리합니다.

작업 범위:

- cash/position exposure
- symbol allocation
- virtual realized/unrealized placeholder metrics
- decision-to-trade linkage summary
- report integration

검증:

- exposure calculation
- allocation totals
- trade linkage summary
- no performance guarantee wording

제외:

- 실계좌 PnL
- 수익률 보장 표현
- broker reconciliation

## PR-17: Replay and Backfill Simulation

목표:

- 저장된 market packet과 decision fixture로 paper simulation을 재현할 수 있게 합니다.

작업 범위:

- market packet JSONL store
- replay input loading
- deterministic replay runner
- prompt version comparison metadata
- replay CLI

검증:

- same fixture produces same virtual trade result
- invalid/stale packet rejected
- replay does not call `tossctl` or Codex CLI

제외:

- historical market data downloader
- backtest performance claim
- live scheduler integration

## PR-18: MCP Operations Extension

목표:

- 운영 조회용 MCP tool을 paper system 상태까지 확장합니다.

작업 범위:

- `get_paper_report`
- `get_scheduler_status`
- `get_source_health`
- `get_market_packets`
- approval-required paper run trigger는 별도 문서화만

검증:

- tools are read-only
- no raw `tossctl`
- no raw `codex exec`
- no live order tool
- handler unit tests

제외:

- MCP에서 collector 직접 실행
- MCP에서 Codex CLI 직접 실행
- live order placement

## PR-19: Local Operations API

목표:

- local dashboard/API가 사용할 수 있는 read-only HTTP API를 추가합니다.

작업 범위:

- Node HTTP server
- `/health`
- `/virtual/portfolio`
- `/virtual/decisions`
- `/virtual/trades`
- `/paper/report`
- `/scheduler/status`
- read-only JSON responses

검증:

- endpoints return JSON
- mutation HTTP methods rejected
- no live order endpoint
- no secret/account data in sample responses

제외:

- 브라우저 UI
- authentication/session
- external network exposure
- live trading API

## PR-20: Stored Market Packet Paper Run

목표:

- 저장된 TossInvest 기반 `market_packet`을 Codex CLI 판단과 paper order simulation에 연결합니다.

작업 범위:

- latest `market-packets.jsonl` loading
- stale packet fail-closed guard
- `virtual_decision.packetId` mismatch guard
- `paper:run-from-market-packet` CLI
- dry-run provider for stored packet path validation
- decision/trade/portfolio/audit persistence

검증:

- stored packet fixture produces virtual trade and portfolio update
- stale packet does not call AI provider
- packet mismatch does not save decision or trade
- provider failure creates no paper order
- CLI dry-run works from stored packet

제외:

- live order placement
- live scheduler integration
- MCP-triggered AI execution
- official Toss Open API adapter
- `tossctl` live call inside the paper run workflow

## PR-21: Local Env Loading and Paper Hold Risk

목표:

- 로컬 `.env`만으로 read-only TossInvest 수집과 Codex CLI paper run을 실행할 수 있게 합니다.
- 가격이 없는 `VIRTUAL_HOLD` 판단이 불필요하게 risk reject로 기록되지 않게 합니다.

작업 범위:

- CLI/MCP entrypoint `.env` auto-load
- `CODEX_EXEC_PATH`, `TOSSINVEST_CLI_PATH`, `TOSSCTL_AUTH_HELPER_PYTHON` local env 문서화
- `VIRTUAL_HOLD`는 packet 후보 존재와 freshness를 검증하되 가격 필수 조건에서는 제외
- packet 밖 종목은 `VIRTUAL_CANDIDATE_NOT_FOUND`로 fail-closed

검증:

- `.env` 없이도 safe defaults 유지
- `.env`가 있으면 CLI 실행 경로 설정 반영
- 가격 없는 HOLD approved
- packet 밖 decision rejected
- full test suite

제외:

- live order placement
- official Toss Open API adapter
- `.env` commit
- real secret 관리

## PR-22: Read-only Paper Dashboard Foundation

목표:

- 사용자가 가상 투자 상태와 AI 판단 근거를 브라우저에서 바로 확인할 수 있는 local dashboard를 추가합니다.

작업 범위:

- `dashboard` static assets
- local operations server의 dashboard asset serving
- `npm run dashboard`
- portfolio summary
- positions table
- recent AI decisions with thesis, risk factors, data refs
- recent virtual trades
- risk summary
- TossInvest source health
- recent market packets
- HTTP API read-only endpoints for source health and market packets

검증:

- dashboard assets are served by GET/HEAD only
- dashboard script does not call mutation methods
- source health endpoint is read-only
- market packet endpoint is read-only
- full test suite
- desktop and mobile browser screenshots

제외:

- dashboard-triggered collection
- dashboard-triggered Codex run
- live order placement
- authentication/session
- external network exposure

## PR-23: AI Decision Timeline Filters

목표:

- AI 판단 이력을 action과 symbol 기준으로 빠르게 좁혀보고, 종목별 판단 분포를 확인할 수 있게 합니다.

작업 범위:

- action segmented control: All, Buy, Sell, Hold
- symbol search filter
- filtered decision count
- per-symbol action summary
- expired decision indicator
- responsive filter layout

검증:

- dashboard script still uses read-only fetch only
- dashboard asset test covers action and symbol filter markup
- full test suite
- desktop and mobile browser screenshots

제외:

- dashboard-triggered trading action
- dashboard-triggered paper run
- decision mutation
- live order placement

## PR-24: AI Decision Risk and Trade Linkage

목표:

- AI 판단 카드에서 Risk Engine 승인/거절 상태와 가상 체결 여부를 함께 확인할 수 있게 합니다.

작업 범위:

- read-only audit events HTTP endpoint
- dashboard decision card risk outcome badge
- dashboard decision card virtual trade outcome badge
- audit event masking validation
- mobile overflow measurement

검증:

- `/audit/events` is read-only and masked
- dashboard script still uses read-only fetch only
- full test suite
- desktop and mobile browser screenshots
- mobile viewport `scrollWidth` check

제외:

- risk decision mutation
- stored risk policy editing
- dashboard-triggered paper run
- live order placement

## PR-25: Dashboard Daily Paper Report

목표:

- `/paper/report`의 일일 가상 투자 요약을 dashboard 첫 화면에서 한 번에 파악할 수 있게 합니다.

작업 범위:

- daily report panel
- decision/trade/risk/source KPI summary
- report detail list
- report disclaimer display
- dashboard asset test update

검증:

- dashboard script still uses read-only fetch only
- dashboard asset test covers daily report markup and renderer
- full test suite
- desktop and mobile browser screenshots

제외:

- dashboard-triggered report generation mutation
- dashboard-triggered paper run
- report editing
- live account reporting
- live order placement

## PR-26: AI Decision Evidence Layout

목표:

- AI 판단 카드에서 Buy/Sell/Hold 판단 근거, 리스크 요인, 데이터 참조, 판단 속성을 분리해 읽을 수 있게 합니다.

작업 범위:

- decision rationale section
- action-specific evidence heading
- risk factor list
- data ref tag group
- decision context line
- dashboard asset test update

검증:

- dashboard script still uses existing read-only decision data
- dashboard asset test covers rationale renderer
- full test suite
- desktop and mobile browser screenshots

제외:

- AI decision mutation
- dashboard-triggered Codex run
- new decision schema fields
- investment advice wording
- live order placement

## PR-27: Dashboard Partial Failure UX and Runbook

목표:

- dashboard 조회 중 일부 read-only endpoint가 실패해도 나머지 데이터를 계속 볼 수 있게 하고, 로컬 실행 문서를 실제 endpoint 목록에 맞춥니다.

작업 범위:

- independent dashboard endpoint fetch
- partial failure status pill
- failed endpoint error banner
- README dashboard endpoint list update
- dashboard asset test update

검증:

- dashboard script still uses read-only fetch only
- dashboard asset test covers partial failure helpers
- full test suite
- browser verification for normal dashboard load

제외:

- retry loop
- dashboard-triggered collection
- dashboard-triggered paper run
- endpoint mutation
- live order placement

## PR-28: Historical Market Data Store

목표:

- 과거 시장 데이터를 시간순으로 저장하고 simulated time 기준으로 미래 데이터를 제외해 조회할 수 있게 합니다.

작업 범위:

- `HistoricalMarketSnapshot` schema
- historical market snapshot JSONL path/store
- `asOf` 이하 조회
- symbol/from filter
- time-order deterministic sorting
- corrupt line handling

검증:

- valid historical snapshot schema validation
- inverted high/low price reject
- `asOf` 이후 snapshot 제외
- from/symbol filter 적용
- corrupt JSONL line count 유지
- full test suite

제외:

- historical downloader
- AI decision execution
- replay runner
- dashboard-triggered replay
- live order placement

## PR-29: Simulated Clock and Replay Window

목표:

- 실제 시간이 아니라 replay 전용 simulated clock으로 start/end/step window를 deterministic하게 진행합니다.

작업 범위:

- `SimulatedClock`
- replay start/end time
- step interval
- speed multiplier metadata
- market session window guard

검증:

- start/end 범위 준수
- step progression deterministic
- session 밖 timestamp skip
- real clock 의존 없음

제외:

- AI decision execution
- paper order execution
- dashboard UI
- real-time loop

## PR-30: Historical Market Packet Builder

목표:

- 특정 simulated time 기준 historical snapshot만 사용해 paper-only `market_packet`을 생성합니다.

작업 범위:

- historical snapshot to `MarketCandidate`
- simulated source refs
- top N candidate trimming
- simulated packet expiry
- lookahead guard warnings

검증:

- simulated time 이후 데이터 미포함
- packet schema validation
- max candidates 적용
- stale/empty input fail-closed

제외:

- Codex CLI execution
- paper order execution
- performance claim

## PR-31: Accelerated Replay Runner Without AI

목표:

- AI 호출 없이 deterministic fixture decision으로 historical replay engine을 검증합니다.

작업 범위:

- packet sequence replay
- static decision provider
- Risk Engine integration
- PaperOrderEngine integration
- replay audit chain

검증:

- same input same result
- risk reject leaves portfolio unchanged
- no realtime API call
- simulated time audit metadata

제외:

- real Codex CLI call
- dashboard-triggered replay
- live trading

## PR-32: Codex AI Historical Decision Provider

목표:

- replay 중 각 historical packet을 Codex CLI paper-only provider에 전달해 AI 판단을 받을 수 있게 합니다.

작업 범위:

- existing `CodexCliDecisionProvider` reuse
- simulated time metadata
- no-lookahead prompt guard
- max AI calls per replay
- timeout/failure skip policy

검증:

- `AI_DECISION_ENABLED=false` no execution
- read-only sandbox 유지
- timeout creates no paper order
- packetId mismatch reject
- AI call budget enforced

제외:

- raw `codex exec` MCP tool
- dashboard-triggered AI run
- live `TradingSignal`
- live order placement

## PR-33: Replay Speed and Sampling Policy

목표:

- 모든 historical tick마다 AI를 호출하지 않고 현실적인 비용/속도로 replay할 수 있게 합니다.

작업 범위:

- every N steps policy
- candidate changed only policy
- daily/weekly decision mode
- max candidates per step
- replay progress summary

검증:

- policy별 AI call 수 제한
- skipped step preserves portfolio
- replay order deterministic
- budget guard 동작

제외:

- auto tuning
- profitability optimization
- live loop

## PR-34: Historical Replay Report

목표:

- historical replay 결과를 paper-only 분석 리포트로 출력합니다.

작업 범위:

- replay summary
- decision/trade/risk counts
- final virtual portfolio
- source/lookahead warning summary
- paper-only disclaimer

검증:

- no investment advice wording
- no performance guarantee wording
- result masking
- deterministic fixture report

제외:

- 실계좌 PnL
- 외부 report upload
- backtest overclaim

## PR-35: Dashboard Replay View

목표:

- dashboard에서 historical replay 결과를 read-only로 확인할 수 있게 합니다.

작업 범위:

- replay summary panel
- simulated time range
- AI decision timeline reuse
- virtual portfolio timeline table
- risk/trade linkage reuse

검증:

- read-only endpoint only
- no replay trigger button
- desktop/mobile screenshot
- partial failure UX 유지

제외:

- dashboard-triggered replay
- live order
- real-time streaming chart

## PR-36: Final Safety and Lookahead Audit

목표:

- historical replay가 simulated time 이후 데이터를 보지 않는지 전체 경계를 점검합니다.

작업 범위:

- lookahead guard tests
- prompt guard review
- historical source ref audit
- docs update
- final review log

검증:

- simulated time 이후 데이터 검색 차단
- replay runner real clock dependency audit
- full test suite
- dashboard browser verification

제외:

- official Toss API
- live trading
- production scheduler

## PR-38: AI Decision Semantic Validation

목표:

- schema-valid이지만 packet 근거가 맞지 않는 paper-only AI decision을 저장 또는 가상 체결 전에 차단합니다.

작업 범위:

- `VirtualDecision`과 `MarketPacket` 사이의 semantic validator 추가
- `packetId` mismatch, packet 밖 symbol, duplicate symbol, allowed action 위반, candidate sourceRef 밖 `dataRefs` 검증
- one-shot paper run, stored market packet run, historical Codex replay provider에 저장 전 validator 연결
- semantic reject 시 `VIRTUAL_DECISION_REJECTED` audit event 기록

검증:

- hallucinated `dataRefs`가 decision/trade 저장 전에 reject됨
- cross-symbol `dataRefs`가 reject됨
- packet 밖 symbol과 duplicate decision이 reject됨
- 기존 paper-only happy path와 historical replay provider 경계 유지
- full test suite

제외:

- decision schema v2 전환
- HOLD reason code 도입
- backend sizing 전환
- live trading 또는 broker adapter 연결

## PR-39: Virtual Hold Reason Code

목표:

- `VIRTUAL_HOLD` 판단을 단순 abstain이 아니라 machine-readable 보류 사유로 기록합니다.

작업 범위:

- `VirtualDecisionItem`에 optional `holdReasonCode` enum 추가
- Codex output schema artifact에 `holdReasonCode` 허용 및 HOLD 조건부 required 반영
- paper decision prompt에서 HOLD reason code 요구
- semantic validator에서 `VIRTUAL_HOLD`의 `holdReasonCode` 누락 reject
- semantic validator에서 BUY/SELL의 `holdReasonCode` 오용 reject
- Codex CLI paper trading 문서에 HOLD reason code 계약 반영

검증:

- schema가 허용된 HOLD reason code를 parse함
- schema가 알 수 없는 HOLD reason code를 reject함
- semantic validator가 HOLD reason 누락을 storage 전에 reject함
- semantic validator가 non-HOLD reason code 오용을 reject함
- prompt/schema artifact 테스트가 새 계약을 확인함
- full test suite

제외:

- decision schema v2 전면 전환
- raw sizing 제거
- backend sizing 계산 전환
- hold reason distribution report/dashboard
- live trading 또는 broker adapter 연결

## PR-40: Virtual Decision Packet Hash Binding

목표:

- AI decision이 참조한 `marketPacket` 내용이 backend가 제공한 packet과 동일한지 `packetHash`로 검증합니다.

작업 범위:

- stable JSON 기반 `createMarketPacketHash` helper 추가
- Codex CLI provider stdin을 `{ packetHash, marketPacket }` envelope로 변경
- `VirtualDecision` top-level optional `packetHash` field 추가
- Codex output schema artifact에서 `packetHash` required 및 `sha256:<hex>` pattern 요구
- semantic validator에서 `packetHash` 누락 및 mismatch reject
- dry-run/static provider가 현재 packet hash를 fixture decision에 바인딩
- Codex CLI paper trading 문서에 packetHash 계약 반영

검증:

- 동일 packet의 object key order 차이에도 hash가 동일함
- packet 내용 변경 시 hash가 달라짐
- semantic validator가 missing/mismatched packetHash를 reject함
- workflow가 packetHash mismatch decision을 storage 전에 reject함
- Codex CLI provider가 stdin envelope에 packetHash와 marketPacket을 포함함
- full test suite

제외:

- promptVersion/modelId/policyVersion audit metadata 추가
- decision schema v2 전면 전환
- normalized order layer
- live trading 또는 broker adapter 연결

## PR-41: Virtual Decision Identity Metadata

목표:

- AI decision에 prompt/model/schema/policy version metadata를 남겨 판단 조건을 audit 가능하게 합니다.

작업 범위:

- `VirtualDecision` top-level optional `promptVersion`, `modelId`, `schemaVersion`, `policyVersion` field 추가
- Codex output schema artifact에서 identity metadata required 반영
- Codex CLI provider stdin envelope에 identity metadata 포함
- paper decision prompt에서 identity metadata 복사 요구
- semantic validator에서 identity metadata 누락 reject
- static/dry-run provider에 `static-fixture-v1` metadata 바인딩
- Codex CLI paper trading 문서에 identity metadata 계약 반영

검증:

- Codex CLI provider stdin에 identity metadata가 포함됨
- output schema artifact가 identity metadata를 required로 요구함
- semantic validator가 metadata 누락 decision을 reject함
- historical Codex adapter fixture가 metadata gate를 통과함
- full test suite

제외:

- metadata value allowlist 또는 version registry
- side-by-side model evaluation
- normalized order layer
- live trading 또는 broker adapter 연결

## PR-42: Virtual Decision Normalizer and Backend Sizing

목표:

- AI가 제출한 raw sizing hint를 바로 paper Risk/Order 경로에 쓰지 않고 backend 정규화 계층에서 paper notional로 변환합니다.
- BUY는 packet budget constraint를 넘지 않도록 cap하고, SELL은 현재 virtual position과 후보 가격을 기준으로 reduce-only notional을 계산합니다.

작업 범위:

- `DecisionNormalizer`
- `NormalizedVirtualOrder`
- BUY budget cap by packet constraint
- SELL `sellAll`, `sellQuantity`, `sellRatio`, `targetWeightPct`, legacy `budgetKrw` 처리
- oversize SELL을 현재 virtual position value로 clip
- `VirtualRiskEngine`과 `PaperOrderEngine`의 notional source를 normalizer로 통일
- Codex CLI paper trading 문서에 raw AI sizing hint와 backend normalized sizing 경계 반영

검증:

- BUY budget cap unit test
- SELL ratio sizing unit test
- oversize SELL quantity clip unit/integration test
- HOLD zero-notional reduce-only unit test
- 기존 Risk Engine cash reserve/NAV weight rejection 유지
- historical Codex replay risk rejection 유지
- full test suite

제외:

- decision schema v2 전면 전환
- AI confidence decomposition
- strategy scoring/portfolio optimizer
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결

## PR-43: Market Packet Candidate Action Eligibility

목표:

- BUY/SELL 가능 여부를 AI가 추측하지 않도록 candidate별 policy-safe eligibility metadata를 `market_packet`에 포함합니다.
- AI가 packet에서 `buyEligible=false` 또는 `sellEligible=false`인 action을 제안하면 저장 전 semantic validator에서 reject합니다.

작업 범위:

- `MarketCandidate` eligibility fields
- `buyEligible`, `sellEligible`, `blockedReasonCodes`, `budgetTierAllowed`, `positionExists`, `cooldownActive`
- `MarketPacketBuilder`의 portfolio/constraint 기반 eligibility 계산
- Codex paper decision prompt version update
- semantic validator의 candidate eligibility hard gate
- Codex CLI paper trading 문서에 eligibility contract 반영

검증:

- empty portfolio candidate는 BUY eligible, SELL ineligible로 생성됨
- 기존 position candidate는 SELL eligible로 생성됨
- `maxNewPositions` 도달 시 신규 candidate BUY가 blocked됨
- `buyEligible=false` candidate에 대한 BUY decision은 semantic reject됨
- prompt가 eligibility fields와 금지 action을 명시함
- full test suite

제외:

- live broker position eligibility
- RiskPolicy cooldownEntries를 packet builder에 직접 연결
- confidence decomposition
- decision schema v2 전면 전환
- live trading 또는 broker adapter 연결

## PR-44: Virtual Decision Feature Refs Grounding

목표:

- AI가 raw `dataRefs`뿐 아니라 backend가 만든 deterministic feature path도 packet 안에서만 인용하게 합니다.
- `featureRefs`가 packet candidate의 `featureRefs` 부분집합이 아니면 semantic validator에서 hard reject합니다.

작업 범위:

- `MarketCandidate.featureRefs`
- `VirtualDecisionItem.featureRefs`
- `MarketPacketBuilder`의 deterministic candidate feature ref 생성
- Codex output schema artifact의 optional `featureRefs` 허용
- Codex paper decision prompt version update
- semantic validator의 featureRef subset hard gate
- Codex CLI paper trading 문서에 featureRefs contract 반영

검증:

- packet builder가 price/ranking/eligibility feature refs를 생성함
- 같은 candidate에서 복사한 featureRefs는 semantic validation 통과
- hallucinated featureRefs는 semantic reject됨
- output schema artifact가 featureRefs를 허용함
- prompt가 featureRefs 복사 규칙을 명시함
- full test suite

제외:

- `claimSupport[]` atomic claim mapping
- feature value score 계산
- confidence decomposition
- decision schema v2 전면 전환
- live trading 또는 broker adapter 연결

## PR-45: Virtual Decision Backend Hash

목표:

- AI decision 저장 레코드에 backend-generated `decisionHash`를 추가해 audit identity를 강화합니다.
- `decisionHash`는 AI가 만들거나 복사하는 값이 아니라 backend가 validation 이후 저장 직전에 계산합니다.

작업 범위:

- `VirtualDecision.decisionHash` optional runtime field
- stable JSON 기반 `createVirtualDecisionHash` helper
- `decisionHash` 자신을 제외한 decision content hash
- `FileVirtualDecisionStore` append 시 backend hash binding
- historical replay decision log와 progress snapshot의 decision hash binding
- semantic validator의 AI-supplied `decisionHash` reject
- Codex CLI paper trading 문서에 backend-generated hash boundary 반영

검증:

- decision hash가 object key order와 무관하게 deterministic함
- 기존 `decisionHash` field는 hash input에서 제외됨
- decision 내용 변경 시 hash가 변경됨
- virtual decision store가 append 시 backend hash를 붙임
- historical replay progress와 decision log에 hash가 기록됨
- AI가 `decisionHash`를 제공하면 semantic reject됨
- full test suite

제외:

- Codex output schema artifact에 `decisionHash` 추가
- hash registry 또는 external signing
- immutable storage/WORM backend
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결

## PR-46: Virtual Decision Claim Support

목표:

- AI decision의 핵심 thesis/risk claim을 packet 내부 ref와 명시적으로 연결합니다.
- free-text 근거 설명이 packet 밖 정보를 암시하거나 다른 symbol/source를 끌어오지 못하도록 semantic validation을 강화합니다.

작업 범위:

- `VirtualDecisionItem.claimSupport[]` optional runtime field
- Codex output schema artifact에서 decision item별 `claimSupport` required 반영
- claim별 `claim`, `dataRefs`, `featureRefs` 구조 추가
- claim support가 최소 하나의 `dataRef` 또는 `featureRef`를 갖도록 schema validation
- semantic validator의 claimSupport 누락 hard reject
- claimSupport `dataRefs`와 `featureRefs`가 같은 packet candidate ref에 속하는지 검증
- Codex paper decision prompt version update
- dry-run/static historical fixture의 claimSupport 보강
- Codex CLI paper trading 문서에 claimSupport contract 반영

검증:

- schema artifact가 `claimSupport`를 required로 요구함
- prompt가 claimSupport mapping 규칙을 명시함
- claimSupport가 supporting ref 없이 들어오면 schema reject됨
- claimSupport 누락 decision은 semantic reject됨
- claimSupport가 packet candidate 밖 dataRef/featureRef를 참조하면 semantic reject됨
- dry-run/stored packet/historical replay fixture가 claimSupport gate를 통과함
- full test suite

제외:

- `thesis` free text의 자연어 entailment 검증
- feature value score 계산
- confidence decomposition
- decision schema v2 전면 전환
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결

## PR-47: Market Candidate Feature Scores

목표:

- AI가 feature path의 의미와 강도를 free text로 추측하지 않도록 candidate별 deterministic `featureScores[]`를 `market_packet`에 포함합니다.
- `featureScores[]`는 같은 candidate의 `featureRefs`에 연결된 backend-normalized metadata로만 사용하며, 투자 성과 보장이나 live execution signal로 사용하지 않습니다.

작업 범위:

- `MarketCandidate.featureScores[]` optional runtime field
- `MarketCandidateFeatureScore` 구조: `featureRef`, `score`, `scoreType`, `reasonCode`
- schema validation에서 `featureScores[].featureRef`가 같은 candidate의 `featureRefs`에 포함되는지 검증
- `MarketPacketBuilder`의 deterministic feature score 계산
- ranking, feature value, eligibility/policy/state feature score 계산
- historical packet builder가 기존 point-in-time candidate features를 통해 feature score를 생성하는지 검증
- Codex paper decision prompt version update
- Codex CLI paper trading 문서에 featureScores contract 반영

검증:

- market packet schema가 featureScore ref와 featureRefs 불일치를 reject함
- packet builder가 ranking/eligibility feature score를 deterministic하게 생성함
- blocked BUY candidate는 `buyEligible`과 `budgetTierAllowed` feature score가 0으로 계산됨
- historical packet builder의 point-in-time score가 `candidate.<market>.<symbol>.score` feature score에 반영됨
- prompt가 featureScores를 backend-normalized metadata로만 사용하도록 명시함
- full test suite

제외:

- confidence decomposition
- feature score를 risk approval gate로 사용하는 변경
- AI output schema에 feature score를 추가하는 변경
- decision schema v2 전면 전환
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결

## PR-48: Backend Confidence Breakdown

목표:

- AI가 제공한 단일 `confidence` scalar를 그대로 신뢰하지 않고, backend가 packet과 decision item을 비교해 confidence를 여러 deterministic component로 분해합니다.
- `confidenceBreakdown`은 Codex output이 아니라 validation 이후 backend-generated 저장 metadata로 남깁니다.

작업 범위:

- `VirtualDecisionItem.confidenceBreakdown` optional runtime field
- `VirtualDecisionConfidenceBreakdown` 구조: `modelConfidence`, `evidenceQualityScore`, `dataCompletenessScore`, `policyEligibilityScore`, `executionRiskScore`, `overallScore`, `reasonCodes`
- Codex output schema artifact가 `confidenceBreakdown`을 허용하지 않는지 테스트
- semantic validator의 AI-supplied `confidenceBreakdown` reject
- backend confidence assessment helper
- paper run workflow, stored market packet workflow, historical replay runner의 validation 이후 confidence breakdown binding
- Codex CLI paper trading 문서에 backend-generated confidence breakdown boundary 반영

검증:

- confidence assessment가 AI `confidence`를 `modelConfidence` audit field로만 보존함
- evidence/data/policy/execution component score가 deterministic하게 계산됨
- policy-blocked candidate는 policy score가 낮게 계산됨
- AI가 `confidenceBreakdown`을 제공하면 semantic validator에서 reject됨
- Codex output schema artifact가 `confidenceBreakdown`을 허용하지 않음
- paper run/stored packet/historical replay 저장 decision에 backend confidence breakdown이 남음
- full test suite

제외:

- AI output schema에 `confidenceBreakdown` 추가
- confidence score를 Risk Engine approval gate로 사용하는 변경
- calibration threshold 또는 conformal/abstention policy
- decision schema v2 전면 전환
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결

## PR-49: Virtual Decision Regression Suite

목표:

- paper-only AI decision validation의 golden path와 adversarial rejection path를 고정 회귀 테스트로 묶습니다.
- 개별 validator unit test가 커버하는 규칙을 실제 packet/decision fixture 조합 기준으로 재검증해 contract drift를 빠르게 감지합니다.

작업 범위:

- golden `MarketPacket` + `VirtualDecision` fixture 추가
- validation 통과 후 backend-generated `confidenceBreakdown` binding 검증
- unknown `dataRef`, cross-symbol `dataRef`, unknown `featureRef` adversarial case 검증
- `claimSupport` 누락, candidate 밖 `claimSupport.dataRefs`, candidate 밖 `claimSupport.featureRefs` 검증
- AI-supplied `decisionHash`, AI-supplied `confidenceBreakdown` reject 검증
- candidate eligibility 밖 `VIRTUAL_BUY` reject 검증
- PR review log에 3단계 검토 기록 추가

검증:

- golden fixture가 semantic validation을 통과함
- confidence breakdown은 AI output이 아니라 validation 이후 backend binding으로만 생성됨
- adversarial fixture가 기대 reject code로 hard reject됨
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- production validation rule 변경
- scoring threshold, calibration, conformal/abstention policy
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-50: Replay Window Sampler

목표:

- `2023-01-01`부터 `2026-05-31`까지 같은 기간 범위에서 seed 기반 랜덤 1개월 replay window를 재현 가능하게 선택합니다.
- batch replay runner가 후속 PR에서 같은 sampler를 사용해 여러 window를 반복 실행할 수 있게 합니다.

작업 범위:

- seed 기반 deterministic calendar-month sampler
- full window가 지정 range 안에 완전히 포함되는 후보만 선택
- `windowMonths`, `timezoneOffsetMinutes`, `candidateCount`, 선택된 local date metadata 반환
- historical replay CLI의 `--random-window`, `--random-window-from`, `--random-window-to`, `--random-window-seed`, `--window-months`, `--print-window-only` 옵션
- Historical Replay 문서에 window 선택 예시 추가
- sampler unit test와 CLI build 검증

검증:

- 같은 seed와 같은 range는 같은 window를 선택함
- 후보 window가 range 밖으로 나가지 않음
- multi-month window 후보가 deterministic하게 계산됨
- full window가 없는 짧은 range는 fail-closed 처리됨
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- 반복 batch 실행 loop
- historical data availability scan
- regime classification
- aggregate report
- dashboard batch view
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-51: Historical Data Availability Check

목표:

- 랜덤 또는 명시 replay window가 실제 `historical-market-snapshots.jsonl` 데이터로 실행 가능한지 사전에 확인합니다.
- batch replay runner가 데이터 없는 window를 실행하지 않도록 fail-closed 판단 근거를 제공합니다.

작업 범위:

- historical snapshot availability report helper
- 전체 snapshot earliest/latest timestamp와 window 내 snapshot count 계산
- symbol별 전체/window snapshot coverage summary
- optional required symbol coverage check
- corrupt JSONL line이 있으면 insufficient 처리
- historical replay CLI의 `--check-data-availability`, `--require-data-availability`, `--min-window-snapshots`, `--min-snapshots-per-symbol`, `--required-symbols` 옵션
- `historical:availability` npm script
- Historical Replay 문서에 data availability 확인 예시 추가

검증:

- window 안 snapshot count가 계산됨
- required symbol별 coverage가 계산됨
- window snapshot이 없으면 insufficient 처리됨
- required symbol이 없거나 부족하면 insufficient 처리됨
- corrupt snapshot line이 있으면 insufficient 처리됨
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- 외부 historical data 수집기 구현
- 반복 batch 실행 loop
- regime classification
- aggregate report
- dashboard batch view
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-52: Batch Replay Run Metadata

목표:

- 반복 batch replay에서 개별 실행 결과를 나중에 집계할 수 있도록 run identity, window, configuration metadata를 구조화합니다.
- 기존 single historical replay의 `historical-replay-run-metadata.json`을 batch runner가 재사용할 수 있는 manifest로 확장합니다.

작업 범위:

- `historicalReplayRunMetadata` schema에 `identity`, `window`, `configuration` 추가
- `runId`, optional `batchId`, optional `runIndex` 저장
- explicit/random window source, selected month, seed, timezone offset 저장
- clock, sampling policy, initial cash, packet/risk constraint configuration 저장
- historical replay workflow option에 batch metadata context 추가
- historical replay CLI의 `--batch-id`, `--batch-run-index`, `--run-id` 옵션 추가
- Batch Run Metadata 문서 추가

검증:

- workflow가 `historical-replay-run-metadata.json`에 batch identity를 저장함
- random window selection metadata가 run metadata에 저장됨
- CLI batch flags가 metadata 파일까지 전달됨
- 기존 positional/named option parsing이 유지됨
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- 반복 batch 실행 loop
- batch run directory layout 생성
- regime classification
- aggregate report
- dashboard batch view
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-53: Batch Replay Runner

목표:

- seed 기반 random 1개월 replay window를 여러 번 선택하고 각 window를 paper-only historical replay로 실행합니다.
- 각 실행 결과를 batch manifest와 run JSONL로 남겨 후속 regime classification과 aggregate report에서 분석할 수 있게 합니다.

작업 범위:

- batch replay workflow 추가
- source data directory와 run별 output directory 분리
- run별 deterministic seed derivation (`seed:runIndex`)
- run별 data availability preflight
- insufficient window는 replay workflow 실행 없이 `skipped` record로 저장
- completed/failed/skipped run record JSONL 저장
- batch manifest JSON 저장
- historical batch replay CLI 추가
- `historical:batch:replay:dry` npm script 추가
- workflow/CLI tests
- Historical Replay 문서에 batch runner 사용법과 출력 구조 추가

검증:

- batch manifest가 생성됨
- run JSONL에 completed run summary가 저장됨
- run별 `historical-replay-run-metadata.json`이 batch identity/window를 포함함
- insufficient window가 skipped로 기록되고 report path가 null로 유지됨
- CLI가 batch manifest와 run JSONL을 생성함
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- regime classification
- aggregate report
- benchmark comparison hardening
- dashboard batch view
- Codex CLI AI batch 호출
- 외부 historical data 수집기
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-54: Regime Classifier

목표:

- batch replay run record에 window별 market regime metadata를 추가해 상승/하락/횡보/혼합/데이터부족 조건별 분석 기반을 만듭니다.
- regime classification은 trading signal이 아니라 후속 aggregate report의 grouping key로만 사용합니다.

작업 범위:

- market regime classifier helper 추가
- symbol별 first/last window price return 계산
- `bull`, `bear`, `sideways`, `mixed`, `insufficient_data` label 정의
- 평균 return, median return, 상승/하락/flat symbol ratio 저장
- classifier thresholds와 reason code 저장
- batch replay run record에 `marketRegime` 추가
- regime classifier tests
- batch workflow tests에 regime record 검증 추가
- Historical Replay 문서에 regime rule 설명 추가

검증:

- 상승 window가 `bull`로 분류됨
- 하락 window가 `bear`로 분류됨
- 횡보 window가 `sideways`로 분류됨
- 방향성이 엇갈린 window가 `mixed`로 분류됨
- 분류 가능한 데이터가 부족하면 `insufficient_data`로 분류됨
- batch run JSONL에 `marketRegime`이 저장됨
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- aggregate report
- regime별 수익률 비교표
- benchmark comparison hardening
- dashboard batch view
- regime을 trading/risk decision에 연결
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-55: Batch Aggregate Report

목표:

- batch replay가 생성한 `batch-replay-runs.jsonl`을 전체 및 market regime별로 집계합니다.
- 반복 실행 결과가 상승/하락/횡보/혼합/데이터부족 조건에서 어떻게 달라지는지 사후 분석할 수 있는 report를 만듭니다.
- 집계 report는 paper-only 결과 요약이며 투자 조언, 성과 보장, live trading signal로 사용하지 않습니다.

작업 범위:

- batch run record aggregate report helper 추가
- 전체 completed/skipped/failed count와 return sample count 계산
- 전체 및 regime별 평균/중앙값/min/max paper return ratio 계산
- 전체 및 regime별 win rate, final virtual net worth 평균, trade/rejected count 계산
- `batch-replay-runs.jsonl` 입력 CLI 추가
- optional aggregate report JSON 파일 출력
- Historical Replay 문서에 report 실행 예시와 safety boundary 추가
- PR review log에 3단계 검토 기록 추가

검증:

- 전체 및 regime별 aggregate metric unit test
- markdown render disclaimer test
- CLI가 JSONL 입력을 읽고 aggregate JSON report를 쓰는지 검증
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- benchmark comparison hardening
- dashboard batch view
- aggregate 결과 기반 전략 자동 조정
- Codex CLI AI batch 호출
- 외부 historical data 수집기
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-56: Benchmark Comparison Hardening

목표:

- historical replay report의 benchmark raw metric만으로는 strategy가 benchmark 대비 얼마나 다른지 바로 판단하기 어렵습니다.
- strategy와 각 benchmark의 delta를 구조화해 batch/diagnostic 분석에서 같은 contract로 비교할 수 있게 합니다.
- benchmark 비교는 paper-only 사후 분석이며 투자 조언, 성과 보장, live trading signal로 사용하지 않습니다.

작업 범위:

- `HistoricalReplayBenchmarkReport.comparisons` contract 추가
- strategy vs cash-only, equal-weight buy-and-hold, initial-portfolio buy-and-hold delta 계산
- final net worth, total return, max drawdown, tick volatility, turnover, fee drag delta 계산
- equal-weight benchmark unavailable 상태를 명시적으로 표현
- equal-weight buy-and-hold가 첫 priced replay packet 이후에만 진입하도록 entry point 보강
- Historical Replay 문서에 comparison delta semantics 추가
- PR review log에 3단계 검토 기록 추가

검증:

- strategy vs benchmark delta unit test
- equal-weight benchmark entry point test
- priced candidate가 없을 때 unavailable comparison test
- historical replay report render test
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- Sharpe/Sortino/Calmar 등 신규 성과 지표
- benchmark weight optimizer
- external market index benchmark
- dashboard batch view
- aggregate 결과 기반 전략 자동 조정
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-57: Batch Replay Dashboard Read-only View

목표:

- batch aggregate report를 dashboard에서 조회만 할 수 있게 합니다.
- 반복 replay 전체 결과와 market regime별 결과를 한 화면에서 확인할 수 있게 합니다.
- dashboard는 batch replay 실행, report 생성, AI 호출, 주문 생성을 트리거하지 않습니다.

작업 범위:

- storage path에 `batch-replay-aggregate-report.json` 추가
- Local Operations API에 `GET/HEAD /batch/replay/report` read-only endpoint 추가
- dashboard fetch endpoint에 batch replay aggregate report 조회 추가
- dashboard에 반복 리플레이 요약 KPI와 장세별 결과 panel 추가
- dashboard asset/API tests 추가
- Historical Replay 문서에 dashboard 조회 경계 추가
- PR review log에 3단계 검토 기록 추가

검증:

- `/batch/replay/report`가 저장된 aggregate report를 read-only로 반환하는지 테스트
- dashboard HTML에 batch replay panel DOM hook이 있는지 테스트
- dashboard JS가 batch endpoint와 renderer를 포함하는지 테스트
- mutation method가 계속 거절되는지 기존 테스트 유지
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- dashboard에서 batch replay 실행
- dashboard에서 aggregate report 생성
- dashboard에서 strategy 자동 조정
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-58: Regression And Safety Tests

목표:

- batch replay 분석 흐름이 paper-only/read-only 경계를 유지하는지 회귀 테스트로 고정합니다.
- aggregate report가 skipped/failed/null-return run을 수익률 표본에 섞지 않는지 검증합니다.
- dashboard/Local Operations API가 batch replay 조회 endpoint에 대해 mutation method를 허용하지 않는지 검증합니다.

작업 범위:

- batch replay workflow/report/dashboard/API source file 대상 금지 실행 표면 정적 테스트 추가
- batch aggregate report의 unavailable return sample 제외 테스트 추가
- `/batch/replay/report` `POST` 거절 및 `HEAD` read-only 조회 테스트 추가
- PR review log에 3단계 검토 기록 추가

검증:

- targeted safety/report/API tests
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- production scheduler 변경
- batch replay 실행 policy 변경
- aggregate metric 산식 변경
- dashboard 기능 추가
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-59: Batch Replay Codex AI Provider

목표:

- batch replay에서 실제 Codex CLI paper-only provider를 명시 옵션으로 사용할 수 있게 합니다.
- 기본 batch replay는 계속 deterministic provider를 사용하고, Codex AI는 `--use-codex-ai`가 있을 때만 활성화합니다.
- run별 Codex call cap과 batch 전체 daily budget을 분리해 긴 실행을 통제합니다.

작업 범위:

- batch workflow에 per-run decision provider factory 주입점 추가
- batch manifest에 decision provider metadata 기록
- batch CLI에 `--use-codex-ai`, `--max-codex-calls-per-run` 옵션 추가
- `historical:batch:replay` npm script 추가
- `AI_DECISION_ENABLED=true` 없이는 Codex AI batch 실행을 fail-fast 처리
- workflow/CLI tests 추가
- Historical Replay 문서에 실제 Codex AI batch 실행법과 안전 경계 추가
- PR review log에 3단계 검토 기록 추가

검증:

- provider factory 주입 workflow test
- CLI fail-fast test
- 기존 deterministic batch replay CLI test
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- dashboard에서 batch replay 실행
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` MCP tool 노출
- raw `tossctl` MCP tool 노출
- retry/backoff scheduler
- 병렬 batch execution

## Batch Replay Follow-up PRs

다음 PR들은 paper-only batch replay 분석을 위한 후속 범위입니다.

## PR-60: Codex Structured Output Replay Fix

목표:

- 실제 Codex CLI batch replay가 `VirtualDecision` 구조화 출력 스키마를 사용해 decision/trade 로그를 남기도록 수정합니다.
- historical replay CLI와 batch replay CLI의 Codex 환경 변수 이름을 기존 paper CLI 설정과 호환되게 정리합니다.
- AI decision prompt가 output schema에 맞는 최상위 JSON object를 반환하도록 요구합니다.

작업 범위:

- Codex structured output에서 거부되는 JSON Schema keyword 제거
- action별 branch schema로 `VIRTUAL_BUY`, `VIRTUAL_HOLD`, `VIRTUAL_SELL` output contract 정리
- `paper-v11` prompt로 packet identity, direct schema output, non-empty candidate decision 요구 반영
- historical replay/batch replay CLI에 `AI_DECISION_*` 우선 및 `CODEX_*` fallback env resolver 추가
- env resolver, prompt, output schema artifact tests 추가/수정
- Historical Replay 문서와 PR review log에 설정/검토 기록 추가

검증:

- `npm test`
- `git diff --check`
- 금지 경계 grep
- 실제 Codex CLI 1회 smoke batch
- 실제 Codex CLI 10회 historical batch replay
- batch aggregate report 생성

제외:

- aggressive risk profile
- 목표 수익률 최적화
- 장세 균형 sampler
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-61: Aggressive Paper Risk Profile

목표:

- historical replay와 batch replay에서 명시적으로 선택 가능한 `aggressive_paper` profile을 추가합니다.
- 기본 replay 동작은 기존 `conservative` profile로 유지합니다.
- 선택된 profile과 정규화된 risk policy를 manifest와 run metadata에 저장해 batch 결과를 나중에 재현 가능하게 만듭니다.

작업 범위:

- `conservative`, `balanced`, `aggressive_paper` paper-only risk profile resolver 추가
- historical replay CLI와 batch replay CLI의 `--risk-profile` 옵션 추가
- `--max-new-positions`, `--max-budget-per-symbol-krw` override를 profile 기반 constraint/risk policy에 반영
- replay runner와 Codex replay runner에 `VirtualRiskEngine` policy override 전달
- batch manifest와 run metadata에 `riskProfile`, `riskPolicy` 저장
- profile resolver, workflow metadata, CLI integration tests 추가
- Historical Replay 문서와 Risk Policy 문서에 profile 표와 적용 경계 추가
- PR review log에 3단계 검토 기록 추가

검증:

- 기본 profile이 기존 `maxNewPositions=3`, `maxBudgetPerSymbolKrw=100000` constraint를 유지함
- `aggressive_paper`가 `maxNewPositions=5`, `maxBudgetPerSymbolKrw=400000` constraint와 paper risk policy를 생성함
- aggressive profile에서 더 큰 paper-only buy fill이 허용되는지 검증
- batch manifest와 run metadata에 선택 profile과 risk policy가 저장되는지 검증
- CLI 실행 결과가 선택 profile을 stdout/metadata에 기록하는지 검증
- `npm test`
- `git diff --check`
- 금지 경계 grep
- deterministic dry-run batch smoke

제외:

- 목표 수익률 최적화
- 장세 균형 sampler
- take-profit/stop-loss/rebalance 규칙
- aggressive profile 전용 Codex prompt policy
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-62: Market Regime Balanced Batch Sampler

목표:

- batch replay가 random month만 반복하지 않고 상승장/하락장/횡보장/혼합장 조건을 균형 있게 선택할 수 있게 합니다.
- 기본 batch replay는 기존 `random` sampling을 유지합니다.
- balanced sampling 결과를 manifest와 run record에 남겨 aggregate report에서 조건별 결과를 해석할 수 있게 합니다.

작업 범위:

- `balanced_regime` window sampling mode 추가
- 전체 candidate month를 `MarketRegimeClassifier`로 사전 분류하는 sampler 추가
- 기본 target regime `bull,bear,sideways,mixed` 순환 선택
- `--window-sampling random|balanced_regime` CLI 옵션 추가
- `--target-regimes` CLI 옵션 추가
- batch manifest에 requested/active/unavailable target regimes와 bucket count 저장
- run record에 target regime, target bucket size, actual market regime 저장
- sampler unit test, workflow test, CLI integration test, safety test 업데이트
- Historical Replay 문서와 PR review log 업데이트

검증:

- sampler가 available target regime을 run index 기준으로 순환 선택함
- unavailable target regime은 active target에서 제외됨
- requested target regime이 하나도 없으면 fail-closed 처리됨
- batch workflow가 balanced target과 actual regime을 run JSONL에 저장함
- CLI가 `--window-sampling balanced_regime`을 stdout/manifest/run record에 기록함
- `npm test`
- `git diff --check`
- 금지 경계 grep
- 실제 2023-01~2026-05 데이터 기준 deterministic dry-run smoke

제외:

- 목표 수익률 hit-rate report
- take-profit/stop-loss/rebalance 규칙
- aggregate 결과 기반 strategy 자동 조정
- Codex prompt policy 변경
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-63: Target Return Hit-rate Aggregate Report

목표:

- batch aggregate report가 완료된 paper return sample 중 target return threshold 이상을 달성한 비율을 계산합니다.
- 사용자가 월 15%, 30% 같은 목표 조건을 paper-only 사후 분석 지표로 확인할 수 있게 합니다.
- 기본 threshold는 `0.15`, `0.30`으로 두고 CLI에서 명시 threshold를 받을 수 있게 합니다.

작업 범위:

- aggregate report option에 `targetReturnThresholds` 추가
- 전체 및 regime별 `targetReturnHitRates` 계산
- threshold별 sample count, hit count, hit rate, hit run ID 저장
- historical batch report CLI에 `--target-return-thresholds` 옵션 추가
- markdown render에 target return hit-rate 출력
- report/CLI tests 업데이트
- Historical Replay 문서와 PR review log 업데이트

검증:

- 기본 threshold `[0.15, 0.30]`이 report에 저장됨
- custom threshold가 정렬/중복 제거되어 저장됨
- 전체 및 regime별 hit count/hit rate가 return sample 기준으로 계산됨
- skipped/failed/null-return run은 sample에서 제외됨
- CLI가 `--target-return-thresholds`를 JSON report와 markdown output에 반영함
- `npm test`
- `git diff --check`
- deterministic aggregate report smoke

제외:

- 목표 수익률 최적화
- strategy 자동 조정
- take-profit/stop-loss/rebalance 규칙
- Codex prompt policy 변경
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## Next Paper Return Experiment PRs

다음 PR들은 사용자가 요청한 월 15~30% 목표를 paper-only 실험으로 검증하기 위한 후속 범위입니다.

## PR-64: Paper Exit Policy Replay

목표:

- historical replay와 batch replay에서 paper-only take-profit/stop-loss/rebalance 규칙을 실험할 수 있게 합니다.
- exit rule은 AI/provider 판단 횟수와 분리하되, decision/risk/trade log에는 남깁니다.

완료:

- `PaperExitPolicy` 순수 모듈 추가
- replay runner와 Codex replay runner에 exit decision 실행 연결
- CLI 옵션 `--paper-take-profit-ratio`, `--paper-stop-loss-ratio`, `--paper-rebalance-max-position-weight-ratio` 추가
- run metadata, batch manifest, historical report에 `paperExitPolicy` 기록
- PR review log에 3단계 검토 기록 추가
- PR #28로 merge 완료

제외:

- live trading 연결
- 수익률 보장 또는 strategy 자동 조정
- historical universe 확대
- Codex prompt policy 변경

## PR-65: Historical Universe Coverage

목표:

- broader paper replay 실험을 위한 KR historical universe manifest를 추가합니다.
- 현재 core dataset과 확장 target의 월별 coverage를 검증하는 CLI를 제공합니다.
- batch replay availability check에 universe required symbol을 연결합니다.

작업 범위:

- `docs/historical-universe.kr-expanded.json` 추가
- `HistoricalUniverseCoverage` report 계산
- `historical:universe:coverage` CLI 추가
- single/batch replay CLI의 `--universe-path` 입력 지원
- optional expansion symbol 강제 옵션 추가
- coverage/CLI/safety tests 업데이트
- Historical Replay 문서와 PR review log 업데이트

검증:

- required core symbol coverage가 충분하면 report status가 `available`
- optional symbol gap은 status를 깨지 않고 별도 필드로 기록
- optional symbol 강제 시 fail-closed
- batch replay CLI가 universe manifest를 availability required symbol로 반영
- `npm test`
- `git diff --check`
- 실제 2023-01~2026-05 데이터 기준 coverage smoke

제외:

- historical raw data 파일 commit
- 외부 데이터 수집 자동화
- replay 결과 기반 universe 자동 선택
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-66: Aggressive Codex Prompt Policy

목표:

- `aggressive_paper` risk profile에서 Codex CLI paper-only prompt policy를 기본 historical replay prompt와 분리합니다.
- 공격형 profile이 더 넓은 paper-only risk envelope을 사용할 수 있음을 prompt에 명시하되, 수익률 목표 달성을 강제하지 않도록 경계를 둡니다.
- batch replay manifest에 선택된 prompt policy와 prompt version을 기록합니다.

작업 범위:

- historical replay prompt policy resolver 추가
- `aggressive_paper` 전용 prompt version 추가
- single/batch historical Codex provider 생성 시 risk profile 기반 prompt policy 주입
- batch replay decision provider metadata에 `promptPolicy`, `promptVersion` 추가
- prompt policy unit test와 batch metadata test 추가
- Historical Replay 문서와 PR review log 업데이트

검증:

- 기본 historical replay prompt version은 기존 `paper-v11-historical-replay-v1` 유지
- `aggressive_paper`는 `paper-v11-historical-replay-aggressive-paper-v1` 사용
- aggressive prompt에는 paper-only, no live trading, no return target chasing, eligibility/constraint guard가 포함
- batch manifest에 Codex provider prompt policy/version 기록
- `npm test`
- `git diff --check`

제외:

- 수익률 보장 또는 목표 수익률 강제
- prompt가 Risk Engine을 우회하는 규칙
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출
- 새로운 외부 데이터 수집 또는 web search 기본 활성화

## Remaining Paper Return Experiment PRs

## PR-67: Batch AI Failure Accounting

목표:

- 완료된 historical replay 내부에서 발생한 Codex provider failure를 batch run 실패와 분리해 기록합니다.
- batch aggregate report가 provider failure count를 합산해, replay workflow 자체 실패와 AI 판단 실패를 구분할 수 있게 합니다.
- 이 변경은 paper-only 사후 분석 정확도 개선이며 trading decision, risk limit, order execution policy를 바꾸지 않습니다.

작업 범위:

- batch run summary에 `aiDecisionFailureCount` 추가
- `HISTORICAL_AI_DECISION_FAILED` audit event를 완료 run summary에 집계
- aggregate report에 `totalAiDecisionFailureCount` 추가
- provider failure가 replay 완료를 막지 않는 workflow test 추가
- report aggregate test, Historical Replay 문서, PR review log 업데이트

검증:

- provider failure가 있는 completed replay가 batch `failed`로 승격되지 않음
- aggregate report가 completed run의 AI failure count만 합산함
- `npm run build`
- targeted tests
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- AI prompt/schema 변경
- retry/repair 정책 추가
- risk limit 완화
- allocation/exit policy 변경
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-68: Codex CLI Batch Session Budget

목표:

- batch replay의 Codex CLI paper-only 호출이 `CODEX_DECISION_MAX_RUNS_PER_DAY` 기본값 1에 묶이지 않게 합니다.
- 각 replay run마다 독립 provider budget을 사용하고, Codex CLI 실행은 ephemeral session으로 격리합니다.
- 실제 batch 실행 전에 연결 실패를 빠르게 드러내는 preflight를 추가합니다.

작업 범위:

- `CodexCliDecisionProvider`에 `ephemeral` command option 추가
- single/batch historical replay Codex CLI 호출에 `--ephemeral` 적용
- batch replay CLI에서 run마다 새 Codex provider 생성
- `--max-codex-calls-per-run`을 per-run provider budget으로 사용
- batch Codex preflight와 `--skip-codex-preflight` escape hatch 추가
- Codex stderr failure summary helper 추가
- provider/replay/CLI regression test와 PR review log 업데이트

검증:

- provider command에 `--ephemeral` 포함
- batch CLI가 preflight 1회와 run별 Codex 호출을 수행하되 per-run cap 1에서 2개 run을 완료
- provider failure audit summary에 핵심 stderr error line 포함
- `npm run build`
- targeted tests
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- AI prompt/schema 변경
- retry/repair 정책 추가
- allocation/exit/risk policy 변경
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## PR-69: Paper Allocation Target Exposure

목표:

- paper replay에서 현금 비중이 과도하게 유지되는 원인을 줄이기 위해 profile별 target exposure를 명시합니다.
- market packet에 allocation snapshot을 포함해 AI/provider와 deterministic fixture가 같은 budget cap을 보게 합니다.
- target exposure를 normalizer와 `VirtualRiskEngine`의 deterministic final gate에 연결합니다.

작업 범위:

- `PaperAllocationPolicy`와 allocation snapshot 계산 추가
- `marketPacket.portfolioAllocation` schema 추가
- `MarketPacketBuilder`와 `HistoricalMarketPacketBuilder`에 allocation snapshot 연결
- BUY normalizer의 per-decision/target-exposure cap 적용
- `VirtualRiskEngine` target exposure reject rule 추가
- risk profile별 target exposure와 initial cash 기반 aggressive budget scaling 추가
- historical replay, Codex historical replay, single/batch workflow, CLI에 allocation policy 전달
- metadata/manifest에 allocation policy 기록
- targeted tests와 PR review log 업데이트

검증:

- allocation snapshot 계산
- packet builder eligibility와 budget tier
- BUY normalizer cap
- target exposure risk reject
- first-priced fixture multi-candidate allocation
- batch manifest/run metadata allocation 기록
- `npm run build`
- targeted tests
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- 수익률 보장 또는 목표 수익률 강제
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출
- partial take-profit/trailing stop exit policy 변경
- portfolio construction aggregate report 확장

## PR-70: Paper Exit Policy Telemetry

목표:

- 기존 paper-only take-profit을 전량 매도 방식만이 아니라 partial take-profit 후 trailing stop 방식으로도 실험할 수 있게 합니다.
- replay report와 batch aggregate report에 cash/exposure/time-in-market 지표를 추가해 현금 비중 문제를 분석할 수 있게 합니다.
- dust/no-op close와 의미 있는 reject count를 분리해 risk reject 통계를 해석 가능하게 만듭니다.

작업 범위:

- `PaperExitPolicy`에 `takeProfitMode`, `takeProfitSellRatio`, `trailingStopFromPeakRatio` 추가
- replay runner와 Codex replay runner에 종목별 paper-only exit state 추가
- CLI 옵션 `--paper-take-profit-mode`, `--paper-take-profit-sell-ratio`, `--paper-trailing-stop-from-peak-ratio` 추가
- run-level portfolio construction metric 계산
- batch aggregate report에 exposure/cash/time-in-market/target gap/dust reject metric 추가
- Historical Replay 문서와 PR review log 업데이트

검증:

- partial take-profit이 1회만 실행되고 이후 peak 대비 trailing stop에서 잔여 수량을 sell-all
- stop-loss, take-profit, rebalance 우선순위 유지
- normalized `paperExitPolicy`가 metadata/manifest/CLI output에 기록됨
- report가 NaN 없이 zero NAV timeline을 처리
- `npm test`
- `git diff --check`
- 금지 경계 grep

제외:

- 수익률 보장 또는 목표 수익률 강제
- strategy 자동 최적화
- live `TradingSignal` 또는 `OrderIntent` 연결
- live trading 또는 broker adapter 연결
- raw `codex exec` 또는 raw `tossctl` MCP tool 노출

## Later PRs

다음 작업은 위 vertical slice가 안정된 뒤 별도 계획으로 분리합니다.

- Official Toss Open API adapter design
- official token auth design
- official token config parser
- mocked token auth client
- live Risk Engine implementation
- threat model for live trading
- live OrderRouter dry-run
- official order gateway behind explicit trading gates
- deployment packaging

이 later PR들은 사용자 명시 지시 없이는 시작하지 않습니다.

### Official Toss Open API adapter design

설계 문서:

- [official-toss-open-api-adapter-design.md](official-toss-open-api-adapter-design.md)

이 단계는 official API adapter 구현이 아니라, 공식 OpenAPI source of truth, 인증 방식, endpoint category, rate limit, error model, adapter 계층, mock-first 구현 순서, MCP/dashboard 금지 표면을 문서화합니다.

제외:

- token auth 구현
- official API 실제 호출 코드
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter 구현
- `TRADING_ENABLED=true` 기본값 또는 실행 예시
- `place_order` MCP enabled surface

### Authenticated read-only HTTP client

목표:

- read-only market adapter를 붙이기 전에 authenticated HTTP request boundary를 순수하게 검증합니다.
- read-only client는 injected token provider와 injected transport만 사용하고 actual network transport를 구현하지 않습니다.
- `GET` 외 method는 token 발급 또는 transport 호출 전에 fail-closed 처리합니다.

작업 범위:

- `src/broker/tossOpenApiReadOnlyHttpClient.ts`
- `src/broker/tossOpenApiReadOnlyHttpClient.test.ts`
- `docs/PROJECT_STRUCTURE.md`, `docs/CODE_CONVENTION.md`, `docs/official-token-auth-design.md`, `docs/official-toss-open-api-adapter-design.md`
- PR review log에 3단계 검토 기록 추가

검증:

- Bearer token header injection
- `GET` only method guard
- disabled/invalid auth config fail-closed
- root-relative path validation
- non-https base URL reject
- 401/403/429/4xx/5xx error mapping
- official error envelope nested `error.code` parsing
- 401 token failure guarded reissue 1회
- 429 `Retry-After` parsing
- `npm run check`
- `git diff --check`
- 금지 경계 grep

제외:

- actual network transport
- official API 실제 호출
- market endpoint adapter
- account snapshot reader
- persistent token store
- Local Operations API/MCP/dashboard token or broker surface
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter 구현
- `TRADING_ENABLED=true` 기본값 또는 실행 예시
- `place_order` MCP enabled surface

### Read-only market data adapter

목표:

- official Toss Open API market data endpoint를 read-only HTTP client 뒤에서 사용할 수 있게 path/query mapping을 고정합니다.
- adapter는 injected read-only JSON client만 호출하고 actual network transport를 구현하지 않습니다.
- market data adapter는 account/order source of truth 역할을 하지 않습니다.

작업 범위:

- `src/broker/tossOpenApiMarketDataAdapter.ts`
- `src/broker/tossOpenApiMarketDataAdapter.test.ts`
- README, `docs/PROJECT_STRUCTURE.md`, `docs/CODE_CONVENTION.md`, `docs/official-toss-open-api-adapter-design.md`
- PR review log에 3단계 검토 기록 추가

검증:

- official OpenAPI JSON endpoint metadata 재확인
- `GET /api/v1/prices` symbols query mapping과 1-200개 limit fail-closed
- `GET /api/v1/orderbook` symbol query mapping
- `GET /api/v1/trades` symbol/count query mapping
- `GET /api/v1/candles` symbol/interval/count/before/adjusted query mapping
- `GET /api/v1/stocks/{symbol}/warnings` path mapping
- `GET /api/v1/market-calendar/{KR|US}` path/date query mapping
- invalid symbol, count, interval, market input fail-closed
- account/order endpoint 미호출
- `npm run check`
- `git diff --check`
- 금지 경계 grep

제외:

- actual network transport
- official API 실제 호출
- account snapshot reader
- account header handling
- persistent token store
- Local Operations API/MCP/dashboard token or broker surface
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter 구현
- `TRADING_ENABLED=true` 기본값 또는 실행 예시
- `place_order` MCP enabled surface

### Read-only account snapshot

목표:

- official Toss Open API account/holdings endpoint를 read-only boundary 뒤에서 조회할 수 있게 account snapshot reader를 추가합니다.
- reader는 injected account read-only JSON client만 호출하고 actual network transport를 구현하지 않습니다.
- account number와 accountSeq는 snapshot output에서 masking합니다.

작업 범위:

- `src/broker/tossOpenApiAccountSnapshotReader.ts`
- `src/broker/tossOpenApiAccountSnapshotReader.test.ts`
- README, `docs/PROJECT_STRUCTURE.md`, `docs/CODE_CONVENTION.md`, `docs/official-toss-open-api-adapter-design.md`
- PR review log에 3단계 검토 기록 추가

검증:

- official OpenAPI JSON endpoint metadata 재확인
- `GET /api/v1/accounts` mapping
- `GET /api/v1/holdings` accountSeq boundary와 optional symbol query mapping
- missing accountSeq에서 holdings 조회를 skip하고 degraded source status 반환
- account number와 accountSeq masking
- invalid accountSeq, symbol input fail-closed
- malformed official envelope fail-closed
- order endpoint 미호출
- `npm run check`
- `git diff --check`
- 금지 경계 grep

제외:

- actual network transport
- official API 실제 호출
- persistent account store
- portfolio mutation
- order endpoint
- Local Operations API/MCP/dashboard token or broker surface
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter 구현
- `TRADING_ENABLED=true` 기본값 또는 실행 예시
- `place_order` MCP enabled surface

### Live RiskEngine implementation

목표:

- live order path로 바로 연결하지 않는 deterministic `LiveRiskEngine`을 추가합니다.
- 이미 구조화된 live order intent와 risk snapshot을 입력으로 받아 fail-closed `RiskDecision`을 생성합니다.
- broker gateway, OrderRouter, official order endpoint, MCP/API/dashboard mutation surface는 추가하지 않습니다.

작업 범위:

- `src/risk/liveRiskPolicy.ts`
- `src/risk/liveRiskEngine.ts`
- `src/risk/liveRiskEngine.test.ts`
- `docs/PROJECT_STRUCTURE.md`, `docs/CODE_CONVENTION.md`, `docs/risk-policy.md`
- PR review log에 3단계 검토 기록 추가

검증:

- 기본 policy fail-closed
- valid limit order approval path
- stale signal fail-closed
- market hours unknown/closed fail-closed
- duplicate order intent와 idempotency key reuse 차단
- cooldown 차단
- max order amount, daily loss, symbol/market/total exposure 차단
- stale risk snapshot 차단
- duplicate position row가 있는 symbol exposure 집계
- pending buy order exposure를 cap 계산에 반영
- pending sell order quantity를 보유 수량 계산에 반영
- market order disabled/requires approval 차단
- sell position missing/quantity exceeded 차단
- preview required/expired/mismatch 차단
- malformed root live risk payload 차단
- malformed snapshot audit metadata 차단
- malformed live order preview 차단
- malformed numeric order intent와 risk snapshot 차단
- malformed numeric risk policy 차단
- malformed boolean risk policy 차단
- malformed risk policy collection 차단
- malformed cooldown expiry 차단
- unknown market order policy 차단
- malformed snapshot collection 차단
- sell intent가 exposure를 증가시키지 않음
- `npm run check`
- `git diff --check`
- 금지 경계 grep

제외:

- broker gateway
- `OrderRouter`
- official order endpoint 호출
- execution tracking
- Local Operations API/MCP/dashboard mutation surface
- Codex CLI `virtual_decision`을 live intent로 변환하는 경로
- `TRADING_ENABLED=true` 기본값 또는 실행 예시
- `place_order` MCP enabled surface

### Official token auth design

설계 문서:

- [official-token-auth-design.md](official-token-auth-design.md)

이 단계는 official token auth 구현이 아니라, `POST /oauth2/token`의 OAuth2 Client Credentials 계약, `application/x-www-form-urlencoded` 요청, secret handling, token lifecycle, single-flight, client당 유효 token 1개 제약, 후속 구현 테스트 기준을 문서화합니다.

포함:

- 공식 Auth API 문서와 OpenAPI JSON 기준 token endpoint snapshot
- `client_id`, `client_secret`, `access_token` masking과 repository 금지선
- process memory token cache, expiry margin, guarded reissue, `AUTH` rate limit 처리 방향
- MCP/dashboard token value 노출 금지 정책

제외:

- token auth client 구현
- token issue HTTP call
- official API 실제 호출 코드
- persistent token store
- account/order adapter
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter 구현
- `TRADING_ENABLED=true` 기본값 또는 실행 예시
- `place_order` MCP enabled surface

### Official token config parser

목표:

- official token auth 구현 전에 env config parsing을 safe-disabled 상태로 고정합니다.
- `.env.example`에는 placeholder만 추가하고 real credential을 포함하지 않습니다.
- `TOSS_OPEN_API_AUTH_ENABLED=true`에서 required secret 누락을 API call 전에 fail-closed 상태로 표현합니다.

작업 범위:

- `src/config/tossOpenApiAuthConfig.ts`
- `src/config/tossOpenApiAuthConfig.test.ts`
- `.env.example` placeholder
- `scripts/qualityGate.mjs` safe default drift check
- `docs/PROJECT_STRUCTURE.md`, `docs/CODE_CONVENTION.md`, `docs/official-token-auth-design.md`
- PR review log에 3단계 검토 기록 추가

검증:

- safe disabled default
- missing client id/client secret invalid status
- non-https base URL reject
- safe summary가 credential value를 반환하지 않음
- `npm run check`
- `git diff --check`
- 금지 경계 grep

제외:

- token auth HTTP client
- token issue request builder
- token cache
- official API 실제 호출
- account/order adapter
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter 구현
- `TRADING_ENABLED=true` 기본값 또는 실행 예시
- `place_order` MCP enabled surface

### Mocked token auth client

목표:

- official token auth HTTP transport를 붙이기 전에 token issue request contract, response parsing, process memory cache, single-flight를 순수하게 검증합니다.
- AuthClient는 injected `TossOpenApiTokenIssuer`만 호출하고 실제 network transport는 구현하지 않습니다.
- disabled/invalid config는 issuer 호출 전에 fail-closed 처리합니다.

작업 범위:

- `src/broker/tossOpenApiAuthClient.ts`
- `src/broker/tossOpenApiAuthClient.test.ts`
- `docs/PROJECT_STRUCTURE.md`, `docs/CODE_CONVENTION.md`, `docs/official-token-auth-design.md`
- PR review log에 3단계 검토 기록 추가

검증:

- `application/x-www-form-urlencoded` token issue request body
- disabled/invalid config no issuer call
- `Bearer` token response validation
- `expires_in` 기반 cache와 safety margin
- concurrent request single-flight
- invalid response no-cache
- `npm run check`
- `git diff --check`
- 금지 경계 grep

제외:

- real HTTP token transport
- official API 실제 호출
- persistent token store
- account/order adapter
- Local Operations API/MCP/dashboard token status surface
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter 구현
- `TRADING_ENABLED=true` 기본값 또는 실행 예시
- `place_order` MCP enabled surface
