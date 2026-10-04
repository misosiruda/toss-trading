# Provenance UI 리뷰 후속 수정

API `1b095817`을 포함한 UI tree `4597da5eb483a2013a0b8410b12555231c7c1091`에서 시작한 후속 작업이다. 당시 원격 UI `e6188ec`는 독립 리뷰를 위해 고정했고 API나 PR803 본문은 변경하지 않았다.

adapter는 소수·음수·안전 범위 밖의 `maxNewPositionsPerDay`를 거절한다. configuration/window 출처는 `run_metadata`, research는 `research_manifest` 또는 `run_metadata`만 허용한다. recorded 필드에 unavailable reason을 함께 넣거나 unavailable 필드에 source/verification을 넣을 수 없다. 필드 종류·전체 상태·사용 불가 이유를 API 계약과 대조한다. 보고된 잘못된 값과 유효한 0·안전 정수·내장/외부 research를 회귀로 검증한다.

## 비교 이동의 보호 범위

비교는 exact ID GET으로 server document를 만든다. 늦은 응답을 적용하는 client polling lifecycle은 없다. 회귀는 이전 server read가 종료되거나 취소된 뒤 최신 document URL·두 ID·상태·provenance panel을 검증한다. keyboard/form/history 시험은 실제 선택 UI를 다룬다. response gate는 document/server read 경계를 검증하며 상세 snapshot component의 stale response 폐기를 검증했다고 주장하지 않는다.

기존 시험은 `page.goto(..., waitUntil=load)` 두 개를 겹쳐 실행하고 ID만으로 요청을 세었다. pending goto promise만으로 document commit이나 backend 응답 보류를 증명할 수 없었다. tablet 이동 중단과 desktop visibility/clock 실패 로그는 diagnostic 자료에 보존했다. PR802의 원래 create202 이동 정체와 혼동하지 않는다.

대체 시험은 완전한 비교 document를 준비한 뒤 generation·endpoint·child ID별 gate를 설정한다. 이전 document commit과 실제 `/batch/replay/runs` 요청의 시작·열림·보류 상태를 독립 확인한 다음 새 document를 commit한다. 이후 이전 응답을 해제하고 종료 또는 취소를 관측한 뒤 최신 exact pair·상태·URL을 확인한다. 미완료 goto를 catch로 숨기지 않는다. provenance suite는 runs/provenance endpoint를 각각 보류하고 최신 ID와 값을 이전 hash/cash와 구분한다.

겹치기 전에 이전 read가 만료·종료되면 사전조건 실패다. 기존 앱 2초 deadline, 시험 timeout, retry=0을 유지하며 overlap/release 전 elapsed age를 확인한다. 600ms sleep·강제 timeout·일괄 goto catch·자동 retry·assertion 완화는 없다. gate는 합성 in-memory 자료로만 동작하고 loopback 및 runner header로 격리한다. generation별 첨부 자료에 pending/release/finish/cancel을 기록한다.

## Visibility와 가상 시간

기존 hidden-document 시험은 hydration timer/listener 설치를 관측하지 않고 visibility event와 가상 시간을 진행했다. 후속 시험은 기존 5초 timer·visibility listener·running child 표시를 먼저 확인한다. hidden timer 제거·GET=0, visible timer 재설치 후 시간 진행·GET=1, 떠난 뒤 cleanup을 검증하고 순서를 첨부한다. 제품 readiness hook·delay·timeout 증가는 없다. 기존 실패에는 timer 준비 관측이 없어 원인은 여전히 미확정이다. 새 통과는 과거 원인 확정이 아니다.

독립 리뷰와 exact 후속 검증은 API PR806 security/Linux gate와 별도이며 상위 PR802 hold는 유지한다.

추가 keyboard probe는 `<details open>` 조건을 유지했다. 실패에는 SUMMARY focusin 없이 BODY에 Enter가 전달됐고 정상 control에는 SUMMARY keydown/keyup 뒤 DETAILS가 열렸다. 회귀는 visible·focused summary에 Enter를 전달한다. 제품이나 open assertion은 바꾸지 않았다. 실패 로그와 probe trace를 보존했으며 과거 focus 호출이 실제 focus를 만들지 못한 이유는 추정하지 않는다.
