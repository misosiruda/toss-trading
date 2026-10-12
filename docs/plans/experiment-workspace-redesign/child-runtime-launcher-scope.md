# Child runtime C2 — launcher/load 계약 범위

기준 main `26813e50f6c887f56aa4157e91f21d82658543cb`, tree
`f06923fc0d381b214e6f7c542127ed58af46ec0c` ([PR825](https://github.com/misosiruda/toss-trading/pull/825)).
이 PR은 C2의 설계 정본이다. 새 launcher, runtime receipt 또는 완전성 판정을 구현하지 않는다.

## 목적

[C1 범위](child-process-observation-scope.md#c2에-남는-것)와
[입력·runtime 정본](input-runtime-provenance-contract.md#runtime과-입력-fingerprint의-의미)에 남은
실제 실행 구현·의존성·Node artifact의 소비 증거를, 검증 가능한 작은 구현 단위로 나눈다.
process label·현재 디스크 hash·설치 성공을 실행 증거로 승격하지 않는다.

## 포함

- 현재 HTTP의 논리적 child와 새 OS process 실행을 구분하는 경계
- load 이전 trust root와 실행 중 감시의 위협모형, 지원 후보 및 비지원 경로
- source/build, lock/설치/actual load, Node artifact/영향 설정의 개별 증명 의무
- 부분 증거와 실패의 의미, exact child 결속 및 durable 순서
- positive/negative 검증표와 C2-A부터의 책임별 PR 순서
- PR825 병합을 현재 checkpoint에 반영하고 C1의 부분 관측 한계를 보존

## 비범위

production launcher나 loader 선택·설치, `ops:api` 명령 변경, 기존 A/B/C1 artifact 수정,
`completeRuntime`/`completeConfiguration`/`completeInput` 승격, 결과 producer, 공개 reader와 UI.
운영 환경·credential·OS 보안·repository 보호 변경, 서명/외부 공증, live order, 유료 AI,
새 데이터 수집, AI 결정 재현성 또는 성과 비교 보장도 포함하지 않는다.

## 완료 기준

1. [C2 계약](child-runtime-launcher-contract.md)이 실제 현재 source와 상위 정본에 모순되지 않는다.
2. 지원 후보와 증명된 지원을 구분하고, 모든 completeness 의무에 positive와 negative가 있다.
3. 환경·입력 원문/민감 hash를 새 artifact·오류·DTO로 내보내는 우회가 없다.
4. 선행 계약 없는 production 코드 변경이 없고, 다음 C2-A는 독립적으로 검증 가능한 범위다.
5. 독립 설계 검토, 상대 링크 검사, `git diff --check`, local review와 최종 Linux full을 통과한다.
6. exact 게시 head의 최초 Ready 자동 Code/Security 검수와 실제 GitHub 보호 조건을 확인한다.
   [작업 계획](pr-work-plan.md)의 branch 보존·수동 review/Actions 중복 요청 금지를 따른다.

문서 검증을 C2 runtime 검증으로 표시하지 않는다. rollback은 문서만 되돌리며 기존 저장 자료,
명령, API, replay 및 clone의 동작은 바뀌지 않는다.
