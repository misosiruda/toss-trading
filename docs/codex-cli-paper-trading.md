# Codex CLI Paper Trading

> Codex is not the trading engine. Codex CLI may be used as a paper-only decision provider that emits virtual decisions for a simulated portfolio.

## 목적

이 문서는 `codex exec`를 사용해 API 비용을 추가로 내지 않고, 사용자의 ChatGPT Pro/Codex 사용량 안에서 AI 기반 가상 투자 판단을 실행하는 구조를 정의합니다.

목표는 실제 주문이 아니라 `VirtualPortfolio`에 기록되는 paper trading입니다. Codex CLI는 시장 데이터를 직접 수집하거나 주문을 실행하지 않습니다. backend worker가 만든 압축된 `market_packet`을 읽고, schema가 고정된 `virtual_decision` JSON만 출력합니다.

참고 문서:

- Codex non-interactive mode: <https://developers.openai.com/codex/noninteractive>
- Codex CLI command reference: <https://developers.openai.com/codex/cli/reference>
- Codex usage limits: <https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan>

## High-level Flow

```mermaid
flowchart LR
    TossCtl["tossctl read-only commands"] --> Packet["MarketPacketBuilder"]
    Packet --> CodexProvider["CodexCliDecisionProvider"]
    CodexProvider --> Schema["VirtualDecisionSchemaValidator"]
    Schema --> VirtualRisk["VirtualRiskEngine"]
    VirtualRisk --> PaperOrder["PaperOrderEngine"]
    PaperOrder --> Portfolio["VirtualPortfolio"]
    PaperOrder --> Ledger["VirtualLedger"]
    CodexProvider --> Audit["AuditLogger"]
    Schema --> Audit
    VirtualRisk --> Audit
    PaperOrder --> Audit
```

## 역할 분리

### Backend Worker

Backend worker는 반복 가능성과 상태를 소유합니다.

- allowlist wrapper를 통해 `tossctl` read-only command만 실행합니다.
- market data와 source metadata를 정규화합니다.
- compact `market_packet`을 생성합니다.
- read-only sandbox 설정으로 `codex exec`를 호출합니다.
- Codex output을 JSON Schema로 검증합니다.
- `VirtualRiskEngine`을 적용합니다.
- `VirtualPortfolio`와 `VirtualLedger`를 갱신합니다.
- audit event를 기록합니다.

### Codex CLI

Codex CLI는 paper trading 전용 AI decision provider입니다.

- `market_packet`을 읽습니다.
- `virtual_decision` JSON을 생성합니다.
- thesis와 risk factor를 설명합니다.
- `tossctl`을 실행하지 않습니다.
- broker API를 호출하지 않습니다.
- worker가 final message를 output file로 라우팅하는 경우 외에는 파일을 쓰지 않습니다.
- real `TradingSignal` 또는 live `OrderIntent`를 생성하지 않습니다.

### VirtualRiskEngine

`VirtualRiskEngine`은 AI 판단을 대체하지 않습니다. 가상 decision을 거절하거나 축소할 수만 있습니다.

예시:

- stale market packet
- insufficient virtual cash
- max symbol exposure exceeded
- max daily turnover exceeded
- cooldown not satisfied
- unsupported market or symbol
- missing thesis or risk factors
- invalid confidence range

## 설정

안전한 기본값:

```env
AI_DECISION_PROVIDER=codex_cli
AI_DECISION_MODE=paper_only
AI_DECISION_ENABLED=false
CODEX_EXEC_PATH=codex
CODEX_EXEC_SANDBOX=read-only
CODEX_EXEC_TIMEOUT_SECONDS=300
CODEX_DECISION_MAX_RUNS_PER_DAY=3
CODEX_DECISION_MAX_SYMBOLS=20
CODEX_DECISION_ALLOW_WEB_SEARCH=false
PAPER_TRADING_ENABLED=true
VIRTUAL_INITIAL_CASH_KRW=1000000
```

`AI_DECISION_ENABLED=false`가 기본값입니다. scheduled AI decision을 켜기 전에 storage, schema, dry-run 검증을 먼저 구현해야 합니다.

로컬 실행에서는 CLI와 MCP server 진입점이 프로젝트 루트 `.env`를 자동으로 읽습니다. `CODEX_EXEC_PATH`는 Windows 전역 환경 변수일 필요가 없고, 이 프로젝트의 `.env`에만 둘 수 있습니다. Windows Store alias가 `Access is denied`를 반환하는 경우에는 `codex` alias 대신 실제 Codex binary 경로를 사용합니다.

예시:

```env
CODEX_EXEC_PATH=C:\Users\<user>\AppData\Local\OpenAI\Codex\bin\<version>\codex.exe
```

`.env`는 Git에서 제외됩니다. real account data, brokerage credential, API key는 넣지 않습니다.

## Market Packet

`market_packet`은 automated paper decision run에서 Codex가 받는 유일한 입력입니다.

권장 형태:

```json
{
  "packet_id": "packet_20260611_153000",
  "mode": "paper_only",
  "generated_at": "2026-06-11T15:30:00+09:00",
  "expires_at": "2026-06-11T15:35:00+09:00",
  "virtual_portfolio": {
    "cash_krw": 1000000,
    "positions": []
  },
  "candidates": [
    {
      "market": "KR",
      "symbol": "005930",
      "name": "Sample Corp",
      "last_price_krw": 70000,
      "ranking": 12,
      "reason_codes": ["RANKING", "FLOW_POSITIVE"],
      "source_refs": ["external_snapshot_001"]
    }
  ],
  "constraints": {
    "max_new_positions": 3,
    "max_budget_per_symbol_krw": 100000,
    "allowed_actions": ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
  }
}
```

packet은 작게 유지합니다. raw quote data, order book, news text를 대량으로 넘기기보다 top 10-20 후보만 전달합니다.

## Virtual Decision Schema

paper order를 만들기 전에 Codex output은 반드시 schema validation을 통과해야 합니다. 현재 런타임 계약은 `schemas/virtual-decision.schema.json`과 `virtualDecisionSchema`의 camelCase 필드를 기준으로 합니다.

기본 필수 필드는 다음과 같습니다.

```json
{
  "type": "object",
  "required": ["packetId", "decisions", "summary"],
  "additionalProperties": false,
  "properties": {
    "packetId": { "type": "string" },
    "summary": { "type": "string" },
    "decisions": {
      "type": "array",
      "maxItems": 20,
      "items": {
        "type": "object",
        "required": [
          "symbol",
          "market",
          "action",
          "confidence",
          "budgetKrw",
          "thesis",
          "riskFactors",
          "dataRefs",
          "expiresAt"
        ],
        "additionalProperties": false,
        "properties": {
          "symbol": { "type": "string" },
          "market": { "type": "string", "enum": ["KR", "US"] },
          "action": {
            "type": "string",
            "enum": ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
          },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "budgetKrw": { "type": "integer", "minimum": 0 },
          "maxBudgetKrw": { "type": "integer", "minimum": 0 },
          "sellQuantity": { "type": "number", "exclusiveMinimum": 0 },
          "sellRatio": { "type": "number", "exclusiveMinimum": 0, "maximum": 1 },
          "targetWeightPct": { "type": "number", "minimum": 0, "maximum": 1 },
          "sellAll": { "type": "boolean" },
          "reduceOnly": { "type": "boolean" },
          "thesis": { "type": "string" },
          "riskFactors": {
            "type": "array",
            "items": { "type": "string" }
          },
          "dataRefs": {
            "type": "array",
            "items": { "type": "string" }
          },
          "expiresAt": { "type": "string" }
        }
      }
    }
  }
}
```

`budgetKrw`는 v1 호환성을 위해 아직 필수입니다. 다만 `VIRTUAL_SELL`에서는 매도 금액을 임의 추정하지 않도록 다음 규칙을 적용합니다.

- `VIRTUAL_SELL`은 `budgetKrw > 0`, `sellQuantity`, `sellRatio`, `targetWeightPct`, `sellAll` 중 하나가 있어야 합니다.
- `sellQuantity`, `sellRatio`, `targetWeightPct`, `sellAll`을 사용하는 v2 SELL sizing은 반드시 `reduceOnly: true`여야 합니다.
- `VIRTUAL_HOLD`는 `budgetKrw: 0`이어야 하고 SELL sizing 필드를 넣지 않습니다.
- Risk Engine과 PaperOrderEngine은 후보 가격과 현재 포지션을 기준으로 실제 paper notional을 다시 계산합니다.

예시:

```json
{
  "packetId": "packet_2026-06-12T09:00:00+09:00",
  "summary": "보유 종목 일부 차익 실현 후보",
  "decisions": [
    {
      "symbol": "005930",
      "market": "KR",
      "action": "VIRTUAL_SELL",
      "confidence": 0.61,
      "budgetKrw": 0,
      "sellRatio": 0.5,
      "reduceOnly": true,
      "thesis": "최근 packet 기준 단기 과열 신호가 있어 paper-only로 절반 축소를 제안한다.",
      "riskFactors": ["과거 데이터 기반 replay이며 실거래 신호가 아니다."],
      "dataRefs": ["packet.candidates[0]"],
      "expiresAt": "2026-06-12T10:00:00+09:00"
    }
  ]
}
```

## Codex Exec Invocation

권장 패턴:

```powershell
Get-Content .\data\market-packets\latest.json |
  codex exec `
    --sandbox read-only `
    --output-schema .\schemas\virtual_decision.schema.json `
    -o .\data\virtual-decisions\latest.json `
    "You are a paper-trading analyst. Use only the provided market_packet. Return virtual_decision JSON only. Do not run commands. Do not provide financial advice. Do not create real orders."
```

workspace가 아직 Git repository가 아니라면 scheduled Codex run 전에 Git을 초기화합니다. `codex exec --skip-git-repo-check`는 통제된 one-off dry run에서만 사용합니다.

사용하지 않습니다:

- `--sandbox workspace-write`
- `--sandbox danger-full-access`
- `--search` by default
- Codex에게 `tossctl` 실행을 요청하는 prompt
- real order execution을 요청하는 prompt

## Prompt Contract

prompt는 단순하고 엄격해야 합니다.

필수 지시:

- paper trading only임을 명시합니다.
- supplied packet만 사용합니다.
- schema에 맞는 JSON만 반환합니다.
- command를 호출하지 않습니다.
- 누락된 가격을 추정하지 않습니다.
- investment advice로 읽히는 표현을 쓰지 않습니다.
- stale, incomplete, contradictory data에서는 `VIRTUAL_HOLD`를 선호합니다.
- non-hold decision에는 risk factor를 포함합니다.

## 실패 정책

worker는 다음 경우 Codex를 unavailable로 처리해야 합니다.

- `codex` executable이 없습니다.
- Codex authentication이 없습니다.
- usage limit에 도달했습니다.
- command timeout이 발생했습니다.
- output이 valid JSON이 아닙니다.
- output이 schema validation에 실패했습니다.
- decision이 존재하지 않는 `data_ref`를 참조합니다.
- decision action이 allowed action set 밖에 있습니다.

실패 결과:

- paper order를 생성하지 않습니다.
- `AI_DECISION_FAILED` audit event를 기록합니다.
- 기존 virtual position은 변경하지 않습니다.
- daily run budget이 남아 있으면 다음 scheduled run에서 재시도할 수 있습니다.

## 사용량 정책

Codex Pro는 더 높은 포함 사용량을 제공하지만 usage limit이 있습니다. automated paper trading은 절약형으로 운영합니다.

권장 기본값:

- 장 종료 후 scheduled decision run 1회
- 선택적 intraday run 1회
- 하루 최대 3회
- packet당 후보 최대 20개
- 특정 strategy가 요구하지 않으면 raw order book dump 금지
- scheduled run에서는 web search 비활성화
- 품질이 충분할 때만 더 작은 model/profile 사용

현재 Codex limit은 Codex usage dashboard 또는 active Codex CLI session의 `/status`에서 확인합니다.

## 보안과 안전 규칙

- `TRADING_ENABLED=false`를 기본값으로 유지합니다.
- `AI_DECISION_MODE=paper_only`가 필수입니다.
- Codex virtual decision은 live `TradingSignal` record가 되지 않습니다.
- Codex virtual decision은 live `OrderIntent` record가 되지 않습니다.
- MCP는 `run_codex_exec` 같은 raw execution tool을 노출하지 않습니다.
- live trading migration은 별도 threat model, test, explicit approval, Risk Engine integration이 필요합니다.
- paper trading report는 profitability나 financial advice를 주장하지 않습니다.

## TradingAgents와의 관계

`tossinvest-cli` repository에는 `TradingAgents -> tossctl` bridge example이 있습니다. AI-generated decision 참고 패턴으로는 유용하지만, 이 프로젝트는 live order bridge를 복사하지 않습니다.

참고할 부분:

- AI가 buy/hold/sell 스타일의 analysis를 생성합니다.
- output이 structured and auditable합니다.

복사하지 않을 부분:

- AI output을 `tossctl order place`로 전달
- `--execute` 활성화
- real brokerage state를 execution target으로 사용

이 프로젝트에서는 AI output을 `PaperOrderEngine`으로만 라우팅합니다.
