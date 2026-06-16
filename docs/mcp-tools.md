# MCP Tools

> Codex is not the trading engine. Codex is an MCP-based operations interface for inspecting, explaining, and safely controlling a deterministic trading backend.

## 목적

이 문서는 현재 MCP server가 Codex에 노출하는 tool surface와 금지된 tool 이름을 정리한다.

기본 정책은 read-only이다. MCP tool 호출은 저장된 paper-only state와 운영 산출물을 조회할 수 있지만, replay 실행, Codex CLI 실행, TossInvest CLI 실행, broker 주문, live trading mode 변경을 시작하지 않는다.

## Source of Truth

| 항목 | 코드 위치 | 역할 |
| --- | --- | --- |
| enabled MCP tool names | `src/mcp/virtualPortfolioTools.ts` | `virtualPortfolioToolNames`와 tool schema 정의 |
| disabled-by-default tool names | `src/mcp/toolSurfacePolicy.ts` | enabled surface에 들어가면 안 되는 금지 tool 이름 |
| MCP server entrypoint | `src/mcp/server.ts` | `ListToolsRequestSchema`, `CallToolRequestSchema` 연결 |
| local operations HTTP routes | `src/api/localOperationsSurface.ts` | dashboard/API route와 read-only method 기준 |

문서를 수정할 때는 위 코드 상수와 테스트를 함께 확인한다.

## Current Enabled Read-only Tools

현재 enabled MCP tool은 paper-only virtual state 조회용이다.

| Tool | 입력 | 조회 대상 | 주의 |
| --- | --- | --- | --- |
| `get_virtual_portfolio` | 없음 | current `VirtualPortfolio` snapshot | portfolio가 없으면 `sourceStatus: "missing"` |
| `get_virtual_positions` | `market?`, `symbol?` | current virtual positions | 저장된 portfolio만 필터링 |
| `get_virtual_decisions` | `limit?` | recent `VirtualDecision` JSONL | 민감 문자열 masking |
| `get_virtual_trades` | `limit?` | recent `VirtualTrade` JSONL | paper-only virtual fills |
| `get_virtual_performance` | 없음 | portfolio/trade 기반 파생 지표 | 투자 성과 주장 금지 disclaimer 포함 |
| `get_paper_report` | `date?` | local paper daily report | report 생성은 저장된 paper state 조회 기반 |
| `get_scheduler_status` | 없음 | scheduler state/lock files | scheduler run을 시작하지 않음 |
| `get_source_health` | 없음 | stored TossInvest source records | 외부 CLI를 실행하지 않음 |
| `get_market_packets` | `limit?` | stored `MarketPacket` JSONL | market packet 조회만 수행 |

모든 enabled tool은 다음 MCP annotations를 가져야 한다.

```json
{
  "readOnlyHint": true,
  "destructiveHint": false,
  "idempotentHint": true,
  "openWorldHint": false
}
```

## Tool Input Policy

- `limit`은 `1` 이상 `100` 이하 integer만 허용한다.
- `date`는 `YYYY-MM-DD` 문자열만 허용한다.
- `market`은 `KR` 또는 `US`만 허용한다.
- unknown input field는 JSON Schema와 server-side validation에서 막는다.
- unknown 또는 disabled tool name은 MCP error result로 반환한다.

## Output Policy

MCP tool output은 JSON text content로 반환한다.

공통 속성:

- `mode: "paper_only"`
- `readOnly: true`
- paper-only disclaimer

민감 정보는 `maskObject`를 통과한다. 계좌번호, token, order ID, execution data처럼 읽힐 수 있는 값은 원문으로 출력하지 않는다.

## Disabled-by-default Tools

다음 이름은 기본 enabled MCP surface에 포함하지 않는다.

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

실거래 또는 외부 command 실행이 가능한 tool은 별도 threat model, 사용자 승인, mock 검증, audit log, rollback 절차가 없으면 추가하지 않는다.

## Local Operations API와의 관계

MCP server와 local operations HTTP API는 모두 운영 조회 surface지만 entrypoint가 다르다.

- MCP: Codex tool 호출용 read-only interface
- Local Operations API: dashboard와 로컬 브라우저 조회용 HTTP interface

Local Operations API의 route와 method 기준은 `src/api/localOperationsSurface.ts`가 source of truth다. HTTP API도 `GET`/`HEAD`만 허용하고 `POST`/`PUT`/`PATCH`/`DELETE` 요청은 `405`로 거절한다.

## Future Tool Policy

새 tool을 추가하기 전에 다음 질문을 통과해야 한다.

1. 이 tool이 계좌, 주문, 체결, watchlist, 설정, replay artifact를 변경하는가?
2. 이 tool이 raw `tossctl` 또는 raw `codex exec`를 실행하는가?
3. 이 tool이 `VirtualDecision`을 live `TradingSignal` 또는 `OrderIntent`로 승격하는가?
4. read-only snapshot 조회로 대체할 수 있는가?
5. approval, audit log, idempotency, rollback 기준이 문서화되어 있는가?

하나라도 불명확하면 enabled tool로 추가하지 않는다.

## Approval Policy Recommendation

- `default_tools_approval_mode = "prompt"`
- read-only tools는 필요 시 tool별 `approval_mode = "approve"`로 명시
- operational tools는 기본 enabled surface에 넣지 않는다.
- disabled-by-default tools는 config의 `disabled_tools` 또는 리뷰 기준에 명시한다.
- MCP server는 `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false` 환경에서 먼저 실행한다.
- Codex CLI paper decision은 backend worker 경로에서만 실행하고 MCP tool로 노출하지 않는다.

설정 예시는 [.codex/config.example.toml](../.codex/config.example.toml)을 참고한다.
