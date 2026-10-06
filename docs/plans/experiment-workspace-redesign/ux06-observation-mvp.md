# UX06 두 실행 관측 MVP

## 범위와 계약
기준 실행 1개와 후보 실행 1개를 GET으로 조회하여 상태, 실행 기록 시각, 저장 근거의 읽기 상태와 반환 범위를 나란히 표시한다. `/dashboard/experiments/compare?baseline=<exact-child>&candidate=<exact-child>`가 선택을 보존한다. 중복 파라미터, 잘못된 ID, 같은 실행 두 번 선택은 조회 전에 거절한다. batch 별칭을 child ID로 조용히 변환하지 않는다. 중복 child 기록이나 다른 ID 응답은 해당 열만 사용할 수 없음으로 처리한다.

기존 `/batch/replay/runs?limit=100&includeLatestRunArtifacts=1&runId=...` 계약을 사용한다. 각 열은 no-store GET 1회, 2초 제한이며 실패를 분리한다. 원본 경로, 오류 메시지, provider 출력은 화면 계약에 전달하지 않는다. 입력·source fingerprint·관측 기간/timezone·scope·cost·benchmark·version의 완전한 provenance를 이 API가 제공하지 않으므로 동등성, 지표 차이, 순위, 공통 기간 성과, clone은 unavailable이다. 두 unknown 값을 같다고 판단하지 않는다. 새 backend API는 추가하지 않는다.

## 화면 명세
기존 실험 디자인의 #f7f8fa 배경, 흰 rail, #172234 본문, #57657a 보조 글, #e1e6ed 선, #1f63df 동작색과 Geist 계열을 유지한다. 헤더 `실행 비교`, 설명 `두 실행의 저장 관측을 확인해요. 지표의 동등성은 확인되지 않았어요.`, 목록 복귀 링크. 기준·후보 ID 입력과 `두 실행 조회` GET form. 다음은 `비교 제한` 안내, 이어 기준·후보 두 열의 실행 상태/UTC 기록 시각/근거별 표/제한 사유. 아래 `입력 복제` disabled와 설명. desktop은 2열, 390px은 기준 다음 후보 순서의 1열. ID와 시각은 줄바꿈하며 표에 가로 스크롤을 요구하지 않는다. 각 표의 caption과 열 제목으로 역할을 구분한다. focus는 명확한 outline, 입력/버튼은 44px 이상이다.

기존 wireframe의 비교 화면은 메뉴와 placeholder였다. 두 입력, 실제 GET 관측 열, 제한 안내는 이번 사용자 요청에 따른 기능 확장이다. 신규 이미지/장식/차트/성과 숫자는 사용하지 않는다. 목록에 실행 비교 진입 링크를 추가하며 기존 검증 보고서 목적지는 보존한다.

## 문서 목표에서 줄어든 범위
후보 1~3개가 아닌 1개만 지원한다. 완전한 입력 비교·지표 동등성 판정·복제 후 wizard/create는 구현하지 않는다. 이번 MVP의 완료는 독립 실행의 제한된 저장 관측에 한정되며 UX06 전체와 프로젝트 완료를 뜻하지 않는다. provenance read 계약이 추가된 뒤 별도 단계에서 확장해야 한다.

## 검증
합성 fixture만 사용한다. 정상/진행 중/부분 실패, 한 열 offline, 다른 child/중복 child, 일부 근거 malformed/차단/잘림/실제 0건, 잘못된 선택의 GET 0회, Back/Forward/reload 선택 보존, keyboard, 1440/1024/390px, axe/console/overflow와 기존 목록/Wizard/상세/근거 회귀를 확인한다. GET 이외 호출이 없는지 확인한다. 기존 PR802 Router 정체 진단과는 독립된 변경이다.
