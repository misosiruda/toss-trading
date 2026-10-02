# 기능별 PR 작업 계획

기준: 2026-10-02 / `main d954915` · 구현 전 범위 고정

문서→실행 계약→UI 연결을 작은 PR로 진행한다. 각 단계는 목적·비범위·완료 조건을
확정한 뒤 구현하며 범위가 커지면 새 기능 PR로 분리한다. 기존 #788은 계속 보류한다.

이번 작업의 최신 사용자 지시(2026-10-02)는 branch 보존과 자동 review 사용, 수동 Codex review/Actions
중복 실행 금지다. 이 절차상 차이는 기존 maintenance runbook의 branch cleanup·수동 review 요청보다
이번 작업에 우선한다. 안전·검증·보호 조건은 완화하지 않는다.

## 공통 게시·병합 조건

- Korean Conventional Commit, 책임 단위 commit. branch는 삭제하지 않는다.
- 최초 PR 개설 전에 자체 diff/안전/문서 검토와 해당 로컬 검증을 완료한다.
- `git diff --check`, `npm run check:review` (반복/게시 후보), 최종 후보 `npm run check:merge`.
- UI 변경은 dashboard lint/unit/build/E2E/axe와 시각 검증을 추가한다. 전체 검증이 포함하는 focused suite 중복 실행은 하지 않는다.
- draft PR로 열고 자동 코드·보안 review를 기다린다. 수동 Codex review 요청이나 Actions 중복 재실행은 하지 않는다.
- finding 수정 시 관련 검증→새 head 검수. 이전 head 통과를 최신 head 통과로 재사용하지 않는다.
- 병합 전에 author=misosiruda, current head, unresolved finding 없음, 필수 CI와 GitHub 보호 조건을 확인한다.
- 보호 조건 우회/완화, 다른 사용자 PR 병합, live mutation/유료 실행은 하지 않는다.
- current head가 바뀌면 테스트 대상·diff·자동 review를 다시 확인한다. parent와 병합 순서를 조율한다.

## UX-00 — 설계·이전표·시안

목표: 메뉴/핵심 3화면/실제 capability/작은 PR 순서를 검토 가능한 정본으로 만든다.

포함: product-plan, technical-design, 이 계획, 공식 참고 조사, desktop/mobile responsive wireframes.
비범위: production 코드, API, 실행, 배포.
완료: 3화면을 1440/1024/390px로 검토하고 링크·현재 계약·기능 이전표 확인. 시안 수치는 예시로 명시.
검증: 문서 link check, `git diff --check`, review profile, 시안 screenshot/overflow/접근성 기본 검사.

## UX-01 — navigation과 정직한 실행 목록

목표: `/dashboard` 진입을 실행 중심으로 전환하며 모든 기존 기능의 접근을 보존한다.

포함: shared shell, 4개 주메뉴와 하단 설정, 기존 운영 요약 보존 route, server-side batch read,
확인된 batch 또는 문맥 미확인 저장 기록으로 구분한 목록, client 필터·empty/error 상태·mobile list, old deep link smoke.
범위: 최신 manifest와 기록의 batch 결속이 확인되면 최신 batch로 표기한다. aggregate fallback 등
문맥 미확인은 조회된 source 기록으로 제한하고 최신 batch/전체 실험으로 추정하지 않는다.
cross-batch index는 별도 필요성 판단.
비범위: 새 runner/config, 새 실험 실제 생성, 실행 상세 전면 개편, 비교 engine.
완료: mock·실데이터 연결 실패 모두 첫 화면에 의미 있는 상태. 목록→기존 정확한 ID 상세.
‘새 실험’은 현재 작동하는 설정 진입점에 연결하고 제한을 설명하며, UX-03 후 canonical wizard로 교체한다.
검증: activeRun+terminal runId dedupe, wrapper/endpoint 상태 분리와 running+corrupt 진단,
ViewModel guard/unit, persisted/active/read 상태의 provenance, aggregate fallback/known batch 불일치,
legacy route 보존, navigation/필터/back-forward, desktop/mobile E2E/axe.

## UX-02a — 요청과 실제 실행 조건 일치

목표: UI가 선택한 조건을 runner가 실제 적용한다는 검증 가능한 계약.

포함: existing simulation source→runner 입력 대응 audit, 비용/benchmark/universe의 미지원 선택
서버 거부, 허용된 default의 정확한 effective 의미, validation-only 경계, 상태 조회 identity.
새 비용/benchmark/universe 기능 확대는 별도 UX-02c로 분리한다.
비범위: PortfolioPolicy 실행 adapter, bucket runner 통합, 새 allocator, EXP CLI adapter, 유료 AI.
완료: 허용한 모든 입력의 effective mapping이 테스트됨. ignored option 없음. validation은 runner를 시작하지 않음.
검증: runner spy/fixture integration, negative schema, 기존 guard tests, full Node gate.

### UX-02b — 접수 후 실패 관측

목표: runner가 manifest 생성 전에 실패해도 동일 simulation ID의 실패를 관측한다.
포함: 현재 저장 계약에 맞는 최소 accepted/failed provenance와 read adapter.
비범위: 자동 retry/recovery, runner 재작성.
완료: before-manifest failure와 응답 불확실 상황이 영구적인 가짜 running으로 남지 않음.
검증: 생성 전/후 실패, corrupt/missing artifact, 같은 ID 조회, 민감 정보 masking, 기존 상태 호환.

### UX-02c — 선택형 실행 조건 확대 (후속)

비용·benchmark·universe의 실제 적용은 각각 기존 workflow 인자와 결과 provenance를 확인한
별도 작은 기능 PR이다. 첫 wizard는 UX-02a가 허용한 기본값만 사용한다. 새 선택은 해당 인자의
전달·결과·비교 provenance와 negative test를 모두 통과한 후 노출한다.

## UX-03 — 3단계 새 실험과 실제 runner 연결

선행: UX-01, UX-02a, UX-02b.
목표: 지원되는 built-in paper 조건으로 새 실행을 시작하고 같은 ID 상세를 연다.

포함: 단계 입력/요약/검증, 정확한 요청값, fixture decision provider, 기존 same-origin guarded BFF,
중복 제출 방지, 409/권한/오류/응답 불확실 상태, accepted 상세 이동.
비범위: 미지원 PortfolioPolicy/단일 bucket 실행, cancel/resume, POST 자동 retry, provider credentials.
완료: 입력→validation-only→1회 create→실제 runner→같은 ID summary가 격리 fixture에서 확인됨.
검증: 최소 정상 flow + 오류수정 + back/forward + double click + reload/응답불확실 + axe + 3 viewport.

## UX-04 — 실행 상세 요약·진행·기록

선행: UX-01, UX-03 (읽기 전용 구현은 UX-02와 독립적으로 준비 가능).
목표: 한 실행에서 상태·산출물·한계를 이해한다.

포함: 공통 header, 상태와 관측 분리, summary/record, 저장된 metric과 source, 실제 시계열 있을 때만 chart.
미지원 replay/evidence tab은 이유를 설명하고 동작하는 기존 자료 경로만 제공한다.
전체 storage Risk/audit는 ‘전체 운영 기록’으로 표시하며 선택 run의 근거처럼 표시하지 않는다.
비범위: 시계열 발명/수익 추정, full live chart, provider 실행, 무근거 completion.
완료: running/completed_with_failures/terminal/stale/partial/offline/invalid/missing 및 batch ID→selected run을 정확히 렌더링.
검증: parser와 state unit, polling cleanup/terminal stop, desktop/mobile screenshot, read-only assertions.

## UX-05 — 리플레이와 판단 근거 연결

선행: UX-04.
목표: 결과→사건→deterministic Risk/모의 체결 근거를 두 번 이내 선택으로 찾는다.

포함: 기존 event/decision/risk/execution artifact의 검증된 참조를 연결하는 최소 read-model,
시점 선택, 이전/다음 사건, inspector, provenance와 missing reference 설명.
비범위: AI 판단 재생성, real-time trading, 원본 artifact 수정.
완료: record별 명시적 참조와 source run identity가 일치하는 사건만 연결. 불일치/없음은 표시하고 임의 결합하지 않음. keyboard/touch 모두 가능.
검증: missing/duplicate/out-of-order reference fixtures, selection history, responsive/axe/console.

## UX-06 — 조건 차이 중심 비교와 조건 복제

선행: UX-02, UX-04, UX-05의 source contract.
목표: 기준+후보의 차이를 해석하고 새로운 실행으로 안전하게 이어간다.

포함: baseline 1/candidate 1–3, complete input 비교와 불가 이유, 공통 관측 범위의 metric,
조건 복제는 UX-03의 새 검증으로 이동하며 새로운 ID를 만듦.
비범위: 서로 다른 evidence class의 자동 순위, 최적화/투자 추천, old run 덮어쓰기.
완료: source·기간·cost·benchmark·scope·version unknown이 동일 값으로 취급되지 않음. 새 ID 확인.
검증: 비교 가능한/불가/불완전 fixture, selection+URL 복원, duplicate/self compare, no overwrite.

## UX-07 — 데이터·설정·호환 경로 정리

선행: UX-01~06에서 관련 계약 안정화.
목표: 남은 source/validation/provider/global audit/legacy 기능을 새 메뉴에서 찾는다.

포함: role-based index, Next에서 이전된 기능의 mapping 갱신, 검증된 legacy compatibility 안내,
기존 페이지 중복 navigation/안전 카드 축약.
비범위: 기존 자료 삭제, 계정 설정, 새 데이터 수집, legacy 제거.
완료: 기술설계 이전표의 모든 행이 route 검증됨. 저장된 기능에 접근 불가가 생기지 않음.
검증: migration checklist, all-route smoke, invalid/missing origin, narrow screen/a11y.

## 진행 증거

| 단계 | 상태 | 증거 |
| --- | --- | --- |
| UX-00 | 문서 작성·정적 검토 완료, browser 검증 대기 | [검증 기록](verification.md) |
| UX-01 | 미구현 | 목록 activeRun/source 상태 계약 포함 |
| UX-02a | 구현·병합 | [PR #797](https://github.com/misosiruda/toss-trading/pull/797), main `492afe9`; 전체 4,381 tests 중 4,348 pass/33 skip/0 fail |
| UX-02b | 구현·병합 | [PR #798](https://github.com/misosiruda/toss-trading/pull/798), main `9235ab7`; 전체 4,462 tests 중 4,429 pass/33 skip/0 fail |
| UX-02c, UX-03~07 | 미구현 | PR별 완료 조건을 통과한 뒤 갱신 |

설계 시안을 구현 완료로, accepted를 실행 완료로, review 대기를 승인으로 표시하지 않는다.
