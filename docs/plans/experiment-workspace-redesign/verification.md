# UX-00 설계 검증 기록

2026-10-02 · 문서 및 시안 검토 · production 구현 없음

## 통과한 확인

- 현재 `main d954915` 코드와 API/route/state 계약을 읽기 전용으로 대조했다.
- 별도 검토에서 발견한 legacy route 오기, `completed_with_failures` 누락, 전체 storage
  Risk/audit를 개별 run 근거로 혼동할 위험을 수정했다.
- `universe.preset` 미전달과 `universe.market`의 allocation 용도를 명시했다.
- UX-02의 입력 계약, 접수 후 실패 관측, 선택형 조건 확대를 작은 단위로 나눴다.
- Markdown 상대 링크 존재, HTML ID/label/ARIA 참조와 JavaScript 구문을 검사했다.
- `git diff --check`를 실행했다.
- 세 가지 Image Gen desktop concept를 실제 이미지로 확인했다. sidebar 208px, 목록 중심,
  2열 생성 form, summary의 차트 중심 배치를 반응형 HTML 시안으로 구체화했다.
- 생성 이미지의 가상 정책 버전·비용·bucket 값은 사실성 검토 후 채택하지 않았다.

## 자동 review finding 수정

자동 review의 P2 아홉 건을 반영했다.

- 완료·진행·실패·미관측 모두 실행 ID가 포함된 상세 링크를 제공한다. 선택 ID의 이름·상태·
  관측 기록을 표시하며 완료 예시의 수치를 다른 실행에 재사용하지 않는다. 미확인 ID도 구분한다.
- 모바일에 접이식 주메뉴를 추가해 실험/전략·정책/비교/데이터/설정 구성을 유지한다.
  세부 메뉴는 production 기능이 아니라 기존 기능 이전표로 이어지는 명시적 구성 안내다.
- 부분 실패(`completed_with_failures`)와 건너뜀 예시/필터/상세를 추가하고 완료·실패·skip counts를 보인다.
- 상세 tab과 목록 filter를 URL에 보존한다. 직접 링크·새 문서 로드·뒤로/앞으로에서도 같은 tab과 조건을 복원한다.
- 별도 DOM 검토에서 찾은 skip link의 hash 충돌을 수정했다. 본문 이동은 현재 실행·tab·filter를
  바꾸지 않고 main에 focus를 옮긴다. 직접/reload 링크와 filter를 유지하는 뒤로/앞으로를 재검증했다.
- 성공 상태는 실제 backend와 같은 `completed` 값을 사용한다. 화면/run 전환 시 새 section으로
  focus를 옮기고 tab-only URL 변경에는 focus를 이동하지 않는다. DOM 회귀로 이를 구분했다.
- 목록 adapter의 activeRun/runId 결합·terminal 우선 dedupe와 서버 count 분리를 문서화했다.
- endpoint status와 fetch wrapper status를 분리하고 running 상태에서도 corruptLineCount 진단을 유지한다.
- filter 변경의 replaceState 직후에도 모든 목록 navigation 링크를 동기화하여 stale query 초기화를 막는다.
- HTML을 읽을 수 있게 포맷하고 임시 JSDOM 검증으로 desktop/mobile ID별 링크, 상태별 상세,
  미확인 ID, mobile menu의 이동/닫힘, 검색/필터/empty, 3단계 이동/입력 보존/요약 갱신,
  키보드 tab 이동, ID/ARIA 참조와 JavaScript error 부재를 확인했다.

JSDOM 검증은 DOM 동작 검사이며 실제 viewport·pixel·layout·browser 접근성 검사와 다르다.
이 검증 도구는 repo dependency에 추가하지 않았고 production 코드도 변경하지 않았다.

## 아직 통과하지 못한 확인

1440/1024/390px의 실제 HTML screenshot, browser interaction, overflow, axe, console 검증은
현재 환경 제한으로 실행되지 않았다. CSS가 반응형으로 작성됐다는 사실을 시각 검증 통과로
보고하지 않는다. Desktop/mobile의 최종 배치와 터치·키보드 동작은 구현 전후 browser에서
검증해야 한다.

확인한 실패:

1. Cloud browser의 local preview: `net::ERR_BLOCKED_BY_CLIENT`
2. Cloud browser의 local file 문서: 지원 protocol이 http/https로 제한되어 거절됨
3. 설치된 Chromium의 Playwright launch: `socket() failed: Operation not permitted`
4. 지원된 실행 권한 요청 후 재시도에서도 같은 Chromium socket 오류

위 접근 제한을 우회하지 않았다. 새 배포/외부 hosting 또는 계정 변경도 하지 않았다.
문서 draft PR 게시와 production UI의 완료·병합을 구별하며 browser 검증 조건을 생략하지 않는다.

## 재개 시 검증 동선

- 목록: 이름/상태 필터 → empty → 초기화 → 완료 예시 상세
- 생성: 위험 설정 → 데이터 단계 → 값 수정 → 확인 → 이전 → 값 보존
- 상세: 요약 → 판단 근거 → 방향키로 기록 tab → browser 뒤로
- 1440×1000, 1024×900, 390×844에서 heading, overflow, 표/모바일 목록, 2열/1열 form,
  chart/inspector, primary action, error text, focus를 검사
- 실제 구현에서는 예시 dataset 대신 격리 fixture API와 같은 동선을 수행하고 create가 한 번만
  발생했는지, 같은 batch/run ID로 조회하는지 검증

HTML 시안은 layout/prototype 예시이며 validation 또는 runner를 호출하지 않는다. 기능 명세의
정본은 product-plan/technical-design이고 구현 PR의 완료 증거는 해당 PR에 따로 기록한다.
