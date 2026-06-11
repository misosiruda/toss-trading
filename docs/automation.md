# Automation

> Codex is not the trading engine. Codex is an MCP-based operations interface for inspecting, explaining, and safely controlling a deterministic trading backend.

## Correct Use of Automation

Automation은 backend runtime과 Codex operation automation을 분리해서 설계해야 합니다.

Trading Engine의 scheduler와 worker가 screener, strategy, risk, order, execution tracking을 실행합니다. Codex automation은 trading loop를 돌리지 않습니다. Codex automation은 보고서 생성, 상태 요약, read-only 점검 같은 운영 보조 작업에만 사용합니다.

## Backend Automation

다음 작업은 backend에서 실행합니다.

- market data polling
- optional external intelligence collection
- screener schedule
- paper-only Codex CLI decision run
- strategy evaluation
- risk checks
- order routing
- execution reconciliation
- position update
- audit log persistence
- kill switch enforcement

이 작업은 Codex 세션과 무관하게 동작해야 합니다.

## Codex Automation

Codex는 다음과 같은 scheduled report generation에 사용할 수 있습니다.

- 장 종료 후 account summary 보고서 생성
- 최근 candidates와 signals 요약
- rejected risk decisions 설명
- strategy status 점검
- audit event anomaly 요약
- docs 또는 runbook 정리

Codex automation은 주문을 생성하거나 실행하지 않습니다.

`codex exec`를 사용하는 paper trading decision run은 Codex app automation이 아니라 backend automation입니다. backend worker가 입력 packet, timeout, schema, audit log를 통제해야 합니다.

## Safe Automation Examples

### Daily Read-only Report

매일 장 종료 후 다음 read-only tools만 호출합니다.

- `get_account_summary`
- `get_positions`
- `get_latest_signals`
- `get_risk_decisions`
- `get_recent_executions`
- `get_audit_events`

결과는 "투자 조언"이 아니라 운영 리포트로 작성합니다.

### Risk Rejection Summary

최근 24시간 `RiskDecision` 중 rejected 항목을 요약하고 reject code별 빈도를 계산합니다.

허용:

- reject reason 설명
- 관련 rule 문서 링크
- 운영자가 확인할 점 정리

금지:

- "다음에는 이 주문을 통과시키기 위해 한도를 올리라" 같은 정책 완화 제안

### Strategy Health Check

strategy별 last run, last error, signal count, stale data 여부를 요약합니다.

허용:

- 상태 조회
- 장애 가능성 설명
- 사람이 검토할 runbook 제안

금지:

- 자동 resume
- 자동 live trading enable

### Documentation Refresh

MCP tool catalog, risk policy, runbook을 최신 구현과 맞추는 문서화 작업입니다.

### External Intelligence Status Report

`tossinvest-cli` fork 같은 optional read-only source를 붙인 경우, Codex automation은 이미 저장된 source status와 normalized snapshot metadata만 요약할 수 있습니다.

허용:

- `get_intelligence_source_status` 같은 read-only status 조회
- stale source, schema mismatch, timeout 요약
- 어떤 screener enrichment가 제외되었는지 보고

금지:

- Codex scheduled job이 직접 `tossctl` 실행
- auth/config/session 갱신 자동화
- watchlist mutation
- order command 실행

### Paper Trading Decision Run

정해진 시간에 backend worker가 `market_packet`을 만들고 `codex exec --sandbox read-only`로 `virtual_decision` JSON을 받을 수 있습니다.

허용:

- 하루 1~3회 제한된 decision run
- top 10~20 후보만 포함한 compact packet
- `--output-schema` 기반 JSON 검증
- `VirtualRiskEngine`의 승인/거절
- `PaperOrderEngine`을 통한 가상 체결

금지:

- Codex가 직접 `tossctl` 실행
- Codex가 직접 실주문 생성
- Codex output을 live `TradingSignal`로 저장
- `--sandbox workspace-write` 또는 `danger-full-access` 사용
- usage limit 또는 timeout 실패를 무시하고 이전 판단 재사용

## Unsafe Automation Examples

다음 automation은 금지합니다.

- Codex가 3분마다 후보를 보고 자동으로 `place_order` 호출
- Codex가 자연어로 "오늘 강한 종목 매수"를 해석해 주문 생성
- Codex가 daily loss가 크다는 이유로 risk policy를 자동 변경
- Codex가 market order를 자동 허용
- Codex가 `enable_live_trading`을 자동 실행
- Codex가 broker API credentials를 읽고 raw order endpoint 호출
- Codex가 raw `tossctl` command를 실행하거나 외부 CLI wrapper를 범용 shell처럼 사용
- Codex가 raw `codex exec` wrapper를 MCP tool로 노출하거나 self-recursive agent loop를 구성
- Codex가 paper `virtual_decision`을 live order path로 승격
- Codex가 rejection을 우회하기 위해 threshold를 낮춤
- Codex scheduled job이 `pause_strategy` 또는 `resume_strategy`를 승인 없이 호출

## Automation Boundary Checklist

새 automation을 추가하기 전 다음 질문을 통과해야 합니다.

- 이 automation이 주문, 포지션, 현금 상태를 변경하는가?
- 변경 대상이 real portfolio인가 virtual portfolio인가?
- read-only report로 충분한가?
- backend deterministic job으로 실행해야 하는 작업인가?
- approval과 audit log가 필요한가?
- 실패 시 fail-closed가 가능한가?
- mock provider에서 검증 가능한가?
- 투자 조언으로 오해될 표현이 있는가?

불명확하면 Codex automation으로 만들지 않습니다.
