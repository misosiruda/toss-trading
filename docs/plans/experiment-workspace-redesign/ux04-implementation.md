# UX-04 실행 상세 구현 계약

2026-10-04 · 기준 PR #802 head `52888e59b949b7f6adbabaff216d49643bef1eae`

## 선행과 분리

별도 branch `feat/experiment-workspace-detail-ux04`는 위 exact head에서 시작한다.
초기 PR base는 `feat/experiment-workspace-create-ux03`이며 #802에 의존하는 stacked draft다.
#802의 간헐 상세 navigation merge hold를 해소하지 않는다. #802 병합 후 main으로 retarget하고
현재 후보 diff/필수 gate를 다시 검증하기 전 병합하지 않는다. 기존 #802 worktree와 진단 증거는 보존한다.

## 현재 source가 허용하는 범위

`readRunDetailPageData`의 기존 no-store GET과 2초 timeout, `RunDetailView` guard를 재사용한다.
요청 ID와 resolved child runId, batchId를 별도 표시한다. 기존 adapter는 같은 child의 최신
artifact만 연결하며 다른 run의 산출물을 제외한다. 이를 summary/record에서 동일하게 유지한다.
이번 PR은 reader/runner/Risk Engine/생성 API/접수 navigation guard를 변경하지 않는다.

현재 ViewModel은 현재 snapshot과 counts만 제공한다. 검증된 equity/benchmark 시계열이나
run-scoped event reference가 없으므로 chart를 발명하지 않는다. replay/evidence는 disabled이며
그 이유와 기존 자료 접근 경로를 보여준다. 전체 Risk/audit는 '전체 운영 기록'으로만 연결한다.
UX-05의 run-scoped decision inspector나 UX-06 비교는 이번 완료 조건에 포함하지 않는다.

## 화면과 URL

canonical `/dashboard/lab/runs/[runId]` 유지. query `tab=summary|record`, 부재/unknown은 summary.
요약·기록 링크는 실제 URL을 사용하고 공유/reload/Back/Forward를 보존한다. 지원하지 않는
replay/evidence는 링크를 만들지 않는 disabled control과 명시적인 이유다.

첫 화면: 'Run Detail' 기존 heading, 목록 복귀, 요청 ID→선택 child ID, child 상태,
batch/endpoint/접수 관측 분리. 이후 요약은 기존 숫자와 progress snapshot, 산출물 판독 상태;
기록은 시작·완료·실패·skip 원본 시각, source 경로·artifact identity·warnings와 전체 운영 기록.
기존 source/safety 영역과 report/progress/count 표시도 보존한다. 판독되지 않은 artifact 숫자는
미관측으로 표시하고 원본 정상 판독의 0은 유지한다. 화면의 변환 시각은 KST를 명시한다.
조회 없음/offline/invalid에서도 요청 ID·탭·목록 복귀·GET 재조회는 접근 가능하다.
접수 unknown/runner_failed는 child 상태/metrics를 덮지 않으며 기존 별도 관측 panel을 유지한다.

시각 정본은 `wireframes.html`과 `technical-design.md`의 token이다. 실제 source에 없는 차트와
결과는 제외하는 의도적인 편차다. 배경 #f7f8fa/white surface/기존 Geist, 단순 URL navigation,
44px controls, focus/단일 main/모바일 단일 열을 유지한다. 숫자·경로에는 줄바꿈을 허용한다.
새 raster 이미지/외부 아이콘/패키지는 필요하지 않다.

## 상태와 완전성

- wrapper offline/invalid와 endpoint 판독 상태, batch 상태, child 상태, 개별 artifact 상태는 별도다.
- child terminal 네 값은 completed/completed_with_failures/failed/skipped이며 완료와 성공을 합치지 않는다.
- same-ID artifacts가 없으면 missing. 하나라도 missing/corrupt/degraded/blocked/invalid이면 partial.
  모든 판독값 ok일 때만 판독 complete이며 투자 결과 성공이나 참조 정합성이 검증됐다는 뜻이 아니다.
- unknown/null metric은 '미관측'이며 숫자 0을 유지한다. total 없는 진행은 percentage를 만들지 않는다.
- heartbeat/원본 수정 시각은 API에 없으므로 '미관측'. fetchedAt은 GET 관측 시각이다.
  실행 시작 시각이나 오래된 terminal 기록을 stale/failure로 바꾸지 않는다.
- stale는 자동 갱신 중 마지막 성공 조회가 15초 이상 지난 browser 관측 경고로만 정의한다.
  timer와 fetch 실패가 runner 실패를 만들지 않는다.

## 제한된 GET 갱신

자동 갱신은 유효 child running 또는 child 부재+유효 접수 unknown일 때만 5초 간격으로 한다.
한 ID/tab document 방문당 최대 12회이며 terminal/runner_failed-only/offline/invalid에서 중단한다.
URL tab 이동은 서버 source를 재조회하고 이전 lifecycle을 정리한다. manual snapshot GET은
방문 한도를 초기화하지 않는다. 정상 terminal 화면에는 불필요한 clock timer도 두지 않는다.
12회 종료는 '자동 조회 한도 도달 · 실행 상태 단정 불가'다. manual GET 재조회는 제공한다.
GET BFF는 위 기존 reader를 호출하며 입력 ID/응답 identity를 검증하고 no-store를 유지한다.
동시에 하나의 GET만 허용하고 AbortController+request identity로 이전 ID/언마운트 응답을 버린다.
tab/route 이탈과 숨긴 document에서 timer/요청을 정리한다. terminal 응답 뒤 재예약하지 않는다.
토큰을 받지 않으며 POST/runner/cancel/retry mutation을 호출하지 않는다.

## 검증 완료 조건

순수 state/identity unit: terminal/running/accepted-only/runner_failed, batch→child,
다른 child artifact 제외, partial 원본 값, zero vs missing, wrapper 오류, unknown tab.
poll lifecycle: terminal stop/최대 회수/중복 GET 방지/abort/늦은 ID 응답 폐기/숨김 정리.
browser: production desktop1440/1024/mobile390, summary↔record URL·Back·reload,
오류 상태·missing·partial, readonly network assertions, keyboard/axe/console/overflow.
시각 비교는 정본 시안과 실제 source의 의도적 편차를 기록하고 screenshot으로 검증한다.
최종 후보는 diff/check:review 및 환경이 지원하는 check:merge와 dashboard lint/unit/type/build를
실행하고 이전 head 증거와 합산하지 않는다. 초기 Ready 자동 review는 한 번만 수행한다.

## 같은 run의 실패한 server replacement

summary/record 이동으로 새 initial이 offline 또는 invalid가 되어도 같은 요청 run ID의 마지막 정상 snapshot은 유지한다. 새 실패 상태와 최근 서버 관측 시각은 현재 snapshot에서 표시하고, 보존한 자료의 GET 관측 시각은 이전 정상 snapshot의 시각으로 유지한다. 요청 run ID가 바뀌면 이전 자료를 초기화한다. replacement는 이전 GET lifecycle을 dispose하여 늦은 성공/실패가 새 관측을 덮지 못하게 한다. 합성 production 회귀는 offline/invalid에서 자료·선택 탭·keyboard focus·시각 보존, 보류된 이전 GET 폐기와 자동 조회 중단, 다른 run의 실패/정상 이동 시 identity 분리를 검증한다.

## 독립 리뷰 회귀 보완

- Tab-only URL 이동은 링크 DOM을 유지한다. run ID만 workspace identity로 사용하고 새 fetchedAt의 관측 상태·polling lifecycle을 갱신한다. 키보드 Enter 및 Back/Forward의 포커스를 검사한다.
- running/accepted-unknown 관측은 응답 pending 또는 hidden 복귀에서도 마지막 성공 GET 이후 15초가 지나면 관측 지연을 표시한다. terminal 결과는 시간 경과만으로 stale 처리하지 않으며 실행 상태를 실패로 바꾸지 않는다.
- Wizard navigation-intent fixture는 202 접수 뒤 같은 ID의 batch terminal 상태를 bounded GET으로 확인하고 다음 케이스로 넘어간다. POST 재시도·고정 sleep·timeout 상향 없이 admission guard를 보존한다. 최초 full-run409 기록은 별도 증거로 유지한다.
