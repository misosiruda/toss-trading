# C2-A startup 후보 판정 — 범위

선행 설계: [C2 launcher/load 계약](child-runtime-launcher-contract.md), PR826 head
`1313f21f297de640e7c12fb1cae62c5f525fce25`. PR826은 시작 시점에 미병합이므로 별도 branch/worktree에서
의존 구현한다. PR826 검증 bytes를 변경하지 않으며 이 PR의 main 병합은 선행 설계와 보호 gate 이후다.

## 목적과 포함 범위

첫 합성 지원 후보를 설명하는 strict plain-data descriptor를 순수하게 판정한다. caller가 제공한
설명이 후보 조건에 맞는지를 반환하며 실제 startup을 관측하거나 runtime 증거를 발행하지 않는다.

- [동결 계약](child-runtime-startup-candidate-contract.md)의 versioned descriptor/결과
- field presence, unknown key, 각 scalar 형식과 고정 unavailable reason/우선순위
- proxy/accessor/custom prototype/serialization hook를 실행하지 않는 검사
- input mutation/원문 echo/부작용 없이 detached immutable 결과 반환
- 실제 positive/negative 및 parser 공격 입력, 지원 밖 환경/조건 회귀

## 비범위

process/env/argv/filesystem/network 수집, launcher/loader 실행, 권한·설정 변경, actual startup 인증,
private handle/receipt/file/API/UI 발행, C1 schema 변경, complete flag 승격, 실거래·외부 AI 실행.
C2-B actual load 실험과 source/build/Node artifact/child 결속은 여전히 후속이다.

## 완료 기준

1. 유효한 후보와 명시적 unsupported/unknown을 구분하며 missing을 default로 채우지 않는다.
2. 모든 결과가 unverified descriptor임을 표시하고 runtime/dependencies/result/comparability
   unavailable, completeRuntime/Configuration/Input=false를 유지한다.
3. unknown/숨김/symbol key, proxy/revoked proxy/accessor/custom prototype/coercion/toJSON 입력에서
   hook 실행0·input mutation0·원문 echo0을 확인한다. field 수/문자열 길이 경계를 시험한다.
4. 같은 복제 가능한 descriptor가 같은 값의 결과를 내되 실행 권한/소유권으로 쓰이는 production
   consumer는 추가하지 않는다. C1의 실제 발행 소유권과 혼동하지 않는다.
5. 독립 설계·구현 검토, diff/link 검사, review profile 및 exact 후보 Linux full을 통과한다.
   최초 Ready 자동 검수와 현재 보호 조건, branch 보존·수동 중복 review/Actions 금지를 따른다.
6. 선행 PR826이 미병합이면 그 의존을 PR에 명시하며 main 병합 가능/전체 C2 완료로 표시하지 않는다.

rollback은 새 pure 판정기·시험·문서만 되돌린다. 기존 저장 artifact·런타임·API·replay 동작은 바뀌지 않는다.
