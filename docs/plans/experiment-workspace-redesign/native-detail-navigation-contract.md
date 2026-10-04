# PR802 접수 후 native 상세 조회 전환

기준 head `52888e59b949b7f6adbabaff216d49643bef1eae`. 원래 create 202 뒤 상세 URL 미commit 간헐 정체의 원인은 미규명이다. 이 변경은 원인 확정이나 timeout 상향이 아니라 App Router action/Flight decode/React commit에 의존하던 자동 URL 이동을 native Document GET으로 대체하는 설계다. 원격 PR802는 최종 검증 전 변경하지 않는다.

## 보존할 계약

생성 POST는 1회이며 accepted ID를 응답 계약으로 검증한다. POST 전 sessionStorage의 중복 생성 barrier를 먼저 저장한다. 접수 뒤 exact ID 저장이 실패하면 현재 화면의 알려진 ID를 유지하고 자동 이동하지 않는다. 접수 사실과 GET 조회 이동 오류는 별도 상태다. 명시적 exact ID 조회도 native anchor이며 ID를 추측하지 않는다. 새 실험은 기존 명시적 reset 이후 재검증해야 한다.

자동 이동은 `location.assign`이며 full document load 및 네트워크 실패 비용이 있다. 이동 함수의 동기 오류는 접수 성공을 unknown으로 강등하지 않는다. 브라우저 네트워크 error page에서 조회 실패를 앱이 직접 감지할 수 없는 한계가 있다. 뒤로 돌아오면 저장된 exact ID와 생성 잠금을 복원하고 token·validation은 폐기한다.

## 양방향 navigation 정책

늦은 202 전 사용자의 새 링크/Back 의도가 있으면 자동 이동하지 않는다. native 상세 GET이 시작됐으나 이전 wizard가 아직 보이는 동안에는 새 링크 이동도 native Document navigation으로 처리한다. 새 document navigation은 이전 document 요청을 취소/대체한다. capture에서 기존 SPA anchor handler를 막고 `window.stop()` 후 최신 목적지에 `location.assign`한다. Back/Forward popstate도 pending native 요청을 중단하고 최신 history 목적지를 native document로 재조회한다. 같은 단계 버튼으로 이동해도 pending GET을 먼저 중단하고 해당 wizard URL을 native로 이동한다. 사용자가 새 탭/다운로드/fragment만 이동하는 동작은 가로채지 않는다.

mount와 `pageshow` 모두 admission을 다시 읽는다. BFCache 복원에서도 known ID·빈 token·무효 validation·중복 생성 잠금이 재동기화된다. 저장소의 barrier가 unknown이어도 현재 메모리에서 알고 있는 accepted ID를 지우지 않는다. BFCache에서 요청 중 상태가 복원되면 자동 재전송 없이 저장 상태 조회만 제공한다.

pending 상태의 popstate는 현재 history 목적지를 `location.replace`로 재조회하므로 같은 Back 목적지를 추가 history entry로 다시 push하지 않는다.

## 필수 검증

1. 202 → exact ID Document GET → 실제 상세 내용, POST 1회
2. soft RSC 보류/실패와 무관하게 native 상세 진입
3. 새 목록/Back 후 늦은 202가 최신 경로를 덮지 않음
4. native 상세 GET 보류 뒤 새 목록/Back, 이전 응답 해제 뒤 최신 경로 유지
5. Back/Forward/reload 및 실제 BFCache에서 ID/token/validation/잠금/POST1
6. GET 실패·취소·ID 저장 실패에서도 accepted 사실과 중복 방지 유지

기존 timeout/worker/retry는 완화하지 않는다. 실제 BFCache 복귀를 관측하지 못하면 synthetic pageshow 검증과 구분해 한계로 기록한다. 정확한 최종 후보의 앱 검증·독립 리뷰·Linux gate 이전에는 hold를 해제하지 않는다.

## Windows production 관측 (2026-10-04)

재실행은 `npm --prefix apps/dashboard run test:e2e:experiment-native`다. 설치된 Chrome을 사용할 때 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`로 executable만 지정하며 sandbox를 유지한다. 전용 production config가 fixture8791·Next3003·Document gate3004를 시작하고 종료한다. 기존 dev Wizard config는 이 native 전용 파일만 제외하여 원래 66개를 독립 유지한다. native config는 실제 BFCache를 위해 Playwright의 disable-back-forward-cache 기본 인자만 제외하며 timeout/worker/retry는 기본 Wizard와 같다.

설치 Chrome 154.0.8037.95, Node24.19, Next16.2.9와 격리 synthetic fixture에서 새 native 회귀 18/18 및 기존 Wizard 66/66이 1440/1024/390px에서 통과했다. worker1/retry0, test30초/URL assertion5초는 유지했다. 실제 BFCache 복귀는 세 viewport 모두 wizard의 pageshow.persisted=true로 확인했으며 synthetic pageshow만으로 대체하지 않았다. 새 회귀는 실제202·POST1·exact ID DocumentGET·실제 상세·Back/reload·native 조회 anchor·저장실패 accepted 유지·GET실패 복귀·두 pending GET 경합을 포함한다.

초기 native 경합 계측은 pending navigation 뒤 이전 document를 Runtime.evaluate하여 멈췄다. storage setItem의 exact ID 이벤트를 이동 전에 받는 계측과 HTTP Document gate, 실제 브라우저 pointer/history 입력으로 교체했다. 이전 실패 기록을 보존하고 이 harness 실패를 원래 정체나 제품 원인으로 해석하지 않는다. 기존 intent 회귀도 native 이동으로 사라지는 document 대신 동일 ID 저장 이벤트를 관측한다. 기존 정상 생성 회귀의 실제202 body는 빠른 새 document commit 전에 route.fetch에서 보존하여 requested/effective·manifest·runner·sameID/POST1 assertion을 유지했다.

이 성공은 원래 App Router 간헐 정체 원인 규명이 아니다. 새 설계의 production 회귀 증거이며 exact 최종 head의 Linux 전체 gate와 독립 리뷰는 별도다. 원격 PR802와 merge hold는 유지한다.
