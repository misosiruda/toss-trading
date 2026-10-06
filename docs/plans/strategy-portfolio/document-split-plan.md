# 포트폴리오 운용 문서 분리 PR 설계

## 목적과 기준

한 파일에 누적된 목표·안전 계약·현재 구현·과거 기록을 책임별 정본으로 분리하여,
독자가 현재 연결된 범위와 아직 필요한 원자 transaction을 혼동하지 않게 한다.
하나의 문서 전용 기능 PR이며 커밋 개수로 PR을 나누거나 게시 시점을 정하지 않는다.

- 원문 및 코드 기준: 원격 `main`의 `8eede864a26143ac91a912671d7f98bd222632e0`
- 기준 확인일: 2026-10-02 KST
- 원문: `docs/plans/strategy-portfolio-operating-model-plan.md` 6,918행
- 이전 문서 폴더 정리: [GitHub PR #789](https://github.com/misosiruda/toss-trading/pull/789), 병합됨
- 작업 branch: `docs/split-portfolio-operating-plan`
- 작업 디렉터리: 새로 clone한 독립 checkout. 이전 문서·runtime checkout은 변경하지 않는다.

## 포함 범위

1. 기존 파일을 제품 목표·운용 순서·독서 경로와 이전 heading 안내를 가진 안정적인 진입점으로 유지
2. policy/lifecycle, mandate/state, selection/sizing/reservation, rebalance/Risk/fill 계약의 정본 분리
3. 실제 main 구현과 남은 통합 작업을 source 근거로 요약하고 미병합 PR788 및 제안을 구분
4. 과거 기준선·단계별 변경 이력과 현재 규칙의 관계를 명시하고 원문 구간별 새 위치를 기록
5. 기존 내부 `PR 1`~`PR 8`, 검증·호환성·최종 수용 기준을 보존
6. 최종 수용 기준 12개에 원문 순서대로 `SPOM-AC-01`~`SPOM-AC-12`만 부여하고 모두 미완료 유지
7. 기존 inbound/outbound 링크·heading anchor와 문서 index 갱신
8. 이전 #789 계획의 병합 상태를 추가하되 당시 검증 결과와 미실행 기록은 시점별 증거로 보존

## 제외 범위

- production code, 테스트/실행 fixture, schema, dependency, 설정, GitHub 보호·review 정책 변경
- PR788 source 수정·포함·병합 및 publisher session 구현 완료 주장
- Trainer MVP의 전략·시장·UX·Jev 선택 확정
- simulation, Codex CLI, 외부 AI/데이터 호출, 실제 거래, credential·계정·유료 서비스
- 기존 안전 계약 완화 또는 최종 운용 수용 기준의 완료 판정

## 책임별 작업 순서

1. 이 설계와 수용 기준을 먼저 기록하고 커밋
2. 원문을 책임별 정본으로 이동하고 구간·anchor·최종 수용 기준 대응을 검증한 뒤 커밋
3. 현재 main 근거·남은 작업·과거 상태와 독서 경로를 보완한 뒤 커밋
4. 독립 검토에서 발견한 범위 내 문서 문제를 수정·검증하고 해당 책임으로 커밋

책임 경계가 바뀌기 전에 검토 가능한 변경을 커밋한다. 최소/목표 커밋 수는 없다.

## 수용 기준

- [x] `SPOM-DOC-01`: 목표, 계약, 현재 상태, 이력, 검증에 각각 하나의 정본이 있음
- [x] `SPOM-DOC-02`: 원문 전체의 비어 있지 않은 행과 코드 블록이 구간 대응으로 보존됨
- [x] `SPOM-DOC-03`: 과거 부재 설명과 main 구현·미병합 PR·제안이 명시적으로 구분됨
- [x] `SPOM-DOC-04`: 내부 PR 단계명 및 최종 12개 기준의 문장·순서·미완료 상태가 보존됨
- [x] `SPOM-DOC-05`: 기존 진입점의 모든 heading anchor와 local file/anchor 참조가 유효함
- [x] `SPOM-DOC-06`: 식별자·숫자·실패/복구/권한 한계 및 rollback 계약이 변경되지 않음
- [x] `SPOM-DOC-07`: docs Markdown 외 변경이 없고 기존 runtime/fixture/보호 정책은 동일함
- [x] `SPOM-DOC-08`: 해당 repo 검증과 독립 정적 검토 결과 및 남은 절차를 사실대로 기록함

## 검증 방법

- 기준 commit의 원문을 `git show`로 읽어 구간별 단일 대상과 본문을 대조
- 최종 AC 12개는 원문 문장과 순서를 기계적으로 대조하고 ID 외 변경·완료 표시가 없는지 확인
- 기존 heading의 GitHub anchor를 계산하여 진입점에서 누락·중복·잘못된 대상 검사
- 전체 tracked Markdown의 상대 파일과 anchor 검사, 소비자 6개와 새 index 독서 경로 확인
- `git diff --check` 및 `npm run check:review`: 문서 변경에도 build/quality/tooling 유지
- 독립 검토: 안전 계약 보존, 역사/현행 분리, 미구현 항목·권한 오인과 링크/매핑 검사
- 최종 병합은 current-head review, 필수 GitHub check와 전체 `npm run check` 조건을 유지
- 이전 PR의 review 예외를 이 PR에 자동 적용하지 않는다. 절차가 막히면 승인 정책을 변경하지 않고 보고한다.

## 구현·검증 기록 (2026-10-02 KST)

- 기준 `main`: `8eede864a26143ac91a912671d7f98bd222632e0`; 새 독립 checkout에서 작업
- 원문 6,918행 전체: 40개 연속 구간의 SHA-256·내용 및 단일 위치 대응 통과
- 상대 링크 재기준화와 최종 AC ID 외 원문 내용 변경 없음; code fence/문단 분할 없음
- 이전 heading anchor 61개 유지. 진입점의 세부 heading 안내는 새 정본의 해당 heading에 직접 연결
- 최종 `SPOM-AC-01`~`SPOM-AC-12`: 문장·순서·12개 미완료 상태 동일
- 전체 repo Markdown 89개, 상대 링크/anchor 862개 검사 통과; 외부 URL 21개는 로컬 검사 범위 밖
- 변경 18개 경로 모두 `docs/` Markdown. Production, test/fixture, 설정·의존성 및 승인/검증 정책 diff 없음
- `git diff --check`: 통과
- `npm run check:review`: 통과 (Node v24.19.0, Linux)
  - build/quality gate 통과, tooling tests 23 통과
  - 변경 영향 분석: `changed=18 mode=none tests=0`, documentation-only
  - 애플리케이션 전체 suite 통과로 해석하지 않음
- 의존성 준비: 첫 `npm ci`는 기본 cache 경로 부재로 실패. 전용 cache 재시도는 실행 도구 취소로 완료 미확인
  - 동일 lockfile SHA-256 및 설치된 95개 package version을 대조한 기존 의존성을 새 checkout으로 복사해 검증
  - 기존 checkout에는 쓰지 않았고 lockfile/의존성 변경은 없음
- 독립 정적 검토: 원문 보존·원본 source·안전 경계·링크에서 차단 finding 없음
  - 깊은 heading이 넓은 구간 시작으로 가던 가독성 finding은 정확한 heading anchor 안내로 보완
  - 분리 전 파일의 앞/뒤를 가리키던 프로젝트 개요 문구를 이력·현재 상태 정본 링크로 교체
  - 별도 재검토에서 1,123개 비문서 파일의 bytes 불변과 main source 근거를 확인

별도 UI E2E, simulation, Codex CLI, 외부 AI/데이터 호출, 실제 거래는 실행하지 않았다.
이 기록 시점에는 최종 병합용 전체 `npm run check`와 원격 current-head Codex review/필수 check의
완료 증거가 없다. 이후 검증·게시 상태는 해당 원격 PR에 별도로 기록한다.
이전 GitHub PR #789의 review 예외를 적용하거나 repository 보호·승인 정책을 변경하지 않는다.
Draft PR 게시와 병합 준비 상태는 별도 원격 확인 결과로 판단하며, 문서 수용 완료를 merge 승인으로 쓰지 않는다.
