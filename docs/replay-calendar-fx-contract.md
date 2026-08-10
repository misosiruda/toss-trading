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
- `src/replay/officialMarketCalendarSessionHoursException.ts`는 date-specific `early_close`/`delayed_open` override를 effective regular-session regime과 source collection의 `session_hours_exception_schedule` composite document provenance에 fail-closed로 결합한다.
- `src/replay/officialMarketCalendarOpenSession.ts`는 `regular`/`early_close`/`delayed_open` session의 regime provenance, optional exception identity, effective local hours와 composite source-ref union을 fail-closed로 결합한다.
- `src/replay/officialMarketCalendarSourceBackedClosure.ts`는 `holiday`/`special_closure` session의 row-role document provenance와 role별 schedule completeness coverage를 분리해 fail-closed로 검증한다.
- `src/replay/officialMarketCalendarWeekendSession.ts`는 Gregorian weekend session을 verified source collection identity/hash와 결합하되 official row provenance를 가장하지 않도록 `sourceDocumentRefs=[]`를 강제한다.
- `src/replay/officialMarketCalendarSessionSet.ts`는 open/closure/weekend 계약을 KRX/NYSE coverage의 모든 exchange-date에 정확히 하나의 session이 존재하는 canonical set으로 결합하고, coverage 내부의 모든 `sessionHoursException`이 같은 exchange-date의 open session에 귀속되지 않으면 source conflict로 중단한다. Source collection coverage에는 포함되지만 session-set coverage 밖인 exception은 귀속 대상에서 제외한다.
- `src/replay/officialMarketCalendarSourceArchiveBinding.ts`는 selected source collection의 모든 document를 composite ref와 hash-addressed package-relative sidecar path에 정확히 한 번 결합하고, shared exact bytes의 path reuse는 같은 hash와 content length일 때만 허용한다. 실제 sidecar byte 검증과 durable publication은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarSourceArchiveSidecar.ts`는 in-memory sidecar set을 binding의 unique canonical path와 exact coverage에 맞추고 각 byte length와 SHA-256을 재계산한다. Filesystem package read/write, fsync와 publication state는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarCacheRequestPolicy.ts`는 recorded cache request policy version과 실제 `Cache-Control`/`Pragma` value 목록을 고정된 revalidation 값에 대조하고 conditional `If-None-Match`/`If-Modified-Since`가 있으면 fail-closed로 거부한다. Request별 검증 수와 redirect effective URL 수의 exact 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. Request 생성과 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRangeRequestBoundary.ts`는 각 effective request의 raw `Range`/`If-Range` value가 모두 없는지 fail-closed로 검증한다. Request별 검증 수와 redirect effective URL 수의 exact 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. Automatic partial assembly와 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarHttpsUrlBoundary.ts`는 top-level requested/final URL과 first/last effective request URL의 exact boundary, 모든 request URL의 HTTPS scheme과 userinfo 부재를 fail-closed로 검증한다. Redirect Location chain과의 exact 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. Certificate/hostname 검증과 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarDomainAllowlist.ts`는 현재 확인된 official entry point host인 KRX `global.krx.co.kr`와 NYSE `www.nyse.com`을 immutable v1 policy로 등록하고 URL parser가 입력을 보정하지 않은 canonical serialization, exchange별 exact hostname과 default port를 fail-closed로 검증한다. Redirect effective URL chain과의 exact 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. 새 redirect/download host, certificate/hostname 검증과 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarTlsClientPolicy.ts`는 platform default trust store, certificate chain과 hostname verification 필수, insecure TLS bypass와 client certificate 금지를 immutable v1 policy로 fail-closed 검증한다. Redirect chain의 필수 policy 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. 실제 TLS handshake, certificate/hostname 검증 결과와 HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarCredentialFreeClientPolicy.ts`는 credential provider, proxy credential, HTTP auth handler와 cookie jar 비활성화를 immutable v1 policy로 fail-closed 검증한다. Redirect chain의 필수 policy 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. 실제 outbound header allowlist, response cookie replay 차단과 HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarCredentialHeaderBoundary.ts`는 initial request와 모든 redirect effective request의 raw `Authorization`, `Proxy-Authorization`, `Cookie` value가 없는지 fail-closed로 검증한다. 관찰된 request 수와 redirect effective URL 수의 exact 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. API-key/unknown header-name allowlist, response cookie replay 차단과 HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRedirectClientPolicy.ts`는 opaque automatic redirect follow 금지와 response/다음 effective request의 per-hop 관찰 필수를 immutable v1 policy로 fail-closed 검증한다. Redirect chain의 필수 policy 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. Parameter/header 전환과 HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRedirectLocationBoundary.ts`는 각 redirect response의 single raw `Location`을 fragment 없는 canonical HTTPS response URL에 resolve하고 absolute/network-path reference가 parser 보정 없는 canonical serialization이며 fragment를 제거한 결과가 fragment 없는 canonical HTTPS next effective request URL과 exact match하고 인접 hop이 하나의 연속 URL chain을 이루며 effective request URL을 반복하지 않는지 fail-closed로 검증한다. Method/body/header 전환, coordinator와 HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRedirectStatusBoundary.ts`는 관찰된 모든 redirect response status가 method 전환 contract를 가진 exact `301`, `302`, `303` 중 하나이고 status 목록이 비어 있지 않은지 fail-closed로 검증한다. HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRedirectMethodBoundary.ts`는 request body content type/hash pair를 함께 검증하고 301/302/303 response 뒤 observed `POST`가 body metadata를 제거한 `GET`으로 전환되며 body 없는 `GET`은 `GET`으로 유지되는지 검증한다. 인접 transition의 next/source method, body content type과 hash는 하나의 연속 request chain을 이루어야 한다. Header/parameter 전환, 307/308, coordinator와 HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRedirectChainBoundary.ts`는 검증된 TLS/redirect/credential-free client policy, cache request, credential header, domain allowlist, registered freshness policy가 결합된 final response, HTTPS URL, range request, request parameters, status, Location, method boundary를 결합해 fail-closed TLS/client/final-response/transfer policy, cache/credential/range/parameter 관찰 수와 effective request 수 일치, allowlist/effective URL exact identity, final response URL identity, Location chain URL 배열 exact match, hop 수와 response/method transition status 일치를 검증한다. 실제 TLS handshake 결과, API-key/unknown header-name allowlist, credential/secret request parameter allowlist, parameter transition과 representation header chain 결합, top-level acquisition coordinator와 HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRequestParametersBoundary.ts`는 effective request별 `requestParameters`를 JSON-compatible strict object로 검증하고 모든 중첩 object key가 valid Unicode이며 UTF-8 byte lexical canonical order인지 fail-closed로 확인한다. JavaScript object enumeration이 원래 lexical order를 보존하지 않는 array-index key grammar는 거부한다. Redirect-chain은 이 boundary를 필수 child로 검증하고 effective request 수와 관찰 수를 exact match하며 acquisition freshness policy boundary는 verified initial request parameters를 registered selector와 exact match한다. Credential/secret parameter allowlist와 실제 HTTP request 관찰 wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRepresentationHeadersBoundary.ts`는 effective request별 `representationHeaders`를 JSON-compatible strict object로 검증하고 key가 lowercase HTTP field-name grammar와 재귀 UTF-8 byte lexical canonical order를 만족하는지 fail-closed로 확인한다. Source별 strict header-name allowlist, redirect-chain과 registered freshness policy 결합 및 실제 HTTP request 관찰 wiring은 아직 구현하지 않는다. 공통 canonical JSON object 검증은 `src/replay/officialMarketCalendarCanonicalJsonObject.ts`가 담당하며 request parameters boundary도 같은 verifier를 사용한다.
- `src/replay/officialMarketCalendarFinalResponseBoundary.ts`는 하나의 final-response object에서 response URL, negotiated protocol, raw `Date`/`Age` cache header, raw `Cache-Control`, cache-header-derived freshness, registry-bound freshness policy expiry와 nested transfer completion을 함께 검증하고 status가 exact `200`이며 raw `Content-Range` value가 없고 recorded `contentRange`가 `null`인지 fail-closed로 검증한다. Freshness policy registry는 verifier의 필수 외부 입력이며 미등록 또는 recorded entry와 다른 policy를 거부한다. Nested transfer protocol은 final response protocol과 같아야 하며 redirect chain의 final URL identity 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. Selector-to-metadata binding, 실제 source별 policy registry 값과 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarTransferCompletion.ts`는 negotiated HTTP protocol별 허용 framing, explicit transfer completion, `content_length` framing의 declared length와 recorded byte length 일치를 fail-closed로 검증한다. Final response boundary가 이 contract를 nested child로 검증하므로 별도 sibling evidence 결합은 허용하지 않는다. 실제 byte stream 수신과 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarResponseCacheHeaders.ts`는 final response의 raw `Date`/`Age` header value 목록에서 duplicate를 보존해 검증하고, canonical IMF-fixdate와 nullable single decimal age만 freshness 입력으로 정규화한다. Final response의 필수 nested cache-header 결합은 `officialMarketCalendarFinalResponseBoundary.ts`가 담당한다. Freshness 계산과 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarResponseCacheControl.ts`는 final response의 raw `Cache-Control` field line을 HTTP cache-directive grammar로 parse하고 directive name 소문자화, quoted-string escape 정규화와 canonical 정렬을 수행하며 header 부재를 `null`로 보존한다. Duplicate directive와 malformed list/token/quoted-string은 fail-closed로 거부한다. Final response의 필수 nested 결합은 `officialMarketCalendarFinalResponseBoundary.ts`가 담당하며 freshness policy와 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarResponseFreshness.ts`는 존재하는 calendar date인 explicit-offset timestamp만 허용하고, final response `Date`의 apparent age와 nullable `Age` header 중 큰 값을 사용해 `effectiveResponseAt`을 재계산하며 stored metadata와 다르면 fail-closed로 거부한다. Final response 결합에서는 Date/Age 중복 입력을 허용하지 않고 검증된 cache-header 결과를 policy expiry 결합에도 사용한다.
- `src/replay/officialMarketCalendarFreshnessPolicy.ts`는 source/request-body/representation/parser identity와 row/schedule/applicability coverage selector, fixed-duration expiry rule을 strict definition으로 검증한다. Registry entry는 immutable ASCII version과 canonical definition hash를 결합하고 registry 안의 duplicate version을 거부한다. Recorded entry의 version을 registry에서 exact lookup하고 definition/hash 전체가 등록값과 다르면 fail-closed로 거부한다. `staleAfter` derivation은 `officialMarketCalendarFreshnessPolicyExpiry.ts`가 담당하며 실제 source별 registry 값과 full acquisition metadata wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarFreshnessPolicySelectorBinding.ts`는 registered policy definition의 source/coverage selector를 policy-relevant acquisition metadata projection으로 평탄화하고 caller projection의 전체 field와 value가 exact match하는지 검증한다. Key insertion order 차이는 허용하지만 field 누락, unknown field, source/coverage 값 mismatch와 미등록 policy는 fail-closed로 거부한다. Full acquisition metadata schema와 coordinator wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarAcquisitionFreshnessPolicyBoundary.ts`는 같은 registry로 redirect-chain/final-response를 먼저 검증하고 resolved policy version/hash가 가리키는 registered entry를 policy-relevant acquisition metadata projection과 결합한다. Registered source selector의 exchange, initial requested URL, method, request parameters, body content type과 body hash는 verified redirect-chain initial request와 exact match해야 한다. Selector mismatch와 unknown top-level field는 fail-closed로 거부한다. Representation headers와 parser contract의 full acquisition metadata wiring, source byte/parser 결과 결합과 전체 acquisition coordinator는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarFreshnessPolicyExpiry.ts`는 hash-verified policy entry의 positive safe duration을 canonical `effectiveResponseAt`에 더해 `staleAfter`를 결정론적으로 재계산한다. Millisecond 변환, timestamp addition, Date/canonical year range overflow와 recorded expiry mismatch는 fail-closed로 거부한다. Response freshness binding helper는 caller의 duplicate `effectiveResponseAt`을 허용하지 않고 response freshness contract를 다시 검증해 derived 값을 주입한다. Registry-bound variant는 recorded policy를 registry에서 exact lookup한 뒤 같은 expiry 경계를 실행하며 final-response boundary가 이 variant를 사용한다. Selector-to-metadata binding과 실제 source별 registry 값은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarEvidenceArtifactWriter.ts`는 strict schema, artifact hash와 artifact `generatedAt` 기준 source freshness를 검증한 뒤 official evidence JSON을 durable exclusive writer로 기록한다. Existing output은 덮어쓰지 않는다.
- `src/replay/officialMarketCalendarLegacyProjection.ts`는 검증된 official evidence의 KRX/NYSE source를 legacy calendar rule로, 모든 exchange-date session을 `MarketCalendarFixture`로 결정론적으로 투영한다. Open session timestamp와 closed session semantics를 보존하고 artifact/source/session provenance를 `sourceRefs`에 결합한다.
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
- [Official Market Calendar Source Acquisition 계획](official-market-calendar-source-acquisition-plan.md)은 official entry point, raw byte 보존, multi-document collection manifest, date-effective regular-session regime, provenance metadata, full coverage와 fail-closed acceptance 기준을 고정한다. 현재 v1은 exchange별 단일 source와 단일 regular session만 표현하므로 contract revision, actual source acquisition과 adapter 구현은 아직 수행하지 않았다.
- `official_market_calendar_evidence.v1` artifact writer는 구현됐지만 official source document를 읽어 payload를 생성하는 ingestion path는 아직 없다.
- 새 official evidence contract는 legacy rule/fixture로 투영할 수 있지만 availability CLI, batch replay 또는 readiness report가 이 projection을 직접 호출하도록 연결되지는 않았다.
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
| `weekend` | Timestamp `null` | 실제 토요일/일요일이며 `exceptionName=null`; 토요일/일요일은 반드시 이 타입 사용 |

Validation 기준:

- Source와 session은 KRX/NYSE의 market/timezone mapping과 일치해야 한다.
- Source는 KRX, NYSE canonical order로 각각 하나씩 존재해야 한다.
- Coverage의 모든 calendar date에 KRX와 NYSE session row가 각각 하나씩 있어야 한다.
- Session은 exchange/date canonical order이며 duplicate 또는 누락을 허용하지 않는다.
- Open/close timestamp는 IANA timezone으로 변환했을 때 `sessionDate`와 source local time에 일치해야 한다. NYSE DST offset은 fixed offset이 아니라 `America/New_York` 계산 결과를 사용한다.
- `generatedAt`, `retrievedAt`, `staleAfter`, `marketOpen`, `marketClose`는 explicit timezone offset을 포함해야 한다. Offset 없는 timestamp는 host timezone에 따라 다르게 해석될 수 있으므로 fail-closed로 거부한다.
- Source regular session이 `HH:mm` 단위이므로 `marketOpen`과 `marketClose`의 초와 밀리초는 0이어야 한다.
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
