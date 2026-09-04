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

## 호환성·롤백

기존 `check`는 전체 검증이고 `check:changed`는 영향 검증이라는 의미를 유지한다. 새 runner는 기존
`build`와 동일한 로컬 TypeScript compiler/config를 사용하며 quality gate가 build 명령의 일치를
검사한다. 새 profile의 stage 구성이 바뀌면 runner 테스트와 gate도 함께 검토한다.
Runtime artifact, DB, API, 거래 설정은 변경하지 않는다. 코드·package script·문서를 함께 되돌리면
이전 명령으로 복구할 수 있으며 데이터 migration이나 cache 정리는 필요 없다.
