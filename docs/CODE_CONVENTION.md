# Code Convention

## 목적

이 문서는 `toss-trading` TypeScript 코드 컨벤션의 기준 문서다.

목표는 코드 스타일을 예쁘게 맞추는 것이 아니라, 다음을 유지하는 것이다.

- 기능 위치를 예측 가능하게 유지
- paper-only 경계와 live trading 금지선을 코드 구조로 보존
- schema, risk, replay, storage 변경 시 테스트와 문서를 함께 갱신
- Codex가 작업할 때 코드 위치와 맥락을 잘못 잡는 일을 줄임

## 적용 범위

기본 적용 범위:

- `src/**/*.ts`
- `schemas/*.json`
- `dashboard/*`
- `docs/*.md`

`data/`, `dist/`, `logs/`, `tmp/`, `node_modules/`는 source convention 적용 대상이 아니다.

## TypeScript 기본 규칙

현재 compiler 기준은 `tsconfig.json`이다.

중요 설정:

- `module`: `NodeNext`
- `target`: `ES2022`
- `strict`: `true`
- `noUncheckedIndexedAccess`: `true`
- `exactOptionalPropertyTypes`: `true`

작성 규칙:

- local TypeScript import는 runtime output 기준으로 `.js` extension을 사용한다.
- Node.js builtin import는 `node:` prefix를 사용한다.
- type-only import는 `import type`을 사용한다.
- public export는 named export를 기본으로 한다.
- `any`는 사용하지 않는다. 외부 입력은 `unknown`으로 받고 schema나 type guard로 좁힌다.
- optional field는 `undefined`를 값으로 억지 주입하지 않는다. 필요하면 conditional spread를 사용한다.
- 배열 index 접근은 `undefined` 가능성을 처리한다.

예:

```typescript
const options = {
  required: true,
  ...(limit === undefined ? {} : { limit })
};
```

## 코드 스타일

- 문자열은 double quote를 사용한다.
- statement 끝에는 semicolon을 사용한다.
- 들여쓰기는 2 spaces를 사용한다.
- 파일명은 기존 패턴인 lower camelCase를 따른다. 예: `paperRunOnce.ts`, `historicalBatchReplay.ts`
- 테스트 파일은 대상 파일 옆에 `*.test.ts`로 둔다.
- 문서 파일은 kebab-case 또는 기존 대문자 문서명을 따른다.
- 주석은 복잡한 정책, fail-closed 이유, security boundary를 설명할 때만 사용한다.

## Naming

| 대상 | 규칙 | 예 |
| --- | --- | --- |
| 함수/변수 | `camelCase` | `runHistoricalBatchReplay` |
| 클래스 | `PascalCase` | `VirtualRiskEngine` |
| interface/type | `PascalCase` | `MarketPacket` |
| enum-like string literal | `SCREAMING_SNAKE_CASE` | `VIRTUAL_BUY` |
| reject code | `SCREAMING_SNAKE_CASE` | `VIRTUAL_CASH_EXCEEDED` |
| file | lower `camelCase.ts` | `localOperationsServer.ts` |
| docs | `kebab-case.md` 또는 주제별 대문자 | `historical-replay.md`, `CODE_CONVENTION.md` |

## 레이어 책임

### `src/domain`

책임:

- Zod schema
- TypeScript type export
- 공통 validation helper

금지:

- filesystem, network, process 실행
- storage repository import
- Codex CLI, broker, collector 호출

### `src/config`

책임:

- `.env` 로딩
- 실행 설정 파싱
- safe default 유지

금지:

- `TRADING_ENABLED=true` 또는 `AI_DECISION_ENABLED=true`를 암묵적으로 강제
- 비밀값을 로그나 문서에 출력

### `src/collectors`

책임:

- optional external read-only source 호출
- allowlist 기반 command wrapping
- normalized source record 생성

금지:

- order, auth, config, watchlist mutation
- 계좌/주문/체결 source of truth 역할
- raw command runner를 MCP/API에 노출

### `src/market`

책임:

- market packet 생성
- historical snapshot 기반 packet 생성
- packet hash 생성

금지:

- Codex CLI 호출
- paper portfolio mutation
- broker order path 호출

### `src/ai`

책임:

- Codex CLI paper-only decision provider
- prompt contract 구성
- timeout, budget, failure summary

금지:

- live `TradingSignal` 또는 `OrderIntent` 생성
- portfolio 직접 변경
- raw `codex exec`를 MCP tool로 노출

### `src/paper`

책임:

- `VirtualDecision` validation
- `VirtualRiskEngine`
- `PaperOrderEngine`
- virtual ledger, allocation, exit policy

금지:

- broker adapter 호출
- live trading path로 decision 승격
- risk reject를 무시하고 trade 기록

### `src/replay`

책임:

- simulated time
- replay sampling
- lookahead guard
- historical replay runner

금지:

- real-time trading loop 대체
- replay 결과를 live signal/order로 연결
- simulated time 이후 데이터를 packet에 포함

### `src/workflows`

책임:

- CLI/API에서 호출할 use case orchestration
- storage, packet, provider, risk, order, report 연결

금지:

- domain schema와 다른 별도 계약 생성
- pure policy를 workflow 내부에 복붙
- 안전 경계를 우회하는 shortcut 구현

### `src/storage`

책임:

- file path mapping
- JSON/JSONL read/write
- corrupt line handling

금지:

- trading decision
- risk approval
- report 해석

### `src/api`, `src/mcp`, `dashboard`

책임:

- 저장된 상태의 read-only 조회
- dashboard 정적 asset 제공
- Codex MCP read-only tool surface

dashboard 작성 규칙:

- `dashboard/app.js`는 dashboard bootstrap과 renderer composition 중심으로 유지한다.
- endpoint fetch는 `dashboard/apiClient.js`, routing은 `dashboard/router.js`, DOM helper는 `dashboard/dom.js`, formatting helper는 `dashboard/formatters.js`, symbol metadata helper는 `dashboard/metadata.js`, shared mutable state는 `dashboard/state.js`에 둔다.
- portfolio timeline, trade PnL, position valuation, benchmark data helper는 `dashboard/portfolioModel.js`에 둔다.
- batch replay 개별 run 목록/탭/상세/polling renderer는 `dashboard/batchRunRenderers.js`에 둔다.
- AI decision timeline/filter/performance renderer와 action display helper는 `dashboard/decisionRenderers.js`에 둔다.
- daily/replay/batch report renderer는 `dashboard/reportRenderers.js`, 여러 renderer가 공유하는 report label/summary helper는 `dashboard/reportViewHelpers.js`에 둔다.
- 새 dashboard module을 추가하면 `src/api/localOperationsSurface.ts`의 asset allowlist와 `scripts/qualityGate.mjs` 검증 대상이 함께 갱신되어야 한다.

Local Operations API 작성 규칙:

- `src/api/localOperationsServer.ts`는 HTTP server bootstrap, read-only method guard, dashboard asset/API dispatch만 담당한다.
- route table과 query parsing은 `src/api/localOperationsRouting.ts`에 둔다.
- storage/report artifact를 읽어 응답 payload를 만드는 코드는 `src/api/localOperationsReaders.ts`에 둔다.
- dashboard static asset mapping은 `src/api/localOperationsDashboardAssets.ts`, masked JSON 응답은 `src/api/localOperationsResponse.ts`에 둔다.
- `localOperationsServer.ts`가 `reports`, `scheduler`, `storage`, `security` module을 직접 import해야 하는 구조로 돌아가면 책임이 다시 섞인 것이다.

금지:

- replay 실행 endpoint
- Codex CLI 실행 endpoint
- live order, raw broker, raw `tossctl` endpoint
- masking 없는 민감 정보 반환

## Import 방향

허용 방향:

```text
cli -> workflows
cli -> config
api/mcp -> storage
api -> reports
workflows -> market/replay/paper/ai/reports/storage
market/replay/paper/ai/reports/storage -> domain
tests -> 대상 module
```

금지 방향:

```text
domain -> storage/api/mcp/ai/collectors
paper -> api/mcp
api/mcp -> workflows that execute replay or AI decisions
collectors -> paper/order/risk mutation
ai -> storage mutation or paper order execution
```

예외가 필요하면 먼저 문서에 이유를 적고, 더 작은 adapter나 DTO로 경계를 줄인다.

## Schema와 Contract

- 외부 입력은 Zod schema로 검증한다.
- `schema.strict()`를 기본으로 사용한다.
- runtime 저장 record는 camelCase를 유지한다.
- timestamp는 ISO-compatible string을 사용한다.
- `VirtualDecision` 계약 변경 시 다음을 함께 확인한다.
  - `src/domain/schemas.ts`
  - `schemas/virtual-decision.schema.json`
  - `src/paper/virtualDecisionValidation.ts`
  - `src/ai/decisionPrompt.ts`
  - 관련 docs와 tests
- packet hash, decision hash, source refs는 replay 재현성과 audit을 위해 임의로 제거하지 않는다.

## Error Handling

- risk, order, replay safety 관련 오류는 fail-closed로 처리한다.
- provider failure, timeout, invalid JSON은 no-trade/no-paper-order로 처리한다.
- 외부 source failure는 degraded status와 audit/report로 남기고 live trading 경로를 열지 않는다.
- API 응답은 raw error object 대신 설명 가능한 code/message를 반환한다.
- 민감한 값은 `maskObject` 또는 전용 masking helper를 통과시킨다.

## Testing

기본 테스트 도구는 Node.js built-in test runner다.

테스트 작성 규칙:

- 대상 파일 옆에 `*.test.ts`를 둔다.
- `node:assert/strict`를 사용한다.
- risk, paper order, replay, storage contract 변경은 테스트를 추가하거나 기존 테스트를 보강한다.
- 시간 의존 로직은 고정된 `Date`를 주입한다.
- filesystem 테스트는 temp directory를 사용한다.
- 실제 Codex CLI, broker, unofficial external CLI 호출은 unit test에서 직접 수행하지 않는다.

검증 명령:

```powershell
npm run check
npm run build
npm test
```

`npm run check`는 `quality:gate`와 전체 Node.js test suite를 실행한다. `quality:gate`는 build 후 Local Operations API route, MCP enabled/disabled tool name, 관련 문서 drift를 검사한다.

`npm test`는 build 후 `dist/**/*.test.js`를 실행한다.

## Documentation

코드 변경과 함께 갱신해야 하는 문서:

- 구조/위치 변경: `docs/PROJECT_STRUCTURE.md`
- 코드 스타일/레이어 규칙 변경: `docs/CODE_CONVENTION.md`
- risk policy 변경: `docs/risk-policy.md`
- MCP tool 변경: `docs/mcp-tools.md`, `docs/llm-boundary.md`
- replay/batch artifact 변경: `docs/historical-replay.md`
- paper-only Codex provider 변경: `docs/codex-cli-paper-trading.md`

문서에는 실제 계좌, 실제 API key, 실제 주문/체결 데이터를 넣지 않는다.

## 안전 규칙

새 코드나 리팩토링은 다음 기본값을 약화하면 안 된다.

- `BROKER_PROVIDER=mock`
- `TRADING_ENABLED=false`
- `AI_DECISION_MODE=paper_only`
- `AI_DECISION_ENABLED=false`
- MCP read-only by default

금지:

- live trading capability 추가
- `place_order` enabled MCP tool 추가
- raw `tossctl` command 실행 tool 추가
- raw `codex exec` 실행 tool 추가
- Codex CLI output을 live `TradingSignal`/`OrderIntent`로 연결
- 투자 성과, 수익률 보장, 종목 추천으로 읽히는 표현 추가

## Review Checklist

- 변경 파일이 올바른 디렉터리에 있는가
- schema와 runtime 저장 계약이 일치하는가
- risk failure가 fail-closed인가
- read-only surface가 side effect를 만들지 않는가
- 새 public contract가 문서화되었는가
- risk/replay/storage 변경에 테스트가 있는가
- 실계좌 정보와 credential이 포함되지 않았는가
- 변경이 paper-only 경계를 live path로 확장하지 않는가
