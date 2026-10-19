# 제한된 시험 실패 정보 보존

기존 turnover short-lock 시험과 compiler-load cleanup 시험은 실패 판정에 사용한 경과 시간,
원인 분류 또는 cleanup 단계가 최종 오류 설명에서 사라질 수 있었다. 이 변경은 두 test-only
경계에 작은 실패 설명을 보존한다. 제품 lock, child wire, strict parser, 거래 정책을 바꾸지 않는다.

## 기록 계약

Turnover 시험은 원래 `<4000ms` 판정에 사용한 elapsed와 원래 predicate가 처음 매치한
메시지의 고정 repository enum을 기록한다. 같은 Error getter와 cause 순회를 사용하며 새
읽기를 추가하지 않는다. 정확한 문자열이 아니면 unknown이다. elapsed가 유한하지 않으면
설명에는 null을 쓰지만 원래 비교 결과를 바꾸지 않는다. 원문 경로·Error는 새 메시지에 넣지 않는다.

Compiler-load harness는 `createCompilerLoadObservationForTest()`가 만든 opaque handle을
선택적으로 받는다. 원래 반환 Promise를 보관해 `readCompilerLoadObservationForTest(handle,
pending)`으로 읽는다. private WeakMap이 최초 호출과 정확한 Promise 객체를 결속한다.
같은 handle의 두 번째 호출에 첫 snapshot을 재사용하지 않는다. handle을 생략한 기존 호출도
그대로 동작하며 caller callback, 새 Promise continuation, timer 또는 filesystem 기록을 추가하지 않는다.

최초 cleanup settle에서 다음 13개 scalar만 frozen snapshot으로 남긴다.

| 필드 | 의미 |
| --- | --- |
| availability/caseId | 관측 존재 여부와 고정 사례 |
| phase/inspectSubmitted/removeRequests | settle 당시 JS 단계와 요청 상태(삭제 완료 증거 아님) |
| settlementTrigger/errorPhase | timer/inspect/remove/error 및 고정 오류 단계 |
| deadline/postInspectAt/settleAt | 원래 clock 호출에서 이미 얻은 값; post-inspect 미도달이면 null |
| outcome | 원래 deadline 비교로 결정한 cleanup 결과 |
| parsedStatus/parsedRejection | 기존 strict parser가 반환한 고정 enum; 미수집이면 null |

pre_inspect에서 deadline이 끝나도 원래처럼 이후 inspection을 제출한다. 늦은 callback은
첫 snapshot을 바꾸지 않는다. first-settle 전에는 unavailable이며 settle 뒤 outer Promise가
완료되기 전 snapshot이 있을 수 있다. 실제 caller는 pending을 await한 뒤 읽고 snapshot을
Promise 완료 증거로 쓰지 않는다. cleanup 전 early return에는 snapshot이 없고 원래 result가
그 사유를 보존한다. 진단만 unavailable인 경우 기존 verdict를 success로 바꾸지 않는다.

실제 compiler-load 시험의 고정10사례는 case별 handle 하나를 만든다. 실패 메시지 전체의
UTF-8 길이가4096bytes 이내일 때만 snapshot을 포함한다. 초과·직렬화 실패에는 작은 고정
unavailable 설명과 기존 bounded result를 사용한다. 이는 reporter의 stack 등 전체 stdout
상한이 아니다. raw child bytes, env, account/provider 또는 Error text를 snapshot에 넣지 않는다.

## 보존하는 경계와 검증

원래 clock 호출·strict 비교·execution/cleanup/grace 제한, first failure, one-remove,
종료 확인, queue latch와 unsupported runtime 판정을 유지한다. 추가 할당·분류·기록 비용이
있으므로 timing equivalence나 zero overhead를 주장하지 않는다. runtime/dependencies/result/
comparability unavailable, completeRuntime/Configuration/Input=false도 그대로다.

기존 harness30개 시험의 판정에 snapshot assertion을 붙인다. 같은 handle의 queued 동일
case 두 호출, pre_inspect 종료 후 원래 inspect 제출, timer 미실행 상태의 post-inspect/late
error를 위한 새 선언3개를 추가한다. 기존 input/result/resource assertion은 유지한다.
그 밖의 오류 조합을 전수 검증했다는 의미는 아니다.

검증은 저장소 `check:review`로 build·quality·tooling·영향 시험을 수행하고, 독립 구현 및
current-head 검수 뒤 최종 후보에 필수 full gate를 적용한다. 같은 입력의 통과 증거가 있으면
중복하지 않으며 실패하면 로그·원본·불확실 상태를 보존하고 수정·재검수로 돌아간다.

2026-10-14 PR833의 과거 G 실패는 elapsed/cause 및 cleanup 경계 로그가 부족해 정확한 원인이
미확정이다. 이후 계측본 성공을 정본 통과나 원인 해결로 바꾸지 않는다. 이 기능의 검증은 새
관측 계약이 제대로 동작하는지 확인하는 것이며 과거 누락 데이터를 복원하거나 G를 고치는
증거가 아니다. C2-C5 compiler-output PR과 별도 기능 단위로 관리한다.
