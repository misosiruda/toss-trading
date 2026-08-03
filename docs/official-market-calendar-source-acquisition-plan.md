# Official Market Calendar Source Acquisition 계획

## 목적

이 문서는 `official_market_calendar_evidence.v1` ingestion 구현 전에 KRX와
NYSE official source document를 어떤 증거로 확보하고 검증할지 고정한다.

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
| `representationHeaders` | `Accept`, locale 등 response representation에 영향을 주는 allowlisted header의 canonical object |
| `finalUrl` | redirect 이후 실제 응답 URL |
| `redirectPolicyVersion` | Redirect follow와 method/body/header 전환 규칙의 version |
| `redirectChain` | 최초 요청부터 final response까지 각 hop의 URL, 실제 전송 method, canonical parameters, body content type/hash, representation headers, response status와 `Location`을 순서대로 기록 |
| `retrievedAt` | explicit timezone offset을 포함한 실제 retrieval 시각 |
| `httpStatus` | 성공 response status |
| `contentType` | response header의 media type |
| `contentEncoding` | `Content-Encoding` 값 또는 encoding이 없으면 `null` |
| `transferFraming` | `content_length`, `chunked`, `stream_end` 또는 `connection_close` |
| `declaredContentLength` | Server `Content-Length`의 non-negative byte count 또는 header가 없으면 `null` |
| `transferCompleted` | HTTP client가 framing별 정상 end-of-message를 확인한 경우에만 `true` |
| `contentLength` | 저장한 exact byte length |
| `sourceDocumentHash` | exact bytes의 `sha256:<hex>` |
| `evidenceRoles` | `holiday_rows`, `session_hours`, `special_closure` 등 원문이 직접 뒷받침하는 역할 |
| `rowCoverageStartDate` / `rowCoverageEndDate` | 실제 parsed exception row의 첫/마지막 date, row가 없거나 rule-only 문서는 `null` |
| `scheduleCoverageStartDate` / `scheduleCoverageEndDate` | Source가 exception schedule의 완전성을 직접 주장하는 전체 기간, rule-only 문서는 `null` |
| `applicabilityStartDate` / `applicabilityEndDate` | Rule이 직접 명시하는 effective interval, open-ended end는 `null` |
| `parserContractVersion` | source format adapter contract version |

Metadata 값은 실제 response와 parser 결과에서 계산한다. File name, local
수정 시각, page title 또는 URL만으로 provenance를 인정하지 않는다.
Top-level request field는 `redirectChain` 첫 entry와 같고 `finalUrl`,
`httpStatus`는 마지막 entry의 URL/status와 같아야 한다. Acquisition client는
opaque automatic redirect follow를 사용하지 않고 각 response와 다음 effective
request를 관찰 가능하게 기록한다. 301/302/303 이후 POST가 GET으로 바뀌거나
body/header가 제거되면 변경된 실제 method, `null` body hash와 effective
headers를 다음 entry에 기록하며 최초 요청 정보에서 추론하지 않는다.
Acquisition client는 transparent content decoding을 비활성화하고 HTTP transfer
framing을 제거한 뒤 Content-Encoding을 적용하기 전의 exact message content
octets를 `source.bin`으로 저장한다. Parser는 recorded `contentEncoding`을 strict
contract로 검증한 뒤 명시적으로 decode한다. `transferCompleted`는 declared
length 수신 완료, terminal chunk, HTTP/2/3 end-of-stream 또는 정상
close-delimited EOF를 client가 확인한 경우에만 `true`이다.
Cookie, authorization header, token과 계정 식별자는 metadata에 저장하지
않고 각 redirect entry에도 포함하지 않는다. Source acquisition에 secret 또는
authenticated session이 필요하면 public official evidence source로 자동
승격하지 않고 blocker로 남긴다.

Exception completeness는 `holiday_schedule`, `special_closure_schedule`,
`session_hours_exception_schedule` coverage role별로 독립 검증한다. 하나의
document가 여러 role의 completeness를 직접 주장할 수 있지만 한 role의
coverage가 다른 role을 대신하지 않는다. Row coverage는 실제로 나온 sparse
exception row의 범위만 나타내며 schedule completeness를 대신하지 않는다.
Source가 특정 role의 schedule coverage를 직접 뒷받침하지 않으면 해당 role의
unlisted weekday를 exception 없음으로 해석하지 않는다.
`session_hours`처럼 rule을 주장하는 document는 source가 직접 뒷받침하는
applicability interval을 가져야 하며, 새 rule로 대체되는 날짜가 source에
없으면 end를 `null`로 유지한다. 하나의 document가 두 역할을 모두 가지면
schedule coverage와 rule applicability를 독립적으로 기록한다.

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
| `collectionHash` | `collectionHash`를 제외한 canonical manifest payload hash |

Manifest hash가 각 원문 hash를 대체하지 않는다. Collection verification은
manifest hash와 모든 referenced metadata/source byte hash를 함께 검증한다.
Session-level provenance는 해당 session을 뒷받침한 `documentIds`와
date-effective `regimeId`를 보존해야 한다.

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
   representation header가 metadata와 일치한다. Opaque auto-follow 결과는
   accepted evidence로 사용하지 않는다.
4. Final HTTP response가 성공이고 redirect loop 또는 authentication page가
   아니다.
5. `transferCompleted`가 `true`이고 recorded `transferFraming`이 실제 protocol
   completion과 일치한다. `declaredContentLength`가 있으면 저장한 exact
   message content octets의 `contentLength`와 같아야 한다.
6. 저장한 byte length와 metadata의 `contentLength`가 일치한다.
7. exact bytes에서 다시 계산한 hash가 `sourceDocumentHash`와 일치한다.
8. Top-level request/final response field가 redirect chain의 first/last entry와
   일치하고 final entry response bytes가 저장한 `source.bin`이다.
9. Parser가 unknown column, duplicate date, invalid date 또는 ambiguous session
   type을 만나면 fail-closed로 중단한다.
10. Parsed row coverage, source-backed schedule coverage와 rule applicability가
   `evidenceRoles`별 metadata interval과 일치한다.
11. 2013-01-01부터 2026-05-31까지 필요한 exchange-date를 official source
   collection이 빠짐없이 설명한다.
12. Source collection 사이에 같은 exchange-date의 session type 또는
   timestamp가 충돌하지 않는다.
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
- Versioned `requiredExceptionCoverageRoles`
- Coverage role별 source-backed `exceptionScheduleIntervals`
- Date-specific, source-backed `sessionHoursExceptions`
- `early_close`의 close override와 `delayed_open`의 open/close override
- 각 session의 근거 `documentIds`
- Open session이 참조한 `regularSessionRegimeId`
- Non-regular open session이 참조한 `sessionHoursExceptionId`
- `delayed_open` session type
- Session date에 effective한 regime 또는 hours exception으로 open/close를
  검증하는 validator
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
retrieval time, evidence roles, row/schedule/applicability interval, metadata
hash와 source byte hash를 payload 안에 포함한다. Exclusive writer는 이
metadata를 session evidence와 같은 artifact에 기록해야 하며, gitignored
acquisition package가 삭제돼도 provenance interpretation이 가능해야 한다.

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

Accepted acquisition metadata는 publish 과정에서 변경하지 않는다.
`metadataHash`는 `archivePath`가 없는 canonical acquisition metadata만
식별하고 `collectionHash`도 이 metadata hash와 source document hash로
계산한다. Revised artifact는 `artifactHash`를 제외한 canonical artifact
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
`artifactHash`만 reader에 제공한다. Raw filesystem path 또는 publication record
scan으로 package를 직접 여는 reader surface는 금지한다.

Coordinator는 writer와 reader 사이에 exclusive publication state lock을
사용하고 package 및 record의 모든 sync가 성공한 뒤에만 hash를 verified set에
추가한다. 어떤 sync failure에서도 추가하지 않으므로 rename 후 record가 보여도
reader는 quarantined 상태로 거부한다. Process start 시 set은 항상 empty이며,
visible record를 자동 활성화하지 않는다. Explicit recovery가 package, record,
hash/path, ancestor durability를 다시 검증하고 sync한 뒤 audit event를 남긴
경우에만 현재 process의 set에 추가할 수 있다.

Package-relative path는 revised artifact의 별도
`sourceArchiveBindings`에 둔다. 각 binding은 `documentId`, `archivePath`,
`sourceDocumentHash`와 `contentLength`를 가지며 artifact canonical hash에
포함된다. `archivePath`는 `sources/sha256/<hex>.bin` 형식만 허용하고 path
traversal과 package 밖 reference를 거부한다. Parser/auditor는 binding과
sidecar bytes의 length/hash를 다시 계산한 뒤에만 source parser를 재실행할
수 있다.

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
artifact와 모든 sidecar를 기록한 뒤 durable flush와 byte/hash/metadata/path
cross-check를 완료한다. 검증된 `artifactHash`에서 destination을 계산해 package
root로 atomic no-replace publish한다. Platform의 no-replace primitive는 같은
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

`retrievedAt`은 실제 source retrieval 시각이다. `staleAfter`는 source
update cadence와 대상 coverage의 완결성을 확인한 뒤 별도 실행 입력에서
명시한다.

다음 처리는 금지한다.

- 코드 내부 default TTL로 `staleAfter` 자동 생성
- artifact `generatedAt`을 통과시키기 위한 임의 연장
- stale source를 새 hash 없이 재사용
- 과거 archive의 불변성과 최신 future calendar freshness를 같은 주장으로
  취급

`staleAfter` policy가 등록되지 않았거나 artifact `generatedAt`이 freshness
window 밖이면 ingestion은 artifact를 생성하지 않는다.

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
- Artifact canonical hash와 package hash directory 불일치
- HTTP message framing 미완료 또는 declared/stored content length 불일치
- Durable namespace ancestor sync 실패
- Publication record 누락, hash/path 불일치 또는 record parent sync 실패
- `PublicationCoordinator` verified activation 누락
- HTTPS/certificate 검증 실패, redirect downgrade 또는 insecure TLS option
- redirect policy 또는 hop별 effective method, parameter, body hash,
  representation header 누락/불일치
- source hash, byte length, coverage 불일치
- Evidence role과 row coverage/applicability interval 불일치
- Regular-session regime의 `session_hours` role, applicability coverage 또는
  parsed open/close binding 불일치
- Required exception coverage role 누락, role별 schedule gap/overlap 또는
  source-backed completeness 누락
- duplicate date, conflicting exception/session 또는 unknown source format
- Target interval의 delayed-open source 또는 `sessionHoursExceptions`
  provenance 누락
- Atomic no-replace publish primitive 미지원 또는 destination collision
- freshness policy 미등록 또는 stale source

이 상태에서는 `OFFICIAL_CALENDAR_EVIDENCE_MISSING`과
`DEPENDENCY_INPUT_INCOMPLETE` blocker를 유지한다. Observed market snapshot,
제3자 calendar package, 국가 공휴일 library 또는 수동 holiday list로
official evidence를 대체하지 않는다.

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
- recorded Content-Encoding의 explicit decode와 unknown encoding reject
- redirect hop별 effective method/parameter/body/header mismatch reject
- POST 301/302/303 redirect의 GET 전환과 body 제거 provenance 검증
- top-level first request/final response와 redirect chain 경계 mismatch reject
- non-HTTPS URL, redirect downgrade와 certificate validation failure reject
- evidence role과 row coverage/applicability mismatch reject
- sparse exception row와 source-backed schedule coverage 분리 검증
- required exception role 목록 mismatch와 role별 interval gap/overlap reject
- holiday coverage만으로 special-closure/session-hours role gap을 채우지 않음
- collection manifest 또는 referenced document hash mismatch reject
- durable artifact에서 canonical manifest/document metadata 누락 reject
- durable source sidecar 누락, mutation 또는 unreferenced file reject
- archive path traversal, conflicting path reuse와 hash/path mismatch reject
- identical source bytes의 shared sidecar binding 허용
- acquisition `metadataHash`/`collectionHash`와 artifact archive binding hash 분리
- freshness/source 변경 artifact의 distinct hash directory 공존
- artifact hash와 package directory identity mismatch reject
- 동일 artifact identity 재게시 destination collision reject
- first publication의 newly created ancestor sync failure 처리
- existing empty package와 concurrent destination 생성 시 no-replace reject
- atomic no-replace 미지원 platform reject와 staging failure cleanup
- package parent sync failure 시 publication record 미생성 및 reader quarantine
- record rename 성공 후 parent sync failure 시 verified set 미등록 및 reader reject
- process restart 시 empty verified set과 explicit recovery activation 검증
- publication record hash/path/no-replace/parent sync와 recovery audit 검증
- regular-session regime gap/overlap reject
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

- Official source 다운로드 또는 local artifact 생성
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
