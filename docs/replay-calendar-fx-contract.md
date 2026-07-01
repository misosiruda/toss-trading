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
- `assessHistoricalDataAvailability()`는 optional `calendarValidation` 입력이 있을 때 window snapshot을 market별 calendar rule과 fixture로 검증하고, 휴장일/fixture 누락/session mismatch/timezone mismatch를 fail-closed issue로 보고한다.
- `historicalReplay` CLI의 `--check-data-availability`와 `--require-data-availability`는 optional `--calendar-fixtures-path`, `--calendar-rule` 입력을 받아 JSON array 또는 JSONL calendar fixture를 availability gate에 연결할 수 있다.
- `runHistoricalBatchReplay()`는 optional `calendarValidation` 입력을 batch run별 availability preflight에 전달하고, calendar issue가 있는 window를 replay 실행 전 `DATA_INSUFFICIENT`로 skip한다.
- `historicalBatchReplay` CLI는 optional `--calendar-fixtures-path`, `--calendar-rule` 입력을 `runHistoricalBatchReplay()`의 run별 availability preflight에 전달한다.

현재 구현이 아직 가지지 않는 RH2 contract는 후속 구현 PR에서 별도 구현한다.

- calendar-aware window candidate filtering
- FX snapshot stale policy
- calendar/FX warning의 report/dashboard 연결

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

Fixture는 exchange별 session metadata를 JSONL 또는 JSON array로 저장할 수 있어야 한다. 후속 구현에서는 JSONL append-only fixture를 우선한다.

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

## Snapshot Mapping

기존 `HistoricalMarketSnapshot` schema는 `observedAt`, `market`, `symbol`, `sourceRefs`, `createdAt`을 가진다. RH2 후속 구현에서 calendar-aware validation은 snapshot 원본 schema를 즉시 확장하기보다 별도 derived metadata로 시작한다.

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

FX fixture는 USD→KRW 환산 근거와 freshness 판단을 분리한다. 후속 구현에서는 Yahoo collector의 `yahoo_fx:<symbol>:<date>` source ref와 연결할 수 있어야 한다.

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

Validation 기준:

- `pair`는 후속 구현 첫 범위에서 `USD/KRW`만 허용한다.
- `rate`는 finite positive number여야 한다.
- `observedAt < staleAfter`가 성립해야 한다.
- price snapshot timestamp가 `staleAfter`를 넘으면 `VIRTUAL_FX_STALE` reject/warning 후보가 된다.
- FX source가 없으면 USD snapshot의 KRW 환산은 실패해야 하며, silent fallback을 사용하지 않는다.

## Warning And Reject Codes

후속 구현에서 사용할 code 후보:

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
- future `calendarHash`: normalized calendar fixture
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
