# Child 실행 process 부분 관측 C1 — 범위

기준 main `aa344baafdc920c0ddaf56da2d241f7f512882cc` ([PR824](https://github.com/misosiruda/toss-trading/pull/824)).
이 문서는 C1 구현 범위와 완료 기준을 정한다. 실제 검증·병합 결과는 해당 후보의 증거로 별도 확인한다.

## 목적과 원래 계약

[입력·runtime 정본](input-runtime-provenance-contract.md#runtime과-입력-fingerprint의-의미)의
실제 child 실행 runtime 구분을 작은 부분 관측으로 진행한다. actual runner가 직접 본 Node/platform/
architecture와 model label을 해당 invocation의 실제 durable child 기록에 연결한다.
접수 서버의 version이나 별도 EXP receipt를 child 소비 증거로 복사하지 않는다.

C1의 성공은 process scalar 관측과 child 결속이다. implementation/source/build, dependency lock와
실제 loaded dependency, Node executable artifact, runtime 설정의 완전성은 C2의 별도 launcher/load
계약에서 확인해야 한다. C1은 runtime/dependencies/result/comparability unavailable,
completeRuntime/completeInput/completeConfiguration=false를 유지한다.
새 loader, process launcher, 권한·서명 체계, 실거래, 유료 AI, 결과 producer와 UI는 포함하지 않는다.

## 실제 현재 경로

- `ops:api`는 build 후 localOperationsApi를 실행한다. EXP launcher 경로를 거치지 않는다.
- default HTTP adapter의 child는 같은 Node process 안의 batch→workflow→runCodexHistoricalReplay 호출이다.
  API runner는 주입 가능하므로 admission process.version과 actual child 관측은 구분해야 한다.
- actual runner는 첫 await 전 initial/source/settings를 캡처하고, 같은 예약의 initial→source→A→B
  durable 뒤 legacy artifacts와 ticks/provider로 진행한다. C1도 이 소유 경계에 결속한다.
- workflow planning의 clock/sampler metadata 호출은 actual runner보다 먼저 일어난다. C1이 그 선행
  callback의 state/구현까지 관측했다고 표시하지 않는다.
- EXP receipt는 현재 source/dist/parsed lock/Node label을 관측한다. 정상 HTTP child에는 전달되지 않으며,
  installed/loaded dependency 또는 실제 Node executable의 증거가 아니다.

## 범위

1. actual runner 진입에서 직접 포착한 bounded process/model scalar의 private issued handle.
   handle에는 같은 invocation의 actual child identity/startedAt 결속이 있어, 값이 우연히 같은 다른
   child의 handle도 대체할 수 없다. HTTP/options의 process 값·receipt/hash/verified 주장은 받지 않는다.
2. 실제 B writer가 성공한 immutable B에서 작은 durable reference를 반환하고 reservation owner가 보관한다.
   B의 schema/bytes는 변경하지 않으며 사후 파일 재읽기나 caller hash로 reference를 만들지 않는다.
3. B가 실제 발행된 child에 별도 immutable C1 기록을 저장한다. source/A의 기존 보안 중단을 먼저 지키고,
   C1 durable 후에만 뒤따르는 legacy/ticks/provider로 진행한다.
4. B가 없는 direct/standalone/legacy/issuer unavailable에서는 C1을 identity envelope 전에 생략한다.
   B가 absence인 이유를 추정하거나 기존 실행/ID를 바꾸지 않는다. redacted seed에서 파생된 ID도
   새 C1이나 private unavailable 상태에 추가 보존하지 않는다.
5. 안전한 issuer가 발행한 B의 lineage가 unsupported/settings/initial unavailable이어도 actual
   process scalar는 독립된 부분 관측으로 기록할 수 있다. C1의 B reference에 그 상태를 그대로 남겨
   admission mapping이나 input 완전성이 개선됐다고 표시하지 않는다.

[동결할 C1 계약](child-process-observation-contract.md)의 scalar 출처·불가 상태·순서·한도를 먼저
독립 검토한 뒤 구현한다. 기존 A/B bytes와 일반 receiptless 실행은 유지한다.

## 완료 기준

- 실제 합성 HTTP→default batch→child에서 runner가 관측한 scalar와 actual B 전체-record reference,
  identity/index/time/reservation/초기·source/A reference가 결속된다. response spy만으로 끝내지 않는다.
- 동일 process scalar를 가진 다른 child handle, JSON/clone/prototype/accessor/proxy 위조, 임의
  process 값, metadata/관측 mutation이 결속으로 승격되지 않는다. 불일치는 고정 오류/provider0이다.
- single/multi-child, supported random/fixed, B unavailable, B 없는 injected/direct/legacy/skipped,
  redacted password/JWT seed를 합성 검증한다. absence 경로에서 새 private/file/오류/log marker가 없다.
- 실제 Node/model scalar의 출처가 admission 또는 현재 디스크 hash가 아님을 검증한다. source/build/
  loaded dependency/Node artifact/runtime 설정·외부 provider state는 여전히 unavailable이다.
- write/file-sync/close/directory-open/sync/close 실패, orphan/alias/경합/재시도에서 원본 B/A와
  reservation/partial을 보존하고 이후 legacy/tick/provider0을 확인한다. accepted202를 소급503으로 바꾸지 않는다.
- strict schema/field presence와 전체 UTF-8 JSON+개행의 합성 최대·-1/at/+1 byte guard를 따로 검증한다.
  관측할 수 없는 runtime scalar는 내용 없는 unavailable이며 일반 허용 replay를 불필요하게 차단하지 않는다.
- 독립 설계·구현 검토, 해당 local profile와 새 exact Linux full, 최초 Ready 자동 Code/Security review,
  현재 GitHub 보호 조건 후 병합한다. branch 보존, 수동 자동-review/Actions 중복 요청 금지를 유지한다.

## C2에 남는 것

application/dependency load 이전의 지원 launcher, source→build 및 actual load bytes/해석 경로,
Node executable artifact·영향 설정, preload/cache/변경/외부/native/generated 자산의 지원 범위가 필요하다.
현재 lock/directory digest나 npm ci로 이를 대신할 수 없다. C1에서 loader API를 선택하거나 완전성을
선언하지 않으며, C2의 positive/negative와 지원 환경은 별도 계약으로 정한다.
