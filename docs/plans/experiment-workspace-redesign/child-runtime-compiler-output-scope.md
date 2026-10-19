# C2-C5: 단일 child의 compiler output 실행 관측

기준 main은 eda4e16456e5aaf795bdc0db86b69fe41093f4b5다. 고정 compiler A의 실제 load,
반환된 exports 객체, source 3개의 Program, 메모리 emit 2개, synchronous loader 직접 공급,
실제 ESM import 결과를 같은 소유 child 안에서 연결한다. 이전 보고서를 합치지 않는다.

## 범위와 전제

Node v24.19.0 Linux x64, builtin-only bootstrap, TypeScript 5.9.3 artifact A
9,112,572bytes/3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675를 고정한다.
input은 entry.ts/value.ts/lib.d.ts 3개, emit은 entry.js/value.js 2개다. compiler options,
source 원문 및 golden output은 C2-C4와 동일하다. default CompilerHost/ts.sys fallback은 없다.
실제 공급한 SourceFile의 객체·원문과 emit callback의 getOriginalNode 연관을 확인한다.

실제 emit 문자열을 닫힌 snapshot에 복사하며 mutable Map의 freeze만을 불변성으로 취급하지 않는다.
entry URL은 bootstrap만, ./value.js는 entry URL만 parent로 허용한다. format은 module,
attributes는 빈 객체이며 미등록 URL/query/fragment/parent/import는 거부한다. output hook을
등록한 뒤 dynamic import한다. namespace.observed의 고정 scalar와 동일 URL 재import의
namespace 객체 동일성·추가 load 없음까지 확인한다. ESM cache 전체 열거나 평가 횟수 증명이 아니다.

정상 supplier는 snapshot 원문을 직접 반환한다. 소유 output mirror 두 파일은 고정 ABA 반례용이며
원본 repository나 기존 root에 쓰지 않는다. 캡처한 single-link inode만 변경·복원한다.
compiler/input은 변경하지 않고 마지막 원문 일치를 확인한다. output을 쓸 때도 크기·UTF8·identity를
검사한다. 첫 failure를 유지하고 artifact/input/output 복원 결과를 각각 보고한다.

## 고정 사례

| caseId | 관측 |
| --- | --- |
| baseline | 고정 observed, snapshot-A |
| output_snapshot_aba | 고정 observed, snapshot-A |
| output_reread_aba | 고정 counterexample, snapshot-B |
| output_same_value_substitution | 고정 counterexample, snapshot-A |
| cache_before_hook | B cache 재사용 |
| hook_rewrite | A supplier 뒤 B rewrite |
| callback_cap | 고정 observed, snapshot-A |
| output_byte_cap | 고정 counterexample, snapshot-A |

cache_before_hook는 고정 B를 먼저 import한 뒤 A hook에서 동일 URL을 import한다. A hook의
suppliedOutput은 unavailable/loadCount 0, preloadedOutput은 B다. 이는 임의 ESM cache의
선행 load를 탐지한다는 주장이 아니다. hook_rewrite는 소유한 후속 hook이 A supplier 반환을 B로
바꾸는 고정 반례다. A supplier 기록을 최종 Node 소비 bytes라는 증거로 승격하지 않는다.
same-value와 byte-cap 변형은 고정 fault 원문이며 실제 compiler가 emit했다고 주장하지 않는다.

| caseId | 첫 reason |
| --- | --- |
| stale_output | STALE_OUTPUT |
| extra_output | UNLISTED_OUTPUT |
| duplicate_output | DUPLICATE_OUTPUT |
| missing_output | INCOMPLETE_OUTPUT |
| unlisted_import | OUTPUT_UNLISTED |
| unlisted_parent | OUTPUT_UNLISTED |
| query_url | OUTPUT_UNLISTED |
| fragment_url | OUTPUT_UNLISTED |
| import_attributes | OUTPUT_UNLISTED |
| format_mismatch | OUTPUT_FORMAT |
| snapshot_swap | OUTPUT_MISMATCH |
| supply_mutation | OUTPUT_MISMATCH |
| hook_deregister | OUTPUT_HOOK_LOST |
| late_load | OUTPUT_CLOSED |
| artifact_mismatch | ARTIFACT_MISMATCH |
| compiler_object_mismatch | COMPILER_IDENTITY |
| type_error | COMPILER_DIAGNOSTIC |
| options_mutation | SOURCE_MISMATCH |
| source_object_mismatch | SOURCE_MISMATCH |
| input_cap_over | INPUT_LIMIT |
| output_cap_over | OUTPUT_LIMIT |
| callback_cap_over | OUTPUT_CALLBACK_LIMIT |
| import_failure | OUTPUT_IMPORT_FAILED |
| restore_failure | COMPILER_DIAGNOSTIC |
| input_extra | INCOMPLETE_INPUT |
| input_missing | INCOMPLETE_INPUT |
| source_text_mismatch | SOURCE_MISMATCH |
| compiler_callback_cap_over | LOAD_LIMIT |
| unlisted_read | UNLISTED_READ |
| read_cap_over | READ_LIMIT |
| resolution_cap_over | RESOLUTION_LIMIT |

고정 fault seam은 각 검사를 실제 경계에서 통과시키며 정상 검사를 완화하지 않는다.
import_failure만 알려진 throw 원문을 실행한다. 임의 source/경로/options를 받는 API는 없다.
runtime/dependencies/result/comparability는 unavailable, completeRuntime/Configuration/Input은
false다. production, 기존 A/B/C1/C2, package/lock/runner, provider/실거래/HTTP/receipt는 변경하지 않는다.
일반 package/build/dependency closure, filesystem/env/native/Node memory image, C2-D admission은 남는다.

## 동결 protocol과 자원

producer 전에 compiler_output_experiment.v1의 case/reason, canonical 순서, literal 관계,
독립 golden을 동결한다. 원문·경로·env·diagnostic·임의 ID를 wire에 싣지 않는다.
unknown/missing/reordered/duplicate key, 잘못된 UTF8/LF, case 불일치와 completeness 승격을 거부한다.
LF 포함 observed/counterexample 최대 1276bytes, rejected 최대 457bytes다.
전자를 transport 2048bytes와 구분한다. 독립 설계 검토 완료 전 producer를 작성하지 않는다.
동결 callback 기대값(일반5/cache2/cap8)은 실제 Node24.19.0 Linux x64 영향 검증에서
일치했다. 이후 불일치도 실패로 보존하고 설계를 재검토한다. assertion 완화는 하지 않는다.

| 항목 | 상한 |
| --- | ---: |
| compiler / bootstrap | 10MiB / 64KiB |
| input / output / output mirror | 3×16384 / 2×16384 / 2×16384bytes |
| source read / resolution | 16 / 8 |
| compiler / output loader callback | 32 / 8 |
| stdout / stderr | 2048 / 4096bytes |
| 실행 / TERM / KILL / 각 root 관측 | 10 / 1 / 1 / 1초 |
| harness 할당 | 40개 |
| root 논리 payload / harness 합계 | 10,633,217 / 425,328,680bytes |

실제 child는 고정 사례39개+hostile env 확인1개로 40회이며 restore_failure가 마지막이다.
root 자동 삭제 요청은 없고 cleanup_not_performed로 보존한다. 최초/final root 관측은 각각 1초다.
확인된 close·valid report·복원·root 관측이 모두 있어야 collected다. 정상적으로 수집된 고정
rejected 사례는 검증 결과이며, 준비/spawn/stream/exit/deadline/protocol/복원/관측 실패는 해당
harness를 영구 중단한다. 늦은 close나 새 harness instance로 실패를 지우지 않는다.
상한은 논리 fixture payload이며 물리 디스크·외부 writer 한도가 아니다. 별도 준비/reader/root 교체
시험도 자동 삭제하지 않고 실행별 root manifest와 집계에 포함한다.

## 완료와 검증

독립 설계 검토 → 구현 → 실제 Linux 사례/프로토콜/소유 lifecycle 검증과 check:review →
독립 구현 검토 → 최초 Ready 자동 Code/Security → 최종 후보 check:merge와 보호조건 확인 순서다.
같은 검증 입력의 full 통과는 중복 실행하지 않는다. 실패·중단·기존 skip을 실제 통과로 바꾸지 않는다.
소스·환경·root↔case와 파일 hash, 종료 상태를 wire 밖 증거에 보존한다.
Library 저장은 공식 경로 성공과 실제 왕복 복원 확인까지 별도 상태로 기록한다.
기존 C2-C2/C2-C3 Library 차단 자료·refs를 유지하며 무변화 재시도·전송 우회를 하지 않는다.

실제 결과와 남은 의무는 [검증 기록](child-runtime-compiler-output-validation.md)에 남긴다.
