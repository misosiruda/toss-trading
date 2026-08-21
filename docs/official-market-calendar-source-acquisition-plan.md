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

### 2026-08-20 read-only request discovery

2026-08-20에 official domain의 현재 HTML과 client JavaScript를 credential 없이
읽어 다음 request surface를 추가로 확인했다. 이 확인은 response body와 hop별
metadata를 acquisition package에 보존한 실행이 아니므로 accepted source evidence,
historical coverage 또는 freshness 증거로 사용하지 않는다.

| Exchange | 확인된 현재 surface | 여전히 닫힌 경계 |
| --- | --- | --- |
| KRX | Holiday page form은 `POST /contents/GLB/99/GLB99000001.jspx`, `data-bld=GLB/05/0501/0501110000/glb0501110000_01`, `search_bas_yy`, `gridTp=KRX`, `pagePath`를 노출한다. Current selector는 2016부터 2026까지다. | 2013부터 2015까지의 official row source가 노출되지 않는다. OTP request/response와 data POST의 exact hop, header, cache, framing 및 cookie-free 동작을 아직 accepted acquisition으로 검증하지 않았다. |
| KRX | Page JavaScript는 `GET /contents/COM/GenerateOTP.jspx`에 `name=form`과 exact `bld`를 보내 동적 `code`를 받은 뒤 form payload에 결합한다. Download도 별도 OTP를 사용한다. | 동적 code를 provenance에 안전하게 결합하는 contract, token 성격과 보존 정책, download response format은 미확정이다. Raw code를 secret-free metadata라고 가정하지 않는다. |
| NYSE | `GET https://www.nyse.com/trade/hours-calendars`의 current server-rendered HTML은 2026, 2027, 2028 holiday table, early-close 각주, core session 09:30~16:00 ET와 official `https://www.nyse.com/publicdocs/Trading_Days.pdf` link를 포함한다. | 2013부터 2025까지의 first-party archive는 현재 page에서 확인되지 않는다. Current HTML/PDF를 과거 규칙에 소급하지 않으며 parser contract와 exact bytes acquisition은 아직 등록하지 않는다. |

KRX 관찰에서 dynamic OTP가 확인됐으므로 direct data POST URL과 form field만으로
request contract가 완성됐다고 주장하지 않는다. Production acquisition client는
OTP 발급 request도 official-domain ancillary request로 명시적으로 관찰하고,
opaque redirect/cookie/credential state 없이 exact effective request chain을 증명할
수 있어야 한다. 이 조건을 만족하기 전에는 OTP code를 획득하거나 holiday data
POST를 production evidence path에서 실행하지 않는다.

NYSE current page는 target interval 중 2026-01-01부터 2026-05-31 일부를 직접
뒷받침할 가능성이 있지만, current page의 schedule coverage claim, parser format,
retrieval freshness와 exact source bytes를 모두 검증하기 전에는 artifact에 포함하지
않는다. 2013부터 2025까지의 gap은 current page나 third-party calendar로 채우지 않는다.

이 미확인 상태는 `official_exchange` 승격 blocker다. Official Toss Open API
`GET /api/v1/market-calendar/{KR|US}`는 별도의 primary operational/observed broker
calendar source이며 `official_broker_observed` class로 관리한다. Toss response는
실제로 검증된 requested date와 returned session 범위에 한해서만
`observed_session_only` paper-only replay input 후보가 될 수 있고, KRX/NYSE
first-party archive 또는 historical completeness를 대신하지 않는다.

### Request Header Policy 사전 등록

확인된 entry point는 다음 immutable request-header policy version으로 사전
등록한다. 기존 KRX source policy는 fixed known-safe set인 `accept`,
`accept-language`, `cache-control`, `content-type`, `pragma`만 허용하고 NYSE
policy는 `accept`, `cache-control`, `pragma`만 허용한다. KRX OTP endpoint는
별도 version에서만 `accept`, `cache-control`, `pragma`, `user-agent`를 허용한다.
기존 version의 allowed-name set은 변경하지 않는다.

| Exchange | `requestHeaderPolicyVersion` | Official entry point |
| --- | --- | --- |
| KRX | `krx_form_otp_request_headers.v1` | `https://global.krx.co.kr/contents/COM/GenerateOTP.jspx` |
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

OTP header-name policy 등록은 허용 가능한 header name의 상한만 고정한다. Exact
value는 아래 별도 header-value policy가 담당한다. Header/parameter value policy의
HTTP client wiring과 process-local OTP 수명은 후속 dedicated network/ephemeral
consumer가 담당한다. 현재 fixed OTP GET, one-time consumption, raw code 비직렬화와
후속 data POST wiring은 아래 별도 모듈로 구현됐지만, 이 policy들 자체만으로 OTP
발급, accepted source acquisition 또는 publication readiness를 통과했다고 판단하지
않는다.

### Request Parameter Policy 사전 등록

KRX form OTP request는 `krx_form_otp_request_parameters.v1`로 별도 등록한다.
이 version은 `GET https://global.krx.co.kr/contents/COM/GenerateOTP.jspx`,
`krx_form_otp_request_headers.v1`과 canonical fixed parameter
`bld=GLB/05/0501/0501110000/glb0501110000_01`, `name=form`을 exact 결합한다.
Allowed parameter name은 현재 `bld`, `name`뿐이며 `code`, OTP/token,
authorization, cookie와 미등록 이름은 fail-closed로 거부한다.

이 generic 정책은 query parameter를 URL과 분리해 secret-free canonical object로 검증하는
contract일 뿐이다. Dedicated OTP/data network policy, consumer와 coordinator가 registered
parameter를 fixed HTTP request, OTP response bytes/shape, raw code의 process-local one-time
lifecycle과 후속 data POST에 결합한다. Registry 등록만으로 해당 실행 결과나 accepted
acquisition을 주장하지 않는다.

### Request Header Value Policy 사전 등록

KRX form OTP request의 fixed non-representation header value는
`krx_form_otp_request_header_values.v1`로 별도 등록한다. 이 version은 같은 KRX
OTP GET URL, `krx_form_otp_request_headers.v1`,
`krx_form_otp_request_parameters.v1`과 exact `user-agent: Mozilla/5.0`을 결합한다.
2026-08-20 read-only observation에서 해당 최소 User-Agent가 cookie 없이 OTP-shaped
response를 반환한 조건을 재현하기 위한 값이며 KRX의 영구 public API contract라고
주장하지 않는다.

Fixed-value name은 현재 `user-agent`만 허용하고 authorization, cookie 또는 다른
header category는 이 policy에 넣을 수 없다. Dedicated OTP network policy와 consumer가
registered value를 fixed request와 bounded response 검증에 결합하지만, 이 등록만으로
external verification 또는 accepted acquisition 성공을 주장하지 않는다.

### KRX OTP Response Body Shape

2026-08-20 cookie/redirect-disabled Node 재관찰에서 fixed KRX form OTP GET은
application-controlled header `accept`, `cache-control`, `pragma`, `user-agent`만 사용했고
HTTP/1.1 200과 exact `Content-Length: 216`, `Content-Type: text/html;charset=UTF-8`을
반환했다. `Cache-Control`은 `max-age=0, no-cache, no-store`, `Pragma`는 `no-cache`,
`Expires`는 `Date`와 같았고 response `Set-Cookie`는 2개였다. Raw OTP와 cookie value는
기록하지 않았다.

`officialMarketCalendarKrxOtpNetworkPolicy.ts`는 이 wire boundary를 기존
`krx_form_otp_request_headers.v1`, parameter/value policy와 결합한다. Redirect/cookie jar,
credential header, connection reuse를 금지하고 10초 deadline과 1,024-byte local response
cap을 고정한다. Policy 자체는 HTTP I/O를 수행하지 않으며 raw OTP process-local only,
durable reuse와 accepted acquisition false를 유지한다.

`createOfficialMarketCalendarKrxOtpNetworkConsumer`는 caller input 없이 registered query와
headers만 전송하는 production fixed HTTPS consumer다. Platform trust와 production
`global.krx.co.kr` Host/SNI, connection reuse disabled와 10초 absolute deadline을 고정하고
dial/CA/deadline override를 노출하지 않는다. Loopback test factory만 synthetic CA와 더
짧은 deadline을 받으며 같은 certificate hostname 검증을 유지한다.

Consumer는 response allocation 전에 HTTP/1.1 200, exact 216-byte content-length, raw-wire
content type, cache/expiry와 positive `Set-Cookie` name count를 검증한다. Complete body는
bounded buffer에서 기존 OTP shape verifier를 거쳐 opaque handle로 이전하고, 각 source
chunk와 실패한 buffer를 zeroize한다. Raw OTP와 cookie value는 log/API/MCP/artifact에
노출하지 않으며 accepted acquisition과 durable reuse는 계속 false다.

2026-08-20 read-only 관찰에서 OTP response body는 whitespace 없는 216-byte canonical
base64였고 exact `==` padding을 제거해 decode하면 160 bytes였다.
`officialMarketCalendarKrxOtpResponseBody.ts`는 string 또는 decoded token copy를 만들지
않고 byte-level alphabet, exact padding과 unused padding bit를 검증한다. 검증용 내부
copy는 성공/실패와 관계없이 zeroize하며 caller byte view의 ownership은 변경하지 않는다.

반환값은 encoding과 encoded/decoded length만 포함하는 non-secret frozen shape이며 raw
body hash나 token을 포함하지 않는다. 이 body-only contract는 status, final URL,
response header, transfer completion, freshness 또는 network provenance를 증명하지
않는다. Dedicated opaque one-shot ownership handle과 fixed data-POST consumer가 이
후속 lifecycle을 구현하지만 raw OTP를 durable metadata, log, API, MCP, CLI 또는
artifact에 넣지 않는 경계는 그대로 유지한다.

`officialMarketCalendarKrxOtpEphemeralBody.ts`는 body-shape 검증을 통과할 raw response
bytes의 ownership을 process-local opaque handle로 이전하는 첫 lifecycle 단계를
구현한다. Factory는 caller view를 internal copy와 분리한 직후 zeroize하고, 검증 실패
시에도 caller/internal bytes를 모두 zeroize한다. Handle은 frozen null-prototype object와
non-enumerable `toJSON`만 가지며 raw bytes 또는 non-secret shape도 노출하지 않는다.

JSON export 시도는 handle을 dispose한 뒤 거부하고, 명시적 disposal은 internal bytes를
zeroize하며 idempotent하다. Factory가 만들지 않은 forged handle은 거부한다. Dedicated
network factory와 fixed data-POST consumer는 이 handle을 process-local lifecycle에서만
사용한다. 이 wiring도 durable reuse 또는 accepted evidence로 승격하지 않으며 callback,
raw-byte getter, serialization 또는 durable sink를 추가하지 않는다.

### KRX Legacy Derivatives Trading Calendar Source Candidate

2026-08-20 read-only 재조사에서 KRX Global의 derivatives market calendar page는
2004~2024 yearly `.doc`와 2025 `.pdf` download selector를 노출하며 2021 항목은
보이지 않았다.
기존 holiday-data selector 밖인 2013~2015의 exact file name을 공식 page JavaScript의
`fileDown` OTP flow로 요청한 결과, cookie jar/redirect/credential 없이 각기 다른 OLE
Compound `.doc` file이 반환됐다. Raw OTP와 문서 bytes는 보존하지 않았다.

`officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy.ts`는 source page,
download OTP의 fixed `name`/`filetype`/`url`, dynamic `file_nm`, file-server POST의
process-local `code`, successful observation의 Origin/Referer와 2013~2015 file name,
content length, SHA-256, OLE signature, observed title/holiday-line count를 immutable v1
candidate policy로 고정한다. 이 문서는 derivatives market scope이며 legacy Word table용
parser는 registered title을 exact paragraph에 결합하는 fixed opaque lifecycle까지 구현됐다.
Structural cell의 column/date/holiday semantics, evidence role/coverage 검증은 아직 구현하지
않았다. 따라서 KRX 전체 market holiday completeness, durable evidence reuse와 accepted
acquisition은 계속 주장하지 않는다.

`officialMarketCalendarKrxLegacyDownloadOtpNetworkPolicy.ts`는 이 candidate policy의
2013~2015 file name만 `file_nm`으로 허용한다. 전용 request-header policy와 연도별 exact
parameter/header-value policy를 registry에 선등록하고, exact `fileDown` GET parameter,
source-page Referer, fixed request header와 HTTP/1.1 `Connection: close`를 결합한다. 2026-08-20
cookie/redirect/credential-disabled 관찰에서 OTP response는 exact 300 ASCII bytes의 canonical
Base64였고 decoded length는 224 bytes, padding은 1개였다. Response는 exact `200`,
`Content-Length: 300`, `text/html; charset=UTF-8`, no-store/no-cache, `Expires == Date`와
2개의 `Set-Cookie` header를 반환했다. Cookie value는 보존하거나 후속 request에 replay하지
않는다. 전용 network consumer와 ephemeral ownership lifecycle은 이 registered policy를
실제 fixed GET request, bounded response 검증과 one-shot opaque handle에 결합한다. Raw OTP는
process-local로만 취급하며 durable evidence reuse와 accepted acquisition을 계속 금지한다.

`officialMarketCalendarKrxLegacyDownloadOtpResponseBody.ts`는 이 network policy에
고정된 exact 300-byte body만 byte-level canonical Base64로 검증한다. 마지막 `=` 1개와
직전 sextet의 unused 2 bit가 zero인지 확인해 decoded length 224를 구조적으로 고정한다.
검증용 owned copy는 성공·실패와 관계없이 zeroize하며 caller bytes의 ownership은 바꾸지
않는다. 반환되는 frozen shape에는 encoding과 길이만 있고 raw OTP, decoded bytes 또는
hash는 없다. 이 body-only 검증은 HTTP metadata, transfer completion, one-shot ownership,
download authorization이나 accepted acquisition을 증명하지 않는다.

`officialMarketCalendarKrxLegacyDownloadOtpEphemeralBody.ts`는 검증 대상 raw OTP bytes와
OTP GET에 사용한 registered `file_nm`을 함께 process-local opaque handle로 이전한다.
Factory는 두 input field를 exact 한 번만 읽고 internal copy를 만든 직후 caller bytes를
zeroize하며, invalid body/file name, detached view와 `SharedArrayBuffer` backing을 거부한다.
Explicit disposal과 JSON export 거부는 internal bytes를 zeroize하고 handle을 idempotent하게
닫는다.

Fixed consumer는 caller에게 새 file name을 받지 않고 OTP handle에 이미 결합된 2013~2015
file identity와 bytes를 opaque download-parameter handle로 exact 한 번만 이전한다. 두
handle 모두 getter, callback, enumerable field나 serialization surface를 제공하지 않는다.
Download-parameter handle을 직접 consume하는 fixed wire encoder와 download POST network
consumer도 구현됐다. Dedicated legacy OTP GET consumer는 registered file name을 network 전
검증하고 exact query/header/response boundary를 적용한 뒤 OTP bytes와 같은 file identity를
기존 opaque lifecycle로 이전한다. Durable reuse와 accepted acquisition은 계속 금지한다.

`officialMarketCalendarKrxLegacyDownloadPostWirePolicy.ts`는 source policy의 exact
`POST https://file.krx.co.kr/download.jspx`, `application/x-www-form-urlencoded`과 단일
`code` parameter를 결합한다. `code`는 generic request-parameter allowlist에 추가하지 않고
bound process-local OTP parameter handle만 공급할 수 있다. Wire definition은 exact OTP
network policy와 body-verifier version을 기록하고 resolver에서 canonical Base64, encoded
300 bytes, decoded 224 bytes와 single padding을 다시 대조한다. Encoder contract는 raw
OTP를 string으로 materialize하지 않고 ASCII bytes를 직접 순회하며 RFC 3986 unreserved
byte만 literal로 보존하고 `+`, `/`, `=`를 각각 uppercase `%2B`, `%2F`, `%3D`로 encoding한다.

Exact 300-byte Base64 input에 `code=` 5 bytes를 더한 encoded body는 최소 307 bytes,
canonical final data sextet의 unused 2-bit zero 규칙을 반영한 최악의 경우 903 bytes로
제한된다. 이 policy 자체는 body를 만들거나 network request를
실행하지 않으며 encoded body도 future opaque process-local handle 밖으로 노출하거나
durable하게 보존할 수 없다.

`officialMarketCalendarKrxLegacyDownloadPostNetworkPolicy.ts`는 global calendar host의
기존 broad allowlist를 완화하지 않고 exact `https://file.krx.co.kr/download.jspx`만 전용
`krx_file_download_host.v1` boundary로 등록한다. Request는 HTTP/1.1 `Connection: close`,
cookie/redirect/credential/connection reuse disabled, 10초 absolute deadline을 사용한다.
Application header는 exact `accept`, `cache-control`, `content-length`, `content-type`,
`origin`, `pragma`, `referer`, `user-agent`이고 Content-Length는 wire-body bytes에서만
파생한다.

Response는 exact `200`, `application/octet-stream`, 등록 document별 Content-Length와
`attachment; filename=<registered file name>`, no-store/no-cache, `Expires == Date`,
Set-Cookie 0을 요구한다. Redirect, Age, Content-Encoding, Transfer-Encoding, Content-Range와
trailers를 거부하고 최대 response는 등록 문서 중 가장 큰 252,928 bytes로 제한한다. 이
policy는 raw document retention을 등록하지 않으며 durable reuse와 accepted acquisition을
계속 금지한다.

`officialMarketCalendarKrxLegacyDownloadOtpEphemeralBody.ts`의 fixed encoder는 bound
download-parameter handle을 exact 한 번만 consume하고 raw OTP를 string으로 만들지 않은 채
ASCII bytes를 직접 uppercase percent encoding한다. Parameter bytes는 성공·실패 모두
zeroize되고 encoded wire body는 getter/serialization이 없는 새 opaque handle로만 이동한다.

Download network consumer는 exact request header와 `Content-Length`를 구성하고 production
factory에 dial/CA/deadline override를 노출하지 않는다. Test-only connector는 loopback IP,
synthetic CA, 최대 10초 deadline만 허용하고 TLS SNI/인증서는 계속 `file.krx.co.kr`로
검증한다. Response는 policy의 status/header/framing, 등록 document별 filename/content length와
transfer completion을 통과한 경우에만 process-local opaque response handle로 이전된다.
Request body와 response bytes는 failure/disposal/JSON export에서 zeroize된다.

이번 transport는 document content hash, OLE signature, table semantics와 market-role/coverage를
검증하지 않는다. 따라서 opaque response는 parser 전 candidate일 뿐 durable sidecar,
accepted evidence 또는 historical completeness 근거가 아니다. Checked-in TLS material과
response body는 synthetic fixture이며 실제 KRX OTP 또는 document bytes를 포함하지 않는다.

`officialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer.ts`는 production factory에
dial/CA/deadline override를 두지 않고 exact `fileDown` GET을 실행한다. Test-only connector는
loopback IP와 synthetic `global.krx.co.kr` certificate만 허용한다. Registered `file_nm`을
network 전에 선택하고 canonical parameter order, fixed header, HTTP/1.1 connection close를
적용한다. Response는 exact 300-byte Content-Length/type/cache, `Expires == Date`, Set-Cookie
header count 2와 forbidden representation/range/trailer 부재를 검증한다. Cookie value는
보존하거나 download POST에 replay하지 않으며 invalid Base64와 incomplete transfer는 opaque
OTP handle을 만들지 않는다.

`officialMarketCalendarKrxLegacyDownloadAcquisitionCoordinator.ts`는 exact registered
`fileName` request를 network 전에 검증하고 fixed OTP GET → filename-bound parameters →
opaque wire body → fixed document POST를 하나의 process-local lifecycle로 조립한다. Production
factory는 dependency/connector override를 노출하지 않고, test-only factory는 제한된 두
network consumer method와 optional identity verifier method를 snapshot한다. 기존 `acquire`는
성공한 opaque document response의 ownership을 caller에게 이전한다. 별도
`acquireWordDocumentTitle`은 같은 network lifecycle 뒤 registered identity부터 title까지의
fixed opaque consumer를 즉시 실행한다. OTP, body composition, document transport와 verification
실패는 provider detail 없는 stage error로 변환하며 모든 중간 handle은 `finally` 또는 각
exact-once consumer에서 dispose한다. `acquireWordCandidateSummary`는 같은 lifecycle을 terminal
summary 소비까지 연결하고 caller에게 opaque/raw handle을 반환하지 않는다. 세 경로 모두 durable
sink나 accepted evidence를 만들지 않는다.

`officialMarketCalendarKrxLegacyDocumentIdentity.ts`는 candidate document의 registered
`fileName`, exact byte length, SHA-256와 8-byte OLE Compound File signature를 하나의
fail-closed identity boundary에서 검증한다. Production verifier는 source policy override를
받지 않고, test-only verifier만 snapshot된 synthetic expectation을 사용한다. 성공 결과는
v2 `identityVerificationAuthority`로 `registered_source_policy`와
`test_only_expectation`을 구분하고 hash와 signature 검증 사실을 기록하지만
`parserStatus=not_verified`와
`sourceRoleStatus=candidate_not_accepted`를 유지한다. Signature 확인은 OLE container 전체
구조나 Word table semantics 검증을 대신하지 않는다. Fixed response consumer와 coordinator의
verified acquisition method가 이 identity를 후속 OLE/Word/title opaque lifecycle의 첫 단계로
결합한다.

`officialMarketCalendarKrxLegacyDownloadOtpEphemeralBody.ts`의 fixed response consumer는
network consumer가 만든 opaque response handle만 exact 한 번 consume하고 내부 document
bytes를 production identity verifier에 전달한다. Length/hash/signature 검증 성공 시 bytes와
identity를 getter/callback 없는 새 opaque handle로 이전하며, 실패·dispose·JSON export에서는
bytes를 zeroize한다. Test-only consumer만 synthetic verifier를 snapshot해 loopback fixture의
성공 ownership transfer를 검증한다. 새 handle도 parser operation이나 durable sink를 노출하지
않으므로 candidate-only 경계는 유지된다.

`officialMarketCalendarOleCompoundFileHeader.ts`는 Microsoft [MS-CFB] Compound File Header
명세의 fixed signature/CLSID/version/byte-order/sector-shift/mini-stream-cutoff와 header DIFAT
entry를 synthetic bytes에서 fail-closed로 검증한다. Version 3/4 sector size, version 3
directory-sector count, chain count/시작점/file sector 범위와 declared sector-role 충돌도
대조한다. Byte view의 own property shadow를 신뢰하지 않고 intrinsic buffer/offset/length를
한 번 snapshot해 전체 DataView 검증에 사용한다. Version 4 header-sector zero padding,
FAT entry capacity와 FAT/DIFAT/mini FAT/directory declared sector 총합도 file sector count에
결합한다. 결과는
`structureStatus=header_only_not_verified`를 유지하며 FAT chain, directory entry, stream 또는
Word table semantics를 검증하지 않는다. Identity-verified KRX handle부터 이 header verifier를
거치는 fixed exact-once consumer wiring은 구현됐지만, 이후 OLE/Word 전체 검증이 통과하기 전에는
header 결과만으로 source를 승인하지 않는다. 명세 기준:
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/05060311-bfce-4b12-874d-71fd4ce63aea

`officialMarketCalendarKrxLegacyDownloadOtpEphemeralBody.ts`의 fixed OLE-header consumer는
identity-verified opaque handle을 exact 한 번 consume하고 같은 private document bytes를
MS-CFB header verifier에 전달한다. 성공 시 identity/header result와 bytes를 getter/callback
없는 새 opaque handle로 이전하며, 실패·dispose·JSON export에서는 bytes를 zeroize한다.
Standalone verifier override나 raw-byte access는 노출하지 않는다. 새 handle도 FAT/directory/
stream/Word parser operation 또는 durable sink를 제공하지 않으므로 header-only candidate
경계는 유지된다.

`officialMarketCalendarOleCompoundFileDifat.ts`의 standalone verifier는 verified header의 첫
109개 FAT sector location과 DIFAT sector chain을 결합한다. 각 DIFAT sector는
`sectorSize / 4 - 1`개의 FAT location과 마지막 next-DIFAT pointer로 해석하고, 선언된 chain
길이·순서, 마지막 `ENDOFCHAIN`, FAT/DIFAT location의 file sector 범위·유일성, 사용하지 않는
entry의 `FREESECT`, directory/mini FAT와의 sector-role 충돌을 fail-closed로 검증한다. 결과는
location 목록만 immutable하게 반환하고 `fatStructureStatus=locations_only_not_verified`를
유지한다. Fixed consumer는 OLE-header-verified handle을 exact 한 번 consume하고 같은 private
bytes를 verifier에 전달한다. 성공 시 identity/header/DIFAT result와 bytes ownership을 getter/
callback 없는 새 opaque handle로 이전하며, 실패·dispose·JSON export에서는 bytes를 zeroize한다.
FAT entry의 `FATSECT`/`DIFSECT` marker와 stream chain, directory, Word table semantics는 검증하지
않으며 새 opaque handle도 durable sink나 parser operation을 노출하지 않는다.
명세 기준:
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/0afa4e43-b18f-432a-9917-4f276eca7a73

`officialMarketCalendarOleCompoundFileFat.ts`는 verified DIFAT location 순서의 FAT sector를
하나의 32-bit allocation table로 펼친다. 실제 file sector마다 regular next-sector 또는
`DIFSECT`/`FATSECT`/`ENDOFCHAIN`/`FREESECT`만 허용하고, DIFAT가 지정한 FAT sector의
entry는 exact `FATSECT`, DIFAT chain sector의 entry는 exact `DIFSECT`인지 검증한다.
지정되지 않은 sector의 stray FAT/DIFAT marker와 actual file sector count를 넘어가는 FAT
entry의 non-`FREESECT` 값은 fail-closed로 거부한다. 결과는 actual file sector 범위의 FAT
entry만 immutable하게 반환하고 `chainStatus=markers_only_chains_not_verified`를 유지한다.
Fixed consumer는 DIFAT-verified handle을 exact 한 번 consume하고 같은 private bytes를 verifier에
전달한다. 성공 시 identity/header/DIFAT/FAT result와 bytes ownership을 getter/callback 없는 새
opaque handle로 이전하며, 실패·dispose·JSON export에서는 bytes를 zeroize한다. Directory/mini
FAT/stream chain의 cycle, shared-sector, expected length와 실제 bytes는 아직 검증하지 않으며 새
opaque handle도 durable sink나 parser operation을 노출하지 않는다. 명세 기준:
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/30e1013a-a0ff-4404-9ccf-d75d835ff404

`officialMarketCalendarOleCompoundFileSystemChains.ts`는 verified FAT에서 header가 지정한
directory와 mini FAT의 standard sector chain을 추적한다. 각 next pointer는 actual file
sector 또는 마지막 `ENDOFCHAIN`이어야 하며 cycle과 두 system chain 사이의 sector reuse를
거부한다. Version 4 directory chain은 header의 declared directory-sector count와 exact
match해야 하고, mini FAT chain은 모든 version에서 declared mini FAT sector count 및
zero-count `ENDOFCHAIN` 시작점과 일치해야 한다. Version 3은 directory-sector count field를
사용하지 않으므로 non-empty chain과 valid termination만 검증한다. 결과는 두 chain의 sector
location만 immutable하게 반환한다. Fixed consumer는 FAT-verified handle을 exact 한 번 consume하고
같은 private bytes를 verifier에 전달한다. 성공 시 이전 verified result와 system-chain result 및
bytes ownership을 getter/callback 없는 새 opaque handle로 이전하며, 실패·dispose·JSON export에서는
bytes를 zeroize한다. Directory entry, mini FAT allocation entry, root mini stream과 user stream은
검증하지 않고 새 opaque handle도 durable sink나 parser operation을 노출하지 않는다. 명세 기준:
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/a94d7445-c4be-49cd-b6b9-2f4abc663817
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/c5d235f7-b73c-4ec5-bf8d-5c08306cd023

`officialMarketCalendarOleCompoundFileDirectoryEntries.ts`는 verified directory-sector chain을
chain 순서의 fixed 128-byte entry array로 투영한다. Allocated entry의 UTF-16LE
null-terminated name, byte length, 금지 문자, object type, color와 actual entry-array 범위의
sibling/child stream ID를 검증한다. Stream은 child `NOSTREAM`, zero CLSID 및 creation/modified
time을, storage는 zero starting sector/size를 강제한다. Unallocated entry는 세 pointer만
`NOSTREAM`이고 나머지는 모두 zero여야 한다. Stream ID 0은 exact `Root Entry` root storage,
zero creation time과 sibling 부재를 만족해야 하고 다른 위치의 root type은 거부한다.
Version 3 stream size는 호환성 권고대로 low DWORD를 effective value로 사용하고 version 4는
full 64-bit unsigned value를 decimal string으로 보존한다. Version 3의 2GB 상한은 ordinary
stream뿐 아니라 root entry가 나타내는 mini stream에도 적용한다. Stream state bits의 zero와
declared name 뒤 64-byte field padding의 zero는 명세상 `MUST`가 아니므로 parser compatibility를
위해 acceptance 조건으로 승격하지 않고 projection에도 포함하지 않는다. Root directory entry는
sibling tree node가 아니므로 red/black color를 모두 허용하며, 후속 tree verifier의 child-tree root
black 규칙과 구분한다. 결과는 모든 entry를 immutable하게 반환한다. Fixed consumer는
system-chains-verified handle을 exact 한 번 consume하고 같은 private bytes를 verifier에 전달한다.
성공 시 이전 verified result와 directory-entry result 및 bytes ownership을 getter/callback 없는 새
opaque handle로 이전하며, 실패·dispose·JSON export에서는 bytes를 zeroize한다. Red-black tree,
sibling name ordering/uniqueness, root mini stream과 stream allocation은 아직 검증하지 않으며 새
opaque handle도 durable sink나 parser operation을 노출하지 않는다. 명세 기준:
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/60fe8611-66c3-496b-b70d-a504c94c9ace
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/026fde6e-143d-41bf-a7da-c08b2130d50e

`officialMarketCalendarOleCompoundFileDirectoryTree.ts`는 verified directory entry array의
root hierarchy부터 각 storage의 child sibling tree를 iterative하게 추적한다. 각 child-tree
root의 black color, 연속 red node 부재, 이름의 strict global ordering과 sibling uniqueness를
검증하고 root/unallocated reference, sibling/containment cycle, 둘 이상의 parent tree가 같은
entry를 소유하는 경우와 root에서 도달할 수 없는 allocated entry를 fail-closed로 거부한다.
MS-CFB는 모든 node를 black으로 둔 일반 binary tree를 명시적으로 허용하므로 일반적인
red-black tree의 equal black-height 조건은 추가하지 않으며, 비균형 all-black tree도 허용한다.
이름 정렬은 Directory Entry Name Length를 먼저 비교하고 같은 길이는 UTF-16 code unit별
Unicode simple uppercase binary value를 비교한다. Surrogate code unit은 변환하지 않는다.
런타임 Unicode/locale 차이를 제거하기 위해 `officialMarketCalendarOleUnicodeSimpleUppercase.ts`가
Unicode 17.0.0 `UnicodeData.txt`의 BMP `Simple_Uppercase_Mapping` 1,198개와 source SHA-256
`2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c`를 고정한다.
결과는 fixed entry projection을 유지하면서 `directoryTreeVerified=true`,
`treeStatus=verified`를 반환한다. Fixed consumer는 directory-entries-verified handle을 exact 한
번 consume하고 같은 private bytes를 verifier에 전달한다. 성공 시 이전 verified result와
directory-tree result 및 bytes ownership을 getter/callback 없는 새 opaque handle로 이전하며,
실패·dispose·JSON export에서는 bytes를 zeroize한다. Mini FAT entry, root mini stream과 user
stream allocation은 아직 검증하지 않으며 새 opaque handle도 durable sink나 parser operation을
노출하지 않는다. 명세 기준:
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/d30e462c-5f8a-435b-9c4c-cc0b9ea89956
https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt

`officialMarketCalendarOleCompoundFileMiniFatEntries.ts`는 verified mini FAT standard-sector
chain이 가리키는 sector를 chain 순서의 32-bit little-endian allocator entry array로 투영한다.
각 entry는 declared mini FAT sector capacity 안의 mini-sector pointer, `ENDOFCHAIN` 또는
`FREESECT`만 허용하고 reserved value와 `DIFSECT`/`FATSECT`, capacity 밖 pointer를
fail-closed로 거부한다. Mini FAT가 없는 valid file은 empty immutable array로 반환한다.
결과는 `miniFatEntriesVerified=true`를 반환한다. Fixed consumer는 directory-tree-verified handle을
exact 한 번 consume하고 같은 private bytes를 verifier에 전달한다. 성공 시 이전 verified result와
mini FAT entry result 및 bytes ownership을 getter/callback 없는 새 opaque handle로 이전하며,
실패·dispose·JSON export에서는 bytes를 zeroize한다. Entry chain의 cycle/reuse, root mini stream
actual capacity, directory stream size 및 user stream allocation은 아직 검증하지 않으며 새 opaque
handle도 durable sink나 parser operation을 노출하지 않는다. 명세 기준:
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/c5d235f7-b73c-4ec5-bf8d-5c08306cd023
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/9d33df18-7aee-4065-9121-4eabe41c29d4

`officialMarketCalendarOleCompoundFileRootMiniStream.ts`는 verified directory tree의 root entry,
verified mini FAT entry array와 verified FAT를 결합한다. Root stream size로 standard FAT sector
count와 64-byte mini-sector count를 계산하고 root starting sector에서 exact-length FAT chain을
추적한다. Cycle, invalid termination, FAT/DIFAT/directory/mini FAT system sector reuse와 version별
mini stream 최대 크기 초과를 fail-closed로 거부한다. Mini FAT regular pointer는 실제 root mini
sector count 안에 있어야 하고 그 capacity 밖 entry는 `FREESECT`여야 한다. Zero-size root는
`ENDOFCHAIN` 시작점과 empty chain을 요구한다. 결과는 root mini stream sector locations와
`rootMiniStreamVerified=true`, `miniFatCapacityVerified=true`를 immutable하게 반환한다. Fixed
consumer는 mini-FAT-entries-verified handle을 exact 한 번 consume하고 같은 private bytes를
verifier에 전달한다. 성공 시 이전 verified result와 root-mini-stream result 및 bytes ownership을
getter/callback 없는 새 opaque handle로 이전하며, 실패·dispose·JSON export에서는 bytes를
zeroize한다. User stream별 FAT/mini FAT chain과 bytes는 아직 검증하지 않으며 새 opaque handle도
durable sink나 parser operation을 노출하지 않는다.
명세 기준:
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/026fde6e-143d-41bf-a7da-c08b2130d50e
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/c5d235f7-b73c-4ec5-bf8d-5c08306cd023
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/b089deda-be20-4b4a-aad5-fbe68bb19672

`officialMarketCalendarOleCompoundFileUserStreamAllocation.ts`는 verified directory tree,
root mini stream, mini FAT entry array와 FAT를 결합해 ordinary stream의 allocation chain을
검증한다. Stream size가 zero이면 allocation이 없는 empty stream으로 처리하고 명세가 별도 값을
강제하지 않는 starting sector는 해석하지 않는다. Non-empty stream은 4,096-byte cutoff 미만이면
mini FAT, 이상이면 standard FAT를 사용하고, chain capacity가 declared stream size 이상인지
version별 sector size로 계산한다. Invalid start/termination, cycle, stream 간 sector 중복,
FAT/DIFAT/directory/mini FAT/root mini stream system sector 재사용과 실제 root mini stream 안의
unowned non-free mini FAT entry를 fail-closed로 거부한다. 결과는 stream별 allocation kind와 sector
locations를 immutable하게 반환한다. Fixed consumer는 root-mini-stream-verified handle을 exact 한 번
consume하고 같은 private bytes를 verifier에 전달한다. 성공 시 이전 verified result와 user-stream
allocation result 및 bytes ownership을 getter/callback 없는 새 opaque handle로 이전하며,
실패·dispose·JSON export에서는 bytes를 zeroize한다. Stream bytes와 FAT의 모든 orphan allocation은
아직 검증하지 않으며 새 opaque handle도 durable sink나 parser operation을 노출하지 않는다. 명세 기준:
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/b37413bb-f3ef-4adc-b18e-29bddd62c26e
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/b089deda-be20-4b4a-aad5-fbe68bb19672
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/9d33df18-7aee-4065-9121-4eabe41c29d4

`officialMarketCalendarOleCompoundFileUserStreamBytes.ts`는 verified user stream allocation과
root mini stream sector chain을 사용해 ordinary stream bytes를 declared stream size까지만
재조립한다. Standard FAT stream은 `(sector + 1) * sectorSize` file offset을 사용하고 mini FAT
stream은 `miniSector * 64` logical offset을 fragmented root mini stream의 standard sector
location으로 다시 매핑한다. Overallocated chain의 trailing bytes는 결과에서 제외하고 각 stream은
원본 document backing memory와 공유하지 않는 caller-owned `Uint8Array` copy로 반환한다. 이
projection은 WordDocument/table semantics를 해석하지 않는다. Fixed consumer는
user-stream-allocation-verified handle을 exact 한 번 consume하고 같은 private bytes로 projection을
수행한다. 성공 시 이전 verified result, projected stream copy 및 bytes ownership을 getter/callback
없는 새 opaque handle로 이전하며, 실패·dispose·JSON export에서는 raw document와 모든 projected
stream copy를 zeroize한다. Word stream parser와 durable evidence writer에는 아직 연결하지 않았고
새 opaque handle도 parser operation을 노출하지 않는다. 명세 기준:
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/9d33df18-7aee-4065-9121-4eabe41c29d4
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/c5d235f7-b73c-4ec5-bf8d-5c08306cd023

`officialMarketCalendarKrxLegacyWordBinaryFileStreams.ts`는 root storage의 direct child
namespace에서 exact `WordDocument` stream과 `FibBase.fWhichTblStm`이 선택한 `0Table` 또는
`1Table` stream을 결합한다. `WordDocument` offset 0의 32-byte `FibBase`에서
`wIdent=0xA5EC`, `fExtChar`, `nFibBack`, `pnNext`, `lKey`, `envr`, `fMac`과 reserved field의
명세상 필수 조건을 검증하고 두 필수 stream의 0x7FFFFFFF-byte 상한을 적용한다. 두 table stream이
모두 존재하면 선택되지 않은 stream은 size를 포함해 명세대로 무시한다. `fEncrypted` content는 후속
parser가 지원하지 않으므로 fail-closed로 거부하고, `fEncrypted=0`일 때 `fObfuscated`는 명세대로
무시한다. WordDocument와 selected Table의 size 상한은 각 byte projection 전에 root directory
metadata에서 검사한다. Byte 19의 undefined bit와 `reserved5`/`reserved6`도 명세가
`MUST be ignored`로 규정하므로 nonzero 값을 거부하지 않는다. 결과는 caller-owned WordDocument/Table bytes와
base version/selector만 반환한다. Fixed consumer는 user-stream-bytes-projected handle을 exact 한 번
consume하고 같은 private bytes를 verifier에 전달한다. 성공 시 이전 verified result와 selected Word
stream result 및 모든 byte-copy ownership을 getter/callback 없는 새 opaque handle로 이전하며,
실패·dispose·JSON export에서는 raw document, 이전 projected stream copy와 selected Word stream copy를
zeroize한다. Variable-length FIB의 effective `nFib`, CLX/text/table semantics와 source role/coverage는
아직 검증하지 않고 새 opaque handle도 parser operation을 노출하지 않는다. 명세 기준:
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/d7fae142-670d-4cd5-869a-708366984a71
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/26fb6c06-4e5c-4778-ab4e-edbf26a545bb
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/44f62054-d911-4989-946c-a42100c26a15

`officialMarketCalendarKrxLegacyWordFib.ts`는 selected Word streams의 `WordDocument` offset 32부터
variable-length FIB count section을 순서대로 검증한다. `csw=0x000E`, `cslw=0x0016`을 요구하고
각 count multiplication과 다음 field offset이 declared WordDocument bytes 안에 있는지 확인한다.
`cswNew=0`이면 `FibBase.nFib`, nonzero이면 `FibRgCswNew.nFibNew`를 effective `nFib`로 결정한 뒤
Word97/2000/2002/2003/2007의 registered `cbRgFcLcb`와 `cswNew` 조합만 허용한다. Effective
`nFib>=0x00D9`에서는 `cQuickSaves=0xF`도 적용한다. 결과는 FIB byte length, effective version과
count summary를 반환한다. Fixed consumer는 word-streams-verified handle을 exact 한 번 consume하고
같은 private bytes를 verifier에 전달한다. 성공 시 이전 verified result와 variable FIB result 및 모든
byte-copy ownership을 getter/callback 없는 새 opaque handle로 이전하며, 실패·dispose·JSON export에서는
raw document와 모든 이전·신규 Word stream copy를 zeroize한다. FibRgW/FibRgLw/FibRgFcLcb/
FibRgCswNewData 내부 field, CLX와 text는 아직 파싱하지 않고 source role도 candidate로 유지하며 새
opaque handle도 parser operation을 노출하지 않는다. 명세 기준:
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/9aeaa2e7-4a45-468e-ab13-3f6193eb9394
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/a4876d81-6ff1-485e-8655-75266ec84c07
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/fe661052-9c88-4ae1-aec4-44799b2b4777

`officialMarketCalendarKrxLegacyWordClxReference.ts`는 verified variable FIB의
`FibRgFcLcb97`에서 0-based pair index 33인 `fcClx`/`lcbClx`를 읽고 selected Table stream의
declared bytes 안에 non-empty CLX range 전체가 포함되는지 fail-closed로 검증한다. 반환하는
`clxBytes`는 source document와 backing memory를 공유하지 않는 copy다. 모든 지원 FIB version이
정확히 하나의 `FibRgFcLcb97`을 포함한다는 명세만 사용하며 `Clx`, `Prc`, `Pcdt`, `PlcPcd`와 text
semantics는 아직 해석하지 않는다. Fixed consumer는 word-fib-verified handle을 exact 한 번 consume하고
같은 private bytes를 verifier에 전달한다. 성공 시 이전 verified result와 bounded CLX copy ownership을
getter/callback 없는 새 opaque handle로 이전하며, 실패·dispose·JSON export에서는 raw document와
모든 이전 Word/stream copy 및 CLX copy를 zeroize한다. Source role은 candidate로 유지하고 새 opaque
handle도 parser operation을 노출하지 않는다. 명세 기준:
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/0c9df81f-98d0-454e-ad84-b612cd05b1a4
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/01d5d8c4-cf9c-4ef9-80fd-439e763cfe01

`officialMarketCalendarKrxLegacyWordClx.ts`는 bounded CLX copy를 `Prc*`와 마지막 `Pcdt`로
framing한다. 각 `Prc`는 `clxt=0x01`, signed `cbGrpprl`의 non-negative/`0x3FA2` 상한과 CLX
범위를 검증하고, 마지막 `Pcdt`는 `clxt=0x02`, exact `lcb` consumption 및 `PlcPcd` byte length가
`12n+4` 형태인지 확인한다. 결과는 Prc byte/count, Pcdt offset, inferred piece descriptor count와
독립 `PlcPcd` byte copy를 반환한다. Fixed consumer는 word-clx-reference-verified handle을 exact 한
번 consume하고 같은 private bytes를 verifier에 전달한다. 성공 시 이전 verified result와 framed
`PlcPcd` copy ownership을 getter/callback 없는 새 opaque handle로 이전하며, 실패·dispose·JSON
export에서는 raw document와 모든 이전 copy 및 `PlcPcd` copy를 zeroize한다. `GrpPrl`, CP
ordering/uniqueness, Pcd/FcCompressed와 text는 아직 해석하지 않고 source role도 candidate로
유지하며 새 opaque handle도 parser operation을 노출하지 않는다. 명세 기준:
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/bad26767-b575-44d3-9da3-96378d56ce14
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/fdc916f9-18c4-453c-95fb-072f2c74c0e2
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/473fd992-c824-4655-8880-3186bd432f80
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/9316ddeb-3441-4840-a501-85225ba32b35
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/a649fcc5-7868-4245-be12-04eea89d916b

`officialMarketCalendarKrxLegacyWordPlcPcd.ts`는 framed `PlcPcd`를 `n+1`개의 signed CP와
`n`개의 8-byte `Pcd`로 분할한다. 첫 CP가 Main Document의 시작인 0이고 전체 CP가
non-negative strict ascending인지 확인하고,
`Pcd.fDirty=0`과 `FcCompressed.r1=0`을 적용한 뒤 CP range, `fNoParaLast`, 30-bit `fc`와
`fCompressed`를 immutable descriptor로 반환한다. Undefined `Pcd.fR1`/`fR2`는 명세대로
무시한다. Fixed consumer는 word-clx-verified handle을 exact 한 번 consume하고 같은 private bytes를
verifier에 전달한다. 성공 시 이전 verified result와 immutable CP/Pcd projection을 getter/callback 없는
새 opaque handle로 이전하며, 실패·dispose·JSON export에서는 raw document와 모든 이전 byte copy를
zeroize한다. `prm`, FibRgLw document total, WordDocument text byte range와 decoding은 아직
검증하지 않고 source role도 candidate로 유지하며 새 opaque handle도 parser operation을 노출하지 않는다.
명세 기준:
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/1caae71f-35c4-49d7-adf0-af5fc766331c
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/498993c9-0a2d-47aa-8ada-fed27616e275
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/aa2e55a2-f4f2-4795-bab5-6d9d7a0ed249

`officialMarketCalendarKrxLegacyWordPcdPrm.ts`는 각 2-byte `Pcd.Prm`을 `Prm0` 또는 `Prm1`로
분기한다. `Prm0.isprm`은 MS-DOC의 complete allowlist와 대조하고 `isprm=0`/`val=0` no-op,
paragraph/character property group, `sprmPFInTable`/`sprmPFTtp` table modifier identity를
immutable하게 반환한다. `Prm1.igrpprl`은 CLX `RgPrc`의 zero-based index 범위 안에 있어야 하며,
각 `PrcData.cbGrpprl`과 exact `GrpPrl` caller-owned copy를 함께 투영한다. Fixed consumer는
word-plc-pcd-verified handle을 exact 한 번 consume해 같은 private document bytes를 재검증하고,
이전 CP/Pcd range와 `Pcd.Prm` projection을 교차 확인한 뒤 새 opaque handle로 ownership을 이전한다.
성공·실패·dispose·JSON export에서 raw document, 이전 projection과 `GrpPrl` copy를 zeroize한다.
`GrpPrl` 내부 `Prl` semantics와 table property 적용은 아직 검증하지 않으며 source role은 candidate다.
`officialMarketCalendarKrxLegacyWordPrl.ts`는 PAPX와 PRC가 공유하는 `Prl` framing 경계로,
2-byte `Sprm`의 `ispmd`/`fSpec`/`sgc`/`spra`를 분해하고 fixed operand, 1-byte `cb` variable
operand, `sprmTDefTable`의 2-byte `cb` 예외를 exact byte consumption으로 검증한다.
`sprmPChgTabs`의 `cb=255` 특수 형식은 아직 지원하지 않으므로 fail-closed로 거부한다.
`officialMarketCalendarKrxLegacyWordPrcGrpPrl.ts`는 모든 PRC `GrpPrl`을 이 공통 parser로
끝까지 해석하고 paragraph/character/other property-group `Prl` count를 투영한다. 각 `Prl`의
operand는 caller-owned copy다. Fixed consumer는 word-pcd-prm-verified handle을 한 번만 소비하고
piece/PRC projection과 `Prl` count 불변식을 교차 확인해 새 opaque handle로 ownership을 이전한다.
성공·실패·dispose 경로에서 `GrpPrl`과 operand copy를 포함한 모든 private bytes를 zeroize한다.
paragraph modifier 선택과 table property 적용은 아직 수행하지 않는다.
`officialMarketCalendarKrxLegacyWordDirectParagraphProperties.ts`는
MS-DOC 2.4.6.1에 따라 paragraph-boundary 탐색이 성공한 마지막 iteration의 `Pcd`, 즉 terminal
`endPieceIndex` 하나만 선택한다. PAPX direct `Prl` 뒤에 `Prm0`의 paragraph modifier 하나 또는
`Prm1` PRC의 `sgc=1` modifier만 순서대로 append한 뒤 table property 불변식을 평가한다. 시작 piece나
중간 piece의 `Pcd.Prm`은 적용하지 않으며 character/other property modifier는 count만 기록하고 table
상태에는 적용하지 않는다. `officialMarketCalendarKrxLegacyWordTableTextMarks.ts`는 결합된 property와
terminal code unit을 대조해 depth 1의 `0x0007` cell/TTP, nested depth의 `0x000D` cell/TTP와
ordinary/non-table paragraph/section 역할을 분류한다. Depth-1 TTP는 직전 code unit도 `0x0007` cell
mark인지 검증한다. `officialMarketCalendarKrxLegacyWordTableRowGrouping.ts`는 depth별 open row를
관리해 depth 1의 cell mark+TTP와 nested cell/TTP를 row/cell CP range로 묶고, depth 하강 전 닫히지
않은 nested row와 non-table 경계까지 남은 open row를 거부한다. Nested row가 outer cell 안에 포함되는
CP range도 보존한다. 입력 paragraph 수를 넘는 table depth는 depth별 row state를 할당하기 전에
거부해 resource usage를 입력 크기에 묶는다. `officialMarketCalendarKrxLegacyWordSourceRows.ts`는
각 cell CP range를 main-document text에 다시 결합하고 terminal table mark 한 code unit만 content에서
제외한다. Raw text에는 terminal mark를 보존하고 cell 내부 paragraph/nested control code는 정규화하지
않는다. 구조적 source row text까지만 투영했으며 column 의미와 날짜/휴장 semantics를 해석하지
않았으므로 source role은 미검증 candidate다. 명세 기준:
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/35226a0b-9038-4427-83c2-3830a8554267
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/6891279f-5855-441b-96f2-7455081147be
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/fdc916f9-18c4-453c-95fb-072f2c74c0e2
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/473fd992-c824-4655-8880-3186bd432f80
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/61b635c3-2c44-4155-bf17-fec281b30c71

`officialMarketCalendarKrxLegacyWordDocumentTitle.ts`는 registered document identity의
연도별 `observedDocumentTitle`을 decoded main-document의 exact paragraph 하나와 결합한다.
부분 문자열, 다른 paragraph text에 포함된 제목, 누락 또는 중복 title paragraph는
fail-closed로 거부한다. 이 경계는 column/date/holiday semantics를 해석하지 않고
source role을 candidate로 유지한다. Fixed production/test-only response consumer는
ephemeral network response부터 이 title-verified opaque handle까지 등록된 identity와
모든 OLE/Word 단계를 순서대로 한 번씩 소비한다. Terminal candidate-summary consumer는
이 handle을 exact 한 번 소비하고 raw document를 zeroize한 뒤 file/year, Word version/Table
stream, structural row/cell count와 미해석/미승인 상태만 frozen summary로 반환한다.
Summary v2도 identity verification authority를 보존해 synthetic test expectation을 production
registered source policy 검증으로 오인할 수 없게 한다.
Legacy download acquisition coordinator의 `acquireWordCandidateSummary`는 OTP/download,
title 검증과 terminal 소비를 한 호출로 연결하고 caller에게 opaque/raw handle을 반환하지 않는다.
Structural row 수를 registered `observedHolidayLineCount`와 동일하다고 가정하지 않는다.

`officialMarketCalendarKrxLegacyWordDocumentCounts.ts`는 verified FIB의 `FibRgLw97`에서
main/subdocument character count를 읽고 PlcPcd final CP와 합계를 대조한다. Fixed consumer는
word-prc-grpprl-verified handle을 한 번만 소비해 같은 private document를 재검증하고 이전 final CP와
결과를 교차 확인한 뒤 새 opaque handle로 ownership을 이전한다. 실패·dispose 경로에서는 이전
`GrpPrl`/operand를 포함한 모든 byte copy를 zeroize하며 text range와 source role은 아직 승인하지 않는다.
`ccpText`, `ccpFtn`, `ccpHdd`, `ccpAtn`, `ccpEdn`, `ccpTxbx`, `ccpHdrTxbx`를 signed
non-negative count로 읽고 `reserved3=0`을 요구한다. 모든 subdocument count가 0이면 final CP가
`ccpText`, 하나라도 nonzero이면 일곱 count의 합에 guard CP 1을 더한 값인지 verified PlcPcd와
대조한다. 계산 결과는 CP 상한 `0x7FFFFFFE`를 넘을 수 없다. WordDocument text byte range와
decoding은 아직 검증하지 않고 source role도 candidate로 유지한다. 명세 기준:
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/37713d3c-a0c8-40f5-821f-bc9622c7de48
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/1caae71f-35c4-49d7-adf0-af5fc766331c

`officialMarketCalendarKrxLegacyWordTextRanges.ts`는 `cbMac` 안에서 각 PlcPcd piece의
compressed/uncompressed physical byte range를 검증한다. Fixed consumer는
word-document-counts-verified handle을 한 번만 소비하고 이전 CP range와 새 byte-range projection을
교차 확인해 새 opaque handle로 ownership을 이전한다. text bytes 자체의 projection/decoding과 source
role은 아직 승인하지 않으며 실패·dispose에서는 이전 private byte ownership 전체를 zeroize한다.

`officialMarketCalendarKrxLegacyWordTextBytes.ts`는 검증된 range마다 WordDocument text bytes의
caller-owned copy를 만든다. Fixed consumer는 word-text-ranges-verified handle을 한 번만 소비하고
range identity와 copy length를 교차 확인해 새 opaque handle로 ownership을 이전한다. 성공·실패·dispose
경로에서 생성된 text piece copy를 zeroize하며 decoding과 source role은 아직 승인하지 않는다.

`officialMarketCalendarKrxLegacyWordTextDecoding.ts`는 UTF-16LE와 MS-DOC compressed 8-bit
mapping을 code unit 단위로 적용한다. Fixed consumer는 word-text-bytes-projected handle을 한 번만
소비해 decoded piece count, final CP와 전체 code unit count를 교차 확인하고 새 opaque handle로
ownership을 이전한다. Decoder 내부 projection bytes와 lifecycle의 이전 text piece copy는 종료 시
zeroize하며 table semantics와 source role은 아직 승인하지 않는다.

`officialMarketCalendarKrxLegacyWordMainDocument.ts`는 `ccpText` 범위의 마지막 code unit이 paragraph
mark이고 subdocument가 있으면 terminal guard도 paragraph mark인지 확인한다. Fixed consumer는
word-text-decoded handle을 한 번만 소비해 final CP, main-document range와 decoded text projection을
교차 확인하고 새 opaque handle로 ownership을 이전한다. Subdocument projection, table semantics와
source role은 아직 승인하지 않으며 실패·dispose에서 private byte ownership 전체를 정리한다.

`officialMarketCalendarKrxLegacyWordPlcBtePapxReference.ts`는 FIB의 `fcPlcfBtePapx`와
`lcbPlcfBtePapx`가 선택한 table-stream range를 caller-owned byte copy로 투영한다. Fixed consumer는
word-main-document-verified handle을 한 번만 소비해 FIB/table stream identity와 byte length를 교차
확인하고 새 opaque handle로 ownership을 이전한다. PlcBtePapx framing, PAPX FKP와 paragraph property는
아직 해석하지 않으며 실패·dispose에서 reference copy와 이전 private byte ownership 전체를 zeroize한다.

`officialMarketCalendarKrxLegacyWordPlcBtePapx.ts`는 reference bytes를 ordered FC 경계와
`PnFkpPapx` descriptor로 framing하고 각 page number를 512-byte FKP offset으로 투영한다. Fixed consumer는
word-plc-bte-papx-reference-verified handle을 한 번만 소비해 reference identity, FC/entry count와 parser
status를 교차 확인한 뒤 새 opaque handle로 ownership을 이전한다. FKP reference allocation과 PAPX page는
아직 검증하지 않으며 실패·dispose에서 reference copy를 포함한 private byte ownership 전체를 정리한다.

`officialMarketCalendarKrxLegacyWordPapxFkpReferences.ts`는 각 `PnFkpPapx`가 가리키는 512-byte
WordDocument page가 `cbMac` 안에 있는지 검증하고 caller-owned copy로 투영한다. Fixed consumer는
word-plc-bte-papx-verified handle을 한 번만 소비해 descriptor count, `cbMac`과 page copy identity를
교차 확인한다. PAPX FKP framing은 아직 해석하지 않으며 실패·dispose에서 모든 page copy와 이전
private byte ownership을 zeroize한다.

`officialMarketCalendarKrxLegacyWordPapxFkp.ts`는 FKP page의 `cpara`, ordered `rgfc`, 13-byte
`BX.PAP`와 optional `PapxInFkp` byte framing을 검증한다. Fixed consumer는
word-papx-fkp-references-verified handle을 한 번만 소비해 page identity, paragraph count와
caller-owned `grpprlAndIstdBytes` projection을 교차 확인한다. GrpPrl semantics는 아직 해석하지 않으며
실패·dispose에서 page copy와 PapxInFkp copy를 포함한 private byte ownership 전체를 zeroize한다.

`officialMarketCalendarKrxLegacyWordGrpPrl.ts`는 각 PapxInFkp의 `istd`와 shared `Prl` operand framing을
검증하고 default paragraph도 빈 group으로 보존한다. Fixed consumer는 word-papx-fkp-verified handle을
한 번만 소비해 paragraph/group count와 caller-owned operand copy를 교차 확인한다. Sprm semantics와
table property 적용은 아직 수행하지 않으며 실패·dispose에서 operand와 모든 이전 private byte copy를
zeroize한다.

`officialMarketCalendarKrxLegacyWordParagraphBoundaries.ts`의 MS-DOC 2.4.2 piece-aware 결과도 fixed
consumer로 연결한다. word-grpprl-verified handle을 한 번만 소비해 main-document CP 범위, contiguous
paragraph coverage, terminal PAPX identity와 mark 검증 상태를 교차 확인하고 새 opaque handle로
ownership을 이전한다. Direct paragraph/table property는 아직 적용하지 않으며 실패·dispose에서 모든
이전 private byte ownership을 정리한다.

`officialMarketCalendarKrxLegacyWordDirectParagraphProperties.ts`의 terminal PAPX와 terminal Pcd.Prm
결합 결과를 fixed consumer로 연결한다. word-paragraph-boundaries-verified handle을 한 번만 소비해
paragraph identity, MS-DOC 2.4.6.1 적용 순서와 Prm0/Prm1 선택 상태를 교차 확인하고 새 opaque handle로
ownership을 이전한다. Text mark와 table row/cell semantics는 아직 승인하지 않으며 실패·dispose에서
모든 이전 private byte ownership을 정리한다.

`officialMarketCalendarKrxLegacyWordTableTextMarks.ts`의 non-table, depth-1, nested cell/TTP mark 분류도
fixed consumer로 연결한다. word-direct-paragraph-properties-verified handle을 한 번만 소비해 paragraph
identity와 depth-1/nested/preceding-cell 검증 상태를 교차 확인하고 새 opaque handle로 ownership을
이전한다. Row/cell grouping과 source row text는 아직 생성하지 않으며 실패·dispose에서 모든 이전
private byte ownership을 정리한다.

`officialMarketCalendarKrxLegacyWordTableRowGrouping.ts`의 depth별 open-row state와 cell/row CP range
결과도 fixed consumer로 연결한다. word-table-text-marks-verified handle을 한 번만 소비해 row/cell index,
non-empty CP range와 grouped status를 교차 확인하고 새 opaque handle로 ownership을 이전한다. Source row
text는 아직 투영하지 않으며 실패·dispose에서 모든 이전 private byte ownership을 정리한다.

`officialMarketCalendarKrxLegacyWordSourceRows.ts`의 grouped cell CP range와 main-document text 결합도
fixed consumer로 연결한다. word-table-row-grouping-verified handle을 한 번만 소비해 row identity와 cell
count, terminal mark 제거/preservation policy와 structural projection status를 교차 확인한다. Column/date
semantics와 source acceptance는 아직 수행하지 않으며 실패·dispose에서 모든 이전 private byte ownership을
정리한다.

Registered title paragraph binding도 fixed consumer로 연결한다. word-source-rows-verified handle을 한 번만
소비해 identity의 file name/target year, main-document와 source-row parser의 Word version/Table stream,
title CP range와 decoded text를 교차 확인하고 새 opaque handle로 ownership을 이전한다. Column/date/holiday
semantics와 source acceptance는 계속 수행하지 않으며 실패·dispose에서 모든 이전 private byte ownership을
정리한다.

`officialMarketCalendarKrxLegacyWordParagraphBoundaries.ts`는 Main Document의 CP 0부터
`ccpText`까지 MS-DOC 2.4.2 paragraph-boundary algorithm을 적용한다. 각 piece의
compressed/uncompressed byte width로 현재 CP를 physical FC에 투영하고, terminal PAPX
`fcLim`이 현재 piece의 byte end를 넘으면 다음 piece에서 탐색을 계속한다. `fcLim`이 piece 안에
들어온 경우에만 CP end를 계산하며 UTF-16LE FC 정렬, `Pcd.fNoParaLast`, terminal code unit이
cell/TTP mark `0x0007`, section mark `0x000C`, paragraph mark `0x000D` 중 하나인지 fail-closed로
검증한다. 결과는 paragraph CP range와 terminal PAPX page/paragraph/FC identity를 결합하지만
`Pcd.Prm`이나 PAPX property를 이 boundary 결과 자체에는 적용하지 않는다. 후속 direct paragraph
property verifier, table text mark verifier와 table row grouping verifier가 terminal PAPX, terminal
`Pcd.Prm`, code unit 역할, depth별 row/cell CP range와 terminal mark를 제외한 structural cell text를
결합하지만 column semantics와 source role은 계속 미검증 candidate다. Direct verifier는
non-default `istd`를 별도 unsupported error code로 fail-closed 분류하며 style sheet를 해석하거나
default style로 강등하지 않는다. 명세 기준:
https://learn.microsoft.com/en-sg/openspecs/office_file_formats/ms-doc/30461a5b-e3ad-44cd-a3fe-038f86639b13
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/01d5d8c4-cf9c-4ef9-80fd-439e763cfe01
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/aa2e55a2-f4f2-4795-bab5-6d9d7a0ed249
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/5b45f0e7-7760-4fdb-af88-0146de2feb4c

2026-08-21 credential-free read-only production coordinator로 registered 2013 document를 다시
확인한 결과 network/identity와 direct paragraph 전 단계는 통과했지만 non-default style에서
`OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DIRECT_PARAGRAPH_STYLE_UNSUPPORTED`로 중단됐다. OTP와 raw
document bytes는 저장하거나 출력하지 않았으며 이 관찰은 accepted acquisition/evidence가 아니다.

### KRX Holiday Data POST Static Policy

`officialMarketCalendarKrxHolidayDataPostPolicy.ts`는 2026-08-20 KRX official holiday
page가 노출한 form contract 중 token-free 정적 부분만
`krx_holiday_data_post_static_request.v1`로 등록한다. Source page, exact `POST`
target, `gridTp=KRX`, exact `pagePath`를 고정하고, 값이 아직 결합되지 않은 dynamic
slot은 canonical order의 `code`, `search_bas_yy`만 허용한다.

`code` 값은 이 policy에 저장하지 않으며 기존 OTP GET parameter policy의 known-safe
name 상한도 완화하지 않는다. `pageFirstCall`, navigation/pagination field, header,
body encoding, cookie 또는 OTP consumption을 추정해 추가하지 않는다. 따라서 이
policy는 HTTP request body, one-shot consumer, acquisition capability 또는 accepted
evidence가 아니다.

`officialMarketCalendarKrxHolidayTargetYear.ts`는 같은 2026-08-20 official page의
`search_bas_yy` selector가 노출한 exact string value `2026`부터 `2016`까지를
descending canonical tuple로 등록한다. Parser는 이 목록의 exact string만 허용하며
숫자 coercion, whitespace 보정, 범위 밖 과거/미래 연도를 거부한다.

이 policy는 provider가 지원하는 영구 연도 범위를 주장하지 않는다. Selector가
변경되면 observation과 policy version을 함께 갱신해야 한다. Target year 검증만으로
OTP consumption, HTTP request 또는 accepted acquisition이 성립하지 않는다.

`consumeOfficialMarketCalendarKrxOtpForHolidayDataPost`는 factory-owned OTP handle을
exact target year와 결합하는 fixed one-shot ownership transfer다. 성공하면 OTP bytes와
validated year는 새 process-local opaque POST-parameter handle의 module-private state로
이동하고 원래 OTP handle은 재사용할 수 없다. Invalid year 또는 transfer 실패도 원래
OTP ownership을 종료하고 bytes를 zeroize한다.

POST-parameter handle은 raw OTP/year getter, callback, enumerable property 또는 JSON
export를 제공하지 않는다. Explicit disposal과 JSON export 거부 시 raw OTP bytes를
zeroize하며 disposal은 idempotent하다. Dedicated fixed encoder와 network consumer만
이 handle을 후속 wire request로 이동하며, handle 자체는 acquisition capability나
accepted evidence가 아니다.

### KRX Holiday Data POST Wire Encoding Policy

2026-08-20 cookie/redirect-disabled read-only observation에서 exact official endpoint는
`application/x-www-form-urlencoded; charset=UTF-8` body를
`search_bas_yy`, `gridTp`, `pagePath`, `code` 순서로 받아 HTTP 200을 반환했다.
Non-unreserved ASCII는 uppercase percent triplet으로 encoding했고 raw OTP는 string으로
변환하지 않았다.

`officialMarketCalendarKrxHolidayDataPostWirePolicy.ts`는 이 재현 encoding과
1,024-byte local fail-closed request-body 상한을
`krx_holiday_data_post_wire_encoding.v1`로 고정한다. 이 상한은 provider limit 주장이
아니며 local safety limit다. Policy만으로 encoder, request body, transport 또는 accepted
acquisition이 생성되지는 않는다.

`consumeOfficialMarketCalendarKrxHolidayDataPostParametersToWireBody`는 opaque
POST-parameter handle을 fixed byte encoder로 한 번만 소비한다. 1,024-byte zeroized
workspace에 policy order대로 field를 기록하고 unreserved ASCII 외 byte를 uppercase
percent triplet으로 encoding한다. Raw OTP를 string으로 변환하지 않는다.

성공 시 original raw OTP와 workspace를 zeroize하고 encoded bytes ownership을 새 opaque
wire-body handle로 이전한다. 실패 시 raw OTP, workspace와 생성된 partial/final body를
zeroize한다. Wire-body handle도 getter/callback/JSON export를 제공하지 않으며 explicit
disposal이 encoded body bytes를 지운다. Fixed network consumer가 이 handle을 정확히 한
번 HTTP request에 사용하지만 durable reuse 또는 accepted acquisition으로 승격하지 않는다.

### KRX Holiday Data POST Network Policy

2026-08-20 cookie/redirect-disabled read-only Node observation에서 successful data POST의
application-controlled canonical header name은 `accept`, `cache-control`, `content-length`,
`content-type`, `pragma`였다. Fixed value는 각각 `*/*`, `no-cache`, wire policy content type,
`no-cache`이고 `Content-Length`는 exact encoded wire-body byte length에서만 파생한다.
Transport-managed `Host`는 requested URL authority, `Connection`은 `close`로 고정한다. Cookie,
Authorization과 Proxy-Authorization은 전송하지 않았다.

`officialMarketCalendarKrxHolidayDataPostNetworkPolicy.ts`는 이 request와 existing
post/wire policy identity를 결합하고 automatic redirect follow/cookie jar disabled,
credential header count 0, 10,000ms absolute deadline, 1,024-byte request 및 1,000,000-byte
response cap과 connection reuse disabled를 immutable v1 definition으로 등록한다. Response는 HTTP/1.1 200 exact
content-length framing만 허용하고 Location, Content-Encoding, Transfer-Encoding,
Content-Range와 trailer를 거부한다. Response `Set-Cookie`는 raw value 없이 count만 기록하고
다음 request에 replay하지 않는다.

이 policy는 HTTP request를 실행하거나 opaque wire-body bytes를 노출하지 않는다. Raw
response는 process-local only, durable reuse와 accepted acquisition은 false로 고정한다.

`createOfficialMarketCalendarKrxHolidayDataNetworkConsumer`는 opaque wire-body handle을
exactly once 소비하는 production fixed HTTPS consumer다. Registered URL과 header, platform
trust, `global.krx.co.kr` hostname/SNI, connection reuse disabled와 10초 absolute deadline을
고정하며 caller가 dial target, CA, cookie, credential, redirect 또는 deadline을 주입할 수
없다. Loopback integration test factory만 synthetic CA와 더 짧은 deadline을 받으며 같은
production Host/SNI/certificate hostname 검증을 유지한다.

Consumer는 request `finish`, failure와 deadline에서 encoded request bytes를 zeroize한다.
Response allocation 전에 exact HTTP/1.1 200, single canonical `Content-Length`, 1,000,000-byte
상한과 forbidden header를 검사하고 partial/aborted/overflow/trailer를 거부한다. Raw
`Set-Cookie` value는 별도 collection에 복사하지 않고 name count만 metadata verifier에
전달한다. Complete body는 기존 metadata/body verifier를 통과한 뒤 process-local opaque
ephemeral response handle로 이전하며 durable reuse와 accepted acquisition은 계속 false다.

### KRX Holiday Data Response Metadata Boundary

2026-08-20 재관찰에서 cookie jar와 redirect follow를 비활성화한 client의 data POST
response는 HTTP/1.1 200, exact `Content-Length`, Node raw-wire
`Content-Type: text/html;charset=UTF-8`, `Cache-Control: no-store, no-cache,
max-age=0`, `Pragma: no-cache`를 반환했다. `Expires`는 `Date`와 같았고 response에는
두 개의 `Set-Cookie` header가 있었으나 raw cookie value는 기록하지 않았다.

이전 client observation은 같은 media type을 `text/html; charset=UTF-8`로
정규화했다. Metadata boundary는 두 exact 표현만 받고 canonical output은 space 포함
형태로 고정하며 다른 OWS/case/duplicate 변형은 허용하지 않는다.

`officialMarketCalendarKrxHolidayDataResponseMetadata.ts`는 이 metadata에서 complete
bounded body validation 진입만 허용한다. Input은 automatic redirect follow/cookie jar가
disabled이고 request Cookie header count가 0임을 strict하게 기록해야 한다. `no-store`,
`no-cache`, `max-age=0`, immediate expiry와 response cookie presence 때문에 `durableEvidenceReusable`과
`acceptedAcquisition`은 반드시 false다. Generic reusable-evidence freshness policy를
완화하거나 이 response를 publication evidence로 승격하지 않는다.

`officialMarketCalendarKrxHolidayDataResponseBody.ts`는 verified metadata의 exact
`contentLength`와 caller body byte length를 결합한 뒤 BOM 없는 strict UTF-8 JSON만
검증한다. Top-level은 exact `block1` 하나이고 row는 최대 1,000개, 각 row는 관찰된
`calnd_dd`, `dy_tp_cd`, `calnd_dd_dy`, `kr_dy_tp`, `holdy_eng_nm` string field만
허용한다. Raw JSON token scan은 escape decoding 후 같은 이름이 되는 duplicate member를
object depth별로 거부한다. Validator는 owned byte copy를 unconditional zeroize하고 row value나 raw
body를 반환하지 않는다. 반환값은 구조 요약뿐이며 durable reuse와 accepted
acquisition을 계속 false로 유지한다. 날짜 의미, 중복 날짜, holiday type과 publication
evidence 변환은 이 shape boundary의 책임이 아니다.

### KRX Holiday Data Row Semantics Policy

2026-08-20 cookie jar disabled/redirect manual read-only 재관찰은 selector가 제공하는
2016부터 2026까지 11개 연도를 각각 새 OTP로 조회했다. 각 응답은 13~19개 row였고
모든 연도에서 `calnd_dd`가 requested year의 canonical date, `calnd_dd_dy`가 같은
date, `dy_tp_cd`가 해당 Gregorian weekday code였다. Row는 date strict ascending,
duplicate date 0이었으며 Korean holiday name은 non-empty/trimmed였다. English holiday
name은 trimmed였지만 2026 응답에 empty value 1건이 있어 optional-empty가 필요하다.
Raw OTP, cookie와 response row value는 기록하지 않았다.

`officialMarketCalendarKrxHolidayDataRowPolicy.ts`는 이 전 연도 observation을 metadata,
body shape와 target-year policy version에 결합한다. Date/year/calendar-day/weekday/name과
row order/duplicate rejection 의미를 immutable policy로 등록하되 raw row consumer나
durable artifact를 만들지 않는다. Observation은 KRX archive completeness를 증명하지
않으며 `historicalCompletenessClaim`, durable reuse와 accepted acquisition은 false다.

`verifyOfficialMarketCalendarKrxHolidayDataResponseSemantics`는 fixed row policy를
private body parser에 적용한다. Target year canonical date, date/calendar-day equality,
Gregorian weekday code, trimmed/control-free holiday name과 strict ascending/duplicate
rejection을 검증한다. English name empty count, row count와 boolean verification summary만
반환하고 row value는 모듈 밖으로 내보내지 않는다. Owned body bytes는 기존 body
boundary와 동일하게 unconditional zeroize하며 결과는 observed rows 범위만 설명한다.

`officialMarketCalendarKrxHolidayDataEphemeralResponse.ts`는 transport가 넘길 caller
`Uint8Array` ownership을 즉시 process-local opaque handle로 이전한다. Factory는 1MiB
상한을 internal allocation과 metadata getter 접근 전에 적용하고 caller view를 성공·실패와
무관하게 zeroize한다. Full response metadata verifier가 같은 process에서 만든 객체만
허용해 caller-reconstructed projection의 transport 검증 우회를 차단하고, body shape를
검증한 뒤 raw metadata input을 보관하지 않고 exact content length와 fail-closed flag만
새 immutable projection으로 만든다. Handle은 JSON export/getter/callback/enumerable
field가 없으며 fixed semantic consumer 또는 explicit disposal만 허용한다. Consumer는
성공·실패 모두 한 번만
실행되고 internal response bytes를 unconditional zeroize한 뒤 summary만 반환한다.
Exclusive transfer를 보장할 수 없는 `SharedArrayBuffer` backing view는 다른 `vm` realm에서
생성된 경우도 intrinsic brand check로 판별해 거부한다.

`createOfficialMarketCalendarKrxAcquisitionCoordinator`는 exact canonical `targetYear`를
network I/O 전에 검증하고 fixed OTP GET → opaque POST parameter → opaque wire body → fixed
holiday data POST → semantic response consume을 하나의 process-local lifecycle로 조립한다.
Production factory에는 dial/CA/deadline/dependency override가 없으며 test-only factory는
이미 제한된 두 consumer interface method만 snapshot한다.

Coordinator는 OTP, request-body, holiday-data transport와 semantic stage 실패를 raw
provider detail 없는 structured error로 변환하고, 성공·실패 모두에서 보유했던 opaque
handle을 `finally`로 dispose한다. 결과는 raw row/date/name 없이 기존 frozen semantic
summary만 반환하므로 `historicalCompletenessClaim: not_claimed`, durable reuse와
`acceptedAcquisition: false` 경계를 바꾸지 않는다. Publication evidence 변환이나
filesystem write는 이 coordinator의 책임이 아니다.

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

`officialMarketCalendarPublicationFilesystemPreflight.ts`는 exact absolute publication
root의 realpath identity를 hash에 결합하고 mutation 없이 platform이 제공하는
`O_DIRECTORY | O_NONBLOCK` read-only flags로 publication root handle을 연다. 같은
handle의 `stat()`으로 directory인지 검증한 뒤 durability sync만 관찰한다.
Handle `stat()` 또는 `close()` I/O 실패는 `probe_failed`로 기록하되 실제
non-directory handle은 입력 오류로 명시적으로 거부한다.
Built-in Node API는 verified directory entry에
cleanup mutation을 결합하는 primitive와 atomic no-replace directory publish contract를
제공하지 않는다. 따라서 exclusive create, file sync, hard-link와 directory rename
mutation probe는 실행하지 않고 `not_probed_safe_cleanup_unavailable` observation과
`safe_mutation_probe_cleanup_unavailable` blocker로 보존한다. 관련 capability는 모두
false이며 built-in implementation은 모든 platform에서 `unsupported`이다. Windows의
directory sync `EPERM`은 Windows에서만 `unsupported` compatibility observation으로
기록하고 다른 platform에서는 `probe_failed`로 보존한다. Capability, observation과 blocker는
서로 일치해야 하고 canonical preflight hash에 결합되며 반환 contract 전체를
deep-freeze한다. 실제 writer enablement에는 별도 검증된 handle-bound cleanup과
no-replace directory primitive가 선행되어야 한다.
Stored contract도 `directorySync: unsupported`이면 `platform: win32`를 요구해
runtime producer의 compatibility 경계를 그대로 재검증한다.

`officialMarketCalendarPublicationActivationPreflight.ts`는 verified package plan과
filesystem preflight를 publication/activation 직전 하나의 immutable decision으로
결합한다. 현재 built-in filesystem implementation은 항상 `blocked`이며 exact
artifact/plan/preflight/root identity와 canonical blocker를 decision hash에 포함한다.
이 상태에서는 `filesystemMutationAction: none`, `verifiedSetAction: unchanged`만
허용하므로 writer 또는 coordinator가 unsupported preflight를 성공으로 축소할 수 없다.
별도 검증된 filesystem implementation이 도입되기 전에는 activation permit을 만들지
않으며 실제 write, recovery와 verified-set 갱신은 수행하지 않는다.

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

현재 `officialMarketCalendarPublicationReaderFreshness.ts`는 verified artifact를
입력으로 받는 순수 reader-time decision 계약을 제공한다. 모든 archive binding의
document를 canonical 순서로 재평가하고, 거부 시 필요한 audit event payload와
`membershipAction: unchanged`를 반환하며, 승인 시에만 exact `artifactHash`, `asOf`,
전체 `SourceDocumentRef`에 결합된 handle identity를 생성한다. 이 계약은 filesystem
package 검증, process-local verified set membership 확인, audit 저장 또는 실제 read
handle open을 수행하지 않으며, 해당 책임은 후속 `PublicationCoordinator` 통합에
남아 있다.

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
Built-in preflight는 verified directory entry에 cleanup을 원자적으로 결합할 수 없으므로
temporary namespace, probe file 또는 probe directory를 만들지 않는다. 따라서 cleanup
path mutation, pending setup mutation과 intermediate symlink traversal도 발생하지 않는다.
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
