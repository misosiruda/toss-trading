# Replay Calendar And FX Contract

이 문서는 RH2 `Exchange Calendar, Timezone, FX Stale Rule`의 calendar/FX contract와 fixture 기준을 정의한다.

범위는 paper-only historical replay input 정합성이다. 이 문서는 live market open 판단, 실시간 FX feed, broker account balance, 실계좌 currency conversion, live order routing을 추가하지 않는다.

## 현재 상태

현재 구현은 다음 contract를 이미 가진다.

- `HistoricalMarketSnapshot.observedAt`은 ISO-compatible UTC timestamp로 저장된다.
- `HistoricalMarketSnapshot.sourceRefs`는 price source와 Yahoo USD 변환에 사용된 FX date ref를 남길 수 있다.
- `ReplaySessionWindow`는 `startTime`, `endTime`, `timezoneOffsetMinutes`, optional `weekdaysOnly`로 simulated tick을 필터링한다.
- `ReplaySamplingPolicy`는 `timezoneOffsetMinutes`로 daily/weekly decision frequency key를 계산한다.
- `HistoricalMarketPacketBuilder`는 `simulatedAt` 이후 snapshot과 `maxSnapshotAgeSeconds`보다 오래된 snapshot을 제외한다.
- `YahooHistoricalDailyCollector`는 USD snapshot을 KRW로 환산할 때 `yahoo_fx:<symbol>:<date>` source ref를 추가한다.
- `src/replay/marketCalendar.ts`는 calendar fixture parsing, duplicate `exchange + sessionDate` index guard, IANA timezone 기반 local date 계산, session/holiday timestamp classification을 제공한다.
- `src/replay/officialMarketCalendarEvidence.ts`는 `official_market_calendar_evidence.v1` strict contract, KRX/NYSE source provenance, 전체 exchange-date coverage, timezone/DST local session 검증, canonical artifact hash와 `asOf` freshness gate를 제공한다.
- `assessHistoricalDataAvailability()`는 optional `calendarValidation` 입력이 있을 때 window snapshot을 market별 calendar rule과 fixture로 검증하고, 휴장일/fixture 누락/session mismatch/timezone mismatch를 fail-closed issue로 보고한다.
- `historicalReplay` CLI의 `--check-data-availability`와 `--require-data-availability`는 optional `--calendar-fixtures-path`, `--calendar-rule` 입력을 받아 JSON array 또는 JSONL calendar fixture를 availability gate에 연결할 수 있다.
- `runHistoricalBatchReplay()`는 optional `calendarValidation` 입력을 batch run별 availability preflight에 전달하고, calendar issue가 있는 window를 replay 실행 전 `DATA_INSUFFICIENT`로 skip한다.
- `historicalBatchReplay` CLI는 optional `--calendar-fixtures-path`, `--calendar-rule` 입력을 `runHistoricalBatchReplay()`의 run별 availability preflight에 전달한다.
- Batch random/balanced sampler는 `calendarValidation` 입력이 있고 calendar-valid 후보가 하나 이상 있으면 calendar-invalid 후보를 제외한 뒤 deterministic window selection을 수행한다. Calendar-valid 후보가 하나도 없으면 기존 availability preflight가 selected run을 fail-closed skip한다.
- `src/replay/fxSnapshotFreshness.ts`는 `USD/KRW` FX fixture parsing과 price snapshot timestamp 기준 freshness 분류를 제공한다.
- FX fixture가 없으면 `VIRTUAL_FX_MISSING`, price snapshot timestamp가 `staleAfter` 이상이면 `VIRTUAL_FX_STALE`로 fail-closed 후보를 반환한다.
- `assessHistoricalDataAvailability()`는 optional `fxValidation` 입력이 있을 때 window snapshot 중 required market의 `yahoo_fx:<symbol>:<date>` source ref를 FX fixture와 대조하고 missing/stale FX를 fail-closed issue로 보고한다.
- `runHistoricalBatchReplay()`는 optional `fxValidation` 입력을 batch run별 availability preflight에 전달하고, FX issue가 있는 window를 replay 실행 전 `DATA_INSUFFICIENT`로 skip한다.
- `historicalReplay` CLI의 `--check-data-availability`와 `--require-data-availability`는 optional `--fx-fixtures-path`, `--fx-required-market` 입력을 받아 JSON array 또는 JSONL FX fixture를 availability gate에 연결할 수 있다.
- `historicalBatchReplay` CLI는 optional `--fx-fixtures-path`, `--fx-required-market` 입력을 `runHistoricalBatchReplay()`의 run별 availability preflight에 전달한다.
- Batch aggregate report는 run-level `dataAvailability.issues`를 code별 count와 run id 목록으로 집계해 calendar/FX reject issue가 report artifact에 남도록 한다.
- Batch replay preflight에서 calendar/FX issue로 skip된 run은 run storage의 `audit-events.jsonl`에 `HISTORICAL_DATA_AVAILABILITY_REJECTED` audit event를 남긴다.
- Next.js Validation Lab은 stored batch aggregate의 `summary.dataAvailabilityIssues`를 read-only calendar/FX availability warning으로 표시한다.

현재 RH2 calendar/FX runtime contract와 별도로 statistical readiness에 남은 gap은 다음과 같다.

- 실제 KRX/NYSE official source document를 확보하고 publisher, URL, retrieval time, stale policy와 source document hash를 기록해야 한다.
- `official_market_calendar_evidence.v1` artifact를 생성하는 writer 또는 ingestion path는 아직 없다.
- 새 official evidence contract는 기존 observed-session fixture, availability CLI, batch replay 또는 readiness report에 아직 연결되지 않았다.
- 따라서 현재 replay calendar evidence class는 계속 `observed_session_only`이며 official holiday/early-close readiness는 충족되지 않았다.

## Contract 목표

KR/US 혼합 replay에서 다음 값은 deterministic input으로 고정되어야 한다.

| 항목 | 목적 | 기본 처리 |
| --- | --- | --- |
| `exchange` | symbol이 따르는 거래소/session calendar 식별 | fixture에 없으면 warning 또는 fail-closed 후보 |
| `timezone` | local trading date 계산 기준 | IANA timezone string을 fixture source of truth로 사용 |
| `sessionDate` | exchange local date | UTC `observedAt`에서 계산하되 fixture와 불일치하면 경고 |
| `marketOpen` / `marketClose` | session boundary | tick/window validation과 stale 판단의 기준 |
| `holiday` | 휴장일 또는 비거래일 | required sample이면 skip/reject, optional coverage면 warning |
| `fxObservedAt` | 환율 source timestamp | price timestamp 대비 freshness 판단 |
| `fxStaleAfter` | 환율 사용 만료 시각 | 초과하면 `VIRTUAL_FX_STALE` 후보 |

## Calendar Fixture

Fixture는 exchange별 session metadata를 JSONL 또는 JSON array로 저장할 수 있다. 현재 CLI 입력은 두 형식을 모두 받으며, append-only 운영 fixture는 JSONL을 우선한다.

필수 필드:

```json
{
  "calendarId": "calendar.krx.2025-01-02",
  "exchange": "KRX",
  "market": "KR",
  "timezone": "Asia/Seoul",
  "sessionDate": "2025-01-02",
  "marketOpen": "2025-01-02T00:00:00.000Z",
  "marketClose": "2025-01-02T06:30:00.000Z",
  "isHoliday": false,
  "sourceRefs": ["manual_calendar_fixture:KRX:2025-01-02"],
  "createdAt": "2026-07-01T00:00:00.000Z"
}
```

US 예시:

```json
{
  "calendarId": "calendar.nyse.2025-01-02",
  "exchange": "NYSE",
  "market": "US",
  "timezone": "America/New_York",
  "sessionDate": "2025-01-02",
  "marketOpen": "2025-01-02T14:30:00.000Z",
  "marketClose": "2025-01-02T21:00:00.000Z",
  "isHoliday": false,
  "sourceRefs": ["manual_calendar_fixture:NYSE:2025-01-02"],
  "createdAt": "2026-07-01T00:00:00.000Z"
}
```

휴장일 예시:

```json
{
  "calendarId": "calendar.nyse.2025-01-01",
  "exchange": "NYSE",
  "market": "US",
  "timezone": "America/New_York",
  "sessionDate": "2025-01-01",
  "marketOpen": null,
  "marketClose": null,
  "isHoliday": true,
  "holidayName": "New Year holiday fixture",
  "sourceRefs": ["manual_calendar_fixture:NYSE:2025-01-01"],
  "createdAt": "2026-07-01T00:00:00.000Z"
}
```

Validation 기준:

- `market`은 현재 domain `Market` 값인 `KR` 또는 `US`와 맞아야 한다.
- `timezone`은 fixture ingestion 단계에서 allowlist로 제한한다.
- `sessionDate`는 exchange local date 기준 `YYYY-MM-DD`다.
- `isHoliday=true`이면 `marketOpen`과 `marketClose`는 `null`이어야 한다.
- `isHoliday=false`이면 `marketOpen`과 `marketClose`는 유효한 ISO timestamp여야 한다.
- `marketOpen < marketClose`가 성립해야 한다.
- 같은 `exchange + sessionDate` 중복은 fixture validation에서 reject한다.

## Official Calendar Evidence Artifact

`official_market_calendar_evidence.v1`은 기존 실행용 `MarketCalendarFixture`와 분리된 source provenance contract다. 이 artifact는 source를 수집하지 않으며, 입력이 official exchange evidence라고 주장하려면 다음 정보를 모두 제공하도록 강제한다.

```json
{
  "schemaVersion": "official_market_calendar_evidence.v1",
  "mode": "paper_only",
  "purpose": "official_exchange_calendar_evidence",
  "generatedAt": "2025-03-10T22:00:00.000Z",
  "coverage": {
    "startDate": "2025-03-10",
    "endDate": "2025-03-10",
    "exchanges": ["KRX", "NYSE"]
  },
  "sources": [],
  "sessions": [],
  "artifactHash": "sha256:<canonical-payload-hash>"
}
```

Source 필수 provenance:

- `sourceId`
- `evidenceClass="official_exchange"`
- Exchange와 일치하는 `market`, IANA `timezone`
- `publisher`, `sourceUrl`, `sourceDocumentHash`
- `retrievedAt`, `staleAfter`
- Exchange regular session의 local open/close time

Session type:

| Type | Timestamp | 추가 조건 |
| --- | --- | --- |
| `regular` | `marketOpen`, `marketClose` 필수 | Source regular local open/close와 일치 |
| `early_close` | `marketOpen`, `marketClose` 필수 | Regular close보다 이르고 `exceptionName` 필수 |
| `holiday` | Timestamp `null` | `exceptionName` 필수 |
| `special_closure` | Timestamp `null` | `exceptionName` 필수 |
| `weekend` | Timestamp `null` | 실제 토요일/일요일이며 `exceptionName=null` |

Validation 기준:

- Source와 session은 KRX/NYSE의 market/timezone mapping과 일치해야 한다.
- Source는 KRX, NYSE canonical order로 각각 하나씩 존재해야 한다.
- Coverage의 모든 calendar date에 KRX와 NYSE session row가 각각 하나씩 있어야 한다.
- Session은 exchange/date canonical order이며 duplicate 또는 누락을 허용하지 않는다.
- Open/close timestamp는 IANA timezone으로 변환했을 때 `sessionDate`와 source local time에 일치해야 한다. NYSE DST offset은 fixed offset이 아니라 `America/New_York` 계산 결과를 사용한다.
- `generatedAt`, `retrievedAt`, `staleAfter`, `marketOpen`, `marketClose`는 explicit timezone offset을 포함해야 한다. Offset 없는 timestamp는 host timezone에 따라 다르게 해석될 수 있으므로 fail-closed로 거부한다.
- Artifact hash는 `artifactHash`를 제외한 strict payload의 canonical hash와 일치해야 한다.
- Parser의 `asOf`가 source `retrievedAt`보다 이르거나 `staleAfter` 이상이면 fail-closed로 거부한다.

현재 test fixture의 publisher와 `.invalid` URL은 contract 검증용 합성 입력이다. 실제 official source 확보, 일정 정확성 또는 readiness 통과를 의미하지 않는다.

## Snapshot Mapping

기존 `HistoricalMarketSnapshot` schema는 `observedAt`, `market`, `symbol`, `sourceRefs`, `createdAt`을 가진다. 현재 calendar-aware validation은 snapshot 원본 schema를 즉시 확장하지 않고 availability report의 derived metadata로 시작한다.

Derived metadata 예시:

```json
{
  "snapshotId": "hist_yahoo_1d_US_SPY_20250102",
  "observedAt": "2025-01-02T14:30:00.000Z",
  "market": "US",
  "symbol": "SPY",
  "exchange": "NYSE",
  "timezone": "America/New_York",
  "sessionDate": "2025-01-02",
  "calendarId": "calendar.nyse.2025-01-02",
  "calendarStatus": "session_open",
  "calendarWarningCodes": []
}
```

처리 기준:

- `observedAt`은 UTC 기준으로 비교한다.
- `sessionDate`는 fixture `timezone` 기준 local date로 계산한다.
- fixture가 없으면 required replay validation에서는 fail-closed 후보로 보고, exploratory report에서는 explicit warning으로 남긴다.
- session 밖 snapshot은 `CALENDAR_SESSION_MISMATCH` warning 또는 reject 후보로 남긴다.
- 휴장일 snapshot은 `CALENDAR_HOLIDAY_SAMPLE` warning 또는 reject 후보로 남긴다.

## FX Fixture

FX fixture는 USD→KRW 환산 근거와 freshness 판단을 분리한다. 현재 availability gate는 Yahoo collector의 `yahoo_fx:<symbol>:<date>` source ref와 FX fixture `sourceRefs`를 대조한다.

예시:

```json
{
  "fxId": "fx.usdkrw.2025-01-02",
  "pair": "USD/KRW",
  "sourceSymbol": "KRW=X",
  "observedAt": "2025-01-02T00:00:00.000Z",
  "rate": 1460.25,
  "staleAfter": "2025-01-03T00:00:00.000Z",
  "sourceRefs": ["yahoo_fx:KRW=X:2025-01-02"],
  "createdAt": "2026-07-01T00:00:00.000Z"
}
```

CLI 입력 기준:

- `--fx-fixtures-path`는 JSON array 또는 JSONL fixture 파일을 받는다.
- `--fx-required-market`은 반복 가능하며 값은 `KR` 또는 `US`만 허용한다.
- `--fx-required-market`을 생략하면 availability gate의 기본 required market인 `US`를 사용한다.
- `--fx-required-market`만 단독으로 지정하고 `--fx-fixtures-path`가 없으면 fail-closed로 거부한다.

Validation 기준:

- `pair`는 현재 첫 범위에서 `USD/KRW`만 허용한다.
- `rate`는 finite positive number여야 한다.
- `observedAt < staleAfter`가 성립해야 한다.
- price snapshot timestamp가 `observedAt`보다 앞서면 아직 관측되지 않은 FX source이므로 `VIRTUAL_FX_MISSING` reject/warning 후보가 된다.
- price snapshot timestamp가 `staleAfter` 이상이면 `VIRTUAL_FX_STALE` reject/warning 후보가 된다.
- FX source가 없으면 USD snapshot의 KRW 환산은 실패해야 하며, silent fallback을 사용하지 않는다.

## Warning And Reject Codes

현재 availability gate, report, dashboard warning에서 사용하는 code:

| Code | 의미 | 기본 severity |
| --- | --- | --- |
| `CALENDAR_FIXTURE_MISSING` | market/exchange/date에 맞는 calendar fixture가 없음 | required validation: reject |
| `CALENDAR_HOLIDAY_SAMPLE` | 휴장일로 분류된 date에 snapshot이 있음 | reject |
| `CALENDAR_SESSION_MISMATCH` | snapshot timestamp가 session window 밖임 | warning 또는 reject |
| `CALENDAR_TIMEZONE_MISMATCH` | fixture timezone과 local date 계산이 맞지 않음 | reject |
| `VIRTUAL_FX_MISSING` | USD→KRW 변환에 필요한 FX source가 없음 | reject |
| `VIRTUAL_FX_STALE` | price timestamp 기준 FX source가 만료됨 | reject |

Fail-closed 기준:

- required input 검증, replay 실행 전 availability gate, risk/report correctness에 영향을 주는 경우는 reject한다.
- exploratory coverage report는 optional symbol 누락을 warning으로 남길 수 있다.
- reject/warning은 report와 audit event에 남겨 조용히 metric이 계산되지 않게 한다.

## Hash And Artifact Policy

Calendar/FX fixture가 replay 결과에 영향을 주는 순간 다음 hash source에 포함한다.

- `dataSnapshotHash`: normalized snapshot field와 calendar/FX source ref
- `configHash`: validation policy, stale threshold, timezone/session option
- `officialMarketCalendarEvidence.artifactHash`: official source provenance와 normalized exchange-date session payload
- runtime `calendarHash`: 기존 normalized execution fixture. Official evidence 연결 전에는 observed-session class를 유지
- future `currencyConversionHash`: normalized FX fixture와 stale policy

Hash source에는 계좌번호, token, broker credential, raw order id를 넣지 않는다.

## Non-goals

이 contract는 다음 surface를 만들지 않는다.

- live order placement
- broker mutation
- `place_order` MCP tool
- raw `codex exec` execution
- raw `tossctl` execution
- natural language order
- live `TradingSignal` 또는 live `OrderIntent` 생성

AI는 paper-only decision/evidence provider이며, final sizing과 gate는 deterministic backend와 Risk Engine이 담당한다.
