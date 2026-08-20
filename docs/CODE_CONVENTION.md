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
- official Toss Open API token auth config를 HTTP 호출 없이 해석

금지:

- `TRADING_ENABLED=true` 또는 `AI_DECISION_ENABLED=true`를 암묵적으로 강제
- 비밀값을 로그나 문서에 출력
- token 발급 HTTP call, token cache, broker adapter 구현

`readTossOpenApiAuthConfig({})`는 `enabled=false`, `status=disabled`를 기본값으로 유지해야 한다. `TOSS_OPEN_API_AUTH_ENABLED=true`일 때 `TOSS_OPEN_API_CLIENT_ID` 또는 `TOSS_OPEN_API_CLIENT_SECRET`이 없으면 API 호출 전에 `invalid`로 fail-closed 처리해야 한다. credential value를 운영 조회에 사용할 때는 `summarizeTossOpenApiAuthConfig`처럼 존재 여부만 반환하는 safe summary를 사용한다.

### `src/broker`

책임:

- official broker integration helper
- Toss Open API token auth client boundary
- token issue request contract 구성
- process memory token cache와 single-flight 제어
- calendar 전용 token issuer HTTPS transport와 finite response boundary
- calendar 전용 GET HTTPS transport와 ephemeral raw-byte observation boundary
- calendar auth/network/evidence/lifecycle을 고정 조립하는 paper-only acquisition coordinator
- authenticated read-only HTTP request contract 구성
- Bearer token injection과 HTTP status mapping
- official market data endpoint path/query mapping
- official account/holdings snapshot masking boundary

금지:

- live order gateway를 기본 활성화
- MCP/API/dashboard에서 직접 호출 가능한 broker mutation surface 추가
- persistent token store를 별도 보안 설계 없이 추가
- auth 계층에서 order retry 또는 Risk Engine 판단 수행
- injected transport 없이 직접 `fetch`, `http.request`, `https.request` 호출 추가

`TossOpenApiAuthClient`는 injected `TossOpenApiTokenIssuer`를 통해 token issue를 추상화한다. 실제 HTTP transport를 추가할 때는 별도 PR에서 error/rate limit/masking 테스트를 함께 추가해야 한다.

`tossOpenApiTokenIssuerNetworkTransport.ts`만 calendar token 발급을 위한 direct `https.request`를 소유할 수 있다. Production factory는 connector, dial target, custom CA와 deadline override를 받지 않고 canonical production origin/path만 사용한다. Test-only factory는 loopback IP와 synthetic CA로 제한하고 logical production URL, HTTP Host, TLS SNI, certificate와 hostname verification을 유지해야 한다. Exact `200`, no `Content-Range`/`Content-Encoding`, `Accept-Encoding: identity`, 256KiB payload cap, complete UTF-8 JSON과 10초 이하 monotonic absolute deadline을 통과하지 못한 response를 AuthClient parser에 전달해서는 안 된다.

`tossOpenApiCalendarNetworkTransport.ts`만 evidence acquisition용 KR/US calendar direct `https.request`를 소유할 수 있다. Production factory는 exact canonical `date` request와 token provider만 받고 dial target, custom CA, clock과 deadline override를 노출하지 않는다. Initial/retry는 exact no-cache와 identity header를 유지하며 refreshable `401`만 generation별 compare-and-clear 뒤 한 번 재시도한다. Final response가 exact `200`, response trailer 없음, complete identity UTF-8 JSON, 1MiB 이하 raw bytes, canonical cache headers와 monotonic corrected freshness를 모두 통과하기 전에는 observation을 반환하지 않는다. Raw bytes는 process memory 밖에 저장하거나 log/API/MCP/dashboard output으로 노출하지 않는다.

`tossOpenApiCalendarAcquisitionCoordinator.ts`의 production factory는 token issuer, `TossOpenApiAuthClient`, calendar network transport와 v2 ephemeral lifecycle을 내부에서 고정 조립한다. Public acquisition input은 exact `market`/`date`만 받고 timestamp, cache metadata, contract version, URL 또는 raw bytes override를 받지 않는다. Network observation의 request identity, parsed body, hash/byte length와 corrected freshness를 다시 검증한다. Pinned example은 trusted parser registry contract 선택에만 사용하고 actual network bytes는 v2 evidence builder의 strict response parser로 별도 검증한 뒤 opaque observation factory에 전달한다. 성공/실패와 관계없이 transport raw-byte view를 zeroize하고 opaque handle 외 evidence/raw/derived output을 반환하지 않는다. Test-only factory도 arbitrary network client를 받지 않고 loopback calendar connector와 injected token issuer만 받을 수 있다.

`tossOpenApiCredentialReadinessPreflight.ts`는 official host의 DNS resolution, exact canonical base URL, credential 존재 여부, paper-only runtime boundary와 owner의 outbound-IP 등록 attestation만 진단한다. Resolved IP address, credential value, token 또는 provider response를 결과에 포함하지 않는다. Raw base URL env는 parser normalization 전에 exact comparison하고, 미설정만 canonical default로 허용하며 noncanonical URL은 path를 포함한 전체 값을 fixed placeholder로 바꾼다. `BROKER_PROVIDER`, `TRADING_ENABLED`, `AI_DECISION_MODE`는 미설정일 때만 safe default를 적용하고 명시값은 각각 exact `mock`, `false`, `paper_only`만 허용해 오타나 공백값을 fail-closed로 차단한다. Outbound-IP attestation도 raw env의 exact `true`/`false`만 허용하고 공백, 빈 값 또는 다른 표기는 invalid로 차단한다. DNS 외 HTTP request를 만들지 않고 token/calendar endpoint를 호출하지 않으며 `ready_for_external_verification`은 external acquisition 성공이나 actual outbound IP 검증을 뜻하지 않는다. Production resolver는 exact `openapi.tossinvest.com`만 조회하고 test-only resolver는 합성 address fixture에만 사용한다.

`TossOpenApiReadOnlyHttpClient`는 injected transport만 호출하며 `GET` request만 허용한다. `401 invalid-token` 또는 `401 expired-token` 계열은 request가 실제 사용한 process-local token lease generation만 compare-and-clear한 뒤 최대 1회 guarded reissue로 재시도한다. Retry도 같은 계열 `401`이면 retry generation만 정리하고 세 번째 request나 token issue를 시작하지 않는다. Stale generation invalidation은 current newer lease를 변경하지 않아야 하며 unconditional token clear, `POST`, `PATCH`, `PUT`, `DELETE` 또는 order/account mutation retry를 허용해서는 안 된다.

`TossOpenApiMarketDataAdapter`는 injected read-only JSON client만 호출하고 `/api/v1/prices`, `/api/v1/orderbook`, `/api/v1/trades`, `/api/v1/candles`, `/api/v1/stocks/{symbol}/warnings`, `/api/v1/market-calendar/{KR|US}` mapping만 허용한다. `prices.symbols`는 official limit에 맞춰 1-200개만 허용한다. 이 adapter에서 account snapshot, order mutation, live `TradingSignal` 또는 `OrderIntent` 생성을 추가해서는 안 된다.

`TossOpenApiAccountSnapshotReader`는 injected account read-only JSON client만 호출하고 `/api/v1/accounts`, `/api/v1/holdings` 조회만 허용한다. holdings 조회에는 explicit `accountSeq`가 필요하며, snapshot output은 account number와 accountSeq를 masking해야 한다. 이 reader에서 order endpoint, portfolio mutation, live `TradingSignal` 또는 `OrderIntent` 생성을 추가해서는 안 된다.

### `src/risk`

책임:

- live 주문 전 deterministic `RiskEngine` 정책
- structured live order intent와 risk snapshot 평가
- kill switch, allowlist, market hours, exposure, duplicate, cooldown, preview gate
- malformed numeric order intent/risk snapshot fail-closed validation
- fail-closed `RiskDecision` 생성

금지:

- broker gateway 호출
- order routing 또는 execution tracking
- Codex CLI `virtual_decision`을 live order intent로 변환
- MCP/API/dashboard mutation surface 추가
- `TRADING_ENABLED=true` 기본값 또는 live order placement 활성화

`LiveRiskEngine`은 이미 구조화된 live order intent와 risk snapshot만 입력으로 받아야 한다. 자연어 주문, Codex paper decision, raw broker response를 직접 해석해서는 안 된다. 기본 policy는 fail-closed여야 하며, 신규 rule이나 reject code를 추가하면 테스트와 문서를 함께 갱신한다.

### `src/order`

책임:

- official adapter roadmap row 16의 internal mock-only dry-run state machine
- typed `LiveOrderIntent`, risk module이 mint한 deep-frozen opaque `LiveRiskAuthority`와
  synthetic owner approval binding 검증
- live idempotency/capacity store와 분리된 deterministic shadow reservation과 permanent tombstone
- masked paper-only audit record와 `dry_run_validated` /
  `shadow_reconciled_no_external_effect` 결과 생성

금지:

- `src/broker` import, official order endpoint 또는 어떤 network transport 호출
- filesystem, process, environment, clock 또는 random source 직접 접근
- live reservation, capacity, approval, permit, gateway 또는 reconciliation queue 공유
- broker order ID, execution ID, raw account identity 생성·저장·출력
- natural language, Codex paper evidence 또는 raw provider payload를 `LiveOrderIntent`로 변환
- API/MCP/dashboard/CLI/package entrypoint에 mutation surface 추가

`src/order`는 pure deterministic module로 유지한다. 구현된 `liveRiskAuthority` 경계는 risk 평가 전에
strict-validated `LiveOrderIntent`를 deep-copy/deep-freeze하고 그 exact snapshot을
`LiveRiskEngine`에 전달한다. 후속 `src/workflows`와 router도 이 동일 snapshot만 handoff해야 한다.
Risk module은 public constructor/factory 없이 engine evaluation이 포함된 module-private mint path에서만
deep-frozen opaque `LiveRiskAuthority`를 만들고 module-owned `WeakSet` brand로 진위를 확인한다.
Rejected authority의 readonly decision을 approved로 바꿀 수 없어야 한다.
Authority의 domain-separated `evaluatedIntentHash`는 schema version, optional-field presence와 exact raw
value를 보존한 snapshot 전체를 length-prefixed canonical form으로 hash한다. Raw `symbol`과
RiskEngine이 사용하는 normalized symbol projection도 서로 다른 field로 모두 bind한다.
`src/order`의 유일한 risk runtime import는 narrow `verifyLiveRiskAuthority()`이며, module-owned brand,
frozen state, approved result와 router 직전 recomputed snapshot hash를 함께 검증한다. Plain decision,
caller-constructed object, missing/mismatched hash 또는 평가 뒤 재구성·정규화한 intent는 handoff
authority가 아니다. `src/order`가 risk rule, sizing 또는 allocation을 재구현해서는 안 된다. Shadow
state와 synthetic approval은 injected typed value로만 받고 live store나 broker transport adapter를
받을 수 없다. 구현된 `dryRunOrderRouter`는 `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`,
`TOSS_OPEN_API_ORDER_MUTATIONS_ENABLED=false`, `TOSS_OPEN_API_DRY_RUN=true`를 unknown field나
normalization 없이 exact 검증한다. Synthetic owner approval fixture는 module-owned brand와 active
state를 사용하고 approved authority의 exact frozen intent, `evaluatedIntentHash`와 opaque scenario
binding에 묶여 한 번만 소비된다. Counterfeit, stale 또는 binding mismatch는 fail-closed하며 실제
owner approval이나 live permit으로 승격할 수 없다. 구현된 `dryRunShadowState`는 module-owned immutable state에서 synthetic
`(scenarioId, syntheticIntentHash)` reservation과 permanent tombstone을 함께 만들고 duplicate를 모든
terminal state 이후에도 거부한다. Timeout은 injected simulation label이며
`shadow_reconciled_no_external_effect`로만 닫고 모든 audit는 `simulationOnly=true`,
`externalEffect=none`을 유지한다. Caller의 scenario string은 저장 전에 domain-separated opaque
reference로 바꾸며 raw value를 record/audit에 남기지 않는다. 각 immutable state handle은 다음
transition에서 한 번만 소비할 수 있고 stale branch/retry는 거부한다. 이 계층의 존재는 row 17
official gateway, live order 또는
`TRADING_ENABLED=true`를 허용하지 않는다.

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
- network-derived calendar v2 evidence/raw-byte process-local lifecycle

금지:

- real-time trading loop 대체
- replay 결과를 live signal/order로 연결
- ephemeral calendar handle과 fixed operation의 derived output을 file, DB, workflow artifact, audit, CLI, MCP 또는 API response로 persist/export
- simulated time 이후 데이터를 packet에 포함

`officialBrokerObservedCalendarEphemeralObservation.ts`는 verified factory가 만든 opaque handle만
받고 v2 evidence와 exact raw response bytes의 ownership을 한 번의 synchronous consumer chain에
제한한다. Factory는 bytes를 내부 copy로 격리한 뒤 transferred caller view를 즉시 zeroize하고
handle에서 evidence/raw bytes를 직접 노출하지 않아야 한다. Consume 시 exact bytes와 freshness를
다시 검증하고 성공/실패와 관계없이 internal bytes를 zeroize해야 한다. Replay input과 coverage
report는 module-owned fixed non-exporting operation 안에서만 만들고 caller callback 또는 return
value로 제공하지 않아야 한다. Handle JSON export와 재사용은 fail-closed로 거부한다. Durable
raw-byte 저장 또는 replay 실행 책임을 이 module에 추가해서는 안 된다.

`officialMarketCalendarKrxOtpEphemeralBody.ts`는 KRX OTP body-shape-valid bytes를
process-local opaque handle로 이전하는 ownership boundary다. Factory는 caller byte view를
내부 copy와 분리한 즉시 zeroize하고 실패 시 모든 owned copy를 지워야 한다. Handle은 raw
bytes, token string/hash 또는 body shape를 노출하지 않고 JSON export를 disposal 뒤 거부해야
하며 forged handle을 받지 않는다. Fixed one-shot data-POST parameter consumer는 registered
static policy와 exact target year만 결합하고 원래 OTP handle ownership을 성공/실패 모두
종료해야 한다. 새 opaque handle도 raw getter, callback, serialization 또는 durable sink를
제공하지 않는다. Network provenance factory와 fixed wire consumer가 추가되기 전에는
acquisition capability를 이 module에 추가해서는 안 된다.

`officialMarketCalendarKrxHolidayDataPostPolicy.ts`는 KRX holiday data POST의
token-free static contract만 소유한다. Official source page, exact method/target,
`gridTp`, `pagePath`와 value-free dynamic slot name을 strict immutable policy로 고정한다.
Raw `code`, target year value, optional UI navigation parameter, header/body encoding,
cookie 또는 HTTP execution을 포함해서는 안 되며 기존 OTP GET parameter allowlist를
확장하는 근거로 사용하지 않는다.

`officialMarketCalendarKrxHolidayTargetYear.ts`는 versioned official-page observation에
포함된 `search_bas_yy` exact string만 parse한다. Number coercion, trim, 범위 확장 또는
현재 연도 추론을 하지 않는다. Official selector가 변경되면 observation date와 policy
version을 함께 갱신하고, 기존 version의 의미를 변경해서는 안 된다.

`officialMarketCalendarKrxHolidayDataPostWirePolicy.ts`는 successful read-only observation의
exact content type, parameter order와 byte-level component encoding을 versioned immutable
policy로 고정한다. Local maximum body byte length를 provider limit처럼 표현하지 않는다.
Raw OTP string conversion, encoder callback, HTTP execution 또는 response acceptance를 이
policy module에 추가해서는 안 된다.

KRX holiday POST fixed byte encoder는 opaque parameter handle을 one-shot으로 소비하고
policy maximum 크기의 zeroized workspace에 직접 encoding해야 한다. Raw OTP를 string,
`Buffer` 또는 enumerable collection으로 복사하지 않는다. Success/failure 모두 original
OTP와 workspace ownership을 종료하고, encoded bytes는 getter/callback 없는 새 opaque
handle에만 이전한다. Fixed network consumer 전에는 wire bytes를 외부로 반환하지 않는다.

`officialMarketCalendarKrxHolidayDataResponseMetadata.ts`는 raw `Set-Cookie` value를
받거나 저장하지 않고 count만 검증한다. Request isolation은 automatic redirect/cookie
jar disabled와 outbound Cookie count 0을 strict하게 요구한다. `no-store`, `no-cache`,
zero max-age, immediate expiry 또는 response cookie가 관찰된 version은 body validation eligibility와 durable
evidence reuse를 분리하고 accepted acquisition을 false로 유지한다. Generic freshness나
publication acceptance policy를 완화해서는 안 된다.

`officialMarketCalendarKrxHolidayDataResponseBody.ts`는 metadata의 verified content
length와 attached `Uint8Array` 길이를 exact match하고 owned copy만 decode한다. External
JSON은 BOM 없는 strict UTF-8, bounded array/string과 strict object key를 요구한다.
Raw JSON member name은 escape decoding 후 object depth별 duplicate를 거부한다.
Owned bytes는 성공·실패와 무관하게 zeroize하며 raw body와 row value를 결과에서
제외한다. Shape validation만으로 durable evidence나 accepted acquisition을 만들지 않는다.

`officialMarketCalendarKrxHolidayDataRowPolicy.ts`는 registered response metadata/body와
target-year policy version에 결합한 field/sequence semantics만 정의한다. Source field
의미는 selector 전체 target year의 비민감 observation으로 확인하고, English holiday
name처럼 실제 empty가 관찰된 field를 임의로 required로 강화하지 않는다. Semantic
policy 등록만으로 raw row retention, archive completeness 또는 accepted acquisition을
주장하지 않는다.

KRX holiday row semantic consumer는 body module의 private parsed row만 사용하고 public
callback이나 row getter를 제공하지 않는다. Output은 count와 validation boolean만
포함하고 date/name/code 목록을 반환하지 않는다. Target year, date/calendar-day,
weekday, name과 sequence policy를 모두 통과해도 observed row scope를 historical
completeness로 확대하거나 durable/accepted 상태로 승격하지 않는다.

KRX holiday response ownership은 1MiB 상한을 internal allocation 전에 적용하고 caller byte
view를 즉시 zeroize하는 process-local opaque handle로만 유지한다. Factory는 full response
metadata verifier가 같은 process에서 만든 객체만 받고 caller가 재구성한 projection을
거부한다. Handle은 raw metadata object, row getter, callback, enumerable field,
JSON export를 제공하지 않고 fixed semantic consumer를 한 번만 허용한다. Factory,
consumer, explicit disposal의 모든 실패 경로는 owned bytes를 unconditional zeroize해야
하며 consumer가 실패해도 handle 재사용을 허용하지 않는다. 다른 agent가 copy 중
mutate할 수 있는 `SharedArrayBuffer` backing view는 ownership input으로 허용하지 않는다.

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
- API 연결 상태, file-mode notice, dashboard 상단 metric renderer는 `dashboard/dashboardStatusRenderers.js`에 둔다.
- portfolio timeline, trade PnL, position valuation, benchmark data helper는 `dashboard/portfolioModel.js`에 둔다.
- portfolio performance, benchmark, exposure, event coverage, income goal, portfolio risk metric DOM renderer는 `dashboard/portfolioRenderers.js`에 둔다.
- positions/trades/market packet table renderer와 symbol cell helper는 `dashboard/tableRenderers.js`에 둔다.
- replay progress panel, performance metric, progress event renderer와 replay progress view helper는 `dashboard/replayProgressRenderers.js`에 둔다.
- replay progress polling, live replay section composition, progress refresh completion callback 연결은 `dashboard/replayProgressCoordinator.js`에 둔다.
- batch replay 개별 run 목록/탭/상세/polling renderer는 `dashboard/batchRunRenderers.js`에 둔다.
- AI decision timeline/filter/performance renderer, decision filter event binding, action display helper는 `dashboard/decisionRenderers.js`에 둔다.
- daily/replay/batch report renderer는 `dashboard/reportRenderers.js`, 여러 renderer가 공유하는 report label/summary helper는 `dashboard/reportViewHelpers.js`에 둔다.
- source summary renderer와 dashboard symbol metadata registration은 `dashboard/sourceRenderers.js`에 둔다.
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
workflows -> market/replay/paper/risk/order/ai/reports/storage
market/replay/paper/risk/order/ai/reports/storage -> domain
order -> risk (opaque authority verifier only)
tests -> 대상 module
```

금지 방향:

```text
domain -> storage/api/mcp/ai/collectors
paper -> api/mcp
api/mcp -> workflows that execute replay or AI decisions
collectors -> paper/order/risk mutation
ai -> storage mutation or paper order execution
order -> broker/api/mcp/cli/ai/paper/storage
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

`npm run check`는 `quality:gate`와 전체 Node.js test suite를 실행한다. `quality:gate`는 build 후 Local Operations API route, MCP enabled/disabled tool name, Codex decision provider safe default, Toss Open API auth config safe default, 관련 문서 drift를 검사한다.

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
- `src/order`에서 broker/network I/O 또는 enabled mutation entrypoint 연결
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
