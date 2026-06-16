# LLM Boundary

> Codex is not the trading engine. Codex is an MCP-based operations interface for inspecting, explaining, and safely controlling a deterministic trading backend.

## Boundary Statement

Codex는 트레이딩 엔진이 아닙니다. Codex는 결정론적 트레이딩 백엔드를 조회, 설명, 분석, 통제하기 위한 MCP 기반 운영 인터페이스입니다.

이 문서는 Codex가 할 수 있는 일과 절대 하면 안 되는 일을 명확히 구분합니다.

## What Codex Can Do

Codex는 현재 enabled MCP surface에서 다음 작업에 사용할 수 있습니다.

- `get_virtual_portfolio`로 paper-only virtual portfolio 조회
- `get_virtual_positions`로 paper-only virtual position 조회
- `get_virtual_decisions`로 저장된 virtual decision 조회
- `get_virtual_trades`로 저장된 virtual trade 조회
- `get_virtual_performance`로 paper-only 파생 지표 조회
- `get_paper_report`로 local paper daily report 조회
- `get_scheduler_status`로 scheduler state와 lock metadata 조회
- `get_source_health`로 저장된 TossInvest read-only source 상태 조회
- `get_market_packets`로 저장된 market packet 조회
- 저장된 후보, risk reject, paper report를 바탕으로 한 설명과 문서화
- backend worker가 paper trading mode에서 실행한 `virtual_decision` JSON 검토

Codex의 설명은 의사결정 지원 정보이며, 실계좌 최종 매매 판단이 아닙니다. `virtual_decision`은 가상 포트폴리오에만 적용되는 paper trading 판단입니다.

## What Codex Must Not Do

Codex는 다음 작업을 수행하면 안 됩니다.

- 실시간 trading loop를 실행
- 실계좌 대상 최종 buy/sell 결정 생성
- LLM reasoning으로 live `TradingSignal`을 최종 확정
- `RiskEngine`을 우회
- 리스크 정책을 런타임에 완화
- 자연어 주문 요청을 바로 실주문으로 변환
- raw broker order API 호출
- raw `tossctl` command 실행
- raw `codex exec` 실행을 MCP enabled tool로 노출
- `place_order` 또는 `place_market_order`를 기본 enabled tool로 노출
- `enable_live_trading`을 자동으로 수행
- `virtual_decision`을 live `TradingSignal` 또는 live `OrderIntent`로 승격
- 계좌번호, token, order ID, execution data를 그대로 출력
- 투자 조언, 수익 보장, 종목 추천으로 읽힐 수 있는 표현 생성

## Paper Trading Exception

`AI_DECISION_MODE=paper_only`에서는 Codex CLI가 가상 투자 판단을 생성할 수 있습니다. 이 예외는 실거래 경로가 아니라 `VirtualPortfolio` 실험 경로에만 적용됩니다.

허용:

- backend worker가 만든 `market_packet` 읽기
- `codex exec --sandbox read-only` 실행
- `virtual_decision` JSON 출력
- thesis, confidence, risk factor 작성
- `VirtualRiskEngine`이 거절할 수 있는 구조화된 가상 주문 제안

금지:

- Codex가 직접 `tossctl` 실행
- Codex가 직접 broker API 호출
- Codex가 파일 시스템을 수정하며 trading state 변경
- `virtual_decision`을 live order로 연결
- `--search`를 기본 활성화해 출처가 섞인 판단 생성

자세한 설계는 [codex-cli-paper-trading.md](codex-cli-paper-trading.md)를 따릅니다.

## MCP Tool Exposure Policy

MCP tool은 세 단계로 분류합니다.

### Read-only Tools

기본 enabled 대상입니다. 현재 구현은 paper-only virtual state와 운영 산출물 조회로 제한합니다.

- `get_virtual_portfolio`
- `get_virtual_positions`
- `get_virtual_decisions`
- `get_virtual_trades`
- `get_virtual_performance`
- `get_paper_report`
- `get_scheduler_status`
- `get_source_health`
- `get_market_packets`

향후 optional external intelligence source를 붙이는 경우에도 Codex는 저장된 normalized snapshot만 조회합니다. Codex가 collector process나 external CLI command를 직접 실행하지 않습니다.

MCP에는 저장된 `VirtualPortfolio`, `VirtualTrade`, `VirtualDecision`, `MarketPacket`, paper report, scheduler/source health 조회 tool만 노출합니다. `codex exec` 실행 tool은 노출하지 않습니다.

### Limited Operational Tools

제한적으로 enabled할 수 있지만 `approval_mode = "prompt"`가 필요합니다. 현재 enabled MCP tool 목록에는 포함되어 있지 않습니다.

- `preview_order`
- `pause_strategy`
- `resume_strategy`
- `emergency_stop`

이 tool들은 최소 side effect만 허용하고, 호출 전후 audit log를 남겨야 합니다.

### Disabled-by-default Tools

기본적으로 Codex에 노출하지 않습니다.

- `place_order`
- `place_market_order`
- `run_tossctl`
- `execute_tossctl`
- `run_codex_exec`
- `execute_codex_cli`
- `place_toss_order`
- `sync_watchlist`
- `enable_live_trading`
- `update_risk_policy`
- `update_strategy_threshold`
- `transfer_cash`
- `withdraw`

## Read-only by Default Policy

MCP Server의 기본 정책은 read-only입니다. 새 tool을 추가할 때는 다음 질문을 먼저 통과해야 합니다.

- 이 tool은 계좌, 주문, 체결 상태를 변경하는가?
- 이 tool이 실패하면 금전적 손실이나 포지션 불일치를 만들 수 있는가?
- read-only tool로 대체할 수 있는가?
- approval, audit log, idempotency가 있는가?
- mock provider에서 먼저 검증할 수 있는가?

하나라도 불명확하면 enabled tool로 추가하지 않습니다.

## Human-in-the-loop Policy

사람의 승인이 필요한 작업은 다음과 같습니다.

- trading mode 변경
- strategy pause/resume
- emergency stop
- 주문 preview 확인
- live trading adapter 활성화
- risk policy 변경
- enabled MCP tool 변경

Human-in-the-loop는 Codex의 자연어 동의를 의미하지 않습니다. 명시적인 사용자 승인, audit log, 설정 변경 이력, rollback 절차가 필요합니다.

## Why LLMs Are Unsuitable for Low-latency Trading Decisions

LLM은 설명과 문서화에 강하지만 저지연 매매 판단의 핵심 컴포넌트로 부적합합니다.

- 응답 latency가 시장 데이터 주기보다 길거나 불안정할 수 있습니다.
- 모델 출력은 deterministic trading rule처럼 고정된 계약으로 검증하기 어렵습니다.
- prompt와 context에 따라 판단이 달라질 수 있습니다.
- 장애 상황에서 재현 가능한 root cause analysis가 어렵습니다.
- risk policy를 코드 수준에서 보장하기 어렵습니다.
- 주문 실행은 idempotency, timeout, retry, reconciliation 같은 명시적 상태 기계가 필요합니다.

따라서 TradingSignal과 RiskDecision은 deterministic backend code가 생성해야 합니다.
