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
| `retrievedAt` | explicit timezone offset을 포함한 실제 retrieval 시각 |
| `httpStatus` | 성공 response status |
| `contentType` | response header의 media type |
| `contentLength` | 저장한 exact byte length |
| `sourceDocumentHash` | exact bytes의 `sha256:<hex>` |
| `evidenceRoles` | `holiday_rows`, `session_hours`, `special_closure` 등 원문이 직접 뒷받침하는 역할 |
| `rowCoverageStartDate` / `rowCoverageEndDate` | 실제 parsed exception row의 첫/마지막 date, row가 없거나 rule-only 문서는 `null` |
| `scheduleCoverageStartDate` / `scheduleCoverageEndDate` | Source가 exception schedule의 완전성을 직접 주장하는 전체 기간, rule-only 문서는 `null` |
| `applicabilityStartDate` / `applicabilityEndDate` | Rule이 직접 명시하는 effective interval, open-ended end는 `null` |
| `parserContractVersion` | source format adapter contract version |

Metadata 값은 실제 response와 parser 결과에서 계산한다. File name, local
수정 시각, page title 또는 URL만으로 provenance를 인정하지 않는다.
Cookie, authorization header, token과 계정 식별자는 metadata에 저장하지
않는다. Source acquisition에 secret 또는 authenticated session이 필요하면
public official evidence source로 자동 승격하지 않고 blocker로 남긴다.

`holiday_rows` 또는 `special_closure`처럼 exception schedule을 주장하는
document는 source-backed schedule coverage를 가져야 한다. Row coverage는
실제로 나온 sparse exception row의 범위만 나타내며 schedule completeness를
대신하지 않는다. Source가 schedule coverage를 직접 뒷받침하지 않으면 해당
document에서 unlisted weekday를 regular session으로 추론하지 않는다.
`session_hours`처럼 rule을 주장하는 document는 source가 직접 뒷받침하는
applicability interval을 가져야 하며, 새 rule로 대체되는 날짜가 source에
없으면 end를 `null`로 유지한다. 하나의 document가 두 역할을 모두 가지면
schedule coverage와 rule applicability를 독립적으로 기록한다.

`collection-manifest.json`은 exchange별 accepted document를 하나의 검증
단위로 결합하며 다음 필드를 가져야 한다.

| 필드 | 기준 |
| --- | --- |
| `schemaVersion` | `official_market_calendar_source_collection.v1` |
| `collectionId` | Exchange와 acquisition을 식별하는 stable identity |
| `exchange` | `KRX` 또는 `NYSE` |
| `coverageStartDate` / `coverageEndDate` | Collection이 설명하는 전체 date range |
| `documents` | Canonical `documentId` 순서의 metadata hash와 `sourceDocumentHash` 목록 |
| `exceptionScheduleIntervals` | Accepted schedule coverage를 canonical date/document 순서로 결합한 interval 목록 |
| `regularSessionRegimes` | `regimeId`, effective start/end date, local open/close, 근거 `documentIds` |
| `collectionHash` | `collectionHash`를 제외한 canonical manifest payload hash |

Manifest hash가 각 원문 hash를 대체하지 않는다. Collection verification은
manifest hash와 모든 referenced metadata/source byte hash를 함께 검증한다.
Session-level provenance는 해당 session을 뒷받침한 `documentIds`와
date-effective `regimeId`를 보존해야 한다.

## Source Acceptance

Exchange source는 다음 조건을 모두 충족해야 accepted 상태가 된다.

1. `requestedUrl`과 `finalUrl`의 host가 exchange official domain allowlist에
   속한다.
2. HTTP response가 성공이고 redirect loop 또는 authentication page가 아니다.
3. 저장한 byte length와 metadata의 `contentLength`가 일치한다.
4. exact bytes에서 다시 계산한 hash가 `sourceDocumentHash`와 일치한다.
5. Method, canonical request parameter/body hash와 representation header가
   실제 acquisition request와 일치한다.
6. Parser가 unknown column, duplicate date, invalid date 또는 ambiguous session
   type을 만나면 fail-closed로 중단한다.
7. Parsed row coverage, source-backed schedule coverage와 rule applicability가
   `evidenceRoles`별 metadata interval과 일치한다.
8. 2013-01-01부터 2026-05-31까지 필요한 exchange-date를 official source
   collection이 빠짐없이 설명한다.
9. Source collection 사이에 같은 exchange-date의 session type 또는
   timestamp가 충돌하지 않는다.
10. Manifest의 document 목록, metadata hash, source byte hash와
   `collectionHash`가 모두 재계산 값과 일치한다.
11. `regularSessionRegimes`가 gap이나 overlap 없이 대상 기간을 덮고 각
    regime이 하나 이상의 accepted official document를 참조한다.
12. `exceptionScheduleIntervals`가 target range를 gap이나 ambiguous overlap
    없이 덮고 각 interval이 accepted schedule document를 참조한다.

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
- Source-backed `exceptionScheduleIntervals`
- 각 session의 근거 `documentIds`
- Open session이 참조한 `regularSessionRegimeId`
- Session date에 effective한 regime으로 open/close를 검증하는 validator

Contract revision은 v1 artifact를 암묵적으로 재해석하지 않는다. Schema
version을 명시적으로 올리고 writer, parser, projection과 회귀 테스트를 함께
갱신해야 한다. 이 변경이 완료되기 전에는 source adapter가 calendar session
row를 생성하지 않는다.

Revised durable artifact는 `sourceCollectionHash`만 저장하지 않는다. Canonical
collection manifest와 referenced document metadata의 request method/URL,
retrieval time, evidence roles, row/schedule/applicability interval, metadata
hash와 source byte hash를 payload 안에 포함한다. Exclusive writer는 이
metadata를 session evidence와 같은 artifact에 기록해야 하며, gitignored
acquisition package가 삭제돼도 provenance interpretation이 가능해야 한다.

## Session 생성 기준

Ingestion adapter는 accepted source row에서 다음 값만 생성할 수 있다.

- `regular`: source가 regular session임을 직접 나타내거나 accepted holiday
  collection의 source-backed exception schedule interval 안에서 unlisted
  weekday로 결정론적으로 확인된 거래일이며, session date에 effective한
  `regularSessionRegimeId`의 open/close를 사용
- `early_close`: official source가 해당 날짜와 close time을 명시한 session
- `holiday`: official source가 holiday로 명시한 날짜
- `special_closure`: 정규 holiday rule 외 exchange closure를 official
  announcement가 명시한 날짜
- `weekend`: Gregorian calendar에서 토요일 또는 일요일인 날짜

Open/close timestamp는 `Asia/Seoul` 또는 `America/New_York` timezone으로
계산한다. NYSE offset을 상수로 두지 않고 해당 session date의 DST를
적용한다. Source가 delayed open만 제공하고 현재
`official_market_calendar_evidence.v1` contract로 표현할 수 없으면 regular
session으로 축소하지 않고 ingestion blocker로 보고한다.

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
- Official exception과 regular-session rule이 충돌하면 exception을 자동
  우선하지 않고 source conflict로 중단한다.
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
- dynamic request method, parameter, body hash 또는 representation header 누락
- source hash, byte length, coverage 불일치
- Evidence role과 row coverage/applicability interval 불일치
- Exception schedule coverage gap 또는 source-backed completeness 누락
- duplicate date, conflicting session 또는 unknown source format
- delayed open 등 current contract가 손실 없이 표현하지 못하는 session
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
- canonical request method/parameter/body/header mismatch reject
- evidence role과 row coverage/applicability mismatch reject
- sparse exception row와 source-backed schedule coverage 분리 검증
- exception schedule interval gap/overlap reject
- collection manifest 또는 referenced document hash mismatch reject
- durable artifact에서 canonical manifest/document metadata 누락 reject
- regular-session regime gap/overlap reject
- session date와 effective regime mismatch reject
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
