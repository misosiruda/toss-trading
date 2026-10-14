# C2-C3 — compiler artifact load 검증 기록

[범위](child-runtime-compiler-load-scope.md)의 부분 실험 기록이다. 전체 C2-C 지원 인증이 아니다.
기준 main `ab1b446c0c2c7dbce0f03c8a350356c1398d0d20`, 실제 source commit
`5c7b1ef0e54a187232197eedbcff4675ee4dd48b`에서 신규6개 source/시험 파일을 확인했다.

## 환경과 성공 관측

집컴의 기존 격리 Linux x64 volume, Node v24.19.0, TypeScript5.9.3을 사용했다.
dependency/lockfile/runner 설정은 변경하지 않았다. 정확한 compiler A/B 크기·hash는 scope에 고정했다.
bootstrap과 Node built-in/native 구현은 선언된 trust root다.

- A snapshot을 실제 CommonJS source로 공급한 뒤 exports의 transpileModule을 실행했다.
- compiler load1, builtin5(`crypto/fs/os/path/perf_hooks`), callback12를 실제 관측했다.
- disk B 중간 상태에도 보존 A를 공급하면 marker0이고, B를 재읽어 공급하면 marker202다.
  두 경우 모두 disk는 A로 복원되고 변환 출력은 같았다. 같은 output은 compiler 동일성 증거가 아니다.
- 등록 전에 실제 B를 평가한 cache는 거절했다. 허용 밖 builtin/local module require를 compiler
  fault suffix가 catch해도 최초 LOAD_UNLISTED가 남았다.
- 실제 callback32는 성공하고33은 거절했다. artifact10 MiB+1은 실제 reader에서 거절했다.
- 신규 harness의 종료/close·TERM/KILL·실제 PID 소유·첫 실패·root 교체·정리 불확실성30개 시험은
  기존 C2-B 경계를 별도 이름으로 유지한다. 기존 구현과 assertion/timeout/skip은 변경하지 않았다.

## 실패와 수정 이력

| 실행(UTC 2026-10-14) | 결과 | 원인과 보존 |
| --- | --- | --- |
| 02:04:24–02:10:23, 358.69초 | 전체 fallback5,499 /pass5,459 /fail7 /skip33 | CJS resolve의 importAttributes 부재에 Object.keys를 적용한 TypeError. 실패 소스 tar·전체 로그·별도 진단 복사본 보존 |
| 02:12:34–02:12:52, 17.71초 | 선택47 /pass38 /fail9 /skip0 | builtin nextResolve가 canonical URL만 반환하여 format hint를 필수로 간주한 검사가 실패. 실제 반환값과 실패 소스 보존 |
| 02:14:06–02:14:24, 17.99초 | 선택47 /pass47 /fail0 /skip0 /cancel0 | build/quality/tooling 포함 check:review 통과 |

부재한 CJS importAttributes와 optional resolve format hint를 구분한다. 제공된 attribute key,
잘못된 canonical URL/명시된 format과 실제 builtin load format은 계속 검사한다. 최종 load의
format 검사를 없애거나 실패를 성공으로 치환하지 않았다.

첫 review는 standalone child의 영향 연결이 불명확해 전체 fallback을 실행했다. 이후 child source의
compiler/protocol import가 type-only인지 확인하는 실제 안전 시험을 추가하여 두 시험 파일로
추적됐다. 영향 선택 도구나 fallback 정책은 변경하지 않았다.

통과한 전후 source SHA256은
`8579923df1a080c27a749086562c972db952d1a35e9d957a88ec82a5d7fb31d1`로 동일했다.
source commit의6개 파일이 이 snapshot과 byte-for-byte 같은지 대조했다.
후속 문서·게시 HEAD의 full check:merge, 자동 독립 Code/Security 검토와 실제 병합 결과는
PR 본문과 외부 체크포인트의 current-head 기록으로 확인한다. 아직 끝나지 않은 검증을 이 문서에서
통과로 주장하지 않는다. 기존 skip은 실제 pass가 아니다.

## 보존과 남은 의무

현재 공식 Library helper는 다시 제공됐으나, 기존 소비 환경에서 인증 연결을 읽지 못해 공식
업로드 절차가 종료됐다. 자격증명 복사·새 권한·대체 업로드나 반복 시도는 하지 않았다.
원본34개 worktree, 인계 overlay10개와 C2-C2 refs/체크포인트를 유지한다. C2-C3도 실패/성공
소스·로그를 보존하고 별도 소비 checkout으로 복원한다. Library roundtrip 완료와 구분한다.

산출물 실행, C2-C2의 실제 Program 입력과 이번 artifact load의 한 세션 결합, compiler의 전체
filesystem/native/configuration 소비, Node memory image와 전체 C2-C/D는 후속 의무다.
runtime/dependencies/result/comparability unavailable과 모든 complete flag=false를 유지한다.
