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
| NYSE | `https://www.nyse.com/trade/hours-calendars` | 2026, 2027, 2028 holiday와 scheduled early close | 2013부터 2025까지의 first-party historical archive |

현재 entry point만으로 대상 기간의 complete exchange-date session을 만들 수
없다. KRX dynamic request를 추측하거나 NYSE의 현재 규칙을 과거 기간에
소급 적용하지 않는다.

## Acquisition Package

Source adapter를 구현하기 전에 exchange별 acquisition package를 gitignored
local path에 보존한다.

```text
tmp/official-market-calendar-source/<acquisition-id>/
├── krx/
│   ├── source.bin
│   └── metadata.json
└── nyse/
    ├── source.bin
    └── metadata.json
```

`source.bin`은 parser가 읽은 exact response bytes 또는 official download
file이다. Browser에서 복사한 표, screenshot OCR, 검색 engine snippet과
수동 재작성 JSON은 source document로 인정하지 않는다.

`metadata.json`은 다음 필드를 가져야 한다.

| 필드 | 기준 |
| --- | --- |
| `exchange` | `KRX` 또는 `NYSE` |
| `publisher` | Official page에서 확인한 publisher name |
| `requestedUrl` | 최초 요청한 official URL |
| `finalUrl` | redirect 이후 실제 응답 URL |
| `retrievedAt` | explicit timezone offset을 포함한 실제 retrieval 시각 |
| `httpStatus` | 성공 response status |
| `contentType` | response header의 media type |
| `contentLength` | 저장한 exact byte length |
| `sourceDocumentHash` | exact bytes의 `sha256:<hex>` |
| `coverageStartDate` | source가 직접 제공하는 첫 session date |
| `coverageEndDate` | source가 직접 제공하는 마지막 session date |
| `parserContractVersion` | source format adapter contract version |

Metadata 값은 실제 response와 parser 결과에서 계산한다. File name, local
수정 시각, page title 또는 URL만으로 provenance를 인정하지 않는다.

## Source Acceptance

Exchange source는 다음 조건을 모두 충족해야 accepted 상태가 된다.

1. `requestedUrl`과 `finalUrl`의 host가 exchange official domain allowlist에
   속한다.
2. HTTP response가 성공이고 redirect loop 또는 authentication page가 아니다.
3. 저장한 byte length와 metadata의 `contentLength`가 일치한다.
4. exact bytes에서 다시 계산한 hash가 `sourceDocumentHash`와 일치한다.
5. Parser가 unknown column, duplicate date, invalid date 또는 ambiguous session
   type을 만나면 fail-closed로 중단한다.
6. Parsed coverage가 metadata의 coverage와 일치한다.
7. 2013-01-01부터 2026-05-31까지 필요한 exchange-date를 official source
   collection이 빠짐없이 설명한다.
8. Source collection 사이에 같은 exchange-date의 session type 또는
   timestamp가 충돌하지 않는다.

Official archive가 여러 문서로 나뉘면 각 document를 별도 acquisition
record로 보존한다. Hash 하나로 여러 원문을 대표하거나 가장 최근 문서의
규칙을 과거 날짜에 소급하지 않는다.

## Session 생성 기준

Ingestion adapter는 accepted source row에서 다음 값만 생성할 수 있다.

- `regular`: source가 regular session임을 직접 나타내거나 accepted holiday
  collection과 complete date coverage에서 결정론적으로 확인된 거래일
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
- 대상 기간 일부의 official source provenance 누락
- raw source bytes 또는 metadata 누락
- source hash, byte length, coverage 불일치
- duplicate date, conflicting session 또는 unknown source format
- delayed open 등 current contract가 손실 없이 표현하지 못하는 session
- freshness policy 미등록 또는 stale source

이 상태에서는 `OFFICIAL_CALENDAR_EVIDENCE_MISSING`과
`DEPENDENCY_INPUT_INCOMPLETE` blocker를 유지한다. Observed market snapshot,
제3자 calendar package, 국가 공휴일 library 또는 수동 holiday list로
official evidence를 대체하지 않는다.

## 검증 계획

후속 source adapter PR은 exchange 하나와 source format 하나만 다룬다.
각 adapter는 checked-in synthetic fixture와 byte-level parser test를 가져야
하며 실제 downloaded source는 commit하지 않는다.

필수 test case:

- known official response fixture의 deterministic parse
- unknown field 또는 format drift reject
- duplicate/conflicting date reject
- declared coverage gap reject
- source byte hash mismatch reject
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
