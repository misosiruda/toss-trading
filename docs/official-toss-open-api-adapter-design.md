# Official Toss Open API Adapter Design

> 이 문서는 official Toss Open API adapter의 안전 경계 설계 문서다. 현재 구현은 safe-disabled token auth config, mocked token auth client, injected transport 기반 read-only HTTP client, read-only market data adapter, masked read-only account snapshot reader까지다. Calendar 전용 actual network transport와 acquisition coordinator는 아래 fail-closed 계약에 한해 후속 구현을 허용하지만 아직 구현하지 않았으며, order adapter, live order routing, live trading enable 기능은 계속 구현하지 않는다.

## 목적

`toss-trading`의 broker primary source를 Toss Securities Open API로 옮기기 전에, 어떤 계층과 안전 조건을 먼저 고정해야 하는지 정리한다.

핵심 목표는 다음과 같다.

- official API와 비공식 `tossinvest-cli` source의 책임을 분리한다.
- Official market calendar의 operational/observed broker source 책임과 KRX/NYSE exchange-grade historical evidence 책임을 분리한다.
- `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false` 기본값을 유지한 채 설계만 문서화한다.
- market/account/order endpoint를 바로 live trading path로 연결하지 않고, mock, read-only, dry-run, Risk Engine, OrderRouter 순서로만 확장한다.
- Codex MCP surface에 raw broker API, raw `tossctl`, raw `codex exec`, `place_order`를 노출하지 않는다.
- 후속 구현 PR의 중단 조건, 테스트 조건, threat model 선행 조건을 명확히 한다.

## 공식 문서 기준

이 문서는 2026-08-13 확인 기준으로 다음 official source를 참고했다.

- Human documentation: https://developers.tossinvest.com/docs
- LLM entrypoint: https://developers.tossinvest.com/llms.txt
- Overview Markdown: https://openapi.tossinvest.com/openapi-docs/overview.md
- OpenAPI Markdown: https://openapi.tossinvest.com/openapi-docs/latest/api-reference/README.md
- OpenAPI JSON source of truth: https://openapi.tossinvest.com/openapi-docs/latest/openapi.json

확인한 현재 OpenAPI metadata:

| 항목 | 값 |
| --- | --- |
| `openapi` | `3.1.0` |
| `info.title` | `토스증권 Open API` |
| `info.version` | `1.2.14` |
| base server | `https://openapi.tossinvest.com` |
| auth | OAuth 2.0 Client Credentials Grant |
| account/order header | `X-Tossinvest-Account` |

구현 PR을 시작하기 전에는 위 OpenAPI JSON을 다시 받아 endpoint, schema, auth, error, rate limit 변경 여부를 확인해야 한다. 이 문서의 endpoint 목록은 방향을 잡기 위한 snapshot이며, 구현 source of truth는 항상 OpenAPI JSON이다. 현재 calendar response/evidence contract는 `1.2.13`에 고정돼 있으므로 `1.2.14` response compatibility와 version-aware evidence transition이 별도 PR에서 입증되기 전에는 network response를 evidence builder에 전달하지 않는다.

## 현재 공식 API 표면

### Auth

| Method | Path | 설명 |
| --- | --- | --- |
| `POST` | `/oauth2/token` | OAuth2 access token 발급 |

### Market Data, Stock Info, Market Info

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/api/v1/orderbook` | 호가 조회 |
| `GET` | `/api/v1/prices` | 현재가 조회 |
| `GET` | `/api/v1/trades` | 최근 체결 내역 조회 |
| `GET` | `/api/v1/price-limits` | 상/하한가 조회 |
| `GET` | `/api/v1/candles` | 캔들 차트 조회 |
| `GET` | `/api/v1/stocks` | 종목 기본 정보 조회 |
| `GET` | `/api/v1/stocks/{symbol}/warnings` | 매수 유의사항 조회 |
| `GET` | `/api/v1/exchange-rate` | 환율 조회 |
| `GET` | `/api/v1/market-calendar/KR` | 국내 장 운영 정보 조회 |
| `GET` | `/api/v1/market-calendar/US` | 해외 장 운영 정보 조회 |

Market calendar endpoint는 primary operational/observed broker calendar source다.
Future evidence class는 `official_broker_observed`이며 실제로 검증된 requested date와
returned session 범위에만 적용한다. 이 source는 KRX/NYSE first-party raw document
기반 `official_exchange` evidence보다 아래 계층이고, historical completeness,
official holiday archive completeness 또는 `official_exchange` readiness를
증명하지 않는다. Historical coverage가 검증되기 전 replay calendar evidence
class는 `observed_session_only`를 유지한다.

Future evidence contract는 request path/query, requested date, market, retrieval
timestamp, exact response hash와 byte length, source/API version, stale policy와
requested/returned coverage 결과를 기록해야 한다. Unsupported date, partial
response, schema mismatch, provenance 누락, stale source와 coverage 불명확성은
fail-closed로 거부한다. Access token과 client credential은 기록하지 않는다.
이 source hierarchy 결정만으로 network transport, OAuth credential, response bytes
취득, response schema/parser 또는 replay 연결을 승인하지 않는다. 각 책임은 별도
Small PR에서 strict contract와 fail-closed test를 함께 검토한다.

`official_broker_observed_calendar_evidence.v1`은 이 metadata 경계를 구현한다.
OpenAPI `1.2.13`의 market별 exact GET path, operation id와 `date` query를 요청
market/date에 결합하고, exact UTF-8 JSON response bytes의 SHA-256과 byte length를
보존한다. Raw bytes 자체와 credential은 artifact에 넣지 않는다. 정규화 response,
request identity, response identity, requested/returned date와 session range,
24시간 retrieval-age freshness policy를 하나의 canonical artifact hash로 묶는다.
Freshness는 retrieval 시각 이상이고 `staleAfter` 미만인 `asOf`에서만 통과한다.
Coverage는 반환된 세 date와 그 response에 실제로 포함된 session에만 `verified`이며
historical completeness는 항상 `not_claimed`, replay class는 계속
`observed_session_only`다. 이 계약은 synthetic/in-memory bytes만 처리하며 HTTP
transport, OAuth 또는 replay fixture 연결을 추가하지 않는다.

후속 read-only replay adapter는 verified evidence를 기존 market calendar
validation rule과 세 returned-day fixture로만 투영한다. Open day에는 exactly one
regular session을 요구하고 KR/US IANA timezone에서 기존 fixture parser를 다시
통과시킨다. Closed day는 legacy replay의 no-session fail-closed 표현으로만 보존하며
official holiday 명칭이나 completeness로 해석하지 않는다. Adapter는 evidence의
artifact/raw-response hash, freshness와 eligible transition을 사용 시점에 다시
검증하고 network, credential, source file write 또는 replay 실행을 수행하지 않는다.

Credential-free coverage probe는 지정 범위의 모든 calendar date를 canonical plan으로
열거하고 외부에서 제공된 verified evidence observation만 평가한다. Missing/rejected
date 또는 겹치는 response의 동일 returned date session 불일치가 하나라도 있으면
coverage를 `ambiguous`, observed replay eligibility를 `rejected`로 보고한다. 모든
planned date가 verified여도 이 결과는 계획 범위의 broker observation coverage이며
historical completeness 또는 `official_exchange` readiness가 아니다. Probe는
HTTP/OAuth를 호출하지 않고 raw response bytes나 credential을 report에 저장하지 않는다.
Stored report를 다시 읽을 때는 별도로 보관된 evidence와 exact raw bytes observation을
요구하고 report를 완전히 재생성해 비교한다. Report의 public hash만 다시 계산해서
conflict나 reject 결과를 지우는 변경은 검증을 통과할 수 없다.

### Calendar 전용 network acquisition 허용 경계

Standing maintenance delegation에 따라 actual network 구현은 다음 두 책임으로만
제한한다. 이 승인은 general-purpose official API client, account 조회 또는 order
surface 승인이 아니다.

| 책임 | 허용 request | 필수 제한 |
| --- | --- | --- |
| Token issuer transport | `POST https://openapi.tossinvest.com/oauth2/token` | `application/x-www-form-urlencoded`, `grant_type=client_credentials`, redirect 금지, credential/token masking |
| Calendar read-only transport | `GET https://openapi.tossinvest.com/api/v1/market-calendar/KR` 또는 `/US` | canonical `date=YYYY-MM-DD` query를 exactly one으로 요구, Bearer 외 credential header 금지, `X-Tossinvest-Account` 금지 |

공통 fail-closed 조건:

- `TOSS_OPEN_API_AUTH_ENABLED=false`를 기본값으로 유지하고 disabled/invalid config에서는
  DNS 또는 socket 연결 전에 중단한다.
- Base URL은 userinfo, path, query, fragment가 없는 exact HTTPS origin
  `https://openapi.tossinvest.com`만 허용한다. 임의 host, protocol-relative URL,
  backslash path와 caller-provided absolute URL은 거부한다.
- Provider endpoint와 generic `TossOpenApiMarketDataAdapter`가 `date` 생략을 지원해도
  evidence acquisition은 생략을 허용하지 않는다. Coordinator는 canonical
  `date=YYYY-MM-DD`를 정확히 하나 전송하고 market, requested date와 effective query를
  evidence builder 전에 exact bind한다. Query 누락, duplicate, unknown query 또는 값
  mismatch는 response를 evidence로 조립하지 않고 거부한다.
- Automatic redirect, cookie jar, client certificate와 credential-bearing proxy auth를
  사용하지 않는다. `Authorization`, `Content-Type`, `Accept` 외의 credential 또는
  account header를 임의 주입하지 않는다.
- 각 request는 10,000ms 이하의 finite timeout을 적용한다. Token response는 256KiB,
  calendar response는 1MiB를 초과하면 body를 사용하지 않고 거부한다.
- 성공 response는 complete `application/json` body만 허용한다. Unsupported content
  type, truncated body, size 초과, timeout과 transport error는 partial evidence를 만들지
  않는다.
- 첫 구현은 기존 read-only client의 invalid/expired token 대상 guarded reissue 1회
  외에 network, `429` 또는 `5xx` 자동 retry를 추가하지 않는다.
- Token과 credential은 process memory 밖에 저장하지 않는다. Calendar exact response
  bytes는 evidence hash와 parser 입력을 위해 acquisition result의 memory에만 보존하며
  log, PR body 또는 public artifact에 기록하지 않는다. Durable raw-byte 저장은 별도
  threat model과 저장 계약 전에는 도입하지 않는다.
- Coordinator output은 `paper_only`, `official_broker_observed`,
  `observed_session_only`로 고정한다. Historical completeness와 `official_exchange`
  readiness를 주장하거나 Risk Engine, order, portfolio mutation 경로에 연결하지 않는다.

실제 external request에는 owner가 repository 밖에서 발급한 credential과 허용 IP 설정이
필요하다. 이 외부 설정이 없어도 transport, local mock server, coordinator, preflight와
negative test 구현은 계속할 수 있다. 실제 호출을 실행하지 않은 PR은 그 사실을
명시하며, mock 결과를 official response evidence로 기록하지 않는다.

OpenAPI `1.2.14` calendar schema가 현재 `1.2.13` parser/evidence contract와
호환된다는 byte-level fixture 검증이 merge되기 전에는 acquisition coordinator가 받은
response를 evidence builder에 전달하지 않는다. Schema compatibility만으로 handoff를
승인하지 않으며, 다음 backward-compatible evidence transition도 먼저 merge돼야 한다.

- `official_broker_observed_calendar_evidence.v1` schema, builder와 verifier는
  OpenAPI `1.2.13`에 계속 고정한다. 기존 v1 artifact를 rewrite하거나 v1의
  `source.apiVersion` 상수만 `1.2.14`로 바꾸지 않는다.
- `1.2.14` response는 별도 `official_broker_observed_calendar_evidence.v2`
  schema/builder/verifier가 exact
  `source.apiVersion="1.2.14"`와 검증에 사용한 official OpenAPI document의 SHA-256을
  provenance에 기록할 때만 받을 수 있다. 이 hash는 response hash와 다른 contract
  snapshot identity다.
- Immutable trusted version registry는 API version, OpenAPI document hash, calendar
  operation id/path와 response parser contract version을 하나의 entry로 결합한다.
  Coordinator와 builder는 caller-provided version string을 신뢰하지 않고 검증된 registry
  entry를 전달받아 exact provenance를 구성한다.
- Verifier는 artifact schema version으로 v1과 v2 검증 경로를 결정한다. Unknown schema,
  registry에 없는 API version, document hash/operation/parser mismatch와 API version 누락은
  artifact 생성 또는 검증 전에 fail-closed로 거부한다.

따라서 version drift를 무시하거나 metadata만 `1.2.14`로 바꿔 기존 artifact를 재해석하는
동작은 금지한다. Compatibility test와 version-aware evidence transition 중 하나라도
없으면 coordinator는 raw response bytes를 evidence builder에 전달하지 않는다.

### Test-only network injection 계약

Local integration test는 production URL allowlist를 localhost URL로 완화하지 않는다.
Request validator가 exact logical origin, method, path와 query를 먼저 통과시킨 뒤 저수준
socket connector만 test factory에서 주입한다.

- Logical request URL과 provenance origin은 `https://openapi.tossinvest.com`,
  destination authority는 `openapi.tossinvest.com:443`, HTTP `Host` header는
  `openapi.tossinvest.com`, TLS SNI/servername은 port 없는 bare DNS hostname
  `openapi.tossinvest.com`을 사용한다. Loopback dial address와 ephemeral port는
  artifact, request identity 또는 application config에 나타나지 않는다. Authority의
  port를 TLS servername에 전달하거나 certificate SAN과 비교하지 않는다.
- Test connector는 validated production host의 socket dial만 `127.0.0.1` 또는 `::1`의
  지정된 ephemeral HTTPS server로 매핑한다. 다른 host, non-loopback address와 두 번째
  redirect target은 거부한다.
- Local HTTPS server는 per-test CA가 서명하고 SAN이 `openapi.tossinvest.com`인 server
  certificate를 사용한다. Test connector에만 해당 CA를 주입하며 hostname/certificate
  verification은 유지한다. `NODE_TLS_REJECT_UNAUTHORIZED=0`,
  `rejectUnauthorized=false`와 plaintext HTTP는 허용하지 않는다.
- Production factory는 dial target, custom CA 또는 test connector 입력을 받지 않고
  platform trust 기반 connector만 구성한다. Test factory는 별도 test-only module에 두고
  runtime config, env, CLI, MCP, dashboard 또는 Local Operations API에 노출하지 않는다.
- Redirect, timeout, oversized body, incomplete stream과 abort test는 이 loopback HTTPS
  server가 응답을 제어해 실행한다. Redirect `Location`은 logical production URL 기준으로
  검증하며 automatic follow 금지는 그대로 적용한다.
- Test fixture는 synthetic credential/token만 사용하고 mock response를 official evidence로
  표시하지 않는다. Test dial metadata도 evidence builder 입력에 포함하지 않는다.

### Account, Asset

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/api/v1/accounts` | 계좌 목록 조회 |
| `GET` | `/api/v1/holdings` | 보유 주식 조회 |

### Order, Order History, Order Info

| Method | Path | 설명 |
| --- | --- | --- |
| `POST` | `/api/v1/orders` | 주문 생성 |
| `POST` | `/api/v1/orders/{orderId}/modify` | 주문 정정 |
| `POST` | `/api/v1/orders/{orderId}/cancel` | 주문 취소 |
| `GET` | `/api/v1/orders` | 주문 목록 조회 |
| `GET` | `/api/v1/orders/{orderId}` | 주문 상세 조회 |
| `GET` | `/api/v1/buying-power` | 매수 가능 금액 조회 |
| `GET` | `/api/v1/sellable-quantity` | 판매 가능 수량 조회 |
| `GET` | `/api/v1/commissions` | 매매 수수료 조회 |

계좌, 자산, 주문 관련 API는 `Authorization: Bearer {access_token}` 외에 `X-Tossinvest-Account` 헤더가 필요하다.

## Adapter 책임 경계

### 이 문서가 허용하는 것

- official API endpoint category와 인증 방식에 맞춘 adapter 설계
- future module boundary, data flow, fail-closed policy 정의
- mock-first 구현 순서 정의
- read-only account/market snapshot과 order mutation path 분리
- rate limit, error envelope, audit, masking 정책 설계
- 위 allowlist에 한정된 safe-disabled token/calendar transport와 paper-only acquisition coordinator

### 이 문서가 금지하는 것

- real `client_id`, `client_secret`, account id, token 문서화
- calendar allowlist 밖 official API 실제 호출 코드 추가
- 임의 URL/method를 받는 general-purpose network transport 구현
- account, holdings, order, order history endpoint를 calendar acquisition에 연결
- `TRADING_ENABLED=true` 기본값 또는 예시 추가
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter 구현
- `place_order` MCP tool enabled surface 추가
- dashboard 또는 Local Operations API에 broker mutation endpoint 추가
- Codex가 natural language 주문을 live order로 변환하는 경로 추가

## 권장 후속 구현 순서

```mermaid
flowchart TD
    D["Design document only"] --> T["Token auth design and secret handling"]
    T --> C["Token config parser with safe defaults"]
    C --> AC["Mocked token auth client"]
    AC --> H["Authenticated read-only HTTP client with injected transport"]
    H --> M["Read-only market data adapter with mocked HTTP tests"]
    M --> A["Read-only account and holdings snapshot reader"]
    A --> NC["Calendar network acquisition contract"]
    NC --> V["OpenAPI calendar compatibility gate"]
    V --> EV["Version-aware calendar evidence transition"]
    EV --> NT["Safe-disabled token issuer transport"]
    NT --> CT["Calendar-only GET transport"]
    CT --> CC["Paper-only acquisition coordinator"]
    CC --> R["Live RiskEngine implementation with mock broker"]
    R --> TM["Live trading threat model"]
    TM --> O["OrderRouter with dry-run broker gateway"]
    O --> P["Official order gateway behind explicit trading gates"]
    P --> Q["Deployment gate"]
```

후속 PR은 이 순서를 건너뛰면 안 된다. Calendar transport는 current OpenAPI compatibility gate와 backward-compatible version-aware evidence transition을 먼저 통과해야 하고, token issuer와 calendar GET 책임을 서로 다른 PR로 유지한다. 특히 `POST /api/v1/orders` 구현은 token auth, read-only adapter, live Risk Engine, mock OrderRouter, threat model이 먼저 merge된 뒤에만 검토한다.

## 제안 계층

후속 구현에서 `src/broker/` 또는 동등한 broker integration layer를 도입할 수 있다. 실제 코드 도입 전에는 `docs/PROJECT_STRUCTURE.md`와 `docs/CODE_CONVENTION.md`를 먼저 갱신한다.

| 계층 | 책임 | 금지 |
| --- | --- | --- |
| `TossOpenApiAuthClient` | Client Credentials Grant, token cache, expiry handling | token 로그 출력, token storage commit |
| `TossOpenApiHttpClient` | base URL, auth header, account header, timeout, retry, error envelope parsing | business decision, risk approval |
| `TossOpenApiMarketDataAdapter` | prices, orderbook, trades, candles, stock warnings, market calendar read-only 조회 | account/order source of truth 역할 |
| `TossOpenApiAccountReader` | accounts, holdings read-only snapshot 조회와 masking | order mutation, portfolio mutation |
| `TossOpenApiOrderInfoReader` | buying power, sellable quantity, commissions 조회 | 주문 생성 판단 |
| `TossOpenApiOrderGateway` | create/modify/cancel order HTTP call | Risk Engine 우회, Codex/MCP 직접 호출 |
| `OrderRouter` | approved `OrderIntent`만 gateway로 전달, idempotency, retry, execution tracking | natural language order 수신 |

## Runtime data flow

### Read-only market/account flow

```mermaid
sequenceDiagram
    participant Worker as Backend Worker
    participant Adapter as TossOpenApi Read-only Adapter
    participant API as Toss Open API
    participant Store as Snapshot Store
    participant Audit as AuditLogger

    Worker->>Adapter: request market/account snapshot
    Adapter->>API: GET request with Bearer token
    API-->>Adapter: response + rate limit headers
    Adapter-->>Worker: normalized snapshot or degraded status
    Worker->>Store: persist normalized snapshot
    Worker->>Audit: append source status with masked metadata
```

### Future order flow

```mermaid
sequenceDiagram
    participant Strategy as StrategyEngine
    participant Risk as RiskEngine
    participant Router as OrderRouter
    participant Gateway as TossOpenApiOrderGateway
    participant API as Toss Open API
    participant Audit as AuditLogger

    Strategy->>Risk: TradingSignal
    Risk-->>Router: approved OrderIntent
    Router->>Router: local idempotency and duplicate check
    Router->>Gateway: create/modify/cancel request
    Gateway->>API: POST order endpoint
    API-->>Gateway: order response or error envelope
    Gateway-->>Router: broker result
    Router->>Audit: masked order event
```

Codex는 이 flow에 직접 참여하지 않는다. Codex는 MCP read-only tools로 audit, position, risk decision, order status를 조회하고 설명할 수 있을 뿐이다.

## Config 정책

후속 구현에서 사용할 수 있는 config 후보는 다음과 같다. 이름은 구현 PR에서 다시 검토한다.

```text
BROKER_PROVIDER=mock
TRADING_ENABLED=false
TOSS_OPEN_API_BASE_URL=https://openapi.tossinvest.com
TOSS_OPEN_API_CLIENT_ID=<local secret only>
TOSS_OPEN_API_CLIENT_SECRET=<local secret only>
TOSS_OPEN_API_ACCOUNT_ID=<local secret only>
TOSS_OPEN_API_ORDER_MUTATIONS_ENABLED=false
TOSS_OPEN_API_DRY_RUN=true
```

원칙:

- repository에는 `.env.example` 수준의 placeholder만 둔다.
- `client_id`, `client_secret`, account id, token은 source, docs, test fixture, PR body에 쓰지 않는다.
- `BROKER_PROVIDER=mock`과 `TRADING_ENABLED=false`를 계속 safe default로 둔다.
- order mutation은 `TRADING_ENABLED=true`, provider가 official API, dry-run false, Risk Engine approval, user approval 조건이 모두 맞아야만 future runtime에서 허용한다.

## Rate limit 정책

공식 overview 기준 rate limit은 client와 API group 단위 TPS로 적용된다. 현재 문서 snapshot:

| Group | 기본 한도 | 피크 한도 |
| --- | --- | --- |
| `AUTH` | 5 TPS | 해당 없음 |
| `ACCOUNT` | 1 TPS | 해당 없음 |
| `ASSET` | 5 TPS | 해당 없음 |
| `STOCK` | 5 TPS | 해당 없음 |
| `MARKET_INFO` | 3 TPS | 해당 없음 |
| `MARKET_DATA` | 10 TPS | 해당 없음 |
| `MARKET_DATA_CHART` | 5 TPS | 해당 없음 |
| `ORDER` | 6 TPS | 09:00-09:10 KST 3 TPS |
| `ORDER_HISTORY` | 5 TPS | 해당 없음 |
| `ORDER_INFO` | 6 TPS | 09:00-09:10 KST 3 TPS |

구현 정책:

- adapter는 `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`를 읽어 audit/debug metadata로 남긴다.
- `429`와 `Retry-After`는 rate-limit metadata로 보존한다. 첫 token/calendar network transport는 자동 retry하지 않으며, bounded jitter backoff는 후속 endpoint-specific orchestrator 계약에서만 도입한다.
- order mutation은 retry 가능성이 공식적으로 안전하다고 확인되기 전까지 blind retry하지 않는다.
- `ORDER`와 `ORDER_INFO`는 장 시작 피크 한도를 별도 budget으로 둔다.

## Error handling 정책

공식 에러 응답은 `error.requestId`, `error.code`, `error.message`, `error.data` envelope을 사용한다.

구현 정책:

- `requestId` 또는 응답 헤더 `X-Request-Id`는 audit metadata로 남기되, 민감 주문/계좌 값은 masking한다.
- `401 invalid-token`, `401 expired-token`은 token refresh 또는 auth failure로 분리한다.
- `400 account-header-required`는 config error로 fail-closed 처리한다.
- `400 confirm-high-value-required`는 backend가 자동으로 `confirmHighValueOrder=true`를 붙이지 않는다. 별도 high-value order policy와 명시 승인 없이는 reject한다.
- `429`는 rate limit degraded status로 기록한다. 이 문서가 승인한 첫 calendar acquisition 경로는 재시도하지 않고 fail-closed 결과를 반환한다.
- `5xx` 또는 network timeout은 circuit breaker와 no-order/no-position-mutation 정책으로 처리한다.

## Idempotency와 duplicate prevention

OpenAPI snapshot에서 order idempotency key 계약은 이 문서에서 확정하지 않는다. 구현 전 OpenAPI JSON과 order endpoint detail을 다시 확인한다.

로컬 정책은 다음을 기본으로 한다.

- `OrderIntent`에는 backend-generated `intentId`와 deterministic order hash를 둔다.
- `OrderRouter`는 같은 `intentId` 또는 같은 order hash가 열린 상태이면 중복 전송하지 않는다.
- mutation 요청이 timeout된 경우에는 즉시 재전송하지 않고 order history/detail 조회로 상태를 먼저 확인한다.
- 공식 API가 idempotency key를 지원하면 local `intentId`와 매핑한다.
- 공식 API가 idempotency key를 지원하지 않으면 retry policy를 더 보수적으로 제한한다.

## Audit와 masking

후속 구현은 다음 필드를 audit/logging 대상으로 구분한다.

| 구분 | 저장 가능 | 원문 출력 |
| --- | --- | --- |
| API group, method, path template | 가능 | 가능 |
| requestId, rate limit header | 가능 | 가능 |
| account id | masked 또는 encrypted local store만 | 금지 |
| access token, client secret | 금지 | 금지 |
| broker order id | masked 또는 encrypted local store만 | 금지 |
| execution detail | encrypted local store 검토 필요 | 금지 |
| normalized market quote | 가능 | 가능 |

문서, fixture, PR body에는 real account data, token, order id, execution data를 넣지 않는다.

## 공식 API와 `tossinvest-cli` 관계

- official Toss Open API는 production broker adapter의 primary source 후보다.
- Official Toss Open API market calendar는 primary operational/observed broker calendar source이며 evidence class는 `official_broker_observed`다.
- KRX/NYSE first-party raw document는 별도의 상위 `official_exchange` historical evidence다. Toss response를 이 계층으로 승격하거나 exchange archive completeness 근거로 사용하지 않는다.
- `tossinvest-cli` fork는 optional read-only intelligence source로만 유지한다.
- account, order, execution, holdings source of truth는 official API 또는 mock broker가 담당해야 한다.
- 비공식 source의 ranking, signals, watchlist-like data는 candidate enrichment에는 쓸 수 있지만 live order routing의 필수 근거가 될 수 없다.

## MCP와 dashboard 노출 정책

이 설계 이후에도 MCP와 dashboard 기본 surface는 read-only다.

허용 가능한 future read-only 조회:

- masked broker source health
- masked account snapshot status
- order router dry-run status
- risk decision summary
- execution reconciliation summary

기본 금지:

- `place_order`
- `place_market_order`
- `enable_live_trading`
- raw broker API call
- raw `tossctl`
- raw `codex exec`
- dashboard-triggered order mutation
- natural language order command

제한적 operational tool을 추가하려면 별도 threat model, approval, audit, idempotency, rollback, mock test가 필요하다.

## 테스트 전략

후속 구현은 최소 다음 테스트를 포함해야 한다.

- auth config parser가 secrets를 로그에 남기지 않고 missing secret을 fail-closed 처리한다.
- token transport가 exact origin과 `/oauth2/token` POST만 허용하고 redirect, timeout, oversized 또는 non-JSON response를 거부한다.
- calendar transport가 KR/US exact GET path와 required canonical `date` exactly one만 허용하고 query 누락/duplicate/mismatch, account header, 임의 query/path와 redirect를 거부한다.
- test-only loopback HTTPS connector에서 canonical production URL, destination authority, hostname-only HTTP Host/SNI와 TLS 검증을 유지한 채 token/calendar redirect, timeout, abort와 response byte boundary를 검증하고 mock bytes를 official evidence로 표시하지 않는다.
- coordinator가 disabled/invalid config, OpenAPI version mismatch, partial response와 schema mismatch에서 evidence를 만들지 않는다.
- evidence verifier가 기존 v1/`1.2.13` artifact를 그대로 검증하고, v2가 registry의 exact API version/OpenAPI document hash/operation/parser contract를 기록하며 unknown 또는 mismatched version identity를 거부한다.
- HTTP client가 OpenAPI fixture 기반 response/error envelope을 parsing한다.
- rate limit `429`와 `Retry-After`를 처리한다.
- account header가 필요한 endpoint에서 누락 시 fail-closed 처리한다.
- read-only market/account adapter는 mutation endpoint를 호출하지 않는다.
- order gateway는 `TRADING_ENABLED=false` 또는 `ORDER_MUTATIONS_ENABLED=false`에서 실행되지 않는다.
- Risk Engine reject가 있으면 `OrderRouter`가 broker gateway를 호출하지 않는다.
- duplicate order intent는 전송되지 않는다.
- MCP enabled tool 목록에 live order tool이 추가되지 않는다.
- dashboard/API에 mutation endpoint가 추가되지 않는다.

## PR 분리 계획

| 순서 | PR | 포함 | 제외 |
| --- | --- | --- | --- |
| 1 | Official API adapter design | 이 문서와 링크 | code, token auth, order |
| 2 | [Official token auth design](official-token-auth-design.md) | env, secret handling, token lifecycle 문서와 tests plan | real secret, API call |
| 3 | Token config parser | safe-disabled env parser, placeholder, missing secret tests | token issue HTTP call |
| 4 | Mocked token auth client | form request builder, response parser, memory cache, single-flight tests | HTTP transport, account/order adapter |
| 5 | Authenticated read-only HTTP client | Bearer injection, read-only method guard, error/rate mapping tests | actual network transport, mutation retry |
| 6 | Read-only market data adapter | mocked HTTP client, market endpoint read-only mapping | account/order mutation |
| 7 | Read-only account snapshot | accounts/holdings reader, masking, source status | order mutation |
| 8 | Calendar network acquisition contract | exact host/method/path, disabled default, limits, masking과 evidence 경계 | code, credential, external call |
| 9 | OpenAPI calendar compatibility | `1.2.14` response fixture, response parser compatibility gate와 regression test | network, evidence artifact transition, metadata-only version bump |
| 9a | Version-aware calendar evidence transition | v1/`1.2.13` 보존, v2 registry-bound API/document/parser provenance와 verifier dispatch test | v1 rewrite, caller-provided version trust, network |
| 10 | Token issuer network transport | exact token POST, finite limits, masked error와 test-only loopback HTTPS connector test | market/account/order request, external credential call |
| 11 | Calendar GET network transport | KR/US allowlist, required canonical date binding, Bearer, exact bytes, finite limits와 test-only loopback HTTPS connector test | query 생략, account/order/general market endpoint |
| 12 | Calendar acquisition coordinator | auth, calendar request, parser/evidence composition과 fail-closed test | raw-byte persistence, replay 실행, completeness claim |
| 13 | Credential-ready preflight | secret value 없는 readiness, host/IP/config 진단 | token/response 출력, successful external evidence claim |
| 14 | Live RiskEngine implementation | deterministic policy, fixtures, fail-closed tests | broker gateway |
| 15 | Live trading threat model | attack paths, secrets, approval, rollback | implementation shortcut |
| 16 | Live OrderRouter dry-run | local idempotency, mock broker, audit | official order POST |
| 17 | Official order gateway behind gates | create/modify/cancel under explicit gates | MCP direct order tool |
| 18 | Deployment packaging | process isolation, config, monitoring | default live enable |

## Merge 전 체크리스트

후속 구현 PR은 아래 항목이 확인되지 않으면 merge하지 않는다.

- [ ] OpenAPI JSON을 구현 시점에 다시 확인했다.
- [ ] `BROKER_PROVIDER=mock` 기본값을 유지한다.
- [ ] `TRADING_ENABLED=false` 기본값을 유지한다.
- [ ] secrets가 source, docs, test fixture, PR body에 없다.
- [ ] order mutation은 mock 또는 dry-run에서 먼저 검증했다.
- [ ] Risk Engine reject가 broker call보다 앞에 있다.
- [ ] mutation retry는 idempotency와 status 조회 없이 blind retry하지 않는다.
- [ ] MCP enabled surface에 live order tool이 없다.
- [ ] Local Operations API와 dashboard에 broker mutation endpoint가 없다.
- [ ] audit log가 requestId와 masked metadata를 남긴다.
- [ ] 투자 조언, 성과 보장, 종목 추천으로 읽힐 수 있는 문구가 없다.
