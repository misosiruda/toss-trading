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
