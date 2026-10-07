# Whole-batch clone UI 검증

기준 main: 4db02564c6bc3ade531446b2fae8906cfeba6835 (PR815 merge), tree 38b97858757f53998f3b498075cfdbb7cebe6321. 제품 변경 전 별도 scope commit을 만들었다.

## 구현

- detail의 요청 exact ID만 cloneFrom으로 전달한다. child/선택 window/data.batchId/latest를 원본으로 사용하지 않는다.
- GET BFF는 bounded 32KiB·UTF-8·strict canonical DTO·UUID·exact ID·SHA-256·typed whole-request roundtrip을 확인한다. legacy/masked/corrupt/missing/unsupported 원본은 입력 기본값으로 복원하지 않는다. GET/HEAD는 validation/create를 호출하지 않는다.
- 원래 requestedConfig의 seed/random 범위, 선택 runCount/executionCosts 생략, preset/provider/model/schema/maxCodexCalls를 유지한다. 현재 wizard 소유 필드만 편집하며 validation·권한·disabled provider guard는 서버에서 다시 적용한다.
- raw draft는 fresh source ID/hash에 묶고 receipt/token을 복원하지 않는다. 항상 새 검증과 명시적 create를 거쳐 다른 새 ID를 접수하며 원본을 덮지 않는다.
- source/validation 취소와 이미 보낸 create의 응답 관측을 분리한다. source 변경이 create 관측을 끊는 경합을 실제202·응답 gate로 결정적으로 재현했고 수정 후 latest source와 accepted exact ID를 함께 보존한다. unmount와 create deadline 중단·unknown no-retry barrier는 유지한다.

## Home PC 검증 (2026-10-06)

기존 Node24.19.0/npm11.17/Chrome154와 이미 설치된 의존성을 사용했다. 설치·다운로드·관리자권한·기존 서비스 종료 없이 새 작업 전용 loopback 서버와 합성 fixture만 사용했다. Codex provider는 테스트 동안 활성화하거나 호출하지 않았다.

| 검사 | 결과 |
| --- | --- |
| 프론트 unit 전체 | 222 pass / 0 fail / 0 skip |
| production wizard 전체 | 96 pass / 0 fail / retry0 |
| 이 중 clone 전용 | 8개 시나리오 ×1440/1024/390 = 24 pass |
| Next production build + TypeScript | 통과 |
| ESLint | error0 / warning0 |
| root build + quality:gate | 통과 |
| 변경 검증 도구 계약 | 23 pass |
| git diff --check | 통과 |

Clone 실제 API create는 typed 원본과 같은 POST body·POST1·202·다른 새ID·exact 상세URL·Back/reload barrier·명시적 별도 새 준비를 확인했다. 원본 batch 디렉터리의 모든 파일 bytes/size/mtime/ctime은 생성 전후 동일했다. 선택값 생략은 explicit0/default 값으로 바뀌지 않았다. Keyboard 진입·axe 위반0·horizontal overflow0, 비활성 상속 provider의400·create0, malformed/unavailable 사례, raw draft 재진입·token/receipt 미복원·unknown barrier 유지, stale source/validation/late202를 확인했다.

첫 실행의 신규 테스트 라벨 불일치와 다음 실행의 source/create 취소 경합 실패 로그·trace는 별도 보존했다. 최종96개는 최신 production build로 새로 실행한 결과이며 timeout/expect5000/retry0을 바꾸지 않았다.

Backend 제품 src는 PR815 tree와 동일하다. PR815의 독립 Linux full4530 pass/33 Windows skip은 기준선 증거이며 이번 clone head의 fresh full 실행으로 주장하지 않는다. Home clone의 변경 검사는 위 표의 결과다.

UX06 전체 비교/benchmark tab query 초기화와 원래 soft-navigation 간헐 정체의 원인은 이 범위 밖이다. source/create 취소 경합을 원래 간헐 정체의 원인으로 주장하지 않는다. ROADMAP_COMPLETE·최신 head Code/Security 통과·merge 완료를 선언하지 않는다.

## 노트북 인계 후 런타임 진단 (2026-10-07)

검증 제품 HEAD는 `e852fb8081f84bc50cdf99230201ac46b7d5ffee`, tree는
`8515deaf7a911f94ba0cca47331655df98bf6212`다. 별도 checkout에서 lockfile로 의존성을
설치했으며 기존 checkout, 제품 코드, 시험 assertion, timeout 및 보안 검사는 변경하지 않았다.

Node v22.15.0의 root build는 통과했지만 UI는 221 pass / 1 fail이었다.
`provenance-contract/writer-ui.test.mjs`의 첫 합성 ID에서 expected `partial`, actual
`blocked`였고 단독 실행과 host 사용자 실행에서도 재현됐다. 실제 reader의
`readExperimentFile`에서 같은 파일의 `lstat.dev=0`, `handle.stat().dev=3163395652`로
달라 `PATH_UNSAFE`가 발생했다. inode와 nlink=1은 일치했고 symlink도 아니었다.

PR815 main `4db02564c6bc3ade531446b2fae8906cfeba6835`를 별도 worktree에서 빌드해
같은 시험을 실행했다. Node v22.15.0에서는 동일하게 실패하고 v24.19.0에서는 1/1 통과했다.
PR816도 v24.19.0에서 1/1 통과했으며 같은 파일의 두 dev 값이 일치했다. 런타임을 맞추고
root를 다시 빌드한 PR816 UI 전체는 **222 pass / 0 fail / 0 skip**이다.

실제 합성 loopback HTTP 응답도 두 런타임 모두 HTTP 200이며 requestedRunId는 동일했다.
v22.15.0의 status는 `blocked`, v24.19.0은 `partial`로 direct reader와 일치했다.

| 노트북 Node v24.19.0 검사 | 결과 |
| --- | --- |
| root TypeScript build | 통과 |
| UI unit 전체 | 222 pass / 0 fail / 0 skip |
| provenance reader 전체 파일 | 44 pass / 0 fail / 0 skip |
| Next production build 및 별도 `tsc --noEmit` | 통과 |
| ESLint `--max-warnings=0` | 통과 |
| 문서 보완 review profile, base `e852fb8` | build·quality·tooling 23 pass, 문서 변경이라 영향 시험 0 |
| diff 검사 | 통과 |

Next build 최초 실행은 sandbox의 Google Fonts 다운로드 실패였으며 공개 폰트의 네트워크
접근을 허용한 같은 코드의 후속 build가 통과했다. 위 review profile은 문서 보완만의 검사다.
노트북 browser/E2E/a11y 및 root full/check:merge는 이번 진단에서 실행하지 않았다.

공식 Node v24.19.0 Windows x64 바이너리를 작업 폴더에만 두고 공식 SHASUMS256과
SHA-256 `3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237` 일치를
확인했다. 시스템 Node나 dependency lock을 변경하지 않았다. 재현·진단 절차는
[단계별 검증 안내](../../runbooks/test-verification.md#windows-파일-동일성-검사와-검증-런타임)를 따른다.

이 결과는 Home 게시 세션에서 발생한 `replayProvenanceReader.test.ts`의
`actual writer running, completed, completed-with-failures and failed contracts remain readable with synthetic providers`
최초 실패 원인을 입증하지 않는다. 그 전체 실행은 중단됐고 실패 assertion 상세와 전체
집계는 미확보 상태다. Library 독립 ZIP은 노트북 materialization의 Windows 오류로 원문을
확보하지 못했다. 부모가 확인한 Linux 독립 결과·기존 Home browser 결과와 노트북 신규
실행을 구분하며 fresh full·독립 리뷰 완료·Ready·merge를 주장하지 않는다.
