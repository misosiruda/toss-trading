# 단계별 테스트 검증 절차

반복 수정마다 전체 suite와 focused suite를 함께 실행하던 중복을 줄인다. 테스트 자체를 삭제하거나
Risk/fail-closed gate를 완화하지 않으며 최종 병합 후보의 전체 검증은 필수다.

## 명령과 적용 시점

| 상황 | 명령 | 검증 범위 |
| --- | --- | --- |
| 구현 중·PR 게시·review finding 수정 | `npm run check:review` | build, quality, tooling, 변경 영향 테스트 |
| 최종 병합 후보 | `npm run check` 또는 `npm run check:merge` | build, quality, tooling, 전체 테스트 |
| 기존 영향 검증 명령 | `npm run check:changed` | `check:review`와 동일 |
| 영향 범위만 사전 확인 | `node scripts/changedTestRunner.mjs --plan` | 계획 출력만 수행; 검증 통과 증거 아님 |

Full profile에 focused test와 build가 포함되므로 같은 변경에 이를 별도로 다시 실행할 필요가 없다.
`npm test`와 `npm run build`도 유지하지만 위 profile 뒤에 무조건 덧붙이는 단계가 아니다.
Frontend E2E/a11y처럼 full Node suite에 포함되지 않는 별도 검증은 해당 변경에서 계속 필수다.

## Review profile의 보수적 선택

기존 `changedTestRunner.mjs`를 그대로 사용한다. `origin/main`의 merge base부터 현재 HEAD까지의
변경과 staged/unstaged/untracked 파일을 합쳐 TypeScript 역의존성으로 테스트를 선택한다.
직접·간접 import, compiled CLI의 subprocess/worker 참조 및 source text를 검사하는 테스트를 포함한다.

설정·tooling·non-TypeScript source, 영향 분석 실패, 영향 테스트가 없는 source, 120개를 초과하는
선택은 전체 suite로 fallback한다. 문서만 바뀌면 애플리케이션 테스트는 생략하되 build/quality/tooling
검사는 유지한다. 따라서 테스트 도구를 바꾸는 이번 종류의 PR은 review에서도 전체 테스트가 실행될 수 있다.
선택 규칙과 임계값은 이번 변경에서 완화하지 않는다.

```powershell
node scripts/verificationRunner.mjs review --base-ref origin/main
node scripts/verificationRunner.mjs review --plan
```

`CHANGED_TEST_BASE_REF`도 기존대로 지원한다. 옵션은 wrapper 차이를 피하기 위해 위처럼 Node에
직접 전달한다. Windows PowerShell의 npm wrapper에서 `npm run ... -- --plan`이 옵션을 전달하지
않고 실제 검증을 실행한 사례가 있으므로 계획만 필요하면 직접 Node 명령을 사용한다.
`--plan` 실행은 `planned`로 보고하며 테스트 실행으로
계산하지 않는다. Merge profile에는 `--plan`과 `--base-ref`를 허용하지 않는다.

## PR 검증 순서

1. 구현 또는 finding 수정 후 diff 검사와 review profile을 실행한다.
2. 실패를 해결한 뒤 commit/push하고 current-head 검수를 받는다.
3. 검수 통과한 최종 후보에 full profile을 한 번 적용한다. 이미 **동일 검증 입력**에 대한 full
   통과 증거가 있는 경우 불필요하게 반복하지 않는다.
4. Full 검증 후 HEAD, 관련 worktree 내용, base와 의존성/실행 환경이 바뀌지 않았는지 확인한다.
   변경됐다면 새 후보의 검증과 필요한 재검수를 수행한다.
5. Current-head review, unresolved thread 0개, 필수 check 성공 및 전체 검증을 확인하고 병합한다.

과거 HEAD의 결과, 종료코드를 확인하지 못한 실행, plan-only나 selected 결과를 전체 통과로
재사용하지 않는다. 중단된 실행은 기존 프로세스의 종료를 확인한 뒤 판단한다. 성공 cache 파일이나
자동 skip은 도입하지 않으며 확인 가능한 증거가 없으면 full 검증을 실행한다.

## 시간과 결과 해석

Runner는 한 번의 호출에서 build → quality → tooling-tests → affected-tests/full-tests를
각각 한 번 실행한다. 모든 subprocess는 동일 Node runtime과 저장소 root를 사용하며 shell을 사용하지
않는다. 종료코드 실패, signal 종료 또는 spawn 오류가 발생하면 이후 단계를 실행하지 않는다.

`[verify]` 뒤의 JSON에는 stage, profile, status, durationMs와 exitCode가 포함된다. 시작 시 Node
version, OS/architecture와 availableParallelism을 출력한다. 경과 시간은 monotonic timer로 측정한다.
영향 profile의 summary scope는 `affected-or-fallback`이며 실제 선택 내역은 기존 `[test:changed]`
로그에서 확인한다. 전체 profile만 `scope: full`로 보고한다.

비교할 때는 동일 코드·Node·의존성과 가능한 한 비슷한 시스템 부하를 사용한다. Node TAP의
`duration_ms`는 build/quality를 포함하지 않으므로 전체 명령 시간과 혼동하지 않는다. 시간 변동만으로
CPU·메모리·디스크 중 원인을 단정하지 않는다. 이 변경은 캐시·증분 빌드·동시성 설정 변경이나
속도 배수 보장을 포함하지 않는다.

## Risk 통합 테스트의 파일 단위 분리

`portfolioActionRiskDecisionPolicyResolver.test.ts`에 모여 있던 155개 테스트를
정책, plan, mandate, snapshot, price, preview, execution 및 turnover의 원본·event·projection·
생성·lease·현재 상태 영역별 13개 파일로 나눈다. 테스트 이름, 본문, assertion, timeout과
fault injection은 변경하지 않는다. 공통 상수·타입·함수 35개는
`portfolioActionRiskDecisionTestFixtures.ts`로 이동하며 fixture import 자체는 테스트를 등록하지 않는다.

기존 Node test runner의 파일별 프로세스 격리/병렬 실행을 사용하고 파일 내부 테스트는
직렬 실행을 유지한다. 따라서 `Date`, filesystem mock과 `syncBuiltinESMExports()`가 다른
파일의 테스트에 섞이지 않는다. 기존 `mkdtemp` 기반 저장소 격리와 `finally` cleanup도 유지한다.
Runner의 concurrency 옵션, 영향 선택 임계값, 전체 검증 gate나 production 구현은 바꾸지 않는다.

원래 정책 테스트 파일은 정책 검증 16개를 계속 등록하므로 이전 compiled 파일이 추가 suite로
남는 rename/delete 문제는 없다. 공통 fixture 변경은 역의존성으로 모든 분리 파일을 선택한다.
테스트 분리는 production API·저장 형식 변경이 아니며 코드 rollback에 데이터 변환은 없다.
분리 뒤 생성된 `dist/portfolio/portfolioActionRiskDecision*.test.js`는 rollback 후 예전 소스에
없는 파일만 정확히 확인해 정리하거나 깨끗한 checkout에서 빌드해야 한다. TypeScript build는
삭제된 source의 오래된 compiled 파일을 자동으로 지우지 않는다.

성능 비교는 동일 Node/OS에서 기존 단일 파일의 155개 테스트와 분리된 13개 파일의 같은
155개 테스트를 각각 실행한다. 애플리케이션 전체 검증도 별도로 확인하며, 테스트 개수 감소나
skip으로 속도를 얻었다고 주장하지 않는다. 단일 측정은 환경별 성능 보장이 아니다.

2026-09-09 Windows x64 / Node v22.15.0 / availableParallelism 8 측정에서 기존 155개
단일 파일의 TAP duration은 211.686초, 분리 후 같은 155개는 71.564초였다(약 66% 감소).
양쪽 모두 실패·skip·cancel 0이다. 분리 후 `check:review`의 build/quality/tooling을 포함한
총 시간은 97.425초, 영향 단계는 분석 비용을 포함해 74.053초다. 이전 단일 파일 측정에는
build/quality가 포함되지 않았으므로 211.686초와 97.425초를 같은 범위의 수치로 비교하지 않는다.

## 호환성·롤백

### Windows 활성화 저장소 잠금 경합

전체 검증의 `activation file repository serializes exact retries across processes`에서
활성화 lock 파일의 exclusive `open`이 `EPERM`으로 실패한 사례가 있었다. 단독 11회 및 동일
커밋 전체 재실행은 통과했지만 그 사실만으로 OS 수준 원인을 확정하거나 오류가 해결됐다고
판단하지 않는다. 활성화 저장소에는 기존 runtime policy 저장소와 같은 제한된 획득 재시도를
적용한다. `EEXIST` 및 Windows에서의 `EPERM`만 `lockTimeoutMs` 안에서 재시도하며 시간 제한은
벽시계가 멈추거나 역행해도 유효하도록 monotonic clock으로 계산한다. 영구 실패는 마지막
오류를 cause로 보존한 timeout이다. `EACCES`, 획득 후 token write/fsync, 작업 본문과
release/ownership 오류는 재시도하지 않는다. 기존·교체된 다른 소유자의 lock을 자동 삭제하지 않는다.

`runtimePortfolioPolicyActivationLocks.test.ts`는 실제 concurrent read와 주입한 획득/쓰기/fsync
오류, frozen Date, abandoned/replaced token을 검증한다. 이 변경은 전체 테스트 runner의
자동 재시도·실패 무시나 테스트 제외가 아니며 activation artifact/정책 결정 시각/기본 timeout을
바꾸지 않는다. 데이터 변환 없이 코드 rollback할 수 있으나 획득 중 Windows EPERM 즉시 실패가
다시 나타날 수 있다. OS 오류 발생 빈도 감소나 전체 실행 시간 개선은 별도 측정 전에는 주장하지 않는다.

### 검증 프로필 호환성

기존 `check`는 전체 검증이고 `check:changed`는 영향 검증이라는 의미를 유지한다. 새 runner는 기존
`build`와 동일한 로컬 TypeScript compiler/config를 사용하며 quality gate가 build 명령의 일치를
검사한다. 새 profile의 stage 구성이 바뀌면 runner 테스트와 gate도 함께 검토한다.
Runtime artifact, DB, API, 거래 설정은 변경하지 않는다. 코드·package script·문서를 함께 되돌리면
이전 명령으로 복구할 수 있으며 데이터 migration이나 cache 정리는 필요 없다.
