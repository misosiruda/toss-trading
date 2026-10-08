# Child 실행 process 부분 관측 C1 — v1 계약

기준 main `aa344baafdc920c0ddaf56da2d241f7f512882cc`. [범위](child-process-observation-scope.md)의
독립 설계 검토와 합성 크기 측정을 거친 부분 관측 계약이다. 실제 구현·전체 검증 결과를 이 문서만으로 선언하지 않는다.

## 관측과 소유권

관측 payload는 actual `runCodexHistoricalReplay` invocation 내부에서 첫 비동기 관측 저장 전에
직접 포착한다. process/node/model 값의 출처는 runtime 자신과 그 실행 경로의 명시적 model label이다.
API canonical runtime, caller options.runtimeIdentity, EXP receipt, 현재 package.json/디스크 파일,
환경·argv 문자열 또는 요청 JSON에서 채우지 않는다.

| 필드 | 출처·정직한 의미 |
| --- | --- |
| nodeVersion | actual runner process.version의 bounded release version 관측 |
| platform | actual process.platform의 명시적 platform 이름 |
| architecture | actual process.arch의 명시적 architecture 이름 |
| costModelVersion | 사용 경로의 PAPER_COST_MODEL_VERSION label 관측 |
| executionModelVersion | 사용 경로의 PAPER_EXECUTION_MODEL_VERSION label 관측 |

내부 `node:process` 객체 전체를 복사·열거하거나 plain object로 요구하지 않는다. version/platform/arch의
고정 own data descriptor3개와 명시적 model export만 읽는다. getter/coercion을 실행해 값으로 바꾸지
않으며 env/argv/execPath/versions 전체를 수집하지 않는다. 후술한 plain-data preflight는 포착한 payload와
binding 입력에 적용한다. 실제 process 객체의 runtime prototype까지 일반 사용자 payload로 해석하지 않는다.

이는 Node artifact·OS·native·model 구현 bytes를 검증한 값이 아니다. 허용 형식은 다음과 같이 동결한다.

- nodeVersion: `v<major>.<minor>.<patch>`, 각 숫자는0 또는 leading-zero 없는1–3자리, 최대12 ASCII 문자.
  prerelease/custom suffix는 이번 부분 payload의 unsupported이다. 이는 해당 Node에서 replay를 금지하는 뜻이 아니다.
- platform: aix/android/darwin/freebsd/linux/openbsd/sunos/win32.
- architecture: arm/arm64/ia32/loong64/mips/mipsel/ppc64/riscv64/s390/s390x/x64.
- costModelVersion: paper_cost_model.v5; executionModelVersion: execution_simulator.v4.
  이 동결 version 밖의 label을 현재 모델 구현으로 해석하지 않는다.

Node scalar 의미와 명칭은 [Node24.19.0 process 문서](https://nodejs.org/download/release/v24.19.0/docs/api/process.html#processarch)를
대조했다. 플랫폼/아키텍처는 binary가 컴파일된 대상의 관측이며 host OS 전체 검사나 binary 검증이 아니다. raw/free string은 복사하지 않으며, 관측 불가/형식 밖 값은 whole payload의
내용 없는 unavailable(reason: unsupported_process_observation)이다. absent/invalid scalar를 기본값으로
채우거나 old/new Node label 차이를 clone compatibility 판단으로 쓰지 않는다.

관측 handle은 actual runner의 module-private 발행 소유권으로 확인한다. 임의 JSON→issued constructor나
caller가 process 값을 제공하는 발행 표면을 열지 않는다. resolver는 속성 읽기/parse 전에 exact handle을
검사하고 forged/clone/prototype/accessor/proxy는 실행 없이 고정 오류로 거절한다. 객체·callback mutation이
나중에 payload를 바꾸지 못하도록 분리·freeze한다.

handle에는 같은 actual invocation의 child identity/runIndex/startedAt가 private하게 결속되어야 한다.
이 identity metadata는 기존 B-safe workflow의 actual capture에서 온다. runtime scalar의 출처를
options로 바꾸는 것이 아니다. 다른 child의 handle은 scalar가 같아도 durable B와 mismatch다.
고유 handle 자체나 정적 version label만으로 invocation identity를 검증했다고 하지 않는다.
같은 ID에 다시 실행하는 시도는 기존 exclusive reservation/re-entry barrier가 막는다.

## 발행 대상과 개인정보 경계

C1은 actual durable B reference가 있는 child만 발행한다. B를 발행할 자격이 없는 경로(context 없음 또는 실제 issuer unavailable)는 C1 identity/reference
구성 및 private runtime handle 발행 전에 생략한다. available issuer의 실제 B 후보에서는 runner 진입에
안전한 actual metadata와 scalar의 private handle을 먼저 포착할 수 있지만, B 저장이 성공하기 전에는
C1 durable envelope를 만들거나 쓰지 않는다. B의 검증/저장이 실패하면 C1을 발행하지 않는다. known issuer unavailable에 담긴 원문·파생 ID나
reason을 추측해 새 C1 파일에 옮기지 않는다. B 부재는 verified 연결 부재이며 원인 판정이 아니다.

B의 lineage가 unavailable인 경우에도 안전한 issuer/지원 가능한 child binding을 실제 B가 소유했다면
process scalar 관측은 가능하다. C1 reference에는 B의 unavailable 상태를 유지한다. source redacted,
settings redacted/inspection_unavailable 또는 실제 mapping mismatch의 기존 stop을 늦추지 않는다.

실제 runner 이전의 planning 실패·skipped child·injected API runner가 actual 경계에 도달하지 않는 경우는
C1 없음이다. direct bound workflow도 실제 B가 있으면 같은 경계를 따르고, B 없으면 종전 동작을 유지한다.

## 별도 immutable 기록

파일 `historical-replay-process-observation.json`, schema `replay_child_process_observation.v1`,
phase `runner_process_observation`, mode `paper_only`.

- identity/runIndex/startedAt/reservationHash: actual durable B와 정확히 일치
- initialObservation/sourceObservation/settingsObservation: B writer가 결속한 실제 선행 references
- admissionObservation: B schemaVersion·전체-record observationHash·작은 lineage 상태
  (recorded이면 mappingVersion, unavailable이면 기존 reason). B payload/seed/receipt 전체를 복사하지 않음
- process: recorded일 때 위5개 scalar, unavailable일 때 reason만 존재하는 strict union
- implementation/sourceBuild/dependencyLock/loadedDependencies/nodeArtifact/runtimeConfiguration/runtime,
  dependencies/result/comparability: unavailable
- completeRuntime/completeConfiguration/completeInput: false

identity는 B의 runId1–256 ASCII safe 문자, 기존 strict API batch ID(최대60 ASCII), index0–19와 같다.
startedAt은 B의24자 canonical UTC ISO이고 hash는 sha256: + 정확한64자리 lowercase hex다.
선행 reference는 기존 typed state/version을 그대로 유지하며 B payload나 자유 문자열을 넣지 않는다.
strict object는 unknown key/잘못된 presence를 버리지 않는다. parser/producer preflight는 proxy,
accessor, custom prototype/serialization hook을 실행하지 않고 유한 descriptor/field 수로 검사한다.

기존 B의 strict schema·bytes·runtime unavailable 상수를 수정하지 않는다. B writer가 file/directory
write/sync/close를 끝낸 실제 record에서 detached frozen reference를 반환하고 reservation owner가
보관한다. 새 C1 writer는 그 reference만 받으며 현재 파일 재hash나 caller reference를 대체 근거로 쓰지 않는다.
C1 저장 record의 hash/ref가 있어도 result 완료/비교를 뜻하지 않는다.

전체 UTF-8 JSON+개행 한도는4,096bytes다. 실제 B reference shape와 독립 identity/scalar
상한을 결합한 설계 fixture에서 recorded2,448bytes, process unavailable2,329bytes였다.
이는 독립 field 상한의 설계 fixture이며 모든 값이 동시에 실제 producer에서 생긴다는 주장이 아니다.
구현 strict schema에 대한 별도 합성 fixture도2,448/2,329bytes를 확인했다. 실제 pipeline·전체 검증은
다른 증거이며 이 크기 측정으로 대체하지 않는다.
한도를 맞추려고 의미 없는 padding field를 추가하지 않는다. UTF-8 byte guard -1/at/+1과 schema 유효성은
별도 시험이다. 첫 구현에서 원본 file/환경/임의 package string을 새로 저장할 이유는 없다.

## 순서와 실패

actual runtime capture → initial/source/A/B durable → C1 durable → 뒤따르는 legacy artifacts/ticks/provider.
process scalar의 형식/관측 unavailable은 내용 없는 상태를 durable로 기록한 뒤 종전 허용 실행을 유지한다.
전체 envelope의 schema·identity·hash 불일치 또는 file byte cap 초과는 저장 실패이며 unavailable로
낮춰 숨기지 않는다.
순서의 capture는 실제 runner 진입이며 planner의 선행 clock/sampler callback까지 포함하지 않는다.

C1 output을 기존 orphan/preflight 목록에 포함하고 attempted flag는 실패 전에 소비한다. exclusive write →
file sync/close → directory open/sync/close가 모두 끝나야 후속 단계로 간다. C1 실패는 fixed child error,
provider/ticks0, original/partial/reservation 보존이다. accepted202를 뒤늦게503으로 바꾸지 않는다.

C1보다 먼저 중단된 child에 missing A/B reference를 만들어 채우지 않는다. B가 실제로 없는데 미래
발행될 것으로 예상해 C1 identity envelope를 남기지 않는다. 지원 가능한 cross-child/hash/reference
충돌을 unavailable로 낮춰 계속 실행하지 않는다.

## 후속 완전성

C2는 실제 launcher→load/process→runner ownership을 별도 검증한다. 현재 source/build/lock hash와
Node label이 같아도 loaded module cache/다른 resolution/설치변조/검증 후 변경을 배제하지 못한다.
C1 scalar 파일의 존재는 그 proof를 대신하지 않는다. 새 공개 reader/UI와 결과/report 결속도 별도다.

## 구현의 parser 실패 경계

C1의 bounded descriptor 검사에서 거절한 객체는 Zod를 호출하기 전에 고정 실패로 반환한다.
Zod의 오류 생성도 issue 직렬화를 수행하므로, inherited Object.prototype.toJSON을 감지한 뒤
ZodError를 만들면 getter가 실행될 수 있다. module-local parse/safeParse 진입점에서 먼저 차단하고
실패에 입력값·raw error를 담지 않는다. 이 변경은 C1 parser에 한정하며 기존 A/B parser를 바꾸지 않는다.
