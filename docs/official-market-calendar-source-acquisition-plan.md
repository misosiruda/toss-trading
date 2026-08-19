# Official Market Calendar Source Acquisition 계획

## 목적

이 문서는 `official_exchange` calendar evidence ingestion 구현 전에 KRX와
NYSE first-party official source document를 어떤 증거로 확보하고 검증할지
고정한다. Official Toss Open API의 `official_broker_observed` 책임과 혼합하지
않는다.

대상 기간은 현재 evidence expansion과 baseline replay를 합친
2013-01-01부터 2026-05-31까지다. 이 문서는 source를 다운로드하거나
artifact를 생성하지 않으며, official calendar availability 또는 statistical
readiness 통과를 주장하지 않는다.

## 현재 확인 상태

2026-07-31에 official domain에서 확인한 entry point는 다음과 같다.

| Exchange | Official entry point | 확인된 내용 | 미확인 또는 부족한 내용 |
| --- | --- | --- | --- |
| KRX | `https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp` | `Market Closing(Holiday)` 조회와 download UI | 조회 request contract, download response format, 2013-01-01부터 2026-05-31까지의 실제 row coverage |
| KRX | `https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T1.jsp` | KOSPI regular session 09:00부터 15:30, holiday category | 날짜별 holiday, special closure와 delayed open row |
| KRX | `https://global.krx.co.kr/contents/GLB/01/0107/0107010000/20170630_eng_brochure.pdf` | 2016-08-01부터 securities regular session 30분 연장 | 2013부터 변경일까지 적용된 전체 historical session rule archive |
| NYSE | `https://www.nyse.com/trade/hours-calendars` | 2026, 2027, 2028 holiday와 scheduled early close | 2013부터 2025까지의 first-party historical archive |

현재 entry point만으로 대상 기간의 complete exchange-date session을 만들 수
없다. KRX dynamic request를 추측하거나 NYSE의 현재 규칙을 과거 기간에
소급 적용하지 않는다.

이 미확인 상태는 `official_exchange` 승격 blocker다. Official Toss Open API
`GET /api/v1/market-calendar/{KR|US}`는 별도의 primary operational/observed broker
calendar source이며 `official_broker_observed` class로 관리한다. Toss response는
실제로 검증된 requested date와 returned session 범위에 한해서만
`observed_session_only` paper-only replay input 후보가 될 수 있고, KRX/NYSE
first-party archive 또는 historical completeness를 대신하지 않는다.

### Request Header Policy 사전 등록

확인된 entry point는 다음 immutable request-header policy version으로 사전
등록한다. KRX policy는 fixed known-safe set인 `accept`, `accept-language`,
`cache-control`, `content-type`, `pragma`만 허용하고 NYSE policy는 `accept`,
`cache-control`, `pragma`만 허용한다.

| Exchange | `requestHeaderPolicyVersion` | Official entry point |
| --- | --- | --- |
| KRX | `krx_market_closing_holiday_request_headers.v1` | `https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp` |
| KRX | `krx_regular_session_request_headers.v1` | `https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T1.jsp` |
| KRX | `krx_2016_session_extension_brochure_request_headers.v1` | `https://global.krx.co.kr/contents/GLB/01/0107/0107010000/20170630_eng_brochure.pdf` |
| NYSE | `nyse_trade_hours_calendars_request_headers.v1` | `https://www.nyse.com/trade/hours-calendars` |

Allowed name은 실제 request에 모두 전송해야 하는 목록이 아니라 source별 상한이다.
`officialMarketCalendarRedirectChainBoundary.ts`는 recorded version을 registry에서
exact resolve하고 initial exchange/requested URL과 모든 recorded effective request
header name이 allowed-name 상한 안에 있는지 결합한다. 실제 HTTP client에서
effective request header name을 관찰하는 wiring은 아직 없다. Recorded `accept`와
`accept-language` name은 같은 effective request의 `representationHeaders` own
canonical safe-ASCII field value를 반드시 가져야 하고, 모든 representation key도 recorded header name에
존재해야 한다. `representationHeaders` key는 representation category인 `accept`와
`accept-language`만 허용하며 cache 또는 request-body header를 representation
value로 중복 기록하면 거부한다. 사전 등록과 redirect-chain 결합만으로 source acquisition,
historical coverage 또는 readiness 통과를 주장하지 않는다. 등록 밖 header가
필요하면 기존 version을 변경하지 않고 별도 검토와 새 version 등록 전까지
acquisition을 거부한다.

Recorded `accept` value는 non-empty canonical media-range list여야 한다. 각
media range는 `type/subtype`, `type/*` 또는 `*/*`이고 parameter는 명시적인
`name=value` pair여야 한다. Media range별 `q` weight는 최대 하나이며 unquoted
0부터 1까지의 값과 최대 세 자리 소수만 허용한다. 같은 media range를 ASCII case-insensitive하게 중복
기록할 수 없고, media range 안에서도 case-insensitive parameter name을 중복 기록할 수 없으며 `q` 뒤에
parameter를 기록할 수 없다. Malformed, 빈 값 또는 중복 media range를 가진
`accept` value는 source request를 보내기 전에 fail-closed로 거부한다. 모든 representation field value는
정규식 검증 비용을 제한하기 위해 8,192 character 상한을 가진다.

Recorded `accept-language` value도 non-empty canonical language-range list여야
한다. 각 range는 `*` 또는 1~8개 ASCII letter로 시작하고 각 1~8개 ASCII
alphanumeric subtag를 hyphen으로 연결한다. Range별 optional `q` weight는
`accept`와 같은 unquoted 0부터 1까지의 값과 최대 세 자리 소수만 허용한다.
같은 language range를 ASCII case-insensitive하게 중복 기록할 수 없다.
Malformed, 빈 값 또는 중복 range를 가진 `accept-language` value는 source request
전에 fail-closed로 거부한다. 실제 HTTP client 관찰 wiring은 아직 구현하지 않는다.

KRX current trading page는 regular close를 15:30으로 표시하고, KRX 2016
brochure는 2016-08-01부터 regular session을 30분 연장했다고 기록한다. 따라서
대상 기간의 KRX regular close는 단일 값이 아니며, 2016-08-01 이전 15:00과
이후 15:30을 date-effective regime으로 분리해야 한다. 실제 regime boundary와
각 값은 해당 official source document hash에 결합한다.

## Acquisition Package

Source adapter를 구현하기 전에 exchange별 acquisition package를 gitignored
local path에 보존한다.

```text
tmp/official-market-calendar-source/<acquisition-id>/
├── krx/
│   ├── collection-manifest.json
│   └── documents/
│       └── <document-id>/
│           ├── source.bin
│           └── metadata.json
└── nyse/
    ├── collection-manifest.json
    └── documents/
        └── <document-id>/
            ├── source.bin
            └── metadata.json
```

`source.bin`은 parser가 읽은 exact response bytes 또는 official download
file이다. Browser에서 복사한 표, screenshot OCR, 검색 engine snippet과
수동 재작성 JSON은 source document로 인정하지 않는다.

`metadata.json`은 다음 필드를 가져야 한다.

| 필드 | 기준 |
| --- | --- |
| `documentId` | Collection 안에서 unique한 stable document identity |
| `exchange` | `KRX` 또는 `NYSE` |
| `publisher` | Official page에서 확인한 publisher name |
| `requestMethod` | Uppercase HTTP method |
| `requestedUrl` | 최초 요청한 official URL |
| `requestParameters` | Query/form parameter의 key와 value를 canonical key 순서로 기록한 secret-free object |
| `requestBodyContentType` | Request body media type 또는 body가 없으면 `null` |
| `requestBodyHash` | 전송한 exact request body bytes의 `sha256:<hex>` 또는 body가 없으면 `null` |
| `requestHeaderPolicyVersion` | Credential-free effective request header allowlist version |
| `requestHeaderNames` | 실제 initial request에 전송한 header name의 lowercase canonical 목록 |
| `representationHeaders` | `Accept`, locale 등 response representation에 영향을 주는 allowlisted header를 canonical safe-ASCII field value로 보존한 object |
| `finalUrl` | redirect 이후 실제 응답 URL |
| `redirectPolicyVersion` | Redirect follow와 method/body/header 전환 규칙의 version |
| `redirectChain` | 최초 요청부터 final response까지 verifier가 정규화한 composite redirect-chain projection. 각 child array가 hop 순서의 URL, 실제 전송 method, canonical parameters, body content type/hash, effective request header names, safe representation/cache header values와 response 관찰을 보존하며 metadata open 시 전체 boundary를 다시 검증 |
| `retrievedAt` | explicit timezone offset을 포함한 실제 retrieval 시각 |
| `cacheRequestPolicyVersion` | Revalidation/bypass request와 response cache metadata 검증 policy version |
| `responseDate` | Final response의 strict HTTP `Date` timestamp |
| `responseAgeSeconds` | Final response `Age`의 non-negative integer 또는 header가 없으면 `null` |
| `responseCacheControl` | Final response `Cache-Control`의 canonical directive 목록 또는 header가 없으면 `null` |
| `effectiveResponseAt` | `retrievedAt`에서 conservative effective cache age를 뺀 freshness 기준 시각 |
| `freshnessPolicyVersion` | 등록 후 변경하지 않는 source/coverage별 freshness policy identity |
| `freshnessPolicyDefinition` | Source/coverage selector, expiry derivation rule과 parameters를 포함한 canonical policy definition |
| `freshnessPolicyHash` | policy definition의 canonical `sha256:<hex>` |
| `staleAfter` | `effectiveResponseAt`과 등록된 policy에서 결정론적으로 계산한 effective expiry |
| `httpStatus` | 성공 response status |
| `httpProtocolVersion` | Final response에서 실제 negotiated된 `http_1_0`, `http_1_1`, `http_2` 또는 `http_3` |
| `contentType` | response header의 media type |
| `contentRange` | Final response `Content-Range` header의 canonical value 또는 header가 없으면 `null`; accepted evidence는 `null`만 허용 |
| `contentEncoding` | `Content-Encoding` 값 또는 encoding이 없으면 `null` |
| `transferFraming` | `content_length`, `chunked` 또는 HTTP/2/3 `stream_end`. HTTP/1.x `connection_close`는 accepted evidence에서 금지 |
| `declaredContentLength` | Server `Content-Length`의 non-negative byte count 또는 header가 없으면 `null` |
| `transferCompleted` | HTTP client가 framing별 정상 end-of-message를 확인한 경우에만 `true` |
| `contentLength` | 저장한 exact byte length |
| `sourceDocumentHash` | exact bytes의 `sha256:<hex>` |
| `evidenceRoles` | `holiday_rows`, `session_hours`, `special_closure` 등 원문이 직접 뒷받침하는 역할 |
| `rowCoverageStartDate` / `rowCoverageEndDate` | 실제 parsed exception row의 첫/마지막 date, row가 없거나 rule-only 문서는 `null` |
| `scheduleCoverageIntervals` | Source가 exception schedule의 완전성을 직접 주장하는 `coverageRole`, start/end date 목록. Completeness를 주장하지 않는 role은 entry가 없으며 role/start/end 순서로 canonical 정렬 |
| `applicabilityStartDate` / `applicabilityEndDate` | Rule이 직접 명시하는 effective interval, open-ended end는 `null` |
| `parserContractVersion` | source format adapter contract version |

Metadata 값은 실제 response와 parser 결과에서 계산한다. File name, local
수정 시각, page title 또는 URL만으로 provenance를 인정하지 않는다.
Top-level request field와 `requestHeaderNames`는 `redirectChain` 첫 entry와 같고
`finalUrl`, `httpStatus`, `httpProtocolVersion`, `contentRange`, `responseDate`,
`responseAgeSeconds`, `responseCacheControl`은 마지막 entry의 해당 response 값과
같아야 한다. Acquisition client는
opaque automatic redirect follow를 사용하지 않고 각 response와 다음 effective
request를 관찰 가능하게 기록한다. 301/302/303 이후 POST가 GET으로 바뀌거나
body/header가 제거되면 변경된 실제 method, `null` body hash와 effective
headers를 다음 entry에 기록하며 최초 요청 정보에서 추론하지 않는다.

현재 `officialMarketCalendarSourceDocumentEnvelope.ts`는 verified acquisition
freshness/redirect boundary, exact source bytes와 document identity를 immutable
pre-metadata envelope로 결합한다. Creation과 stored parse 모두 transfer content length와
exact byte length/hash를 다시 검증하고 raw bytes 또는 caller-supplied publisher/content
metadata를 output에 포함하지 않는다. 이 envelope는 source parser 결과를 collection
document metadata로 승격하거나 filesystem package를 publish하지 않는다.

Final response의 representation metadata는
`officialMarketCalendarResponseRepresentationHeaders.ts`가 raw header value에서
검증한다. `Content-Type`은 single parameter-free media type으로 canonical lowercase
정규화하고 `Content-Encoding`은 absent 또는 single `gzip`/`deflate`/`br`만 허용한다.
이 boundary는 final-response verifier의 필수 child이며 decode, parser selection 또는
parser-contract별 representation allowlist는 수행하지 않는다.

`officialMarketCalendarSourceDocumentAcquisitionMetadata.ts`는 verified envelope 하나만 입력받아
request/final-response/cache/freshness/representation/transfer field와 registry-bound
expected coverage/parser selector를 재구성한다. `publisher`는 verified exchange의 canonical
identity인 `KRX` 또는 `NYSE`로 파생하고 full envelope를 acquisition metadata hash에 포함해 raw
redirect/acquisition boundary를 보존한다. Top-level `redirectChain`은 raw input이 아닌
verifier가 정규화한 composite projection을 노출하고 `cacheRequestPolicyVersion`은 verified initial
cache request policy에서 파생한다. Stored parse는 exact source bytes와 freshness
policy registry로 전체 aggregate를 다시 생성한다. Registry selector는
`expectedEvidenceRoles`, expected row/schedule/applicability coverage와
`expectedParserContractVersion`으로만 기록하고 `parserResultBound=false`를 강제한다.
따라서 이 pre-parser aggregate는 final `metadata.json`이 아니며 actual `evidenceRoles`,
row coverage, parsed session-hours와 `metadataHash`는 verified parser result 결합 전에는
생성하지 않는다.

Parser identity는 `officialMarketCalendarSourceParserContract.ts`의 immutable strict
definition/registry로 별도 관리한다. Definition은 exchange, canonical parameter-free
accepted content type 목록, absent를 `null`로 포함할 수 있는 canonical accepted content
encoding 목록과 parser output schema version만 가진다. Registry entry는 definition hash를
검증하며 duplicate/unregistered version과 recorded mismatch를 거부한다. Executable path,
parser code 또는 raw command는 contract 입력이 아니다. 실제 KRX/NYSE source format과
representation을 확인하기 전에는 production parser entry를 등록하지 않는다.

`officialMarketCalendarSourceRepresentationDecodeBoundary.ts`는 registry에서 exact
resolve한 parser contract의 representation allowlist를 적용한 뒤 absent, gzip, deflate,
br encoding을 명시적으로 decode한다. Encoded/decoded byte length와 hash, parser contract
entry, versioned 64 MiB expansion limit을 immutable boundary에 결합하고 stored open도 exact
encoded bytes로 전체 boundary를 다시 생성한다. Decoded bytes는 metadata에 저장하지 않고
process-local parser input으로만 반환한다. 이 pure representation boundary를 verified
acquisition metadata와 결합하는 책임은 별도 parser-input binding이 담당하며 parser
result 생성은 후속 경계이다.

`officialMarketCalendarSourceParserInputBinding.ts`는 verified acquisition metadata의
expected parser version과 registry-resolved contract를 exact match하고 acquisition의
exchange, content type/encoding, source hash/length를 decoded representation boundary와
결합한다. Full acquisition metadata, decode boundary, parser output schema identity와
decoded byte hash/length는 immutable parser-input binding hash에 포함한다. Stored open은
freshness registry와 exact encoded bytes로 acquisition부터 decode까지 전체 chain을 다시
검증하며 decoded bytes는 process-local parser input으로만 반환한다. Parser 실행과 verified
result 결합은 별도 parser-result contract가 담당하고 production parser 실행은 후속 단계이다.

`officialMarketCalendarSourceParserResult.ts`는 parser-specific adapter output을 strict
canonical contract로 받고 parser-input binding과 결합한다. Parsed row는 unique ascending
exchange-date와 canonical evidence role/field ordering을 가져야 하며 row coverage는 실제
첫/마지막 row에서 파생한다. Evidence roles는 row roles, parsed regular session hours와
schedule coverage role에서 파생하고 acquisition metadata의 expected coverage selector와
exact match해야 한다. Parser output/result hash는 full input binding과 함께 고정하며 stored
parse는 acquisition부터 parser input까지 다시 연다. Production source-specific parser와
final document metadata 승격은 각각 별도 adapter와 metadata 모듈이 담당한다.

`officialMarketCalendarSourceDocumentMetadata.ts`는 verified parser result를 final
`official_market_calendar_source_document_metadata.v1` aggregate로 승격한다. Pre-parser
expected selector는 flat final projection에서 제거하고 actual evidence/row/schedule/
applicability/session-hours claim을 노출한다. Full acquisition metadata와 parser result는
nested provenance로 보존하며 request/freshness/representation field, parser hashes와 함께
`metadataHash`에 결합한다. Stored parse는 exact source bytes와 freshness/parser registry로
acquisition부터 result까지 전체 chain을 다시 생성한다. Collection document projection은
별도 projection 모듈이 담당하며 production source-specific parser는 후속 단계이다.

`officialMarketCalendarSourceCollectionDocumentProjection.ts`는 final document metadata를
기존 source collection document strict schema로 projection한다. Exchange, full metadata와
projected document를 immutable projection hash에 결합하고 metadata/source-document hash,
actual evidence roles, regular session hours, schedule/applicability claim은 caller 입력 없이
final metadata에서만 파생한다. Stored parse는 exact source bytes와 registries로 전체 chain을
다시 생성하며 collection aggregate 결합은 별도 assembly 모듈이 담당한다.

`officialMarketCalendarSourceCollectionAssembly.ts`는 canonical collection plan과 verified
document projection 목록을 결합해 source collection payload와 `collectionHash`를 생성한다.
Plan은 documents/collectionHash를 직접 공급할 수 없고 projection document ID와
per-document exact byte map은 unique canonical exact coverage여야 한다. 모든 projection을
bytes와 registries로 다시 연 뒤 existing collection strict schema를 적용하며 exchange,
full projection 목록과 source collection은 immutable assembly hash에 결합한다. Production
source-specific parser와 filesystem publication은 별도 후속 단계이다.

`officialMarketCalendarEvidenceArtifactV2.ts`는 KRX/NYSE collection assembly를 canonical
순서로 다시 열고 complete session set, open-session provenance와 session-hours exception을
`official_market_calendar_evidence.v2` payload에 결합한다. Full projection이 final document
metadata와 nested acquisition/parser provenance를 보존하고 `sourceArchiveBindings`의
composite ref, package-relative path, source hash와 length는 caller 입력 없이 metadata에서
파생한다. Artifact 생성 시 모든 source에 `retrievedAt <= generatedAt < staleAfter`를
적용하고 stored parse는 exact bytes와 registry로 전체 payload/hash를 재생성한다.
Filesystem package writer, durability sync, coordinator activation/recovery와 reader-time
freshness gate는 별도 후속 단계이다.

`officialMarketCalendarPublicationPackagePlan.ts`는 verified v2 artifact와 canonical exact
sidecar set을 다시 검증해 canonical `artifact.json` bytes의 hash/length, source archive
file descriptor, hash-derived package path와 publication record/path를 하나의 immutable
plan hash에 결합한다. Plan field는 caller가 공급하지 않으며 stored parse도 artifact와
sidecar에서 전체 plan을 재생성한다. 실제 filesystem write, directory/file sync,
atomic no-replace publication과 coordinator activation은 후속 단계이다.

Acquisition client는 credential provider, proxy credential, HTTP auth handler와
client certificate를 구성하지 않는다. 각 effective request를 전송하기 전에
versioned strict header-name allowlist와 대조하고 실제 lowercase header name
목록을 redirect entry에 기록한다. `Authorization`, `Proxy-Authorization`,
`Cookie`, API-key header 또는 allowlist 밖 header가 하나라도 있으면 값을
metadata에 저장하지 않고 acquisition 자체를 거부한다. URL userinfo와 secret-bearing
request parameter도 허용하지 않는다.
Acquisition client는 transparent content decoding을 비활성화하고 HTTP transfer
framing을 제거한 뒤 Content-Encoding을 적용하기 전의 exact message content
octets를 `source.bin`으로 저장한다. Parser는 recorded `contentEncoding`을 strict
contract로 검증한 뒤 명시적으로 decode한다. `transferCompleted`는 declared
length 수신 완료, terminal chunk 또는 HTTP/2/3 end-of-stream을 client가 확인한
경우에만 `true`이다. HTTP/1.x close-delimited response는 정상 EOF와 premature
FIN을 구분할 수 없으므로 parser 결과나 저장 후 hash와 무관하게 거부한다.
Protocol/framing 조합은 다음만 허용한다.

- `http_1_0`: `content_length`
- `http_1_1`: `content_length` 또는 `chunked`
- `http_2`, `http_3`: `stream_end`

Unknown protocol, HTTP/1.x `stream_end`, HTTP/1.0 `chunked` 또는 HTTP/2/3의
HTTP/1.x framing label은 fail-closed로 거부한다. HTTP/2/3 response에
`Content-Length`가 있어도 transfer completion은 `stream_end`로 기록하고 declared
length는 저장 bytes와 별도로 교차검증한다.

Initial request와 모든 redirect effective request는 canonical cache revalidation
header인 `Cache-Control: no-cache, no-store, max-age=0`과 `Pragma: no-cache`를
전송하고 conditional `If-None-Match`/`If-Modified-Since`를 보내지 않는다. Final
response의 `Date`는
필수이며 strict HTTP date로 parse하고 `retrievedAt`보다 늦으면 거부한다. `Age`는
없거나 single non-negative decimal integer여야 하며 duplicate, negative 또는
invalid value를 거부한다. 다음 값을 canonical metadata에 포함한다.

```text
apparentAgeSeconds = max(0, floor(retrievedAt - responseDate))
effectiveCacheAgeSeconds = max(apparentAgeSeconds, responseAgeSeconds ?? 0)
effectiveResponseAt = retrievedAt - effectiveCacheAgeSeconds
```

Freshness policy는 download 완료 시각이 아니라 `effectiveResponseAt`에서
`staleAfter`를 계산한다. Cache revalidation request, response `Date`/`Age`와
cache-control metadata field가 누락되거나 boundary와 다르면 accepted evidence로
승격하지 않는다. Response `Cache-Control` header 부재는 field를 생략하지 않고
canonical `null`로 기록한다.

Acquisition client는 최초 요청과 redirect effective request에 `Range` 또는
`If-Range` header를 전송하지 않고 automatic segmented/range retry를 사용하지
않는다. Final response는 exact `200`이어야 하고 `Content-Range`가 없어야 한다.
`206 Partial Content`, multipart byte ranges와 여러 partial response의 assembly는
지원하지 않으며, parser가 valid row boundary를 만들거나 partial bytes의 hash가
일치해도 accepted evidence로 승격하지 않는다.

Acquisition client는 cookie jar/store를 비활성화하고 최초 요청과 모든 redirect
effective request에 `Cookie` header를 전송하지 않는다. Response의 `Set-Cookie`를
후속 hop에 replay하지 않는다. Source acquisition에 cookie, secret 또는
authenticated session이 필요하면 public official evidence source로 자동
승격하지 않고 blocker로 남긴다. 실제 effective request에 `Cookie` 또는 다른
credential header가 존재한 acquisition은 값의 공개 여부와 무관하게 거부한다.

Exception completeness는 `holiday_schedule`, `special_closure_schedule`,
`session_hours_exception_schedule` coverage role별로 독립 검증한다. 하나의
document가 여러 role의 completeness를 직접 주장할 수 있지만 한 role의
coverage가 다른 role을 대신하지 않는다. Row coverage는 실제로 나온 sparse
exception row의 범위만 나타내며 schedule completeness를 대신하지 않는다.
Source가 특정 role의 schedule coverage를 직접 뒷받침하지 않으면 해당 role의
unlisted weekday를 exception 없음으로 해석하지 않는다.
한 document가 role마다 서로 다른 기간의 completeness를 주장하면
`scheduleCoverageIntervals`에 role별 interval을 별도로 기록한다. 같은 role의
복수 interval은 겹치거나 인접한 구간을 canonical merge한 뒤 저장하며, 다른
role의 더 넓은 interval로 좁은 role의 coverage를 확장하지 않는다.
`session_hours`처럼 rule을 주장하는 document는 source가 직접 뒷받침하는
applicability interval을 가져야 한다. Source가 end date를 명시하지 않으면
document metadata의 `applicabilityEndDate`는 `null`로 보존하며 후속 문서의
retrieval/publication date로 원문 값을 덮어쓰지 않는다. 하나의 document가 두
역할을 모두 가지면 schedule coverage와 rule applicability를 독립적으로 기록한다.

후속 accepted `session_hours` document set이 같은 exchange의 replacement full
regular hours와 `replacementEffectiveStartDate`를 함께 뒷받침하면 manifest의
`regularSessionSupersessions`가 이전 open-ended rule을 종료할 수 있다. 각 record는
`supersessionId`, superseded/replacement `documentIds`, replacement effective
start와 그 전 calendar date인 `derivedSupersededEndDate`를 canonical하게
보존한다. Superseded document는 직전 날짜를 source-declared applicability로
덮어야 하고 replacement document set은 effective start를 덮어야 한다. Effective
start, replacement hours 또는 대상 rule이 모호하거나 같은 boundary에 복수
replacement가 있으면 supersession을 추론하지 않고 overlap blocker를 유지한다.

각 `regularSessionRegime`의 `documentIds`는 `session_hours` evidence role을
가진 accepted document만 참조해야 한다. 모든 referenced document의
applicability interval은 regime의 전체 effective interval을 합쳐서 덮어야 하며
gap 또는 ambiguous overlap을 허용하지 않는다. Regime의 local open/close는
해당 interval에 대해 source에서 parsed한 session-hours 값과 정확히 같아야 한다.
Holiday 또는 special-closure 역할만 가진 document, regime interval을 덮지 않는
document나 서로 다른 open/close를 주장하는 document로 regime을 accepted
처리하지 않는다.

`collection-manifest.json`은 exchange별 accepted document를 하나의 검증
단위로 결합하며 다음 필드를 가져야 한다.

| 필드 | 기준 |
| --- | --- |
| `schemaVersion` | `official_market_calendar_source_collection.v1` |
| `collectionId` | Exchange와 acquisition을 식별하는 stable identity |
| `exchange` | `KRX` 또는 `NYSE` |
| `coverageStartDate` / `coverageEndDate` | Collection이 설명하는 전체 date range |
| `documents` | Canonical `documentId` 순서의 metadata hash와 `sourceDocumentHash` 목록 |
| `requiredExceptionCoverageRoles` | Versioned exchange contract가 target interval에 요구하는 exception coverage role 목록 |
| `exceptionScheduleIntervals` | `coverageRole`, start/end date와 근거 `documentIds`를 role/date/document 순서로 결합한 interval 목록 |
| `regularSessionRegimes` | `regimeId`, effective start/end date, local open/close, 근거 `documentIds` |
| `regularSessionSupersessions` | Official replacement effective date로 open-ended prior rule을 종료한 provenance-backed boundary 목록 |
| `collectionHash` | `collectionHash`를 제외한 canonical manifest payload hash |

Manifest hash가 각 원문 hash를 대체하지 않는다. Collection verification은
manifest hash와 모든 referenced metadata/source byte hash를 함께 검증한다.
Collection manifest 내부 `documentIds`는 해당 manifest의 `exchange`와
`collectionId` scope에서만 해석한다. Combined artifact의 session-level
provenance는 해당 session을 뒷받침한 `(exchange, collectionId, documentId)`
`SourceDocumentRef` 목록과 date-effective `regimeId`를 보존해야 한다. Local
`documentId` 단독 값을 artifact-level key로 사용하지 않는다.

## Source Acceptance

Exchange source는 다음 조건을 모두 충족해야 accepted 상태가 된다.

1. `requestedUrl`, `finalUrl`과 모든 redirect entry의 host가 exchange official
   domain allowlist에 속한다.
2. Requested URL, final URL과 모든 redirect hop이 `https:`이며 platform trust
   store 기반 certificate chain과 hostname 검증을 통과한다. Insecure TLS
   option, certificate verification bypass와 protocol downgrade를 허용하지
   않는다.
3. `redirectPolicyVersion`이 등록된 정책이고 각 response `Location`이 다음
   entry URL과 일치하며 모든 hop의 실제 method, parameters, body hash와
   effective header names, safe representation/cache header가 metadata와 일치한다.
   모든 request는 registered credential-free header allowlist를 통과하고 cache
   revalidation header를 포함해야 한다. Opaque auto-follow 결과는 accepted
   evidence로 사용하지 않는다.
4. Final HTTP response status가 exact `200`이고 `contentRange`가 `null`이며
   redirect loop 또는 authentication page가 아니다. 모든 effective request에
   `Range`, `If-Range`와 credential header가 없어야 한다. Final `Date`/`Age`는
   strict cache policy를 통과하고 top-level cache metadata가 final redirect
   entry와 일치해야 한다.
5. `transferCompleted`가 `true`이고 recorded `transferFraming`이 실제 protocol
    completion과 protocol/framing allowlist에 일치한다. Top-level
    `httpProtocolVersion`은 final redirect entry의 negotiated protocol과 같아야
    한다. `declaredContentLength`가 있으면 저장한 exact message content octets의
    `contentLength`와 같아야 한다. HTTP/1.x `connection_close` framing은 허용하지
    않는다.
6. 저장한 byte length와 metadata의 `contentLength`가 일치한다.
7. exact bytes에서 다시 계산한 hash가 `sourceDocumentHash`와 일치한다.
8. Top-level request/final response field가 redirect chain의 first/last entry와
   일치하고 final entry response bytes가 저장한 `source.bin`이다.
9. Parser가 unknown column, duplicate date, invalid date 또는 ambiguous session
   type을 만나면 fail-closed로 중단한다.
10. Parsed row coverage, role-keyed `scheduleCoverageIntervals`와 rule
    applicability가 `evidenceRoles`별 source claim과 일치한다. Manifest의 각
    `exceptionScheduleInterval`은 referenced document metadata의 동일
    `coverageRole` interval union 안에 완전히 포함되어야 한다.
11. 2013-01-01부터 2026-05-31까지 필요한 exchange-date를 official source
   collection이 빠짐없이 설명한다.
12. Validated `regularSessionSupersession`을 적용한 effective regime 기준으로
    같은 exchange-date의 session type 또는 timestamp가 충돌하지 않는다. Raw
    open-ended claim의 overlap을 document 순서나 선택으로 임의 해소하지 않는다.
13. Manifest의 document 목록, metadata hash, source byte hash와
   `collectionHash`가 모두 재계산 값과 일치한다.
14. `regularSessionRegimes`가 gap이나 overlap 없이 대상 기간을 덮는다. 각
    regime은 `session_hours` 역할을 가진 accepted official document만 참조하고,
    referenced applicability interval이 regime 전체를 덮으며, regime의 local
    open/close가 해당 interval에서 parsed한 source 값과 정확히 일치한다.
15. `requiredExceptionCoverageRoles`가 versioned exchange contract와 일치한다.
    각 required role의 `exceptionScheduleIntervals`가 target range를 독립적으로
    gap이나 ambiguous overlap 없이 덮고 accepted completeness document를
    참조한다. 한 role의 interval로 다른 role의 gap을 채우지 않는다.

Official archive가 여러 문서로 나뉘면 각 document를 별도 acquisition
record로 보존하고 collection manifest가 모든 원문 hash를 결합한다. 가장
최근 문서의 규칙을 과거 날짜에 소급하지 않는다.

## Evidence Contract 선행 변경

현재 `official_market_calendar_evidence.v1`은 exchange별 source 하나,
source별 `regularSession` 하나와 session별 `sourceId` 하나만 허용한다.
따라서 여러 archive document와 date-effective regular-session regime을
손실 없이 표현할 수 없다.

Source adapter 구현 전에 evidence contract는 다음 정보를 strict schema와
canonical hash에 포함하도록 revision해야 한다.

- Exchange source의 `sourceCollectionHash`
- Canonical collection manifest와 collection에 포함된 모든 document metadata
- 모든 document identity, metadata hash와 source document hash
- Date-effective `regularSessionRegimes`
- Provenance-backed `regularSessionSupersessions`와 derived prior end boundary
- Versioned `requiredExceptionCoverageRoles`
- Coverage role별 source-backed `exceptionScheduleIntervals`
- Date-specific, source-backed `sessionHoursExceptions`
- `early_close`의 close override와 `delayed_open`의 open/close override
- 각 session의 근거 composite `SourceDocumentRef` 목록
- Open session이 참조한 `regularSessionRegimeId`
- Non-regular open session이 참조한 `sessionHoursExceptionId`
- `delayed_open` session type
- Session date에 effective한 regime 또는 hours exception으로 open/close를
  검증하는 validator
- 모든 reader open에서 explicit `asOf`로 document별 freshness를 다시 검증하는
  coordinator gate
- `buildEvidenceExpansionCanonicalTradingDates()`와
  `calculateAdjacencyTradingDayGap()`의 open-session allowlist에 `delayed_open`을
  포함하는 downstream migration
- `validation-role-regime-evidence-expansion-preflight-plan.md`의 canonical
  trading-date 계약을 `regular`, `early_close`, `delayed_open`으로 맞추는 문서
  migration

Contract revision은 v1 artifact를 암묵적으로 재해석하지 않는다. Schema
version을 명시적으로 올리고 writer, parser, projection, canonical trading-date
builder, pairwise adjacency calculator, preflight 계약 문서와 회귀 테스트를 함께
갱신해야 한다. `delayed_open`이 canonical trading date와 pairwise trading-day
gap 양쪽에서 open session으로 유지되는 테스트를 포함한다. 이 변경이 완료되기
전에는 source adapter가 calendar session row를 생성하지 않는다.

Revised durable artifact는 `sourceCollectionHash`만 저장하지 않는다. Canonical
collection manifest와 referenced document metadata의 request method/URL,
retrieval time, canonical freshness policy definition/version/hash와 derived
expiry, evidence roles, row/schedule/applicability interval, metadata hash와 source
byte hash를 payload 안에 포함한다. Exclusive writer는 이 metadata를 session
evidence와 같은 artifact에 기록해야 하며, gitignored acquisition package나
policy registry가 없어도 provenance와 expiry derivation을 재현할 수 있어야 한다.
Policy identity, definition 또는 derived expiry가 달라지면 canonical artifact
payload와 `artifactHash`도 달라져야 한다.

Exact source bytes도 gitignored acquisition package에만 남기지 않는다.
Revised exclusive writer는 다음 immutable package를 publish해야 한다.

```text
<output-root>/official-market-calendar-evidence-package.v2/
├── sha256/
│   └── <artifact-sha256-hex>/
│       ├── artifact.json
│       └── sources/
│           └── sha256/
│               └── <source-document-sha256>.bin
└── published/
    └── sha256/
        └── <artifact-sha256-hex>.json
```

Accepted acquisition metadata와 verified parser result는 final document metadata의
nested provenance로 publish 과정에서 변경하지 않는다. `metadataHash`는 자기 hash와
`archivePath`가 없는 canonical final document metadata payload 전체를 식별하고
`collectionHash`도 이 metadata hash와 source document hash로 계산한다. Pre-parser
`acquisitionMetadataHash`는 acquisition boundary만 식별하며 collection document
identity로 사용하지 않는다. Revised artifact는 `artifactHash`를 제외한 canonical artifact
payload의 SHA-256인 `artifactHash`를 가지며 package directory 이름의
`<artifact-sha256-hex>`와 정확히 일치해야 한다.

Freshness 재획득이나 source collection 변경으로 canonical artifact payload가
바뀌면 새 `artifactHash` directory에 publish한다. 이전 immutable package는
그대로 보존하며 fixed package directory, mutable `latest` directory 또는 기존
package 교체로 새 evidence를 게시하지 않는다. Reader는 선택한 explicit
`artifactHash` 또는 별도 검증된 catalog reference로 package를 연다.

`published/sha256/<artifact-sha256-hex>.json`은 package와 분리된 immutable
publication record이다. Record는 schema version, `artifactHash`, package-relative
path와 자기 hash field를 제외한 canonical record SHA-256인
`publicationRecordHash`를 가진다. Record 존재는 acceptance의 필요조건일 뿐
충분조건이 아니다. Deterministic backend의 `PublicationCoordinator`만 package
selection을 소유하며 process-local `verifiedPublicationSet`에 포함된
`artifactHash`만 freshness 검증 후보로 삼는다. Set membership은 package/record의
구조적 검증과 durability만 의미하며 현재 시각 freshness를 보증하지 않는다. Raw
filesystem path 또는 publication record scan으로 package를 직접 여는 reader
surface는 금지한다.

현재 `officialMarketCalendarPublicationRecord.ts`는 record schema와 canonical hash,
artifact hash에서 파생되는 immutable package/record path를 strict 검증한다. 이 contract는
filesystem writer, directory/file sync, atomic no-replace publication,
`PublicationCoordinator` activation 또는 recovery를 수행하지 않는다.

Coordinator는 writer와 reader 사이에 exclusive publication state lock을
사용하고 package 및 record의 모든 sync가 성공한 뒤에만 hash를 verified set에
추가한다. 어떤 sync failure에서도 추가하지 않으므로 rename 후 record가 보여도
reader는 quarantined 상태로 거부한다. Process start 시 set은 항상 empty이며,
visible package나 record를 자동 활성화하지 않는다.

Idempotent explicit recovery는 다음 두 상태를 구분한다. Package와 record가 모두
있으면 두 object의 canonical hash/path, sidecar와 ancestor durability를 다시
검증하고 필요한 directory sync와 audit를 완료한 뒤에만 활성화한다. Hash-addressed package는
완전하지만 record가 없으면 coordinator lock 아래 artifact, canonical
`artifactHash`, package path, 모든 metadata/binding/sidecar byte hash와 length 및
package tree를 전부 재검증한다. 검증된 populated package directory와 package
parent를 bottom-up 다시 `fsync`한 후에만 package에서 deterministic publication
record를 재구성하고 writer-owned staging file sync, record hash 검증, atomic
no-replace rename과 record parent `fsync` 순서로 missing record를 생성한다. 기존
package를 rewrite하거나 rename하지 않는다.

Orphan recovery 중 concurrent record가 먼저 나타나면 expected canonical record와
hash/path가 정확히 같은 경우에만 기존 record를 재검증하고 계속하며, 다르면
collision으로 거부한다. Incomplete package, unreferenced/missing sidecar 또는 hash
불일치는 record를 생성하지 않고 blocker로 유지한다. 성공 시
`publication_record_recovered` audit event를 남긴 뒤 verified set에 추가한다.
Writer retry가 existing package destination을 만나도 자동 성공 처리하지 않고,
동일 requested `artifactHash`의 record 누락 상태에만 이 recovery로 전환한다.

모든 reader open은 explicit timezone offset을 가진 `asOf`를 필수 입력으로 받아
coordinator를 호출한다. Coordinator는 read handle을 반환하기 직전에 artifact의
모든 referenced document에 `retrievedAt <= asOf < staleAfter`를 다시 적용한다.
Activation/recovery 시각 또는 artifact `generatedAt` 검증 결과를 캐시해 이
read-time gate를 생략하지 않는다. 한 document라도 `asOf < retrievedAt`이면
handle을 fail-closed로 거부하고 `source_not_yet_retrieved` audit을 남기되 구조적
set membership은 변경하지 않는다. `asOf`가 어느 document의 `staleAfter`와
같거나 늦으면 해당 read를 거부하고 `publication_freshness_rejected` audit에
`artifactHash`, `asOf`와 expired `SourceDocumentRef`를 기록하되 구조적 set
membership은 변경하지 않는다. Explicit `asOf` 요청은 시간 순서가 보장되지
않으므로 stale request가 이후 valid historical request의 결과를 바꾸지 않아야
한다. 검증된 handle은 해당 explicit `asOf`에만 결합되며 후속 replay는 새 open과
freshness 검증을 수행해야 한다.

Package-relative path는 revised artifact의 별도
`sourceArchiveBindings`에 둔다. 각 binding은 `exchange`, `collectionId`,
`documentId`로 구성한 `SourceDocumentRef`, `archivePath`, `sourceDocumentHash`와
`contentLength`를 가지며 artifact canonical hash에 포함된다. Binding은
exchange/collection/document 순서로 canonical 정렬하고 full composite key가
unique해야 한다. Ref의 collection manifest와 metadata가 존재하고 exchange 및
local document identity가 모두 일치해야 한다. `archivePath`는
`sources/sha256/<hex>.bin` 형식만 허용하고 path traversal과 package 밖 reference를
거부한다. Parser/auditor는 binding과 sidecar bytes의 length/hash를 다시 계산한
뒤에만 source parser를 재실행할 수 있다.

여러 document metadata가 같은 exact bytes를 참조하면 동일 `archivePath`를
공유할 수 있다. Shared binding은 `sourceDocumentHash`와 `contentLength`가
모두 같아야 한다. 같은 path를 다른 hash/length에 연결하는 conflicting
reuse만 거부한다.

Package writer는 existing output root를 덮어쓰지 않는다. Version, package hash와
publication-record namespace는 publication 전에 durable 상태여야 한다. Writer가
새 ancestor directory를 만들면 한 level씩 생성하고 새 directory와 그 parent를
`fsync`해 이미 durable한 `output-root`까지 모든 새 directory entry를 sync한다.
이 과정이 실패하면 package publication을 시작하지 않는다.

Artifact hash namespace의 같은 parent에 writer-owned staging directory를 만들고
artifact와 모든 sidecar를 기록한 뒤 각 file을 durable flush하고
byte/hash/metadata/path cross-check를 완료한다. 그 다음 populated nested
directory에서 staging package root 방향으로 `sources/sha256`, `sources`와 모든
중간 directory 및 staging root를 bottom-up `fsync`해 각 file/subdirectory entry를
durable하게 만든다. 어느 file 또는 staging directory sync라도 실패하면 publish를
시작하지 않는다. 검증된 `artifactHash`에서 destination을 계산해 package root로
atomic no-replace publish한다. Platform의 no-replace primitive는 같은
artifact identity의 destination이 existing empty directory이거나 concurrent
writer가 먼저 생성한 경우에도 실패해야 한다. Preflight existence check,
일반 POSIX `rename` 또는 cooperative lock만으로 no-replace를 주장하지 않는다.
Atomic no-replace를 지원하거나 동등하게 보장할 수 없는 platform에서는
publish를 fail-closed로 중단한다.

Package no-replace 성공 후 immediate parent를 `fsync`한다. 이 sync가 성공한
뒤에만 publication record를 writer-owned staging file에 기록하고 file sync,
record hash 검증, atomic no-replace rename과 record parent `fsync` 순서로
publish한다. Record parent sync가 성공한 뒤 coordinator가 verified set을
갱신하고 lock을 해제하며, 그 뒤에만 publish 완료를 반환한다. Package parent
sync, record rename 또는 record parent sync가 실패하면 verified set을 갱신하지
않는다. Record가 final path에 보이는 실패도 reader에는 quarantined이며 explicit
recovery 전에는 accepted 상태로 재사용하지 않는다.

POSIX sync failure는 성공으로 축소하지 않는다. Windows에서 directory sync가
`EPERM`으로 지원되지 않는 경우는 platform-specific compatibility 상태와
테스트를 명시하고 POSIX durability 완료로 주장하지 않는다. Package publish
이전 실패는 writer-owned staging만 정리한다. 이미 publish된 package,
publication record 또는 unrelated path는 어떤 실패에서도 변경하지 않는다.
Artifact는 누락 sidecar, conflicting archive path reuse, hash/path 불일치 또는
unreferenced sidecar가 있으면 fail-closed로 거부한다.

## Session 생성 기준

Ingestion adapter는 accepted source row에서 다음 값만 생성할 수 있다.

- `regular`: source가 regular session임을 직접 나타내거나 모든
  `requiredExceptionCoverageRoles`의 source-backed interval이 해당 exchange/date를
  덮고 어떤 role에도 exception row가 없는 weekday로 결정론적으로 확인된
  거래일이며, session date에 effective한 `regularSessionRegimeId`의 open/close를
  사용
- `early_close`: official source가 해당 날짜와 close time을 명시한 session
- `delayed_open`: official source가 해당 날짜의 delayed open과 실제 close를
  명시하고 `sessionHoursExceptionId`로 provenance를 결합한 open session
- `holiday`: official source가 holiday로 명시한 날짜
- `special_closure`: 정규 holiday rule 외 exchange closure를 official
  announcement가 명시한 날짜
- `weekend`: Gregorian calendar에서 토요일 또는 일요일인 날짜

Open/close timestamp는 `Asia/Seoul` 또는 `America/New_York` timezone으로
계산한다. NYSE offset을 상수로 두지 않고 해당 session date의 DST를
적용한다. Date-effective `regularSessionRegime`은 해당 날짜 open/close의
기본값이다. Accepted provenance와 coverage 검증을 통과한 canonical
`sessionHoursException`이 있으면 그 날짜에만 field-level override를 먼저
적용한 뒤 effective session hours를 계산한다.

`regular`은 exception이 없고 date-effective regime과 정확히 일치해야 한다.
`early_close`는 exception의 close override를 사용하고 open은 effective
regime open을 유지한다. `delayed_open`은 exception의 실제 open/close
override를 모두 사용하며 open이 regular open보다 늦어야 한다. 각
non-regular open session은 `sessionHoursExceptionId`를 참조해야 한다. Delayed
open을 regular session으로 축소하거나 close time을 regime에서 추정하지
않는다.

## Freshness 기준

`retrievedAt`은 실제 source transfer 완료 시각이고 `effectiveResponseAt`은 final
response `Date`/`Age`에서 계산한 conservative freshness 기준 시각이다.
`freshnessPolicyVersion`과 `freshnessPolicyHash`는 source update cadence와 대상
coverage의 완결성을 구분하는 등록된 immutable policy를 식별한다. Canonical
`freshnessPolicyDefinition`도 artifact에 보존해 registry 없이 hash와 expiry를
재계산할 수 있어야 한다. `staleAfter`는 이 policy와 `effectiveResponseAt`에서
결정론적으로 계산하고 document metadata, revised canonical artifact와
`artifactHash`에 결합한다. 실행 시각의 별도 입력이나 download 완료 시각으로
expiry를 교체하지 않는다.

### Freshness Policy Contract

Freshness policy는 acquisition 결과를 본 뒤 선택하는 TTL 설정이 아니다. Source
document를 accepted evidence로 평가하기 전에 registry에 immutable entry로
등록하고, metadata는 등록된 entry의 version, canonical definition과 hash를
그대로 보존해야 한다. V1 definition은 다음 strict shape를 사용한다.

```typescript
type OfficialCalendarSourceEvidenceRole =
  | "holiday_rows"
  | "holiday_schedule"
  | "session_hours"
  | "session_hours_exception_schedule"
  | "special_closure"
  | "special_closure_schedule";

type OfficialCalendarExceptionCoverageRole =
  | "holiday_schedule"
  | "session_hours_exception_schedule"
  | "special_closure_schedule";

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

type CanonicalJsonObject = { [key: string]: CanonicalJsonValue };

interface OfficialMarketCalendarFreshnessPolicyDefinitionV1 {
  schemaVersion: "official_market_calendar_freshness_policy_definition.v1";
  sourceSelector: {
    exchange: "KRX" | "NYSE";
    requestMethod: string;
    requestedUrl: string;
    requestParameters: CanonicalJsonObject;
    requestBodyContentType: string | null;
    requestBodyHash: Sha256Hash | null;
    representationHeaders: CanonicalJsonObject;
    parserContractVersion: string;
  };
  coverageSelector: {
    evidenceRoles: OfficialCalendarSourceEvidenceRole[];
    rowCoverageStartDate: string | null;
    rowCoverageEndDate: string | null;
    scheduleCoverageIntervals: Array<{
      coverageRole: OfficialCalendarExceptionCoverageRole;
      startDate: string;
      endDate: string;
    }>;
    applicabilityStartDate: string | null;
    applicabilityEndDate: string | null;
  };
  expiryRule: {
    type: "fixed_duration_from_effective_response";
    durationSeconds: number;
  };
}
```

`sourceSelector`는 actual request와 parser contract에서 관찰하거나 사전 고정한
값만 사용한다. Redirect 이후 `finalUrl`, response header, retrieval 시각,
`documentId`, local path와 source byte hash는 selector가 아니다. 같은 official
entry point라도 request parameter, request body, representation header 또는 parser
contract가 다르면 별도 definition을 등록한다. URL은 HTTPS boundary가 승인한 canonical
serialization이어야 하고 request method와 parameter/header object는 acquisition
metadata의 canonical 값과 exact match해야 한다. Body가 없으면
`requestBodyContentType`과 `requestBodyHash`가 모두 `null`이어야 한다. Body가
있으면 두 field가 모두 non-null이어야 하고 actual media type 및 exact request
body bytes의 hash와 일치해야 한다. 한 field만 `null`인 selector나 metadata는
거부한다.

`coverageSelector`는 document가 직접 주장하는 coverage를 선택한다.
`evidenceRoles`는 canonical unique 순서여야 하며 row coverage start/end는 둘 다
`null`이거나 둘 다 existing calendar date여야 한다. Non-null
`rowCoverageStartDate`는 `rowCoverageEndDate` 이후일 수 없다. Schedule interval은
`coverageRole`, `startDate`, `endDate` 순서의 canonical unique list이고 각 start는
end 이후일 수 없다. Applicability start가 `null`이면 end도 `null`이어야 하며,
start가 있으면 end는 `null`인 open-ended claim 또는 start 이상인 existing date만
허용한다. Metadata의 coverage claim과 selector가 exact match하지 않으면 broad
role, overlapping interval 또는 exchange-level default policy로 fallback하지 않는다.

Registry entry는 다음 세 값을 하나의 immutable record로 관리한다.

```typescript
interface OfficialMarketCalendarFreshnessPolicyRegistryEntryV1 {
  freshnessPolicyVersion: string;
  freshnessPolicyDefinition: OfficialMarketCalendarFreshnessPolicyDefinitionV1;
  freshnessPolicyHash: Sha256Hash;
}
```

`freshnessPolicyVersion`은 registered ASCII identifier grammar를 사용하며 registry
안에서 unique하다. 이미 등록된 version의 definition 또는 hash를 in-place로
변경하지 않는다. Definition 변경은 새 version과 새 hash를 사용한다.
`Sha256Hash`는 project의 lowercase `sha256:<64 hex>` strict schema를 사용한다.
`freshnessPolicyHash`는 기존 `createReplayResearchHash()` canonical JSON 규칙으로
definition 전체만 hash한 값이다. Version이나 recorded hash 자체는 hash input에
넣지 않는다. Acquisition metadata의 version으로 registry entry를 exact lookup한
뒤 recorded definition과 hash를 registry 값 및 재계산 hash와 각각 비교한다.

V1 expiry rule은 하나만 허용한다.

```text
policyExpiry = effectiveResponseAt + durationSeconds * 1,000 milliseconds
staleAfter = canonicalUtcMilliseconds(policyExpiry)
```

`durationSeconds`는 0보다 큰 safe integer여야 한다. `effectiveResponseAt`은 검증된
final-response freshness 결과에서만 가져오며 별도 caller timestamp를 허용하지
않는다. Millisecond 연산이 finite exact integer가 아니거나 JavaScript Date 범위를
벗어나면 fail-closed로 거부한다. Recorded `staleAfter`는 canonical UTC millisecond
format이어야 하며 재계산 값과 exact match해야 한다. Response `Cache-Control`은
provenance로 보존하지만 `durationSeconds`를 자동 생성하거나 늘리는 입력으로
사용하지 않는다.

다음 validation matrix를 구현 contract로 고정한다.

| 입력 또는 상태 | 결과 |
| --- | --- |
| Registry에 없는 `freshnessPolicyVersion` | reject |
| Registry definition과 recorded definition 불일치 | reject |
| Recomputed hash와 registry/recorded hash 불일치 | reject |
| Source 또는 coverage selector exact mismatch | reject |
| Request body content type/hash pair 누락 또는 actual request mismatch | reject |
| Row coverage start/end pair 누락 또는 reversed range | reject |
| Unknown definition field, role, rule type 또는 non-canonical 배열 | reject |
| `durationSeconds`가 0, 음수, 소수, unsafe integer | reject |
| Expiry overflow 또는 non-canonical `staleAfter` | reject |
| Recorded `staleAfter`와 derived expiry 불일치 | reject |
| 같은 immutable entry와 같은 `effectiveResponseAt` | 동일한 `staleAfter` 반환 |

첫 구현 PR은 definition과 registry entry의 strict parser, canonical hash 검증까지만
다룬다. 다음 PR에서 `effectiveResponseAt` 기반 expiry derivation을 추가하고, 그
다음 final-response/acquisition metadata에 결합한다. Registry에 넣을 실제
source별 duration 값은 source update cadence와 coverage 완결성 근거를 별도 문서
PR로 사전 등록하기 전까지 추가하지 않는다.

다음 처리는 금지한다.

- 코드 내부 default TTL로 `staleAfter` 자동 생성
- artifact `generatedAt`을 통과시키기 위한 임의 연장
- stale source를 새 hash 없이 재사용
- 과거 archive의 불변성과 최신 future calendar freshness를 같은 주장으로
  취급

Freshness policy가 등록되지 않았거나 policy hash가 registry definition과
일치하지 않거나 cache metadata/effective response age가 재계산 값과 다르거나
recorded `staleAfter`가 결정론적 재계산 값과 다르거나 artifact `generatedAt`이
freshness window 밖이면 ingestion은 artifact를 생성하지 않는다.
Publication 이후 reader도 기존 `official_market_calendar_evidence.v1`의 `asOf`
gate를 유지한다. Explicit `asOf`가 없거나 offset이 없거나 document
`retrievedAt <= asOf < staleAfter`를 하나라도 만족하지 않으면 package를 열지
않는다.

## Cross-Source Verification

KRX와 NYSE source는 독립적으로 검증한 뒤 하나의 canonical payload로
결합한다.

- KRX source가 NYSE date를 설명하거나 반대 exchange date를 대신하지 않는다.
- 각 exchange는 coverage의 모든 calendar date에 정확히 한 session을 가진다.
- Weekend row는 공식 holiday row와 중복 생성하지 않는다.
- 검증된 canonical `sessionHoursException`의 field-level override는 regular
  hours와 다르다는 이유만으로 conflict로 처리하지 않고 해당 날짜에만
  deterministic precedence를 가진다.
- 같은 exchange/date의 official exception document가 서로 다른 session type,
  override field 또는 timestamp를 주장하면 source conflict로 중단한다.
- 결합된 payload는 existing strict contract와 canonical hash 검증을
  통과해야 한다.
- 검증된 artifact만 existing exclusive writer와 legacy projection에
  전달한다.

## Fail-Closed Blocker

다음 중 하나라도 해당하면 actual official calendar artifact를 생성하지
않는다.

- KRX dynamic request 또는 download format 미확인
- NYSE 2013부터 2025까지의 first-party archive 미확보
- Multi-document collection과 date-effective session regime을 표현하는
  evidence contract revision 미구현
- 대상 기간 일부의 official source provenance 누락
- raw source bytes 또는 metadata 누락
- Durable package의 source byte sidecar 누락 또는 hash/length 불일치
- Artifact-level `SourceDocumentRef` qualifier 누락, unknown composite ref 또는
  binding의 exchange/collection/document identity 불일치
- Artifact canonical hash와 package hash directory 불일치
- HTTP message framing 미완료 또는 declared/stored content length 불일치
- Negotiated HTTP protocol version 누락/불일치 또는 protocol/framing 조합 위반
- Final status가 `200`이 아니거나 `Content-Range`, outbound `Range` 또는
  `If-Range`가 존재한 acquisition
- Cache revalidation header, response `Date`/`Age`, effective cache age 또는
  `effectiveResponseAt` 누락·불일치
- HTTP/1.x `connection_close` framing 또는 outbound credential header가 존재한
  acquisition
- Durable namespace ancestor sync 실패
- Staging file 또는 populated nested directory의 publication 전 sync 실패
- Publication record 누락, hash/path 불일치 또는 record parent sync 실패
- `PublicationCoordinator` verified activation 누락
- Reader open의 explicit `asOf` 누락/형식 오류 또는 document별 read-time
  freshness 실패
- HTTPS/certificate 검증 실패, redirect downgrade 또는 insecure TLS option
- redirect policy 또는 hop별 effective method, parameter, body hash,
  representation header 누락/불일치
- source hash, byte length, coverage 불일치
- Evidence role과 row coverage/applicability interval 불일치
- Document의 role-keyed schedule coverage 누락/충돌 또는 manifest interval의
  동일 role metadata coverage 이탈
- Regular-session regime의 `session_hours` role, applicability coverage 또는
  parsed open/close binding 불일치
- Open-ended session-hours rule의 supersession 근거 누락·모호성 또는 derived
  boundary 불일치
- Required exception coverage role 누락, role별 schedule gap/overlap 또는
  source-backed completeness 누락
- duplicate date, conflicting exception/session 또는 unknown source format
- Target interval의 delayed-open source 또는 `sessionHoursExceptions`
  provenance 누락
- Atomic no-replace publish primitive 미지원 또는 destination collision
- freshness policy identity/hash/derived expiry 누락·불일치 또는 stale source

이 상태에서는 `official_exchange` readiness에 대해
`OFFICIAL_CALENDAR_EVIDENCE_MISSING`과 `DEPENDENCY_INPUT_INCOMPLETE` blocker를
유지한다. Observed market snapshot, Official Toss Open API response, 제3자
calendar package, 국가 공휴일 library 또는 수동 holiday list로 KRX/NYSE
first-party evidence를 대체하지 않는다.

이 blocker는 credential 없이 가능한 `official_broker_observed` 문서, strict
contract, synthetic parser/normalization test, provenance/hash와 coverage gate의
독립 구현을 막지 않는다. 다만 Toss response를 실제 replay input 후보로
승격하려면 requested date/market, request path/query, retrieval timestamp, response
hash/byte length, source/API version, stale policy와 requested/returned coverage를
검증해야 한다. Unsupported date, partial response, schema mismatch, provenance 누락,
stale source 또는 coverage 불명확성은 fail-closed로 거부한다.

## 검증 계획

먼저 evidence contract revision PR에서 multi-document collection,
date-effective regular-session regime과 session-level document provenance를
구현한다. 그 다음 source adapter PR은 exchange 하나와 source format 하나만
다룬다. 각 adapter는 checked-in synthetic fixture와 byte-level parser test를
가져야 하며 실제 downloaded source는 commit하지 않는다.

필수 test case:

- known official response fixture의 deterministic parse
- unknown field 또는 format drift reject
- duplicate/conflicting date reject
- declared coverage gap reject
- source byte hash mismatch reject
- truncated Content-Length, missing terminal chunk와 reset stream reject
- declared/stored content length 및 transfer completion 독립 검증
- Final/redirect negotiated protocol version 보존과 top-level boundary 일치 검증
- HTTP/1.0, HTTP/1.1, HTTP/2/3 framing allowlist 및 mismatch reject
- Final exact 200과 absent `Content-Range` 검증, 206/multipart range reject
- Initial/redirect `Range`·`If-Range`와 automatic partial assembly reject
- Partial bytes가 valid row boundary와 일치하는 hash를 가져도 reject
- Revalidation cache request header와 final/redirect `Date`·`Age` boundary 검증
- Cached 200의 apparent/header age 중 큰 값으로 `effectiveResponseAt`과
  `staleAfter`를 계산하고 current download time 기반 extension reject
- Missing/future `Date`, duplicate/negative/invalid `Age`와 cache metadata mismatch reject
- HTTP/1.x close-delimited response가 valid row boundary에서 끝나도 reject
- recorded Content-Encoding의 explicit decode와 unknown encoding reject
- redirect hop별 effective method/parameter/body/header mismatch reject
- Initial/redirect strict header-name allowlist와 canonical effective name 검증
- Credential provider/proxy auth/client certificate 비활성화와 outbound
  `Authorization`, `Proxy-Authorization`, `Cookie`, API-key 또는 unknown header reject
- POST 301/302/303 redirect의 GET 전환과 body 제거 provenance 검증
- top-level first request/final response와 redirect chain 경계 mismatch reject
- non-HTTPS URL, redirect downgrade와 certificate validation failure reject
- evidence role과 row coverage/applicability mismatch reject
- sparse exception row와 source-backed schedule coverage 분리 검증
- 한 document의 role별 서로 다른 schedule coverage interval 보존과 canonical
  merge 검증
- manifest exception interval이 referenced document의 동일 role coverage를
  벗어나거나 다른 role coverage를 차용하면 reject
- required exception role 목록 mismatch와 role별 interval gap/overlap reject
- holiday coverage만으로 special-closure/session-hours role gap을 채우지 않음
- collection manifest 또는 referenced document hash mismatch reject
- durable artifact에서 canonical manifest/document metadata 누락 reject
- durable source sidecar 누락, mutation 또는 unreferenced file reject
- archive path traversal, conflicting path reuse와 hash/path mismatch reject
- KRX와 NYSE collection이 같은 local `documentId`를 서로 다른 bytes에 사용해도
  composite `SourceDocumentRef`로 각각 정확히 binding
- Unqualified `documentId`, duplicate/unknown composite ref 또는 ref와
  collection metadata identity mismatch reject
- identical source bytes의 shared sidecar binding 허용
- final document `metadataHash`/`collectionHash`와 artifact archive binding hash 분리
- freshness/source 변경 artifact의 distinct hash directory 공존
- freshness policy version/hash 또는 derived `staleAfter` 변경 시 distinct
  canonical artifact hash와 재계산 mismatch reject
- 같은 process에서 expiry 전 open 성공 후 exact `staleAfter` 또는 이후 open은
  해당 read만 reject하고 freshness audit을 남기며 structural set은 유지
- Stale `asOf` reject 뒤 valid historical `asOf` open이 성공해 request order와
  무관한 결과를 유지
- 여러 document 중 하나만 expired이거나 `asOf < retrievedAt`이어도 package 전체
  reject하고 후속 replay가 cached activation을 재사용하지 않음
- artifact hash와 package directory identity mismatch reject
- 동일 artifact identity 재게시 destination collision reject
- first publication의 newly created ancestor sync failure 처리
- artifact/sidecar file sync 후 populated staging directory를 bottom-up sync하지
  않거나 nested directory sync가 실패하면 publication 미실행
- existing empty package와 concurrent destination 생성 시 no-replace reject
- atomic no-replace 미지원 platform reject와 staging failure cleanup
- package parent sync failure 시 publication record 미생성 및 reader quarantine
- Record staging/rename 실패 뒤 valid orphan package에서 deterministic missing
  record만 no-replace로 복구하고 audit 후 활성화
- Orphan package incomplete/hash mismatch와 concurrent conflicting record reject
- record rename 성공 후 parent sync failure 시 verified set 미등록 및 reader reject
- process restart 시 empty verified set과 explicit recovery activation 검증
- publication record hash/path/no-replace/parent sync와 recovery audit 검증
- regular-session regime gap/overlap reject
- source-declared open end 보존과 provenance-backed supersession boundary 검증
- KRX 2016 transition에서 prior 15:00 regime은 2016-07-31에 종료되고 replacement
  15:30 regime은 official effective date인 2016-08-01에 시작하는 회귀 검증
- replacement effective date/hours 누락, 복수 replacement 또는 retrieval date
  기반 boundary 추론 reject
- regime document의 `session_hours` role 누락, applicability gap/overlap 또는
  parsed open/close 불일치 reject
- session date와 effective regime mismatch reject
- validated exception의 field-level precedence와 unaffected regime field 검증
- 같은 exchange/date의 exception type 또는 override timestamp conflict reject
- delayed-open exception provenance와 actual open/close 검증
- `delayed_open`이 canonical trading-date hash와 pairwise adjacency gap에
  포함되고 holiday, special closure와 weekend는 제외되는 downstream 회귀 검증
- timezone/DST open-close conversion
- existing output 보존

두 exchange adapter와 full coverage source collection이 모두 준비되기 전에는
combined ingestion CLI, actual artifact 생성 또는 baseline replay 재생성을
시작하지 않는다.

## Non-Goals

- KRX/NYSE official source 다운로드 또는 local artifact 생성
- Official Toss Open API network transport, OAuth credential 또는 response bytes 취득
- KRX dynamic endpoint 추측 구현
- NYSE historical archive를 third-party source로 대체
- Ingestion adapter, combined CLI 또는 runtime 연결 구현
- Baseline/expansion source, replay, readiness 또는 preflight 실행
- 특정 종목 추천, 투자 조언 또는 수익 보장
- Live order, broker mutation, natural language order, raw `codex exec`, raw
  `tossctl`, `place_order` surface 추가
- Deterministic backend 또는 Risk Engine 우회

AI는 source evidence 정리만 지원하며 calendar acceptance와 후속 gate는
deterministic backend가 담당한다.
