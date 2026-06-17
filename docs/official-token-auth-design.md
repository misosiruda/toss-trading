# Official Toss Open API Token Auth Design

> 이 문서는 token auth 설계 문서다. 현재 runtime 구현 범위는 safe-disabled config parser, injected `TossOpenApiTokenIssuer` 기반 mocked `TossOpenApiAuthClient`, injected transport 기반 `TossOpenApiReadOnlyHttpClient`다. real network transport, official API actual call, persistent token store, account/order adapter, live trading 기능은 구현하지 않는다.

## 목적

official Toss Open API adapter를 구현하기 전에 OAuth2 Client Credentials 기반 token 발급과 secret handling 정책을 별도 경계로 고정한다.

핵심 목표는 다음과 같다.

- token 발급 endpoint 계약을 OpenAPI source 기준으로 정리한다.
- real `client_id`, `client_secret`, `access_token`, account id가 source, docs, logs, PR body에 들어가지 않도록 금지선을 명확히 한다.
- client당 유효 token이 1개라는 제약을 반영해 token cache, single-flight, multi-process 운영 위험을 먼저 설계한다.
- `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` 기본값을 바꾸지 않는다.
- auth 구현 PR의 테스트 기준과 중단 조건을 정의한다.

## 공식 문서 기준

이 문서는 2026-06-17 확인 기준으로 다음 official source를 참고했다.

- Auth Markdown: https://openapi.tossinvest.com/openapi-docs/latest/api-reference/Apis/AuthApi.md
- OpenAPI JSON source of truth: https://openapi.tossinvest.com/openapi-docs/latest/openapi.json

확인한 현재 OpenAPI metadata:

| 항목 | 값 |
| --- | --- |
| `openapi` | `3.1.0` |
| `info.version` | `1.1.1` |
| base server | `https://openapi.tossinvest.com` |
| auth operation | `issueOAuth2Token` |
| auth path | `POST /oauth2/token` |
| request content type | `application/x-www-form-urlencoded` |
| success response | OAuth2 standard response |
| rate limit group | `AUTH` |

구현 PR을 시작하기 전에는 OpenAPI JSON을 다시 받아 token request/response schema, error response, rate limit 문구가 바뀌었는지 확인한다.

## Token Endpoint 계약

### Request

```text
POST /oauth2/token
Content-Type: application/x-www-form-urlencoded
Accept: application/json
```

요청 body:

| 필드 | 필수 | 값/형식 | 정책 |
| --- | --- | --- | --- |
| `grant_type` | yes | `client_credentials` | 다른 grant type은 지원하지 않는다. |
| `client_id` | yes | string | local secret으로만 취급한다. |
| `client_secret` | yes | password string | source, docs, logs, audit에 원문을 남기지 않는다. |

토큰 발급 endpoint 자체에는 Bearer authorization이 필요하지 않다.

### Response

성공 응답은 BFF 공통 envelope이 아니라 OAuth2 표준 형식이다.

```json
{
  "access_token": "<masked>",
  "token_type": "Bearer",
  "expires_in": 86400
}
```

정책:

- `token_type`은 `Bearer`만 허용한다.
- `expires_in`은 예시값을 hard-code하지 않고 응답값 기준으로 expiry를 계산한다.
- `access_token`은 process memory에만 보관하는 것을 1차 구현 기본값으로 둔다.
- persistent token store는 별도 보안 설계와 암호화 정책이 merge되기 전까지 도입하지 않는다.

### Error

| Status | Error | 처리 정책 |
| --- | --- | --- |
| `400` | `invalid_request` | 필수 값 누락 또는 형식 오류다. config/parser 또는 request builder 오류로 fail-closed 처리한다. |
| `400` | `unsupported_grant_type` | `client_credentials` 외 grant type 사용 시 fail-closed 처리한다. |
| `401` | `invalid_client` | secret/config 오류다. retry loop로 숨기지 않고 operational failure로 기록한다. |
| `429` | rate limit exceeded | `AUTH` budget 초과다. `Retry-After`가 있으면 우선하고 jitter backoff를 적용한다. |

401 응답의 `WWW-Authenticate` header는 진단 metadata로만 사용하고 secret과 token은 함께 기록하지 않는다.

## Secret Handling 정책

후속 구현에서 사용할 config 이름은 config parser PR에서 다음 placeholder로 고정했다.

```text
TOSS_OPEN_API_AUTH_ENABLED=false
TOSS_OPEN_API_BASE_URL=https://openapi.tossinvest.com
TOSS_OPEN_API_CLIENT_ID=<local secret only>
TOSS_OPEN_API_CLIENT_SECRET=<local secret only>
```

원칙:

- repository에는 placeholder만 둘 수 있으며 real credential은 commit하지 않는다.
- `.env`와 `.env.*`는 Git에서 제외된 상태를 유지한다.
- `client_id`, `client_secret`, `access_token`은 source, test fixture, docs, audit log, PR body에 원문으로 쓰지 않는다.
- 실패 메시지를 저장할 때 provider response body를 그대로 남기지 않고 token-like string과 credential-like string을 masking한다.
- `client_id`는 식별자로 보일 수 있지만 broker credential로 취급해 기본적으로 masking한다.
- account id는 token auth 범위가 아니라 account adapter 범위에서 별도 masking 정책을 둔다.

현재 구현 상태:

- `.env.example`에는 placeholder만 추가되어 있으며 `TOSS_OPEN_API_AUTH_ENABLED=false`가 기본값이다.
- `readTossOpenApiAuthConfig`는 env를 해석하되 token 발급 HTTP call을 수행하지 않는다.
- `TOSS_OPEN_API_AUTH_ENABLED=true`에서 `client_id` 또는 `client_secret`이 누락되면 `status=invalid`로 fail-closed 처리한다.
- `summarizeTossOpenApiAuthConfig`는 credential value를 반환하지 않고 존재 여부만 반환한다.
- `TossOpenApiAuthClient`는 injected `TossOpenApiTokenIssuer`를 사용해 token issue request, response parsing, process memory cache, single-flight를 검증한다.
- `TossOpenApiReadOnlyHttpClient`는 injected transport를 사용해 Bearer injection, read-only method guard, HTTP status/error/rate limit mapping, 401 token failure 1회 guarded reissue를 검증한다.
- 실제 network transport, official API 실제 호출, persistent token store, account/order adapter는 아직 구현하지 않았다.

## Token Lifecycle

후속 `TossOpenApiAuthClient` 구현은 다음 lifecycle을 따른다.

1. config parser가 required secret 존재 여부를 확인한다.
2. process memory token cache에 유효 token이 있으면 재사용한다.
3. token이 없거나 safety margin 안으로 만료가 가까워지면 `POST /oauth2/token`을 호출한다.
4. 동시에 여러 요청이 token을 요구하면 single-flight로 token 발급 요청을 1개만 수행한다.
5. 새 token이 발급되면 `expires_in` 기준 만료 시각과 함께 memory cache를 갱신한다.
6. API 요청이 `401 invalid-token` 또는 expired-token 계열로 실패하면 guarded reissue를 1회만 시도한다.

주의:

- 공식 문서는 refresh token을 제공하지 않으므로 refresh flow를 만들지 않는다.
- client당 유효 access token은 1개이며 재발급 시 이전 token이 즉시 무효화된다.
- 구현은 token 재발급이 기존 in-flight 요청을 깨뜨릴 수 있음을 audit/debug metadata에 남겨야 한다.
- order mutation 요청은 auth failure 후 blind retry하지 않는다. retry 가능성은 OrderRouter idempotency 정책이 있는 PR에서 별도 판단한다.

## 동시성 및 운영 제약

client당 유효 token이 1개라는 제약 때문에 token auth는 단순 cache보다 운영 제약이 중요하다.

### In-process

- token 발급은 single-flight promise 또는 lock으로 묶는다.
- near-expiry reissue 중에는 기존 token을 사용하는 read-only 요청과 새 token 발급 요청의 경계를 명시한다.
- token 발급 실패 시 기존 token이 아직 유효하면 read-only 요청 재사용 가능 여부를 보수적으로 판단한다.

### Multi-process

- shared encrypted token store 또는 distributed lock이 도입되기 전까지 같은 `client_id`를 여러 backend process가 동시에 사용하는 운영은 지원하지 않는다.
- local dashboard, MCP server, worker가 동시에 official auth owner가 되는 구조를 만들지 않는다.
- paper-only 경로는 official token을 요구하지 않아야 한다.

### Retry

- read-only market/account GET 요청은 guarded reissue 후 1회 retry를 검토할 수 있다.
- mutation 요청은 idempotency key, order status reconciliation, Risk Engine approval 재확인 없이 retry하지 않는다.
- `429`는 endpoint group budget을 기준으로 backoff하고 busy loop를 만들지 않는다.

## 계층 책임

| 계층 | 책임 | 금지 |
| --- | --- | --- |
| `TossOpenApiAuthConfig` | env parsing, required secret validation, safe default | secret logging, live trading enable |
| `TossOpenApiAuthClient` | token request, memory cache, expiry, single-flight | token persistent store, business decision |
| `TossOpenApiHttpClient` | Bearer header injection, timeout, rate limit/error mapping | Risk Engine 우회, order retry 판단 |
| `TossOpenApiMarketDataAdapter` | read-only market endpoint 호출 | token 직접 발급, order mutation |
| `TossOpenApiOrderGateway` | future gated mutation call | auth failure blind retry, Codex direct call |

`AuthClient`는 token을 발급하고 HTTP client에 제공하는 책임만 가진다. trading signal 생성, risk approval, order routing 판단은 이 계층에 들어오면 안 된다.

## MCP와 Dashboard 노출 정책

토큰 인증이 구현되더라도 기본 MCP와 dashboard surface는 read-only다.

허용 가능한 future 조회:

- masked auth configuration status
- token cache health without token value
- last token issue status with masked error code
- official API rate limit degraded status

금지:

- `get_access_token`
- `refresh_access_token` direct MCP tool
- raw `POST /oauth2/token` proxy endpoint
- raw broker API call endpoint
- secret 입력/저장 UI
- dashboard-triggered order mutation
- `place_order` enabled MCP tool

운영자가 token 상태를 확인해야 하더라도 token value를 반환하지 않고 상태와 오류 code만 반환한다.

## 구현 PR 테스트 기준

후속 token auth 구현 PR은 최소 다음 검증을 포함해야 한다.

- missing `client_id` 또는 `client_secret`은 API call 전에 fail-closed 처리한다.
- token request가 `application/x-www-form-urlencoded`로 만들어진다.
- `grant_type`은 `client_credentials`만 사용한다.
- `token_type`이 `Bearer`가 아니면 token을 cache하지 않는다.
- `expires_in` 기준 expiry와 safety margin이 적용된다.
- concurrent token request가 single-flight로 합쳐진다.
- 400 `invalid_request`, 400 `unsupported_grant_type`, 401 `invalid_client`, 429 rate limit을 구분한다.
- log/audit payload에서 `client_id`, `client_secret`, `access_token`이 masking된다.
- MCP enabled tool과 Local Operations API route에 token value 반환 surface가 추가되지 않는다.
- `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` 기본값이 유지된다.

## PR 분리 계획

| 순서 | PR | 포함 | 제외 |
| --- | --- | --- | --- |
| 1 | Token auth design | 이 문서와 링크 | code, secret, API call |
| 2 | Token config parser | placeholder env docs, parser, missing secret tests, safe summary, quality gate default check | token issue HTTP call |
| 3 | Mocked AuthClient | form request builder, response parser, process memory cache, single-flight tests | HTTP transport, account/order adapter |
| 4 | Authenticated read-only HTTP client | Bearer injection, read-only method guard, error/rate mapping tests | actual network transport, mutation retry |
| 5 | Read-only market adapter | market endpoint mapping with mocked HTTP | account/order mutation |
| 6 | Read-only account snapshot | account header handling, holdings masking | order mutation |

order gateway 구현은 live Risk Engine, threat model, dry-run OrderRouter가 merge된 뒤에만 검토한다.

## Merge 전 체크리스트

후속 token auth 구현 PR은 아래 항목이 확인되지 않으면 merge하지 않는다.

- [ ] OpenAPI JSON을 구현 시점에 다시 확인했다.
- [ ] real `client_id`, `client_secret`, `access_token`이 source, docs, tests, PR body에 없다.
- [ ] `.env`가 Git에 포함되지 않는다.
- [ ] token value를 반환하는 MCP/API/dashboard surface가 없다.
- [ ] token cache는 process memory 또는 명시적으로 승인된 encrypted store만 사용한다.
- [ ] concurrent reissue가 client당 1개 token 제약을 깨뜨리지 않는다.
- [ ] order mutation retry는 auth 계층에서 결정하지 않는다.
- [ ] `BROKER_PROVIDER=mock`과 `TRADING_ENABLED=false` 기본값이 유지된다.
- [ ] 투자 조언, 성과 보장, 종목 추천으로 읽힐 수 있는 문구가 없다.
