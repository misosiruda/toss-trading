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

## Later PRs

다음 작업은 위 vertical slice가 안정된 뒤 별도 계획으로 분리합니다.

- Official Toss Open API adapter design
- official token auth
- live Risk Engine implementation
- live OrderRouter
- threat model for live trading
- deployment packaging

이 later PR들은 사용자 명시 지시 없이는 시작하지 않습니다.
