# C2-A startup 후보 판정 — v1 계약

[범위](child-runtime-startup-candidate-scope.md), [C2 상위 계약](child-runtime-launcher-contract.md)을 따른다.
`evaluateReplayRuntimeStartupCandidate(value: unknown)`은 부작용 없는 데이터 판정기다. 값의 출처나
내용의 진실성을 인증하지 않는다. 실제 process와 전혀 다른 caller JSON도 형식상 후보가 될 수 있으며,
그 결과는 launcher 실행 권한·서명·private issuer·runtime receipt가 아니다.

## Descriptor

schemaVersion은 `replay_runtime_startup_candidate.v1`이다. 아래 18개 own enumerable data field가
모두 있어야 한다. unknown/symbol/non-enumerable key, accessor, array, custom prototype, proxy는 invalid다.
표준 Object.prototype 또는 null prototype의 평범한 object만 허용하며 input을 변경하지 않는다.

| field | 허용된 값 | 첫 후보 값 |
| --- | --- | --- |
| schemaVersion | 위 literal | 위 literal |
| nodeVersion | C1과 같은 bounded `v<major>.<minor>.<patch>` 형식, 각 숫자1–3자리/leading zero 없음(0 허용), 최대12 ASCII 문자 | v24.19.0 |
| platform | C1 platform enum 및 unknown | linux |
| architecture | C1 architecture enum 및 unknown | x64 |
| mode | paper_only / live / unknown | paper_only |
| provider | mock / deterministic_fixture / external / unknown | mock 또는 deterministic_fixture |
| bootstrap | before_application_load / application_loaded / unknown | before_application_load |
| preloads | absent / present / unknown | absent |
| moduleLoader | builtin_local_esm_cjs_json / custom_or_external / unknown | builtin_local_esm_cjs_json |
| moduleCache | owned_empty / preexisting / unknown | owned_empty |
| compileCache | disabled / enabled / unknown | disabled |
| startupSnapshot | absent / present / unknown | absent |
| inspector | disabled / enabled / unknown | disabled |
| startupConfig | absent / present / unknown | absent |
| runtimeSettings | declared_baseline / unsupported / unknown | declared_baseline |
| nativeAssets | absent / present / unknown | absent |
| filesystem | local_regular_files / unsupported / unknown | local_regular_files |
| generatedCode | absent / present / unknown | absent |

platform enum: aix/android/darwin/freebsd/linux/openbsd/sunos/win32/unknown.
architecture enum: arm/arm64/ia32/loong64/mips/mipsel/ppc64/riscv64/s390/s390x/x64/unknown.
C1의 schema 자체는 수정하거나 import해 확장하지 않는다. 후보 버전은 특정 합성 검증을 위한 값이며
C1이 기록하는 모든 Node/OS에서 C2를 지원한다는 뜻이 아니다.

runtimeSettings=declared_baseline은 caller가 baseline 범주라고 기술한 값이다. baseline의 실제 env/argv,
timezone/locale 또는 native linkage가 관측·검증됐다는 뜻이 아니다. C2-B/C가 실제 지원 설정과 소비
근거를 추가하기 전 이 descriptor로 환경의 안전성을 승인하지 않는다. preloads/config 등의 absent도
진실성 증명이 아닌 범주 입력이다. 자유 문자열·raw env/argv/path·hash·verified field를 받지 않는다.

18개 field, object 깊이1, string-only shape로 제한한다. field별 enum 또는 위 bounded version만
허용하므로 임의 큰 문자열·nested object를 순회/직렬화하지 않는다. own key 열거 자체의 메모리까지
고정한 JSON ingestion 방어라고 주장하지 않는다. HTTP body parser나 무제한 JSON 수집을 추가하지 않는다.

## 안전 검사와 실패

proxy/revoked proxy는 property/prototype/own-key trap을 건드리기 전에 검사한다. descriptor는 own
property descriptor로 읽고 getter/coercion/사용자 toJSON을 호출하지 않는다. 표준 Object/Array
prototype chain 변경 및 실행 가능한 own toJSON(function/accessor)은 내용 없이 invalid로 거절한다.
표준 prototype의 inert non-callable toJSON 값은 입력 판정 의미에 영향을 주지 않는다.

에러의 상세 입력·원래 문자열·key·exception message를 반환하지 않는다. invalid 입력은 고정
`invalid_descriptor` 결과다. Zod error 생성, JSON.stringify, 문자열 보간/coercion, 임의 함수 호출을
검사 경로에 사용하지 않는다. 검사에 쓰는 Node built-in과 표준 reflection intrinsics 자체의 악의적
교체를 방어하는 sandbox는 아니다.

## 반환값과 결정 순서

결과 schemaVersion=`replay_runtime_startup_candidate_result.v1`, evidence=`unverified_descriptor`다.
모든 결과는 own scalar만 가진 detached frozen null-prototype object이며 다음 불완전성이 고정된다.

- runtime/dependencies/result/comparability=`unavailable`
- completeRuntime/completeConfiguration/completeInput=false

candidate면 status=`candidate`, profile=`linux_x64_node24_19_paper_fixture.v1`이며 reason field는 없다.
unavailable이면 status=`unavailable`, reason은 아래 enum 하나이며 profile field는 없다.
입력 descriptor·run ID·접수/child reference·hash·실제 설정·private handle은 반환하지 않는다.
caller가 같은 결과를 만들거나 복제할 수 있다. 이 순수 판정은 ownership/검증 발행 표면이 아니다.

여러 불가 조건은 다음 순서로 하나만 반환한다.

1. shape/field/enum/version 형식 오류 → invalid_descriptor
2. nodeVersion/platform/architecture 후보 불일치 → unsupported_runtime_profile
3. mode/provider 후보 불일치 → unsupported_execution_profile
4. bootstrap 불일치 → application_not_unloaded
5. preloads/compileCache/startupSnapshot/inspector/startupConfig/runtimeSettings 불일치 → unsupported_startup_profile
6. moduleLoader/moduleCache/nativeAssets/generatedCode 불일치 → unsupported_loading_profile
7. filesystem 불일치 → unsupported_filesystem_profile
8. 모두 후보 조건과 일치 → candidate

unknown은 해당 group의 unavailable이고 missing은 invalid다. 지원 밖이면서 문법상 유효한 다른
Node version은 unsupported_runtime_profile이다. 문법이 틀린 version을 지원 밖 version과 섞지 않는다.

## 검증

- mock/deterministic fixture, null/표준 prototype, input freeze 여부가 같은 후보 값을 만든다.
- 18개 필수 field 각각의 missing/wrong type, unknown/symbol/non-enumerable/extra field와
  version length/숫자3자리·leading zero·suffix/newline/최대 경계.
- 각 group의 known unsupported/unknown, runtime mismatch, 복수 오류의 reason 우선순위.
- proxy/revoked proxy/getter/toJSON/Symbol.toPrimitive/custom prototype/cycle/nested object에
  hook 실행0·fixed reason·입력 내용 미복사. 표준 prototype poison은 별도 격리 시험으로 복원한다.
- 반환의 own property presence/immutable/null prototype, 민감 sentinel 미노출, 입력 변경 후 반환 불변.
- 전체 판정 경로에서 process/env/argv/fs/network 수집과 launcher/provider/artifact 동작을 추가하지 않는다.
  실제 production 소비자가 없음을 source/diff로 확인하며 시험의 가짜 spy를 runtime 관측 증거로 부르지 않는다.

후속 실제 launcher는 이 결과를 신뢰 증거로 받아들이는 대신 독립적으로 actual startup을 관측·결속해야
한다. 이 PR은 기존 A/B/C1과 일반 HTTP/legacy/direct replay를 호출하거나 변경하지 않는다.
