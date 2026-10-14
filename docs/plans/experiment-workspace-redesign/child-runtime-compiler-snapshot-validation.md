# C2-C2 — compiler snapshot 검증 기록

[범위와 계약](child-runtime-compiler-snapshot-scope.md)에 따른 부분 관측이다.
컴파일러 자체의 load, emitted output의 실행, Node memory/native/전체 설정 결속은 증명하지 않는다.
runtime/dependencies/result/comparability는 unavailable이고 세 complete flag는 false다.

## 환경과 소스

- 기준 main: `2b8cb7abdc012c6b1fca35fd60689bffe1b7289f` (PR829).
- 사전 scope commit: `868fd6cf`.
- 구현·시험 commit: `1386e0653468b07415bb912ba0918f353a7e35a1`, 신규 source6개.
- 실제 Node v24.19.0/Linux x64, TypeScript 5.9.3, 기존 UID1000의 격리 Linux volume.
- 원본 Node/compiler, dependency/lockfile, build runner와 기존 A/B/C1/C2-A/C2-B/C2-C1 소스는 변경하지 않았다.
- 기존 집컴 checkout/worktree34개(변경이 있던4개 포함)는 이전 HEAD/status 그대로임을 확인했다.
- 새 worktree·서비스를 만들지 않았으며 소유 Linux checkout은 시작 시 clean main이고 실행 중인 작업이 없었다.
  CMS 등 다른 프로세스의 종료·포커스 전환·계정/권한 변경은 수행하지 않았다.

## 실제 확인

고정 entry.ts/value.ts/lib.d.ts를 실제 compiler에 공급했다. type 검사와 emit이 성공했고
entry.js/value.js의 정확한 ESM text를 별도 assertion으로 확인했다.
snapshot A 공급은 disk를 B로 교체했다 A로 돌려도 baseline과 동일한 산출물을 만든다.
반면 그 사이 disk B를 다시 읽는 경로는 before/after input이 A로 같아도 consumed input과 output이 다르다.
이 차이는 실제 CompilerHost·SourceFile·emit에서 관측했다. compiled output은 실행하지 않았다.

TypeScript5.9.3은 noLib에도 default lib **이름**을 조회한다. prototype1에서 이를 내용 읽기와
동일시한 예외를 보존했고, 고정 이름 조회만 허용했다. prototype2는 프로세스 exit0이어도 기본 global
선언2개가 없어 diagnostics2/emitSkipped였다. 이를 compile 통과로 계산하지 않았다.
필요한 CallableFunction/NewableFunction 선언을 추가한 prototype3은 diagnostics0/output2였다.

emit의 sourceFiles는 변환 객체다. 실측에서 wrapper 자체는 host 객체와 달랐지만 getOriginalNode가
정확히 host가 공급한 원본으로 돌아왔다. 현재 구현은 원본 객체 identity와 양쪽 이름/text를 함께
확인한다. 이름과 text만 복제한 객체, 변경된 SourceFile·options, unknown read/resolve/write,
중복/누락/초과 output을 거절한다. stale/extra output은 명시적인 observer fault 시험이다.

reader에서는 실제 UTF-8 경계16,384/16,385 bytes, symlink/hardlink, invalid UTF-8,
같은 내용의 새 inode 교체와 열린 뒤 경로 부재를 확인했다. lifecycle unit fault는 root 확인 실패,
정리 실패·후속 allocation 차단·queued caller 직렬화와 첫 실패 유지 및 raw 오류 비노출을 검증한다.

## 실행과 실패 보존

| gate | UTC (2026-10-14) | 결과 |
| --- | --- | --- |
| 01 check:review | 01:24:22–01:24:37 | build exit2, string/undefined narrowing 오류 |
| 02 check:review | 01:25:51–01:26:08 | build/quality/tooling 통과; 영향36개 중27 pass/9 fail/0 skip, exit1 |
| 03 check:review | 01:28:11–01:28:25 | build exit2, getOriginalNode의 Node→SourceFile narrowing 오류 |
| 04 check:review | 01:29:35–01:29:51 | build/quality/tooling 및 영향3개 파일36 tests 모두 pass, fail0/skip0/cancelled0, exit0 |

02의 실패는 emit wrapper를 원본 객체 자체라고 가정한 검사였다. actual original-node 연결을
검사하도록 구현을 바로잡고, 동일 이름/text의 별도 객체는 계속 거절하는 시험을 보강했다.
01/03은 고정 reject 분기의 return과 실제 SourceFile type guard로 수정했다.
실패를 통과로 바꾸거나 assertion/timeout/기존 skip을 완화하지 않았다.
각 실패 소스 tar, 명령·시각·exit·stdout/stderr·전후 전체 source hash를 별도 보존했다.

04는16.09초이며 전후 source snapshot은
`cb998b4bd79aa5dbab980af2a1b5114e1b458bceb7ff2346dab0feb43c930196`로 동일했다.
이 snapshot에는 당시 미커밋 source6개와 scope 보강이 포함된다. 위 구현 commit의 source6개는
실제 통과한 파일과 byte-for-byte 동일하다. 그 뒤 검증 기록과 상위 로드맵 문서만 갱신한다.

## 게시·최종 확인

현재 게시 HEAD의 독립 Code/Security 검토와 최종 check:merge 전체 검증, 실제 GitHub 병합 및
source/evidence 복원 결과는 PR 본문·별도 증거에 기록한다. 이 문서의36개 영향 시험 통과를
전체 suite 또는 완전한 C2-C 성공으로 바꾸어 표현하지 않는다.
최초 Ready 자동 검수를 사용하며 수동 Codex/Actions 중복 요청·보호조건 변경·우회는 하지 않는다.
