# C2-C4: 단일 child의 compiler build 관측

이 test-only 부분 실험의 기준은 main `efcdfb8a009543e978a4ff1f91323b50006f7411`,
tree `55a863d143ec03f68ae5f59cacc8fbfecab1ab57`이다. 하나의 소유 child 안에서 고정 compiler bytes의
실제 공급, 반환된 compiler exports 객체, source 3개의 Program과 메모리 emit 2개를 연결한다.
parent는 terminal report 하나를 수집한다. C2-C2/C2-C3 보고서를 합치거나 같은 label/hash를
process/session 동일성으로 해석하지 않는다.

## 신뢰 경계와 고정 입력

Node v24.19.0 Linux x64와 standalone builtin-only bootstrap은 이 실험의 신뢰 전제다.
TypeScript5.9.3 compiler A는 9,112,572bytes이며 SHA256은
`3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`다.
compiler B는 고정 `__c2c3Marker = 202` suffix를 붙인 9,112,608bytes다.
소유 fixture에는 artifact, 컴파일된 bootstrap, `entry.ts/value.ts/lib.d.ts`를 exclusive write로 복사한다.
stable reader는 link, inode 교체, 상한 초과, 잘못된 UTF-8을 거부한다. 원본 repository 파일은 바꾸지
않으며, ABA 주입은 이미 캡처한 single-link fixture inode에만 쓴다. 실제 공급할 A/B bytes는
hook 등록과 require 전에 크기·digest pin을 검사한다. unlisted module/builtin 거부 시험의 고정
fault suffix만 pin 확인 뒤 붙인다.

실제로 load한 exports 객체로 createSourceFile/createProgram/getPreEmitDiagnostics/getOriginalNode와
Program.emit을 호출한다. host는 캡처한 텍스트만 소비하고 SourceFile 객체를 보존하며 고정
`./value.js` 해석과 두 output만 허용한다. emit의 source는 host가 공급한 원본 SourceFile 및
변하지 않은 text와 연결돼야 한다. options는 `/c2c2`, ES2022 ESM, Classic resolution,
strict/noLib, types=[], noEmitOnError, LF와 incremental/declaration/source-map 비활성화로 고정하여
C2-C2 options digest를 유지한다. golden output 원문은 독립 fixture이며 생성된 JS를 실행하지 않는다.
default CompilerHost나 ts.sys를 입력 fallback으로 사용하지 않는다.

## 고정 사례

| caseId | 공급 compiler | 소비 source/output | terminal |
| --- | --- | --- | --- |
| baseline | A | A | observed |
| compiler_snapshot_aba | disk A-B-A 중 캡처 A | A | observed |
| compiler_reread_aba | disk A-B-A 중 다시 읽은 B | A | counterexample |
| input_snapshot_aba | A | disk A-B-A 중 캡처 A | observed |
| input_reread_aba | A | disk A-B-A 중 다시 읽은 B | counterexample |
| both_snapshot_aba | 캡처 A | 캡처 A | observed |
| both_reread_aba | B | B | counterexample |

이 사례들은 A/A, B/A, A/B, B/B 값을 다루며 모든 가능한 interleaving을 증명하지 않는다.
같은 emit output이 compiler bytes의 동일성을 보장하지 않는다. `callback_cap`, `read_cap`,
`resolution_cap`은 각각 정확한 상한에 도달한다.

이 부분 실험의 고정 negative 목록은 `runtimeCompilerBuildProtocolTestFixtures.ts`에 있다.
cache/pin/load 실패, 미등록 import/read, diagnostic, stale/extra/duplicate/missing output,
source 객체·원문·개수 불일치, option/compiler/cache 객체 변경, byte/count 초과와 독립 복원 실패를
검증한다. 다른 원본 SourceFile은 실제 emit callback에 주입하고 stale 항목은 실제 output Map에
주입해 공통 검사를 거친다. observer fault injection은 test-only이며 compiler 고유 동작이라는 주장이 아니다.

## 동결된 protocol과 상한

producer 구현 전에 독립 설계 검토로 `compiler_build_experiment.v1`, 유한 case/reason,
canonical key 순서와 정확한 최대 fixture를 동결했다. 최초 검토의 P2는 복원 실패가 첫 diagnostic에
가려질 수 있다는 점이었다. rejected union에 두 복원 상태를 각각 기록하도록 수정했으며
후속 설계 검토에서 남은 P1/P2는 없었다.

공통 필드의 순서는 schemaVersion, caseId, runtime, dependencies, result, comparability,
completeRuntime, completeConfiguration, completeInput이다. 네 범주는 항상 `unavailable`이고
세 complete flag는 항상 false다.

observed/counterexample의 추가 필드 순서는 status, evidence (`fixed_compiler_build_observation`),
compilerVersion (5.9.3), artifactBytes, capturedArtifact, suppliedArtifact, restoredArtifact,
compilerLoadCount (1), builtinLoads (`crypto,fs,os,path,perf_hooks` 순서), cacheSameObject (true),
compilerObjectSame (true), observedMarker (0/202), callbackCount (12 또는 cap 사례32), inputFileCount (3),
outputFileCount (2), capturedInput, consumedInput, restoredInput, emittedOutput, optionsDigest,
sourceFileObjectsSame (true), diskBeforeAfterMatch (true)다. case별 literal과 digest 관계는 정확히
고정되며 임의의 숫자·문자열을 받지 않는다. parser는 유한 기대 객체를 다시 serialize하여 LF 하나까지
byte 단위 일치를 요구한다. unknown/missing/reordered/duplicate key와 completeness 승격을 거부한다.

rejected의 공통 필드 뒤에는 status=rejected, evidence=unavailable, 유한 reason,
artifactRestoration, inputRestoration이 온다. 각 복원 상태는 `not_changed|confirmed|unconfirmed`다.
첫 reason을 latch하고 두 복원을 각각 시도한다. 어느 쪽이든 unconfirmed면 parent는
`RESTORE_UNCONFIRMED`와 원래 rejected report를 반환하고 root를 보존한다. 삭제를 요청하지 않고
같은 harness의 후속 root 할당도 막는다. transport 실패에는 신뢰할 report가 없다.
종료나 cleanup이 미확인이어도 소유 상태를 남기고 후속 child를 막는다.

| 항목 | 상한 |
| --- | ---: |
| compiler artifact / bootstrap | 10 MiB / 64 KiB |
| input 개수 / 파일당 / 합계 | 3 / 16,384 / 49,152bytes |
| output 개수 / 파일당 / 합계 | 2 / 16,384 / 32,768bytes |
| source callback / resolution 요청 / loader callback | 16 / 8 / 32 |
| stdout / stderr | 2,048 / 4,096bytes |
| 실행 / TERM / KILL / cleanup 관측 | 10 / 1 / 1 / 1초 |
| LF 포함 schema-valid report 최대 | 1,376bytes |
| LF 포함 rejected report 최대 | 416bytes |

위 양성7개의 길이는 순서대로 1357,1370,1376,1367,1371,1366,1372이며 cap 사례는 1361,1357,1363이다.
rejected 상한은 모든 유한 case/reason/복원 상태 조합을 열거해 계산한다.
callback12는 실제 Program 경로에서 측정해야 하는 동결된 기대값이며 C2-C3 결과를 대신 사용하지 않는다.
통과를 위해 cap/assertion/timeout/skip을 완화하지 않는다. wire에는 원문 source/output, 경로,
env/argv, diagnostic, 임의 ID와 비공개 hash를 넣지 않는다.

## 남은 의무

이 실험은 runtime admission이나 durable receipt가 아니다. compiler 초기화의 일반 filesystem/env
소비, builtin/native 구현, Node memory image, 전체 project build, package/dependency closure,
생성 JS 실행, 전체 configuration/input, C2-D IPC/admission은 아직 증명하지 않았다.
기존 A/B/C1과 C2 구현, production HTTP/runner/provider/receipt, package/lock/runner 설정은 바꾸지 않는다.
runtime/dependencies/result/comparability는 unavailable이며 complete flag는 모두 false로 유지한다.
실제 검증과 보존된 실패는 [검증 기록](child-runtime-compiler-build-validation.md)에 구분하여 남긴다.
