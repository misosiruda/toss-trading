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
- `src/replay/officialMarketCalendarSourceDocumentEnvelope.ts`는 verified acquisition freshness/redirect boundary와 exact source bytes를 하나의 immutable pre-metadata envelope로 결합한다. Transfer-completion content length와 source byte length, exact source byte SHA-256, exchange identity와 canonical envelope hash를 재검증하며 stored envelope를 열 때도 exact source bytes와 freshness policy registry를 다시 요구한다. Raw bytes, caller-supplied publisher/content metadata와 parser output은 envelope에 포함하지 않으며 final metadata/collection 결합은 상위 contract가 담당한다. Durable publication은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarSourceDocumentAcquisitionMetadata.ts`는 verified source-document envelope에서 request identity, verifier-normalized composite redirect-chain projection, cache request policy identity와 final response/cache/freshness/representation/transfer 값을 재구성하고 canonical publisher identity, raw boundary를 보존한 full envelope와 함께 immutable `official_market_calendar_source_document_acquisition_metadata.v1` pre-parser aggregate로 결합한다. Registry-bound coverage/parser selector는 `expected*` field로만 보존하고 `parserResultBound=false`를 강제하므로 actual evidence role, parsed row coverage 또는 final `metadataHash`를 주장하지 않는다. Caller는 envelope 외 acquisition metadata field를 주입할 수 없으며 stored parse는 exact source bytes와 freshness policy registry로 전체 aggregate를 다시 생성해 field 또는 `acquisitionMetadataHash` tamper를 거부한다. Actual row/session-hours claim, final metadata와 collection 승격은 상위 contract가 담당하며 filesystem publication은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarSourceParserContract.ts`는 exchange, canonical parameter-free accepted content type 목록, absent를 `null`로 표현한 accepted content encoding 목록과 parser output schema version을 immutable definition으로 결합한다. Definition/registry entry/hash와 registry 전체를 strict parse하고 canonical ordering, duplicate version, hash tamper, unregistered version과 recorded/registered mismatch를 fail-closed로 거부한다. Executable path, parser code 또는 arbitrary command는 contract에 포함하지 않으며 실제 KRX/NYSE source format과 representation이 확인되기 전에는 production parser entry를 등록하지 않는다. Decode/input/result contract는 별도 경계이며 production parser 실행은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarSourceRepresentationDecodeBoundary.ts`는 exact encoded source bytes와 registry-resolved parser contract의 content type/encoding allowlist를 결합하고 absent/gzip/deflate/br representation을 명시적으로 decode한다. Encoded/decoded byte length와 SHA-256, immutable parser contract entry, versioned 64 MiB expansion limit을 hash-addressed boundary에 기록하고 stored open에서 exact source bytes로 전체 boundary를 재생성한다. Transparent decoding, unknown representation, corrupt/trailing stream, expansion limit 초과와 boundary tamper를 fail-closed로 거부하며 decoded bytes는 process-local parser input으로만 반환한다. Acquisition metadata와 parser result 결합은 각각 별도 상위 경계가 담당한다.
- `src/replay/officialMarketCalendarSourceParserInputBinding.ts`는 verified acquisition metadata의 expected parser version, exchange, canonical representation, exact source byte hash/length를 registry-resolved decode boundary와 결합한다. Full acquisition metadata와 representation boundary, parser contract/output schema identity와 decoded byte hash/length를 immutable binding hash에 포함하고 stored open에서 freshness registry와 exact source bytes로 전체 chain을 다시 검증한다. Decoded bytes는 process-local parser input으로만 반환하며 parser output은 별도 result contract가 결합한다.
- `src/replay/officialMarketCalendarSourceParserResult.ts`는 parser-specific adapter가 반환한 strict canonical output을 parser-input binding과 결합한다. Parsed rows는 unique ascending exchange-date와 canonical evidence role/field ordering을 요구하고 row coverage를 첫/마지막 row에서 파생한다. Row/session-hours/schedule claims에서 evidence roles를 파생한 뒤 acquisition의 expected coverage selector와 exact match하고 parser output/result hash를 고정한다. Stored parse는 acquisition부터 parser input까지 다시 열어 result 전체를 재생성한다. Final document metadata 승격은 별도 metadata 모듈이 담당하며 production parser adapter는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarSourceDocumentMetadata.ts`는 verified parser result를 final `official_market_calendar_source_document_metadata.v1`로 승격한다. Expected selector field를 flat final projection에서 제거하고 full acquisition metadata와 parser result를 nested provenance로 보존하면서 request/freshness/representation field, actual evidence/row/schedule/applicability/session-hours claim과 parser hashes를 `metadataHash`에 결합한다. Stored parse는 exact source bytes와 두 registry로 acquisition부터 result까지 재생성한다. Collection projection은 별도 projection 모듈이 담당하며 production parser adapter는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarSourceCollectionDocumentProjection.ts`는 final document metadata를 기존 source collection document strict schema로 projection하고 exchange, full metadata와 projected document를 immutable projection hash에 결합한다. Metadata/source-document hash, actual evidence roles, regular session hours와 schedule/applicability claim은 caller 입력 없이 final metadata에서만 파생하며 stored parse는 exact bytes와 registries로 전체 chain을 다시 생성한다. Collection aggregate 결합은 별도 assembly 모듈이 담당한다.
- `src/replay/officialMarketCalendarSourceCollectionAssembly.ts`는 canonical collection plan과 document projection 목록을 결합해 source collection payload/hash를 생성한다. Plan에는 documents/collectionHash를 허용하지 않고 projection document ID와 per-document exact byte map의 exact canonical coverage를 요구한다. 각 projection을 bytes와 registries로 다시 연 뒤 collection strict schema를 적용하고 exchange, full projections와 source collection을 immutable assembly hash에 결합한다. Production parser와 filesystem publication은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarEvidenceArtifactV2.ts`는 KRX/NYSE verified collection assembly를 canonical 순서로 다시 열고 complete session set, open-session provenance, session-hours exception과 derived source archive binding을 `official_market_calendar_evidence.v2` payload/hash에 결합한다. Full collection projections가 final document metadata와 nested acquisition/parser provenance를 보존하며 binding path/hash/length는 caller 입력 없이 metadata에서 파생된다. Artifact `generatedAt`에는 모든 source의 `retrievedAt <= generatedAt < staleAfter`를 적용하고 stored parse는 exact bytes와 두 registry로 전체 evidence를 재생성한다. Reader-time freshness decision contract는 별도 구현됐고, filesystem package writer와 verified-set을 소유하는 publication coordinator는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarPublicationPackagePlan.ts`는 verified v2 artifact와 canonical exact sidecar set을 결합해 canonical `artifact.json` bytes/hash/length, source archive file 목록, hash-derived package path와 publication record/path를 immutable publication plan hash에 고정한다. Stored plan은 artifact와 sidecar를 다시 검증해 재생성하며 caller가 file descriptor나 publication identity를 주입하지 못한다. 실제 directory/file 생성, durability sync, atomic no-replace publish와 coordinator activation은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarPublicationFilesystemPreflight.ts`는 writer가 사용할 exact absolute publication root의 realpath identity를 hash에 결합한다. Mutation 없이 platform이 제공하는 `O_DIRECTORY | O_NONBLOCK` read-only flags로 root handle을 열어 special-file blocking을 피하고, 같은 handle의 `stat()`으로 directory인지 검증한 뒤 directory sync만 관찰한다. Handle `stat()` 또는 `close()` I/O 실패는 `probe_failed`로 기록하되 실제 non-directory handle은 입력 오류로 거부한다. Built-in Node API에는 verified directory entry에 cleanup mutation을 결합하는 primitive와 atomic no-replace directory publish contract가 없으므로 exclusive create, file sync, hard-link와 directory rename mutation probe는 실행하지 않는다. 해당 observation은 `not_probed_safe_cleanup_unavailable`, capability는 false, blocker는 `safe_mutation_probe_cleanup_unavailable`로 명시한다. Temporary namespace나 probe entry를 만들지 않으므로 cleanup path mutation과 symlink traversal도 없다. Directory-sync `EPERM`은 Windows에서만 `unsupported` compatibility observation으로 기록하고 다른 platform에서는 `probe_failed`로 보존하며 stored parse도 `unsupported`이면 `platform: win32`를 요구한다. Platform과 관계없이 built-in implementation은 `unsupported`이며 root identity, blocker/capability/observation을 canonical hash에 결합하고 반환 contract 전체를 deep-freeze한다. 별도 검증된 handle-bound cleanup, no-replace directory primitive와 filesystem writer는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarSourceArchiveBinding.ts`는 selected source collection의 모든 document를 composite ref와 hash-addressed package-relative sidecar path에 정확히 한 번 결합하고, shared exact bytes의 path reuse는 같은 hash와 content length일 때만 허용한다. Exact sidecar byte 검증은 전용 sidecar module이 담당하며 durable publication은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarSourceArchiveSidecar.ts`는 in-memory sidecar set을 binding의 unique canonical path와 exact coverage에 맞추고 각 byte length와 SHA-256을 재계산한다. Filesystem package read/write, fsync와 publication state는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarPublicationRecord.ts`는 artifact hash에서 immutable `sha256/<artifact-hash>` package path와 `published/sha256/<artifact-hash>.json` record path를 결정론적으로 만들고, schema version, artifact hash와 package path 전체를 `publicationRecordHash`에 결합한다. Mutable alias, traversal, path/hash mismatch와 record hash tamper는 fail-closed로 거부한다. Filesystem publication, durability sync, coordinator activation과 recovery는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarCacheRequestPolicy.ts`는 recorded cache request policy version과 실제 `Cache-Control`/`Pragma` value 목록을 고정된 revalidation 값에 대조하고 conditional `If-None-Match`/`If-Modified-Since`가 있으면 fail-closed로 거부한다. Request별 검증 수와 redirect effective URL 수의 exact 결합, request header name 목록의 `cache-control`/`pragma` 존재와 conditional name 부재 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. Request 생성과 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRangeRequestBoundary.ts`는 각 effective request의 raw `Range`/`If-Range` value가 모두 없는지 fail-closed로 검증한다. Request별 검증 수와 redirect effective URL 수의 exact 결합 및 request header name 목록의 `range`/`if-range` 부재 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. Automatic partial assembly와 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarHttpsUrlBoundary.ts`는 top-level requested/final URL과 first/last effective request URL의 exact boundary, 모든 request URL의 HTTPS scheme과 userinfo 부재를 fail-closed로 검증한다. Redirect Location chain과의 exact 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. Certificate/hostname 검증과 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarDomainAllowlist.ts`는 현재 확인된 official entry point host인 KRX `global.krx.co.kr`와 NYSE `www.nyse.com`을 immutable v1 policy로 등록하고 URL parser가 입력을 보정하지 않은 canonical serialization, exchange별 exact hostname과 default port를 fail-closed로 검증한다. Redirect effective URL chain과의 exact 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. 새 redirect/download host, certificate/hostname 검증과 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarTlsClientPolicy.ts`는 platform default trust store, certificate chain과 hostname verification 필수, insecure TLS bypass와 client certificate 금지를 immutable v1 policy로 fail-closed 검증한다. Redirect chain의 필수 policy 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. 실제 TLS handshake, certificate/hostname 검증 결과와 HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarCredentialFreeClientPolicy.ts`는 credential provider, proxy credential, HTTP auth handler와 cookie jar 비활성화를 immutable v1 policy로 fail-closed 검증한다. Redirect chain의 필수 policy 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. 실제 outbound header allowlist, response cookie replay 차단과 HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarCredentialHeaderBoundary.ts`는 initial request와 모든 redirect effective request의 raw `Authorization`, `Proxy-Authorization`, `Cookie` value가 없는지 fail-closed로 검증한다. 관찰된 request 수와 redirect effective URL 수의 exact 결합 및 request header name 목록의 known credential name 부재 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. Response cookie replay 차단과 HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRequestHeaderNamesBoundary.ts`는 effective request별 기록된 request header name을 value 없이 non-empty lowercase HTTP field-name 배열로 검증하고 ASCII 범위의 UTF-8 byte lexical canonical strict order를 강제해 duplicate를 fail-closed로 거부한다. Redirect-chain은 이 boundary를 필수 child로 검증하고 effective request 수와 관찰 수를 exact match하며 verified cache policy에 맞춰 `cache-control`/`pragma` 존재와 conditional name 부재, credential boundary에 맞춰 `authorization`/`proxy-authorization`/`cookie` 부재, range boundary에 맞춰 `range`/`if-range` 부재, body metadata에 맞춰 `content-type` 존재/부재를 결합한다. Representation category인 `accept`·`accept-language`는 request header name과 `representationHeaders` own key가 양방향으로 일치해야 하며 cache 또는 request-body category key가 representation value로 기록되면 거부한다. Recorded request-header policy version은 registry에서 exact resolve되며 initial exchange/requested URL과 모든 effective request header name의 allowed-set 포함 관계에 결합된다. 실제 HTTP request 관찰 wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRequestHeaderPolicy.ts`는 exchange와 fragment 없는 canonical official requested URL을 source selector로 가진 immutable definition을 strict contract로 검증한다. Allowed header name은 lowercase HTTP field-name의 canonical strict order를 사용하고 `cache-control`/`pragma`를 필수로 포함하며 fixed known-safe set인 `accept`, `accept-language`, `cache-control`, `content-type`, `pragma`, `user-agent`의 부분집합이어야 한다. `user-agent`는 별도 KRX OTP policy version에서만 allowed-name 상한으로 등록되고 기존 KRX/NYSE source policy에는 추가되지 않는다. Exact `User-Agent` field value와 OTP lifecycle은 이 name-only contract가 검증하지 않는다. Credential/API-key alias, conditional cache, range와 그 밖의 unknown header name은 spelling과 관계없이 policy에서 fail-closed로 거부한다. Registry entry는 registered ASCII grammar의 `requestHeaderPolicyVersion`과 strict definition을 결합하고 registry 안의 duplicate version을 거부하며, lookup은 version을 exact match하고 미등록 version을 fail-closed로 거부한다. `src/replay/officialMarketCalendarRequestHeaderPolicyRegistry.ts`는 확인된 KRX source 3개, KRX OTP 1개와 NYSE 1개 official entry point의 versioned policy를 사전 등록하고 매 read마다 registry 전체를 strict parse한다. `officialMarketCalendarRedirectChainBoundary.ts`는 외부 registry override 없이 이 configured registry만 resolve한다.
- `src/replay/officialMarketCalendarRequestHeaderValuePolicy.ts`는 ancillary request의 exchange/method/URL, same-source registered header policy와 parameter policy, canonical fixed non-representation header value를 immutable definition으로 결합한다. Fixed-value name은 현재 `user-agent`만 허용하고 value는 1~8,192 character canonical safe ASCII여야 하며 bound header policy의 allowed-name set에도 포함돼야 한다. `src/replay/officialMarketCalendarRequestHeaderValuePolicyRegistry.ts`는 KRX OTP GET의 exact `user-agent: Mozilla/5.0`을 별도 version으로 등록한다. 이는 2026-08-20 read-only observation 재현값이며 영구 provider contract, HTTP observation wiring 또는 OTP acquisition 성공을 뜻하지 않는다.
- `src/replay/officialMarketCalendarKrxOtpResponseBody.ts`는 KRX OTP raw body가 exact 216-byte canonical base64, `==` padding, 160-byte decoded length와 zero unused padding bit를 갖는지 string/decoded token copy 없이 검증한다. 검증용 byte copy는 항상 zeroize하고 caller view는 변경하지 않으며, 반환하는 frozen shape에는 encoding과 길이만 포함하고 raw token/hash를 넣지 않는다. 이 body-only contract 자체는 status/header/framing/freshness/network provenance 또는 one-shot ownership을 증명하지 않는다. Network/one-shot/data POST wiring은 dedicated consumer와 coordinator가 담당하며 durable sink는 제공하지 않는다.
- `src/replay/officialMarketCalendarKrxOtpEphemeralBody.ts`는 body-shape-valid raw response bytes를 WeakMap-backed opaque handle로 이전한다. Factory는 transferred caller view를 internal copy와 분리한 즉시 zeroize한다. Fixed one-shot parameter consumer는 registered static policy와 exact target year를 검증해 OTP ownership을 새 opaque POST-parameter handle로 이동한다. Fixed byte encoder는 registered wire policy와 selector binding을 검증하고 1,024-byte zeroized workspace에서 raw OTP string copy 없이 uppercase percent encoding한 뒤 새 opaque wire-body handle로 ownership을 이동한다. 성공/실패/explicit disposal/JSON export는 더 이상 소유하지 않는 raw/encoded bytes를 zeroize하고 original handle 재사용과 forged handle을 거부한다. 세 handle 모두 raw getter/callback/serialization/durable sink를 제공하지 않는다. Fixed HTTPS consumer는 wire-body handle을 exactly once 소비하고 registered production URL/Host/SNI, application header, no credential/cookie/redirect, connection reuse disabled와 10초 deadline을 고정한다. Request `finish`/failure/deadline에 body bytes를 zeroize하고, bounded complete HTTP/1.1 content-length response만 기존 metadata/body verifier를 거쳐 opaque ephemeral response handle로 이전한다. Raw response와 `Set-Cookie` value는 반환·저장하지 않으며 durable reuse와 accepted acquisition은 false다.
- `src/replay/officialMarketCalendarKrxOtpNetworkPolicy.ts`는 registered KRX form OTP header-name/parameter/header-value identity에 exact GET query, four application headers, production Host/Connection, no redirect/cookie/credential/reuse, 10초 deadline과 1,024-byte cap을 결합한다. Observed response는 HTTP/1.1 200, 216-byte content-length, raw-wire content type, immediate-expiry/no-store cache와 positive `Set-Cookie` name count만 허용한다. Raw cookie value와 OTP bytes를 보존하지 않으며 policy resolver는 I/O를 수행하지 않고 durable reuse와 accepted acquisition false를 유지한다.
- `src/replay/officialMarketCalendarKrxOtpNetworkConsumer.ts`는 caller input 없는 production factory로 registered OTP GET을 실행한다. Production dial/CA/deadline override는 없고 test-only connector만 loopback synthetic TLS를 허용하되 production Host/SNI/hostname 검증을 유지한다. Exact HTTP/1.1 200, 216-byte content-length, observed representation/cache/expiry, no redirect/encoding/trailer와 positive `Set-Cookie` name count를 allocation 전에 검사한다. Complete bounded response만 opaque OTP handle로 이전하며 source chunk와 failure buffer를 zeroize하고 raw OTP/cookie value를 반환·저장하지 않는다.
- `src/replay/officialMarketCalendarKrxHolidayDataPostPolicy.ts`는 KRX official holiday page와 exact data POST target을 결합하고 token-free fixed parameter `gridTp=KRX`/exact `pagePath`와 value-free dynamic parameter name `code`/`search_bas_yy`를 strict immutable v1 policy로 등록한다. Raw OTP value, target year value, optional pagination/navigation field, header/body encoding, cookie 또는 HTTP wiring은 포함하지 않으며 기존 OTP GET parameter policy의 `code` 금지를 완화하지 않는다.
- `src/replay/officialMarketCalendarKrxHolidayTargetYear.ts`는 2026-08-20 KRX official holiday page의 `search_bas_yy` selector에서 관찰한 exact string value `2026..2016`을 descending immutable tuple로 등록하고 exact member만 parse한다. 숫자 coercion/whitespace 보정/범위 밖 연도는 거부하며, selector 변경은 새 observation과 policy version을 요구한다. 이 parser는 OTP lifecycle이나 HTTP request를 수행하지 않는다.
- `src/replay/officialMarketCalendarKrxHolidayDataPostWirePolicy.ts`는 cookie/redirect-disabled 2026-08-20 successful read-only POST에서 사용한 exact content type, parameter order `search_bas_yy`/`gridTp`/`pagePath`/`code`, uppercase percent-triplet component encoding, raw OTP no-string-copy rule과 1,024-byte local 상한을 strict immutable v1 policy로 등록한다. 이는 provider body-size limit이나 encoder/transport/acquisition 성공을 뜻하지 않는다.
- `src/replay/officialMarketCalendarKrxHolidayDataPostNetworkPolicy.ts`는 observed data POST의 application-controlled canonical header names `accept`/`cache-control`/`content-length`/`content-type`/`pragma`, fixed values, exact wire-body-length binding, URL-derived `Host`, `Connection: close`, cookie/redirect/credential-free isolation과 connection reuse 금지, 10초 absolute deadline과 request/response byte cap을 post/wire/response policy에 결합한다. Response는 HTTP/1.1 200 content-length framing만 허용하고 Location/Content-Encoding/Transfer-Encoding/Content-Range/trailer를 거부하며 `Set-Cookie` value retention/replay 없이 count만 허용한다. Resolver는 HTTP I/O나 wire bytes를 노출하지 않고 process-local raw response, durable false와 accepted false를 고정한다. Fixed consumer는 이 immutable definition을 실제 HTTPS request/response boundary에 적용하지만 policy module 자체에는 I/O를 추가하지 않는다.
- `src/replay/officialMarketCalendarKrxHolidayDataResponseMetadata.ts`는 automatic redirect/cookie jar disabled와 request Cookie count 0을 요구하고 KRX data POST의 exact official response URL, HTTP/1.1 200 content-length completion, Node raw-wire `text/html;charset=UTF-8` 또는 이전 client-normalized `text/html; charset=UTF-8`의 bounded exact allowlist, no encoding/redirect, immediate expiry, canonical `max-age=0`/`no-cache`/`no-store`, `Pragma: no-cache`와 raw value 없는 positive `Set-Cookie` count를 검증한다. Content-Type output은 space 포함 형태로 canonicalize하고 다른 OWS/case/duplicate 변형은 거부한다. Complete bounded body validation에는 진입할 수 있지만 cache prohibition/immediate expiry/response cookie 때문에 durable evidence reuse와 accepted acquisition은 false로 고정한다. Generic reusable-evidence policy를 완화하지 않는다.
- `src/replay/officialMarketCalendarKrxHolidayDataResponseBody.ts`는 verified response metadata의 exact content length와 caller `Uint8Array`를 결합하고 owned copy에서 BOM 없는 strict UTF-8 JSON을 검증한다. Raw token scan은 escape decoding 후 같은 이름이 되는 duplicate JSON member를 거부하며, top-level exact `block1`, bounded non-empty row array와 관찰된 5개 string field만 허용한다. Owned bytes는 unconditional zeroize한다. 결과는 row value 없이 body length, row count와 exact key 목록만 제공하고 durable evidence reuse와 accepted acquisition은 false로 유지한다. 날짜 의미와 중복 날짜는 fixed semantic consumer가 검증하며 publication evidence 변환은 하지 않는다.
- `src/replay/officialMarketCalendarKrxHolidayDataRowPolicy.ts`는 2026-08-20 cookie/redirect-disabled read-only observation으로 registered 2016~2026 target year 모두에서 확인한 row 의미를 response metadata/body/target-year version에 결합한다. `calnd_dd` canonical requested-year date, `calnd_dd_dy` exact date match, `dy_tp_cd` Gregorian weekday match, Korean name non-empty/trimmed, English name empty-or-trimmed, date strict ascending과 duplicate rejection을 immutable v1 policy로 고정한다. Fixed semantic consumer는 raw row를 반환하지 않고 summary만 제공하며 historical completeness claim, durable reuse와 accepted acquisition false를 유지한다.
- `verifyOfficialMarketCalendarKrxHolidayDataResponseSemantics`는 body module의 private verified parser와 registered row policy를 결합한 fixed consumer다. Exact target-year canonical date, calendar-day/date equality, Gregorian weekday, Korean/English name policy, strict ascending과 duplicate rejection을 검사하고 row count, English empty count와 boolean summary만 반환한다. Raw row value, date 목록과 name은 반환하지 않으며 observed rows 범위, no completeness claim, durable reuse와 accepted acquisition false를 유지한다.
- `src/replay/officialMarketCalendarKrxHolidayDataEphemeralResponse.ts`는 caller `Uint8Array`에 1MiB 상한을 internal allocation/metadata 접근 전에 적용하고 즉시 zeroize한다. Full response metadata verifier가 같은 process에서 만든 객체만 허용해 reconstructed projection의 transport 검증 우회를 차단하며, realm-independent intrinsic brand check로 cross-realm `SharedArrayBuffer` backing도 거부한다. Shape-verified owned copy, 최소 immutable metadata projection과 target year만 process-local opaque handle에 보관한다. JSON export/getter/callback 없이 fixed semantic consumer를 정확히 한 번 허용하며 consume/dispose/실패 경로 모두 internal bytes를 zeroize한다. Consumer 결과는 기존 summary-only/no-completeness/durable false/accepted false 경계를 유지한다. Fixed HTTPS consumer만 이 handle을 생성한다.
- `src/replay/officialMarketCalendarKrxAcquisitionCoordinator.ts`는 exact canonical target-year request를 network I/O 전에 검증하고 production fixed OTP GET, one-shot POST parameter/wire encoding, fixed holiday data POST와 ephemeral semantic consume을 순서대로 조립한다. Production dependency override는 없고 test-only factory는 제한된 consumer method를 snapshot한다. Stage 실패는 raw provider detail 없는 structured error로 변환하며 모든 보유 handle을 success/failure `finally`에서 dispose한다. 반환은 frozen summary-only contract이며 raw row/date/name, historical completeness claim, durable evidence reuse, accepted acquisition과 publication write를 추가하지 않는다.
- `src/replay/officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy.ts`는 KRX Global derivatives calendar page의 official `fileDown` OTP/download selector와 2026-08-20에 read-only로 확인한 2013~2015 legacy `.doc` file name, content length, SHA-256, OLE signature, observed title/holiday-line count를 immutable candidate policy로 등록한다. OTP value와 raw document는 policy에 넣지 않고 cookie/redirect/credential-free request isolation을 고정한다. Derivatives market 문서의 Word-table parser, evidence role/coverage와 cross-market holiday completeness는 미검증이므로 source candidate only, durable reuse false와 accepted acquisition false를 유지한다.
- `src/replay/officialMarketCalendarRedirectClientPolicy.ts`는 opaque automatic redirect follow 금지와 response/다음 effective request의 per-hop 관찰 필수를 immutable v1 policy로 fail-closed 검증한다. Redirect chain의 필수 policy 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. Parameter/header 전환과 HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRedirectLocationBoundary.ts`는 각 redirect response의 single raw `Location`을 fragment 없는 canonical HTTPS response URL에 resolve하고 absolute/network-path reference가 parser 보정 없는 canonical serialization이며 fragment를 제거한 결과가 fragment 없는 canonical HTTPS next effective request URL과 exact match하고 인접 hop이 하나의 연속 URL chain을 이루며 effective request URL을 반복하지 않는지 fail-closed로 검증한다. Method/body/header 전환, coordinator와 HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRedirectStatusBoundary.ts`는 관찰된 모든 redirect response status가 method 전환 contract를 가진 exact `301`, `302`, `303` 중 하나이고 status 목록이 비어 있지 않은지 fail-closed로 검증한다. HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRedirectMethodBoundary.ts`는 request body content type/hash pair를 함께 검증하고 301/302/303 response 뒤 observed `POST`가 body metadata를 제거한 `GET`으로 전환되며 body 없는 `GET`은 `GET`으로 유지되는지 검증한다. 인접 transition의 next/source method, body content type과 hash는 하나의 연속 request chain을 이루어야 한다. Redirect-chain은 각 effective request의 body content type 존재 여부와 `content-type` request header name 존재 여부를 exact 결합한다. 그 밖의 header/parameter 전환, 307/308, coordinator와 HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRedirectChainBoundary.ts`는 검증된 TLS/redirect/credential-free client policy, cache request, credential header, registered request-header policy와 request header names, domain allowlist, registered freshness policy가 결합된 final response, HTTPS URL, range request, request parameters, representation headers, status, Location, method boundary를 결합해 fail-closed TLS/client/final-response/transfer policy, cache/credential/range/request header name/parameter/representation header 관찰 수와 effective request 수 일치, request-header policy version/source selector/allowed-name 상한, cache request value/name, credential value/name, range value/name, body content-type/name identity, representation category identity와 name/value 양방향 completeness, allowlist/effective URL exact identity, final response URL identity, Location chain URL 배열 exact match, hop 수와 response/method transition status 일치를 검증한다. 실제 TLS handshake 결과, credential/secret request parameter allowlist, parameter/header transition, top-level acquisition coordinator와 HTTP transport wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRequestParametersBoundary.ts`는 effective request별 `requestParameters`를 JSON-compatible strict object로 검증하고 모든 중첩 object key가 valid Unicode이며 UTF-8 byte lexical canonical order인지 fail-closed로 확인한다. JavaScript object enumeration이 원래 lexical order를 보존하지 않는 array-index key grammar는 거부한다. Redirect-chain은 이 boundary를 필수 child로 검증하고 effective request 수와 관찰 수를 exact match하며 acquisition freshness policy boundary는 verified initial request parameters를 registered selector와 exact match한다. Ancillary request parameter policy를 redirect-chain이나 실제 HTTP request 관찰에 연결하는 wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarRequestParameterPolicy.ts`는 ancillary request의 exchange/method/query 없는 canonical official URL, 같은 source selector의 registered header-policy version과 exact fixed string parameter object를 immutable definition으로 결합한다. Parameter name은 lowercase safe grammar와 canonical key order를 사용하고 현재 known-safe `bld`, `name`만 허용하므로 `code`, OTP/token, authorization, cookie와 미등록 이름을 fail-closed로 거부한다. `src/replay/officialMarketCalendarRequestParameterPolicyRegistry.ts`는 KRX form OTP GET의 exact `bld`/`name` request를 별도 version으로 등록한다. Generic policy module은 HTTP I/O나 dynamic value를 소유하지 않으며 dedicated KRX consumers가 이 registered request와 separate one-shot code/data POST lifecycle을 실행한다.
- `src/replay/officialMarketCalendarRepresentationHeadersBoundary.ts`는 effective request별 `representationHeaders`를 lowercase HTTP field-name에서 최대 8,192 character의 canonical safe-ASCII field value로 매핑되는 strict object로 검증하고 key가 UTF-8 byte lexical canonical order를 만족하는지 fail-closed로 확인한다. Generic value는 empty를 허용하며 non-empty value는 visible ASCII로 시작·종료하고 내부에는 visible ASCII, SP와 HTAB만 허용한다. Leading/trailing whitespace, control character, DEL, non-ASCII와 non-string value는 거부한다. Recorded `accept` value는 추가로 non-empty `type/subtype`, `type/*`, `*/*` media-range list와 explicit parameter `name=value` 문법을 통과해야 하며 quoted parameter 내부 literal HTAB을 허용한다. Media range별 `q` weight는 최대 하나, unquoted 0부터 1까지와 최대 세 자리 소수로 제한하며 `q` 뒤 parameter, case-insensitive media range 반복과 case-insensitive parameter name 중복을 거부한다. Redirect-chain은 이 boundary를 필수 child로 검증하고 effective request 수와 관찰 수를 exact match하며 모든 representation key가 같은 effective request의 verified header-name 목록에 존재하고 `accept`·`accept-language` category에 속하는지 확인한다. Recorded `accept`·`accept-language` request header name도 같은 effective request의 representation object에 own value가 있어야 하며, acquisition freshness policy boundary는 verified initial representation headers를 registered selector와 exact match한다. Recorded `accept-language` value는 non-empty `*` 또는 1\~8 ASCII letter와 각 1\~8 ASCII alphanumeric subtag로 구성된 language-range list여야 하며 range별 optional `q` weight는 같은 범위와 정밀도로 제한하고 같은 range의 ASCII case-insensitive 중복을 거부한다. 실제 HTTP request 관찰 wiring은 아직 구현하지 않는다. 공통 canonical object key 검증은 `src/replay/officialMarketCalendarCanonicalJsonObject.ts`가 담당하며 request parameters boundary도 같은 verifier를 사용한다.
- `src/replay/officialMarketCalendarFinalResponseBoundary.ts`는 하나의 final-response object에서 response URL, negotiated protocol, raw `Date`/`Age` cache header, raw `Cache-Control`, strict response representation header, cache-header-derived freshness, registry-bound freshness policy expiry와 nested transfer completion을 함께 검증하고 status가 exact `200`이며 raw `Content-Range` value가 없고 recorded `contentRange`가 `null`인지 fail-closed로 검증한다. Freshness policy registry는 verifier의 필수 외부 입력이며 미등록 또는 recorded entry와 다른 policy를 거부한다. Nested transfer protocol은 final response protocol과 같아야 하며 redirect chain의 final URL identity 결합은 `officialMarketCalendarRedirectChainBoundary.ts`가 담당한다. Parser-contract별 media type/coding allowlist, full metadata binding과 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarTransferCompletion.ts`는 negotiated HTTP protocol별 허용 framing, explicit transfer completion, `content_length` framing의 declared length와 recorded byte length 일치를 fail-closed로 검증한다. Final response boundary가 이 contract를 nested child로 검증하므로 별도 sibling evidence 결합은 허용하지 않는다. 실제 byte stream 수신과 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarResponseRepresentationHeaders.ts`는 final response의 raw `Content-Type`/`Content-Encoding` value 목록을 strict하게 검증한다. `Content-Type`은 정확히 하나의 parameter-free media type이어야 하며 canonical lowercase로 정규화한다. `Content-Encoding`은 absent 또는 single `gzip`·`deflate`·`br`만 허용하고 canonical lowercase 또는 `null`로 보존한다. Duplicate, stacked/unknown coding, whitespace/control/non-ASCII, parameterized media type와 unknown field는 fail-closed로 거부한다. 이 boundary는 representation을 decode하거나 parser를 선택하지 않으며 final-response의 필수 nested child로만 결합된다.
- `src/replay/officialMarketCalendarResponseCacheHeaders.ts`는 final response의 raw `Date`/`Age` header value 목록에서 duplicate를 보존해 검증하고, canonical IMF-fixdate와 nullable single decimal age만 freshness 입력으로 정규화한다. 현재 raw `Expires`는 받지 않으므로 actual Toss network v2 전에 nullable single canonical `Expires`를 추가하는 backward-compatible parser/schema 확장이 필요하다. Final response의 필수 nested cache-header 결합은 `officialMarketCalendarFinalResponseBoundary.ts`가 담당한다. Expires-aware freshness 계산과 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarResponseCacheControl.ts`는 final response의 raw `Cache-Control` field line을 HTTP cache-directive grammar로 parse하고 directive name 소문자화, quoted-string escape 정규화와 canonical 정렬을 수행하며 header 부재를 `null`로 보존한다. Duplicate directive와 malformed list/token/quoted-string은 fail-closed로 거부한다. Final response의 필수 nested 결합은 `officialMarketCalendarFinalResponseBoundary.ts`가 담당하며 freshness policy와 HTTP transport는 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarResponseFreshness.ts`는 존재하는 calendar date인 explicit-offset timestamp만 허용하고, final response `Date`의 apparent age와 nullable `Age` header 중 큰 값을 사용해 `effectiveResponseAt`을 재계산하며 stored metadata와 다르면 fail-closed로 거부한다. Final response 결합에서는 Date/Age 중복 입력을 허용하지 않고 검증된 cache-header 결과를 policy expiry 결합에도 사용한다. 이 기존 helper는 response delay, response directive semantics와 `Expires`를 입력받지 않으므로 actual Toss network v2에는 그대로 사용하지 않으며, final attempt의 transport-derived delay와 Expires-aware response expiry를 포함하는 backward-compatible network-bound variant가 선행돼야 한다.
- `src/replay/officialMarketCalendarFreshnessPolicy.ts`는 source/request-body/representation/parser identity와 row/schedule/applicability coverage selector, fixed-duration expiry rule을 strict definition으로 검증한다. Registry entry는 immutable ASCII version과 canonical definition hash를 결합하고 registry 안의 duplicate version을 거부한다. Recorded entry의 version을 registry에서 exact lookup하고 definition/hash 전체가 등록값과 다르면 fail-closed로 거부한다. `staleAfter` derivation은 `officialMarketCalendarFreshnessPolicyExpiry.ts`가 담당하며 실제 source별 registry 값과 full acquisition metadata wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarFreshnessPolicySelectorBinding.ts`는 registered policy definition의 source/coverage selector를 policy-relevant acquisition metadata projection으로 평탄화하고 caller projection의 전체 field와 value가 exact match하는지 검증한다. Key insertion order 차이는 허용하지만 field 누락, unknown field, source/coverage 값 mismatch와 미등록 policy는 fail-closed로 거부한다. Full acquisition metadata schema와 coordinator wiring은 아직 구현하지 않는다.
- `src/replay/officialMarketCalendarAcquisitionFreshnessPolicyBoundary.ts`는 같은 registry로 redirect-chain/final-response를 먼저 검증하고 resolved policy version/hash가 가리키는 registered entry를 policy-relevant acquisition metadata projection과 결합한다. Registered source selector의 exchange, initial requested URL, method, request parameters, body content type, body hash와 representation headers는 verified redirect-chain initial request와 exact match해야 한다. Selector mismatch와 unknown top-level field는 fail-closed로 거부한다. Parser contract의 full acquisition metadata wiring, source byte/parser 결과 결합과 전체 acquisition coordinator는 아직 구현하지 않는다.
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

- Official Toss Open API `/api/v1/market-calendar/{KR|US}`는 primary operational/observed broker calendar source로 승인됐고, 현재 generic `TossOpenApiMarketDataAdapter`는 injected read-only client에 path와 optional `date` query를 전달한다. Strict response/evidence/replay adapter와 credential-free coverage probe contract는 분리된 synthetic/in-memory 입력으로 구현됐다. Calendar 전용 safe-disabled token issuer, Calendar GET network transport와 paper-only acquisition coordinator는 synthetic loopback HTTPS 범위로 구현됐다. Coordinator와 evidence acquisition transport는 generic adapter보다 엄격하게 canonical `date` query를 필수로 요구한다.
- 실제 KRX/NYSE official source document를 확보하고 publisher, URL, retrieval time, stale policy와 source document hash를 기록해야 `official_exchange` evidence를 만들 수 있다.
- KRX derivatives 2013~2015 legacy document는 exact file identity, 전용 request header 및 연도별 parameter/header-value registry, loopback-tested `fileDown` OTP GET consumer, exact 300-byte canonical Base64 verifier, OTP 발급 request의 `file_nm`에 bind된 one-shot opaque lifecycle, download POST wire/network policy, fixed encoder/loopback-tested POST consumer, lifecycle coordinator, registered byte-length/SHA-256/OLE-signature identity verifier, identity-verified opaque response consumer, MS-CFB header boundary와 fixed header lifecycle consumer, standalone DIFAT/FAT-sector-location boundary까지 candidate로 구현됐다. DIFAT boundary는 아직 opaque lifecycle에 연결하지 않았고 FAT marker/chain, directory, stream, Word table parser와 market-role/coverage 검증이 없으므로 accepted source나 historical completeness 근거가 아니다.
- [Official Market Calendar Source Acquisition 계획](official-market-calendar-source-acquisition-plan.md)은 `official_exchange`용 official entry point, raw byte 보존, multi-document collection manifest, date-effective regular-session regime, provenance metadata, full coverage와 fail-closed acceptance 기준을 고정한다. 현재 v1은 exchange별 단일 source와 단일 regular session만 표현하므로 contract revision, actual exchange source acquisition과 adapter 구현은 아직 수행하지 않았다.
- `official_market_calendar_evidence.v1` artifact writer는 구현됐지만 official source document를 읽어 payload를 생성하는 ingestion path는 아직 없다.
- 새 official evidence contract는 legacy rule/fixture로 투영할 수 있지만 availability CLI, batch replay 또는 readiness report가 이 projection을 직접 호출하도록 연결되지는 않았다.
- 따라서 현재 replay calendar evidence class는 계속 `observed_session_only`이며 official holiday/early-close readiness는 충족되지 않았다.

## Calendar Evidence Source Hierarchy

Calendar source, source evidence class와 replay evidence class는 서로 다른 책임이다.

| 구분 | 책임 | 허용되는 주장 | 금지되는 승격 또는 주장 |
| --- | --- | --- | --- |
| `official_broker_observed` | Official Toss Open API `GET /api/v1/market-calendar/{KR|US}` response를 requested date와 실제 returned session 범위에 한정해 검증한 operational/observed broker calendar input | 검증된 request와 response 범위 안의 observed session 후보 | KRX/NYSE first-party archive와 동급 취급, exchange historical completeness, official holiday archive completeness, `official_exchange` readiness |
| `official_exchange` | KRX/NYSE first-party raw document와 source-backed collection으로 exchange-grade historical evidence 구성 | 검증된 document coverage와 provenance 범위의 exchange calendar evidence | 미확인 기간 소급, Toss response 또는 third-party source로 raw exchange evidence 대체 |
| `observed_session_only` | Historical completeness가 입증되기 전 replay가 유지하는 calendar evidence class | 실제 검증된 observed session 범위의 paper-only replay input 후보 | Official holiday/early-close completeness 또는 `official_exchange` readiness |

Official Toss Open API calendar는 primary operational/observed broker source다. KRX와
NYSE raw document는 별도의 상위 exchange-grade historical evidence다. Source가
official broker라고 해서 replay evidence class가 자동 승격되지는 않는다. 실제
historical coverage가 검증되기 전에는 `observed_session_only`를 유지한다.

Actual acquisition은 [Official Toss Open API Adapter Design](official-toss-open-api-adapter-design.md)의
calendar 전용 network allowlist를 따라야 한다. Exact token POST와 KR/US calendar GET
외의 host, method, path, query 또는 account header는 허용하지 않으며, disabled/invalid
config, redirect, timeout, response-size/content-type 위반과 partial body는 evidence 생성
전에 fail-closed 처리한다. Raw response bytes는 parser와 evidence hash 입력을 위해
memory에서만 전달하고 public artifact나 log에 저장하지 않는다.

Token issue와 calendar GET의 각 network attempt는 socket inactivity timeout이 아니라
request 시작부터 DNS/TCP/TLS, response header와 complete body 수신까지를 포함하는
10,000ms 이하의 monotonic absolute deadline을 사용한다. Chunk 수신으로 deadline을
연장하지 않으며, slow-drip을 포함해 deadline 안에 complete body를 받지 못하면 request와
stream을 abort하고 partial bytes를 폐기한다. Token POST는 `Range`/`If-Range`를 보내지 않고
token response도 calendar와 같이 exact status `200`이며 raw `Content-Range`가 없을 때만
parser/cache로 전달한다. Valid JSON을 가진 다른 `2xx`와 status `200`/`Content-Range` 조합도
허용하지 않는다.

Initial calendar GET과 guarded `401` 뒤 retry는 exact
`Cache-Control: no-cache, no-store, max-age=0`과 `Pragma: no-cache`를 보내고
`If-None-Match`/`If-Modified-Since` conditional request를 금지한다. Final response의 raw
`Date`는 exactly one canonical IMF-fixdate, raw `Age`는 없거나 single non-negative decimal
integer, raw `Expires`는 없거나 single canonical IMF-fixdate여야 한다. Response
cache-control과 `Expires`는 canonical value 또는 header 부재를 `null`로 보존한다.
Duplicate/missing/invalid cache metadata는 parser/evidence builder 전에 거부한다.

Initial calendar request와 유일한 retry는 각각 실제 사용한 token lease generation을
보존한다. Initial refreshable `401`은 해당 generation만 compare-and-clear한 뒤 current/new
lease로 한 번 retry한다. Retry도 refreshable `401`이면 retry generation을 compare-and-clear하고
현재 호출은 auth failure로 종료한다. 이 final invalidation은 token 발급이나 세 번째 calendar
attempt를 시작하지 않는다. Retry token이 current면 제거해 다음 caller의 재사용을 막고, 이미
newer generation이 current이면 stale invalidation은 no-op으로 current token을 보존한다.

Calendar GET request에는 `Range` 또는 `If-Range`를 보내지 않는다. Final response는 exact
status `200`이고 raw `Content-Range`가 없어야 하며, `206 Partial Content`, 그 밖의 `2xx`와
status `200`/`Content-Range` 조합은 body가 strict response parser를 통과할 JSON이어도
response parsing과 evidence builder 전에 거부한다. 이 조건은 기존
`officialMarketCalendarFinalResponseBoundary`의 complete-representation 원칙과 같다.

Token과 calendar request는 exact `Accept-Encoding: identity`만 전송하고 transport의
automatic response decompression을 비활성화한다. Raw `Content-Encoding` header가 존재하면
값이 `identity`여도 parser 전에 거부한다. HTTP transfer framing 제거 후 content decoding
전 exact identity payload bytes를 streaming으로 세어 token 256KiB/calendar 1MiB cap을
적용하며, calendar parser와 response SHA-256/byte length는 모두 이 동일한 bytes를 입력으로
사용한다. Encoded byte length, decoded byte length 또는 library-decoded body를 evidence
identity로 혼용하지 않는다.

Provider가 query 생략 시 기본 기준일을 선택하더라도 acquisition coordinator는 이
동작을 사용하지 않는다. Canonical `date=YYYY-MM-DD`를 exactly one으로 전송하고
effective query의 값이 requested date, evidence request와 일치하는지 response parsing
전에 검증한다. 누락, duplicate, unknown query와 mismatch response는 deterministic
request provenance를 만들 수 없으므로 evidence artifact를 생성하지 않는다.

2026-08-14의 official OpenAPI `latest`는 `1.2.14`이며
`officialBrokerObservedCalendarOpenApiCompatibility.ts`가 account/order/execution example을
제외한 calendar-scoped snapshot bytes의 자체 SHA-256, source document SHA-256과 calendar
operation/schema binding을 먼저 검증하고 snapshot의 exact example
value를 기존 strict response parser로 검증한다. Compatibility result는 document SHA-256,
KR/US operation과 parser contract identity를 고정하고 scope를
`pinned_document_examples_only`로 제한한다. Component schema가 허용하는 모든 optional
조합의 호환성을 주장하지 않으며 compatibility gate 자체는 evidence artifact를
만들지 않는다. Compatibility result의 legacy handoff field는
`blocked_pending_version_aware_consumers`로 유지하며, 이 result 자체로 actual response
handoff를 승인하지 않는다. Network-derived v2 handoff 권한은 compatibility result가 아니라
별도 process-local lifecycle factory provenance에서만 생긴다. 기존
`official_broker_observed_calendar_evidence.v1` schema/builder/verifier와
legacy `source.apiVersion`은 `1.2.13` parser contract snapshot 의미를 그대로 보존한다.
이 field는 synthetic-only v1 parser가 검증된 OpenAPI contract identity이며 actual network
response를 제공한 provider deployment version 관측값이 아니다.

`src/replay/officialBrokerObservedCalendarEvidenceV2.ts`는 backward-compatible
`official_broker_observed_calendar_evidence.v2` schema/builder/verifier와 v1/v2
schema-version dispatch를 구현한다. V2 provenance는 immutable trusted parser contract registry가 결합한 exact
`source.apiContractVersion="1.2.14"`, official OpenAPI document SHA-256, calendar operation
id/path와 response parser contract version, cache request policy version, actual retrieval
completion, raw header에서 parse한 canonical `responseDate`, nullable
`responseAgeSeconds`와 nullable `responseExpires`, final attempt의 monotonic elapsed time에서 올림한
`responseDelayMilliseconds`, canonical response cache-control, corrected
`effectiveResponseAt`과 `staleAfter`를 기록한다. OpenAPI document identity는 bytes를 해석한 contract snapshot이지
provider deployment version 관측 증거가 아니다. Coordinator는 임의의 caller-provided
version/cache metadata/timestamp를 받지 않고 검증된 registry entry와 network observation만
builder에 전달한다. Compatibility result의 pinned example body는 registry identity를 선택하는
근거일 뿐 actual network response와 equality를 요구하지 않는다. Builder는 별도 requested
date와 exact raw bytes를 strict parser, response hash, request/coverage binding으로 검증한다.
`officialMarketCalendarResponseCacheHeaders.ts`의 network variant는 raw
`Expires`를 nullable canonical provenance로 보존하고,
`officialMarketCalendarNetworkResponseFreshness.ts`는 response delay, HTTP corrected age,
response Cache-Control과 `Expires` expiry를 다시 계산해 recorded `effectiveResponseAt`과
`staleAfter`를 검증한다.
V2 artifact만으로는 response hash와 normalized response를 재검증할 수 없다. Actual network
observation은 v2 evidence, exact response bytes와 검증된 cache metadata를 함께 가진
process-local ephemeral envelope 안에서만 verified 상태를 유지한다.

Calendar endpoint와 official OpenAPI `latest` document는 immutable versioned resource가
아니므로 v2 strict schema는 `source.apiVersion` 또는 `source.providerApiVersion` claim을
허용하지 않는다. Provider가 공식적으로 정의한 authenticated response metadata, versioned
endpoint 또는 signed manifest로 contemporaneous binding을 제공하기 전에는 actual served
version은 `unknown/not_claimed`이며 artifact에 쓰지 않는다. Verifier는 artifact schema
version으로 v1/v2를 분기하고 unknown schema/API contract version, registry 누락,
document hash/operation/parser mismatch와 provider deployment version claim을 fail-closed로
거부한다. 기존 v1 artifact를 rewrite하거나 metadata 상수만 `1.2.14`로 바꾸고 historical
completeness를 추정해 version drift를 우회할 수 없다.

V2 evidence transition, version-aware replay consumer migration과 ephemeral lifecycle
boundary는 구현됐다.
`officialBrokerObservedCalendarReplayAdapter.ts`의 embedded evidence schema와 verifier,
`officialBrokerObservedCalendarCoverageProbe.ts`의 verified evidence collection은 shared
schema-version dispatcher로 v1/v2를 구분하고 각각의 exact raw response bytes와 `asOf`를
version별 verifier에 다시 전달한다. Replay input과 coverage report를 다시 읽을 때도 같은
dispatch와 raw-byte 검증을 반복하며, unknown schema, raw-byte 누락/불일치, registry mismatch
또는 version별 normalized response mismatch는 `observed_session_only` input과 coverage result를
만들기 전에 거부한다. Existing v1 artifact/replay input/coverage report identity와 regression은
그대로 보존한다. `officialBrokerObservedCalendarEphemeralObservation.ts`는 v2 evidence와
exact bytes를 WeakMap-backed opaque handle로 결합하고 verified factory가 만든 handle만 1회
소비하게 한다. Factory는 transferred caller byte view를 내부 copy와 분리하고 caller view를 즉시
zeroize한다. Handle은 evidence/raw bytes를 노출하지 않으며 module-owned fixed replay input 또는
coverage report operation만 internal bytes를 사용할 수 있다. Consume 시점의 `asOf`와 exact bytes로
evidence를 다시 검증하고 operation 종료, verifier/builder 오류, stale, 명시적 disposal 또는 JSON
export 시도 뒤 internal bytes를 zeroize한다. Fixed operation은 derived replay input/report를 내부에서만
만들고 caller callback 또는 return value로 제공하지 않는다. Handle 재사용과 직렬화를 거부하며
public consumer registration surface를 두지 않는다.

Future `official_broker_observed` contract는 최소한 request path/query, requested
date, market, retrieval timestamp, accepted identity payload의 exact hash와 byte length,
parser/API contract snapshot identity, stale policy와 requested/returned coverage 결과를 secret-free
provenance로 기록해야 한다. Actual provider deployment version은 authoritative
request-response binding이 확인될 때만 별도 contract로 추가한다. Unsupported date, partial
response, schema mismatch, provenance 누락, stale source 또는 coverage 불명확성은 observed
input 후보를 만들지 않고 fail-closed로 처리한다. Access token과 client credential은
artifact, log, docs, test fixture 또는 PR body에 기록하지 않는다.

현재 `official_market_calendar_evidence.v1`의 `purpose`와 `evidenceClass`는 각각
`official_exchange_calendar_evidence`, `official_exchange`로 고정돼 있다.
`official_broker_observed`를 이 schema에 주입하거나 v1 artifact를 재해석하지
않는다.

`src/replay/officialBrokerObservedCalendarEvidenceTransition.ts`는
`broker_observed_calendar_evidence_transition.v1` strict contract로 source evidence
class와 replay evidence class의 전이를 분리한다. Source registry는
`official_broker_observed`, `official_exchange`만 허용하고 broker transition input은
`official_broker_observed`와 `paper_only`로 고정한다. 모든 gate가 verified 상태일
때만 `observed_session_only` 후보를 반환하고 historical completeness claim은 항상
`not_claimed`다. Unsupported date, partial response, schema mismatch, provenance
missing, stale source와 ambiguous coverage는 deterministic reject code를 반환하고
replay evidence class를 `null`로 유지한다. Unknown field, `official_exchange` 입력과
broker source의 exchange-grade 승격 시도는 strict schema에서 거부한다.

`src/replay/officialBrokerObservedCalendarResponse.ts`는 2026-08-12에 확인한 official
OpenAPI `1.2.13`의 KR/US market calendar response를 synthetic fixture로 고정한
`official_broker_observed_calendar_response.v1` strict parser/normalizer다. KR은
`integrated` 안의 `preMarket`, `regularMarket`, `afterMarket`, US는 `dayMarket`,
`preMarket`, `regularMarket`, `afterMarket`을 nullable session으로 읽는다. 세 returned
day의 필수 존재, requested date와 `today.date` 일치, strict chronological order,
session time과 positive auction interval boundary, day 내부와 returned day 사이의
non-overlap을 검증한다.

`src/replay/officialBrokerObservedCalendarEvidence.ts`는 parser 결과를
`official_broker_observed_calendar_evidence.v1` provenance artifact로 결합한다.
Market별 OpenAPI `1.2.13` GET path/operation id와 exact `date` query, retrieval
timestamp, raw response SHA-256/byte length, parser contract version을 기록한다.
Legacy `source.apiVersion`은 이 parser contract snapshot을 식별하며 provider가 실제 제공한
API version을 관측했다는 뜻이 아니다.
V1 synthetic/in-memory builder는 raw bytes를 다시 제공해야 response hash와 normalized
response를 함께 검증하며,
request/response/coverage/freshness metadata와 canonical artifact hash 중 하나라도
달라지면 거부한다. Freshness policy는 retrieval부터 86,400초이며 `asOf`가 retrieval
이전이거나 `staleAfter` 이상이면 fail-closed다. Coverage는 requested date, 반환된
세 date, 실제 반환 session count/range만 포함한다. Historical completeness는
`not_claimed`, replay evidence class는 `observed_session_only`로 고정하며
`official_exchange` 승격을 허용하지 않는다. 이 artifact는 network acquisition이나
실행용 calendar fixture가 아니다. V1은 response cache provenance를 표현하지 못하므로
actual network response handoff에 사용하지 않는다.

Actual network coordinator는 final calendar request attempt 시작 직전에 monotonic clock을
기록하고 accepted complete body 수신 시 같은 monotonic clock과 coordinator-owned UTC clock을
읽어 immutable `completedAt`을 transport result에 결합한다. Final attempt elapsed nanoseconds를
millisecond로 올림한 `responseDelayMilliseconds`는 safe integer `0..10,000`이어야 한다. Raw
`Date`가 `completedAt`보다 늦으면 거부한다. Response delay를 받지 않는 현재
`resolveOfficialMarketCalendarResponseFreshness`는 actual network v2에 그대로 사용하지 않으며,
backward-compatible network-bound variant가 다음 HTTP corrected age를 적용해야 한다.

```text
responseDelayMilliseconds = ceil(finalAttemptElapsedNanoseconds / 1,000,000)
apparentAgeMilliseconds = max(0, completedAtMs - responseDateMs)
correctedAgeValueMilliseconds = (responseAgeSeconds ?? 0) * 1,000 + responseDelayMilliseconds
correctedInitialAgeMilliseconds = max(apparentAgeMilliseconds, correctedAgeValueMilliseconds)
effectiveResponseAtMs = completedAtMs - correctedInitialAgeMilliseconds
policyStaleAfterMs = effectiveResponseAtMs + 86,400 * 1,000
expiresFreshnessLifetimeMilliseconds = responseExpiresMs == null
  ? null
  : max(0, responseExpiresMs - responseDateMs)
expiresStaleAfterMs = expiresFreshnessLifetimeMilliseconds == null
  ? null
  : effectiveResponseAtMs + expiresFreshnessLifetimeMilliseconds
responseStaleAfterMs = hasValidatedResponseMaxAge
  ? effectiveResponseAtMs + validatedResponseMaxAgeSeconds * 1,000
  : responseExpiresMs != null
    ? expiresStaleAfterMs
    : policyStaleAfterMs
staleAfterMs = min(policyStaleAfterMs, responseStaleAfterMs)
```

Response semantic allowlist는 `public`, `private`, `no-transform`, `must-revalidate`,
`proxy-revalidate`, `max-age`, `s-maxage`, `no-cache`, `no-store`로 고정한다. `max-age`와
`s-maxage`는 unquoted `0|[1-9][0-9]*` safe integer argument를 정확히 하나 요구하고,
`validatedResponseMaxAgeSeconds`는 두 값 중 최솟값이며 둘 다 없으면 86,400이다. 나머지
directive는 argument를 허용하지 않는다. `no-cache`, `no-store`와 allowlist 밖 extension은
evidence reuse 의미를 추측하지 않고 parser/evidence builder 전에 거부한다. 허용된
non-lifetime directive는 provenance로만 보존하며 expiry를 늘리지 않는다. `max-age=0`,
`s-maxage=0` 또는 corrected age 때문에 `completedAt >= staleAfter`이면 initial evaluation에서
already-stale로 거부한다.

Raw `Expires`는 없거나 exactly one canonical IMF-fixdate여야 하며 nullable provenance로
보존한다. `max-age`/`s-maxage`가 하나라도 있으면 `Expires`보다 우선하고, 둘 다 없으면
`Expires - Date`의 non-negative freshness lifetime을 corrected `effectiveResponseAt`에 더해
response expiry를 계산한다. 이 fallback의 `Expires <= Date`, corrected age로 이미 만료된
response, millisecond subtraction/addition overflow와 canonical date range 이탈은 fail-closed다.

Monotonic clock 역행, deadline 초과, second-to-millisecond 변환과 age/delay 합산의 safe-integer
overflow, timestamp subtraction/addition의 canonical date range 이탈은 fail-closed다. Guarded
retry가 있으면 실패 attempt의 elapsed time을 합산하지 않고 final response를 만든 attempt의
request/response delay만 결합한다.

V2 evidence의 `retrievedAt`은 실제 completion인 `completedAt`, initial `evaluatedAt`도
`completedAt`으로 기록하지만 freshness는 response delay가 반영된 `effectiveResponseAt`에서만 시작한다.
`completedAt >= staleAfter`이면 evidence 생성 전에 거부한다. Public coordinator input은
retrieval/evaluation/cache timestamp나 response delay를 받지 않으며 caller, provider body, env
또는 config 값을 신뢰하지 않는다. Production clock override는 금지하고 deterministic
wall/monotonic clock은 test-only factory에만 주입한다. 같은 cached representation의 재조회는
completion 시각만으로 freshness를 연장할 수 없다.

Durable raw-byte threat model과 저장 계약이 merge되기 전에는 actual network-derived v2
observation과 그 replay input/coverage report를 process 밖으로 persist/export하지 않는다.
Coordinator는 ephemeral handle을 같은 process의 fixed version-aware operation에 직접 넘기고,
operation은 내부 exact bytes로 evidence를 다시 검증한 뒤 성공/실패와
관계없이 chain 종료 시 bytes reference를 폐기한다. Detached v2 evidence, replay input 또는 report, process 재시작 뒤 남은
artifact와 raw-byte 누락 입력은 unverifiable로 fail-closed 처리한다. JSON/file/DB/object store,
workflow artifact writer, audit, CLI, MCP와 API response는 이 handle 또는 derived output의
durable sink가 될 수 없다. 재사용하려면 acquisition을 다시 수행한다.

현재 `src/replay/officialBrokerObservedCalendarReplayAdapter.ts`는 v1/v2로 dispatch해
검증된 evidence와 exact raw response bytes를 `asOf` 시점에 다시 확인한 뒤 기존 paper-only
`calendarValidation` 입력으로 변환한다. Market별 rule은 KR/`KRX`/`Asia/Seoul` 또는
US/`NYSE`/`America/New_York` 하나이고 fixture는 response가 반환한 세 date에만
생성한다. Open day는 regular session이 정확히 하나일 때만 기존 단일-session
fixture로 변환한다. Regular session 누락, fixture timezone/date 불일치, evidence
hash, source ref, rule 또는 transition 변조는 모두 거부한다. Closed day는 legacy
fixture의 `isHoliday` fail-closed 분기를 사용하되 이름을
`Toss broker-observed market closure`로 고정한다. 이는 official holiday 이름이나
holiday/archive completeness claim이 아니다. Adapter output은 계속
`observed_session_only`이며 replay를 실행하거나 파일/network를 읽지 않는다.

`src/replay/officialBrokerObservedCalendarCoverageProbe.ts`는 credential 없이 생성할
수 있는 `every_calendar_date.v1` plan과 evidence 기반 report를 제공한다. Plan은 최대
10,000일 범위의 모든 calendar date를 빠짐없이 canonical order로 요청하도록
고정한다. Report builder는 각 verified observation의 schema version, exact raw bytes와
version별 freshness를 다시 검증하고 공통 최대 86,400초 경계를 넘지 않게 제한한 뒤
replay adapter의 regular-session/timezone 경계까지 통과시킨다. 변환 불가능한 evidence, rejected observation과 관찰되지 않은 plan
date를 별도로 기록한다. 서로 다른 evidence가 겹쳐 반환한 같은 market date의 status/session이
다르면 returned-date conflict로 판정한다. 모든 plan date가 verified이고 conflict가
0일 때만 `coverageStatus="verified"`와 observed replay `eligible`을 기록한다. 이는
명시된 planned-date 범위의 broker observation coverage만 뜻한다. Report가 verified여도
historical completeness는 `not_claimed`, `officialExchangeReadiness`는
`not_established`, replay class는 `observed_session_only`로 유지한다. Plan/report는
canonical hash를 포함하지만 HTTP/OAuth를 호출하거나 raw bytes/credential을 report에
저장하지 않는다. Stored report parser는 report만 신뢰하지 않고 requested date별
evidence와 exact raw bytes observation을 다시 받아 같은 plan/evaluatedAt으로 report
전체를 재생성한 뒤 exact match를 요구한다. 따라서 conflict, summary, issue와 status를
함께 바꾸고 public hash를 다시 계산해도 원본 observation과 다르면 거부한다. 또한
non-null evidence artifact hash 고유성을 요구해 하나의 evidence가 복수 날짜 coverage로
재사용되지 않게 한다. 이 stored-report 검증은 synthetic v1 또는 승인된 별도 저장 계약으로
exact bytes를 공급할 수 있는 observation에만 적용한다. Actual network-derived v2 report는
ephemeral envelope의 lifetime을 벗어나 저장하거나 다시 읽을 수 없다.
각 timestamp는 KR session의
same-day KST date, US `regularMarket`/`afterMarket`의 next-day KST overnight boundary를
포함해 returned market date와 결합한다. Missing/unknown field,
cross-market shape, explicit offset 없는 timestamp, invalid/non-canonical normalized UTC
timestamp, market/session에서 지원하지 않는 auction field와 ambiguous KR all-null
integrated object를 fail-closed로 거부한다. Official response timestamp는 documented KST
`+09:00` offset을 가져야 하며 다른 offset은 schema mismatch로 처리한다.

Normalized output은 `previous_business_day`, `today`, `next_business_day`와 market별
canonical session order를 사용하고 timestamp를 UTC ISO string으로 정규화한다.
휴장 응답은 holiday archive completeness를 주장하지 않고 `status="closed"`, 빈
session 목록으로만 보존한다. Output source class는 `official_broker_observed`로
고정되며 `official_exchange`로 승격할 수 없다.

이 parser 자체는 actual network transport를 호출하거나 provenance/hash/coverage를
직접 검증하지 않는다. 해당 책임은 별도 evidence, replay adapter와 coverage probe
contract가 담당한다. OpenAPI compatibility gate와 version-aware evidence transition은
synthetic/public contract 범위로 구현됐고 replay adapter/coverage probe consumer migration과
ephemeral acquisition lifecycle boundary도 구현됐다. Acquisition coordinator는 production
token/auth/calendar 고정 조립, pinned example 기반 parser registry 선택, actual-response v2 strict validation과 opaque lifecycle handoff까지
구현됐으며 raw-byte persistence, stored report와 replay 실행은 포함하지 않는다.

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

`official_market_calendar_evidence.v1`은 기존 실행용 `MarketCalendarFixture`와 분리된 `official_exchange` source provenance contract다. 이 artifact는 source를 수집하지 않으며, 입력이 official exchange evidence라고 주장하려면 다음 정보를 모두 제공하도록 강제한다. Official Toss Open API의 `official_broker_observed` response는 이 artifact에 넣지 않는다.

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
