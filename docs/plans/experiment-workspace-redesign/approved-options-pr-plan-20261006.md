# 승인된 네 방향의 기능별 PR 실행 계획

기준: 2026-10-06 / main66f7b3ca. [승인 계약](approved-options-contract-20261006.md)이 사용자 결정 정본이다. PR810은 legacy 폭 회귀·정식 E2E 격리·패널/readiness 검증만 소유한다. 이 문서는 별도 문서 PR이며 아래 기능을 구현 완료로 표시하지 않는다.

## 순서와 책임

| 순서 | 작은 PR | 포함 | 비범위 | 완료 조건 |
| --- | --- | --- | --- | --- |
| 1 | 비용 직접 입력의 실행 계약 | executionCosts schema/기존 validator/resolver→create runner→provenance·계약 테스트 | UI, 숫자 preset, 새로운 비용 model, live/provider 활성화 | 기존 요청 호환·명시3필드·오류 거절·validation side effects0·runner spy 및 합성 체결 비용 동일 |
| 2 | wizard 비용 입력 | 기존 3단계 wizard의 직접 bps 입력·요약·재검증 lifecycle | benchmark 계산 변경, 새 runner, 유료 AI | 입력 변경 시 검증 만료·정확 payload·create1회·같은 accepted ID·3viewport/a11y |
| 3 | benchmark 표시 선택과 coverage 설명 | 기존 3종 관측값의 UI 표시 선택·unavailable, source coverage/unknown 및 무필터 안내 | cash-only 실행·membership filtering·새 데이터 수집 | 계산/runner/보고서 입력 불변·3종 복원·missing 표시·coverage 근거 구분·keyboard/history |
| 4 | 원래 생성 요청 정본 저장·읽기 | acceptance와 결속된 versioned canonical request·exact batch ID bounded read·완전성/민감 masking | clone create/UI, 과거 artifact 보정 | 저장 실패시202/runner0·동일 batch binding·변조/부족/민감/limit unavailable·기존 산출물 불변 |
| 5 | 실험 전체 조건 복제 | 정본을 기존 wizard로 로드→현재 validation→기존 create1회→새 ID | child 실효조건 복제, 자동 retry, old run overwrite | 원래 요청 복사·재검증·새 ID·실패/버전/redacted/missing unavailable·3viewport/history/a11y |

비용 계약부터 구현한다. 정본 저장 PR은 복제 UI보다 먼저 완료하며 이력 없는 과거 기록에 기본값을 덧붙이지 않는다. 각 PR의 scope 문서/책임 commit/현재 head 검증/한국어 Draft를 먼저 준비하고 독립 검토 후 최초 Ready 자동 코드·보안 review 정책을 따른다. 기존 보호·필수 CI를 우회하거나 수동 review/Actions를 중복 요청하지 않는다.

## 검증 경계

- backend 계약 변경은 관련 strict schema/negative/runner spy/실제 합성 replay와 root build/quality/tooling 및 최종 독립 Linux full을 확인한다. Windows의 기존 실패와 신규 실패를 구분한다.
- frontend는 unit/lint/type/build 및 실제 fixture production·3viewport·keyboard/axe/console·저장 상태/URL/Back/reload를 영향 범위에 맞춰 확인한다. timeout/assertion 완화로 통과시키지 않는다.
- 기존 3-origin role index와 전용 loopback legacy suite의 환경을 섞지 않는다. 정식 E2E 진입점으로 재현 가능하게 유지한다.
- 새 숫자 preset·실제 거래 비용 정책·membership 명단은 승인되지 않았다. 추천 문구를 추가 사용자 질문으로 반복하지 않고 승인된 방향을 구현한다.

## 남은 기존 범위

UX06 baseline1/candidate1–3, 완전 input/runtime/version 비교 가능성은 현재 exact-pair MVP와 별도의 미완료 범위다. 이번 clone은 원래 batch 생성 요청과 새 실험 생성만 소유한다. 모든 legacy payload의 Next 재구현이나 원래 soft-navigation 원인 규명 완료를 선언하지 않는다. 전체 ROADMAP_COMPLETE는 아직 아니다.

## PR817 이후 선행 계약

2026-10-07 PR816 whole-batch clone과 PR817 상세 탐색의 benchmark 표시 선택 보존이 병합됐다.
후속 입력·runtime/version은 [별도 계약](input-runtime-provenance-contract.md)에서 현재 저장 근거와
부족한 근거를 구분한다. 계약 문서 자체는 새 producer/reader 구현 또는 complete provenance의
완료가 아니다. 접수 당시 실효 입력 보존 → 실제 child 소비 입력·runtime 결속 → bounded historical
read → baseline1/candidate1–3 UI 순서로 진행한다. child의 실제 초기 현금·보유 portfolio도 소비 입력과
fingerprint/완전성 판정의 필수 근거다. 원래 요청과 child 실효 window·초기 상태를 혼동하지 않으며
runtime UUID나 현재 조회 DTO version을 실행 구현 version으로 사용하지 않는다.
