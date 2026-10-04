# 저장 조건 조회의 상세·비교 화면 연결

별도 frontend 후보이며 provenance API `97ed6a13`의 조회 DTO를 type-only로 참조한다. backend reviewer 수정은 API branch에서 처리하고 화면 adapter `runProvenance.ts`에서 독립적으로 반영한다. 원격 API/compare branch는 변경하지 않는다.

## 구현 경계

상세 canonical exact ID와 비교 baseline/candidate 각각에 server no-store GET 1회를 추가한다. 상태·근거 읽기와 병렬로 수행하고 각 조회는 기존 2초 한도 안에서 실패를 분리한다. invalid ID와 invalid comparison 선택은 provenance GET을 시작하지 않는다. 기존 상세 snapshot polling에는 조건을 섞지 않으며 문서 조회 관측 시각을 따로 표시한다. 페이지 reload·새 tab 문서 조회는 새 GET을 수행한다.

기간, 실행 설정, 비용·체결, Risk·배분·종료, 저장 hash, 복원되지 않은 입력/runtime을 native details/summary로 분리한다. 값과 unavailable 사유를 같은 field 행에 표시한다. 저장된 0/false/null과 누락을 구별하며 absent field에 default를 넣지 않는다. source와 stored observation을 표시하고 hash는 현재 자료·코드·정책과 미검증이라고 설명한다. 전체 입력/runtime 복원, 지표 동등성·순위·clone은 계속 unavailable이다.

client display model은 알려진 field whitelist만 전달한다. exact requested identity와 DTO version/mode/readOnly를 대조하고 임의 field/error/path를 전달하지 않는다. 6개 timestamp는 엄격한 문법·calendar guard로 Date.parse 자유 문자열을 표시하지 않는다. 원래 입력/runtime/seed의 recorded claim도 unavailable 처리한다. API 날짜·배열 보안 수정 후보와 별도로 이 frontend 방어를 갖춘다.

기존 상세 summary를 조건 패널보다 먼저 유지한다. established workspace의 palette/type/outline/44px disclosure와 반응형 행을 사용한다. 기존 placeholder의 완전한 fidelity 또는 UX06 전체 구현 완료를 주장하지 않는다. backend schema 변경 때 adapter와 이 후보의 typecheck/negative tests를 다시 확인한다.

## 검증과 발견

합성 fixture로 exact detail/두 열 partial, zero/false/hash, field별 unavailable, 한 열 missing/offline/blocked/limit/ambiguous/identity mismatch, 6개 unsafe date, keyboard disclosure, Back/reload, GET-only 및 clone disabled를 검사한다. desktop 1440, tablet 1024, mobile 390에서 상세·비교 axe/overflow/console와 스크린샷을 확인한다. 기존 상세 polling/terminal stop/held snapshot과 UX06 비교/default route 회귀도 확인한다.

기존 run-workspace fixture는 같은 ID의 모든 API 요청을 상태 전이 횟수에 셌다. 새 독립 provenance GET 때문에 held snapshot의 running 응답이 조기 completed로 바뀌는 실패를 재현했다. 전이 횟수는 `/batch/replay/runs` 요청만 세도록 고쳤고 기존 running/terminal/race assertion은 유지했다. 이는 product의 상태 경합 수정이 아니며 PR802 원래 navigation 정체 원인으로 주장하지 않는다.

## UX02c·UX07 잔여 완료 기준 대조

| 범위 | 독립 확인한 현재 계약 | 남은 완료 조건 |
| --- | --- | --- |
| UX02c cost/benchmark/universe | 현재 high_cost/cash_only 및 미지원 선택 거절, preset metadata와 market allocation의 제한, validation/create의 exact runner mapping을 기존 synthetic negative/spy tests로 확인 | 실제 선택별 runner 적용·결과 provenance·비교 계약·negative tests를 갖춘 별도 기능 PR 이후에만 새 옵션 노출. 이번 후보에서 확대하지 않음 |
| UX07 Next 이전표 | default smoke의 기존 operations/portfolio/Risk/validation/audit/detail/policy/bucket/legacy 접근 경계와 목록·fragment·keyboard 경로를 독립 검증 | 데이터·설정의 역할별 index, 미이전 legacy 자료 mapping, 명시 origin의 missing/invalid 안내, 문서/runbook 출처 안내를 포함한 전체 migration checklist는 별도 작업. 현재 smoke 통과를 UX07 전체 완료로 기록하지 않음 |

독립 리뷰 및 최신 Linux 전체 gate, 자동 리뷰/보호 조건 확인 전 PR/Ready/merge를 확정하지 않는다. 원래 create 입력 정본 저장·clone 단위 선택은 사용자 결정 전 구현하지 않는다. PR803 본문 정정 승인 대기는 유지한다.
