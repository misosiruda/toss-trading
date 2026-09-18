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

## Opening capacity 통합 테스트의 파일 단위 분리

`storedSnapshotOpeningCapacity.test.ts`의 23개 테스트를 다음 5개 파일로 나눈다.

| 파일 | 책임 | 테스트 수 |
| --- | --- | --- |
| `storedSnapshotOpeningCapacity.test.ts` | occupancy, 예약과 보유 slot 집계 | 4 |
| `storedSnapshotOpeningCapacityPolicy.test.ts` | 활성 정책, 관측 도중 정책 변경 | 3 |
| `storedSnapshotOpeningCapacityIntegrity.test.ts` | 원본 무결성, 중복, overflow, strict 입력 | 6 |
| `storedSnapshotOpeningBudget.test.ts` | 공유 현금, 예약 차감, max band와 정수 경계 | 6 |
| `storedBucketOpeningCapacityStates.test.ts` | bucket state payload 및 재시작 persistence | 4 |

공통 type/function 8개는 `storedSnapshotOpeningCapacityTestFixtures.ts`로 이동한다.
분리 전후 TypeScript AST statement를 대조해 23개 test 호출의 이름·본문·반복 조합·assertion과
8개 helper 구현이 동일함을 확인했다. Helper의 export와 import 연결만 변경하며 fixture import는
테스트를 등록하지 않는다. Production 코드, 테스트 runner/선택 임계값, timeout과 Risk gate는 바꾸지 않는다.

Node test runner의 기존 파일별 프로세스 격리를 사용한다. 파일 안의 테스트는 계속 직렬이며
`Date` mock과 repository prototype mock은 다른 파일로 전파되지 않는다. 기존 fixture의
`mkdtemp` 경로 격리와 `finally`의 timer reset/cleanup을 유지한다.

2026-09-16 Windows x64 / Node v22.15.0 / availableParallelism 8에서 원본 23개 단독 실행은
138.418초, 분리된 같은 23개는 44.781초였다(TAP duration, 약 68% 감소). 둘 다 실패·skip·cancel 0이다.
Build 시간을 제외한 동일 테스트 집합 비교이며 단일 환경 측정이다. 전체 suite 또는 다른 환경의
속도 개선율을 이 값으로 주장하지 않는다.

```powershell
# 분리 전 main의 원본 파일: 23개
node --test dist/portfolio/storedSnapshotOpeningCapacity.test.js
# 분리 후 동일 집합: 4 + 3 + 6 + 6 + 4개
node --test dist/portfolio/storedSnapshotOpeningCapacity.test.js dist/portfolio/storedSnapshotOpeningCapacityPolicy.test.js dist/portfolio/storedSnapshotOpeningCapacityIntegrity.test.js dist/portfolio/storedSnapshotOpeningBudget.test.js dist/portfolio/storedBucketOpeningCapacityStates.test.js
```

원래 파일은 occupancy 4개를 계속 실행하므로 기존 compiled 파일이 전체 23개를 중복 등록하지 않는다.
Rollback에는 데이터 변환이 없지만 TypeScript는 삭제된 source의 compiled 파일을 자동 제거하지 않는다.
분리 PR을 되돌릴 때는 깨끗한 checkout에서 build하거나 해당 rollback으로 사라진 신규 4개 test 및
fixture의 compiled artifact만 정확히 확인해 정리해야 한다. 전체 `dist`나 사용자 데이터를 삭제하는
절차가 아니다. 새 fixture 변경은 영향 분석에서 이를 사용하는 5개 테스트 파일을 모두 선택한다.

## 호환성·롤백

### Windows 캘린더 root lease 해제 응답 순서

전체 검증에서 calendar publication writer의 namespace/root lease 해제가 간헐적으로 실패했다.
진단 실행에서 실제 helper가 `PUBLICATION_ROOT_LEASE_RELEASED`와 exit 0을 먼저 반환한 뒤
Node의 `stdin.end` callback이 `ERR_STREAM_DESTROYED`를 반환하는 순서를 확인했다. 로컬 입력
완료 callback만으로 이 정상 해제를 실패 처리하지 않고, 동일 helper의 정확한 해제 응답·exit 0·
stdin error 부재를 요구한다. 입력 실패 당시 아직 실행 중인 helper는 기존처럼 종료시키므로
응답 없는 실패·비정상 종료·signal 종료를 성공으로 승격하지 않는다.

`officialMarketCalendarRootLeaseReleaseOrdering.test.ts`는 이 순서와 응답 누락, exit 1,
signal, 조기 입력 실패 및 stdin error를 결정적으로 검증한다. 실제 Windows root replacement
차단 및 package publication 테스트도 유지한다. Timeout, OS 잠금 정책, directory fsync 또는
evidence 신뢰 조건은 완화하지 않는다. Schema migration 없이 코드 rollback 가능하지만 이
응답 순서의 false failure가 재발할 수 있다. 다른 staging/pinned helper에 대한 원인 확정이나
변경은 포함하지 않는다.

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

### Windows mandate 저장소 잠금 경합

전체 검증에서 `mandate repository atomically converges concurrent exact retries`도
`.instrument-mandates.lock`의 exclusive open이 Windows `EPERM`을 반환해 실패했다. Mandate 저장소는
잠금 획득의 `EEXIST`와 Windows `EPERM`만 기존 timeout 내 재시도하고, monotonic clock으로
wall clock 정지·역행에도 대기를 제한한다. Timeout에는 마지막 경합 오류를 cause로 보존한다.
`EACCES`, token write/fsync, consumer 작업 및 release/ownership 오류는 재시도하지 않는다.
Token 초기화가 실패하면 불완전하거나 교체된 lock의 소유권을 확정할 수 없으므로 descriptor만 닫고
barrier를 명시적 복구용으로 보존한다. Abandoned/replaced lock 자동 삭제는 하지 않는다.

`investmentMandateLocks.test.ts`는 실제 40개 concurrent read, 주입한 acquisition/initialization 실패,
frozen Date와 영구 경합, abandoned/replaced token 및 consumer 오류를 검증한다. 기존 concurrent
exact retry 테스트는 유지한다. 테스트 runner 재시도·skip·timeout 완화가 아니라 저장소 획득 경계의
수정이다. Mandate record/event 형식, default timeout과 거래 정책은 변경하지 않는다. Migration이나
artifact 삭제 없이 코드 rollback할 수 있지만 Windows EPERM 즉시 실패와 초기화 실패 시 lock 삭제
동작이 돌아온다. 보존된 실패 lock은 진행 중인 writer가 없고 원본이 일관적인지 확인하는 별도 복구가
필요하며 이 변경은 자동 stale lock 복구를 제공하지 않는다. 실제 OS 오류 원인이나 빈도 감소는
이 테스트만으로 확정하지 않는다.

### Windows 수동 배정 저장소 잠금 경합

비용 기준 기능의 전체 fallback 검증에서 `manual capacity concurrent exact retries produce only one durable pair`가
`.manual-assignment-events.jsonl.lock`의 exclusive open에서 Windows `EPERM`으로 실패했다. 수동 배정
저장소는 기존 `EEXIST`와 Windows `EPERM` 획득 오류만 기존 timeout 내 재시도하도록 한다. Deadline은
monotonic clock을 사용하고 영구 경합 시 마지막 오류를 cause로 남긴다. Wall clock 정지·역행으로
대기가 무한정 늘어나지 않는다. OS 오류의 구체적인 발생 원인이나 빈도 감소는 측정하지 않았다.

`EACCES`, token write/fsync, consumer와 release 오류는 재시도하지 않는다. 초기화 실패 시 현재
경로의 소유권을 확정할 수 없으므로 descriptor만 닫고 실패 barrier를 명시적 복구용으로 보존한다.
Abandoned/replaced token은 자동 삭제하지 않는다. `manualAssignmentLocks.test.ts`는 실제 40개
concurrent read, 주입한 획득·초기화 실패, frozen Date, 영구 경합과 consumer/ownership 실패를 검증한다.
기존 exact retry·capacity 테스트와 전체 검증 gate, default timeout은 변경하지 않는다.

수동 배정 event/관측 형식·Risk·거래 정책 변경은 없고 데이터 변환 없이 코드 rollback할 수 있다.
Rollback하면 Windows EPERM 즉시 실패 및 초기화 실패 시 lock 삭제 동작이 돌아온다. 보존된 실패
lock은 진행 중인 writer와 원본 무결성을 확인한 별도 복구가 필요하다. 이 변경은 전체 테스트 자동
재시도, 오류 무시 또는 stale lock 자동 복구가 아니다.

## 후보 평가·대기 예약 원본 테스트의 파일 단위 분리

`storedCandidateSelectionScore.test.ts`의 79개 테스트를 점수, 증거 요구사항, hard gate,
실행 비용, 유동성, 비용 기준, 현금, 분류, position exposure, bounded cost sizing의 10개 파일로
분리한다. 기존 파일은 점수 테스트 10개를 유지한다. 18개 공통 선언은
`storedCandidateEvidenceTestFixtures.ts`에서 재사용한다.

`storedSnapshotPendingReservationOrigins.test.ts`의 8개 테스트는 원본·소비 이력·무결성·관측의
4개 파일로 분리하고 기존 파일에 원본 테스트 2개를 남긴다. 6개 공통 선언은
`snapshotPendingReservationTestFixtures.ts`로 이동한다. 두 fixture module은 테스트를 등록하지 않는다.

분리 시 원본 87개 test expression의 전체 본문과 공통 선언 24개를 TypeScript AST로 추출해
대조했다. Export modifier를 제외한 helper 본문, 테스트 이름·assertion·timeout·fault injection은
그대로 유지하고 중복 등록은 없다. 원래 test 파일을 삭제하지 않아 이전 dist 파일이 별도 suite로
남는 문제를 피한다. 생성된 각 test 파일은 실제 사용하는 import와 fixture만 명시한다.

기존 Node 파일별 프로세스 격리 및 기본 병렬 실행을 사용한다. 파일 내부의 Date/filesystem mock,
임시 디렉터리와 finally 정리는 유지하며 runner concurrency·영향 선택 임계값·전체 검증 gate를
바꾸지 않는다. 성능 비교 시 분리 전 2개와 분리 후 14개 파일의 같은 87개 테스트를 실행하고,
TAP duration과 build/quality를 포함한 profile 총시간을 구분한다. 부하가 다른 전체 suite의 시간이나
항상 동일한 개선율을 보장하지 않는다. Production/저장 형식 변경이 없어 코드 rollback으로 복구한다.

## 캘린더 publication 통합 테스트의 파일 단위 분리

전체 검증에서 `officialMarketCalendarRedirectChainBoundary.test.ts`가 마지막으로 남은 실행을
확인한 뒤 동일 파일을 단독 측정했다. 기존 55개 중 앞의 52개는 redirect/document/parser/evidence/
reader/package plan 검증이고, 마지막 3개는 실제 Windows filesystem preflight와 package writer를
실행한다. 마지막 3개를 각 파일로 옮겨 기존 Node runner의 파일별 병렬 실행을 사용한다.

| 파일 | 책임 | 테스트 수 |
| --- | --- | --- |
| `officialMarketCalendarRedirectChainBoundary.test.ts` | redirect부터 package plan까지의 기존 검증 | 52 |
| `officialMarketCalendarPublicationPackageWriter.test.ts` | 실제 package publish와 중복 publish 거절 | 1 |
| `officialMarketCalendarPublicationPackageIdentity.test.ts` | preflight 뒤 교체된 root의 mutation 차단 | 1 |
| `officialMarketCalendarPublicationActivationBoundary.test.ts` | filesystem capability와 activation decision 결속 | 1 |

공통 type/constant/function 선언 28개는 `officialMarketCalendarBoundaryTestFixtures.ts`로 이동한다.
TypeScript AST로 55개 test expression 전체와 export modifier를 제외한 28개 선언 본문을 분리 전
커밋과 대조했다. 테스트 이름·assertion·skip 조건·fault injection과 timeout을 변경하지 않고
중복 등록은 없다. Fixture는 테스트나 filesystem probe를 import 시 실행하지 않는다. 기존 파일은
52개를 유지하므로 오래된 동일 compiled 파일이 55개를 별도 실행하지 않는다.

실제 Windows filesystem 검증을 mock이나 cache로 바꾸지 않는다. 각 테스트의 기존 mkdtemp,
probe 경로 및 cleanup을 유지하며 production, runner concurrency/영향 선택 임계값, 전체 검증
gate와 안전 정책 변경은 없다. Fixture 변경 시 이를 사용하는 네 테스트 파일이 함께 선택된다.

2026-09-16 Windows x64 / Node v22.15.0 / availableParallelism 8 단독 측정에서 같은 55개는
분리 전 TAP 76.649초, 분리 후 44.236초였다(약 42% 감소). 양쪽 실패·skip·cancel 0이며 build는
제외한 비교다. 단일 환경 측정이고 전체 suite 속도 개선율이나 다른 환경의 성능 보장은 아니다.
분리 전 Windows 세 테스트의 시간은 각각 49.847초, 12.483초, 11.022초였다.

```powershell
# 분리 전: 원본 55개
node --test dist/replay/officialMarketCalendarRedirectChainBoundary.test.js
# 분리 후: 같은 52 + 1 + 1 + 1개
node --test dist/replay/officialMarketCalendarRedirectChainBoundary.test.js dist/replay/officialMarketCalendarPublicationPackageWriter.test.js dist/replay/officialMarketCalendarPublicationPackageIdentity.test.js dist/replay/officialMarketCalendarPublicationActivationBoundary.test.js
```

테스트만 이동하므로 runtime artifact migration은 없다. Rollback은 깨끗한 checkout에서 build하거나
해당 rollback으로 소스가 사라진 신규 3개 test와 fixture의 compiled artifact만 확인해 정리해야 한다.
TypeScript는 삭제된 source의 오래된 dist 파일을 자동 제거하지 않는다. 사용자 데이터나 전체 dist를
삭제하는 절차가 아니며, source와 compiled test가 섞여 중복 실행되지 않게 해야 한다.

### 검증 프로필 호환성

기존 `check`는 전체 검증이고 `check:changed`는 영향 검증이라는 의미를 유지한다. 새 runner는 기존
`build`와 동일한 로컬 TypeScript compiler/config를 사용하며 quality gate가 build 명령의 일치를
검사한다. 새 profile의 stage 구성이 바뀌면 runner 테스트와 gate도 함께 검토한다.
Runtime artifact, DB, API, 거래 설정은 변경하지 않는다. 코드·package script·문서를 함께 되돌리면
이전 명령으로 복구할 수 있으며 데이터 migration이나 cache 정리는 필요 없다.
