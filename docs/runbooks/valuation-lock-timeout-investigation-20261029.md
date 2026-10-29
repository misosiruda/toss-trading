# Valuation lock timeout 재현 조사

## 판정과 변경 범위

2026-10-29 조사에서 과거 valuation 동시 exact retry의 lock timeout은 재현되지 않았다.
원인은 **미확정**이다. `BucketValuationApplicationFileRepository`, 기존 테스트,
timeout, retry delay, assertion, test runner와 병렬도는 변경하지 않는다.
이번 변경은 조사 기록과 검증 절차의 연결이며, 간헐 실패를 해결했다는 주장이 아니다.

기준 main은 `5da597ee1ac383bcb3888c30492e819b242ea9d7`, tree는
`01e353da5073b0ebf0c499764f77b700b1b9bbc7`다. 최초 실패 당시 PR #833 head
`ebf2ebd5d0d2c2c42dd5ff3d1d1ad190ec2cba9a`와 기준 main 사이에서 대상 저장소와
`bucketValuationApplicationFiles.test.ts`의 diff는 없다.

기계 판독용 결과와 원문 SHA-256은
[조사 근거](valuation-lock-timeout-investigation-20261029.json)에 기록한다.

## 최초 실패에서 확인할 수 있는 것

- PR #833의 수정 전 계측 전체 실행 `diagnostic-run-02`에서
  `valuation application repository converges concurrent exact retries`가
  `bucket valuation application repository lock is unavailable`로 실패했다.
- 테스트 전체 경과 시간은 6110.201561ms이며 `Promise.all (index 1)`에서 전파됐다.
  이 값은 fixture 준비와 정리를 포함하므로 lock 대기 시간 자체가 아니다.
- 전체 결과는 5672개 중 5638 pass, 1 fail, 기존 33 skip이었다.
- 당시 기록에는 개별 lock 이름, 획득·해제 시각, fsync 지연, event-loop 지연과
  wall-clock 변화가 없다. OS I/O, event-loop 지연, lock 누수 또는 시계 변화 중
  하나를 원인으로 확정할 수 없다.

## 보존한 계약

- 기본 lock timeout 5000ms, retry delay 10ms, 동일 요청 8개 동시 실행.
- 신규 적용 1개와 `alreadyApplied` 7개, 저장 mark 1개, equity event 2개,
  position event 4개라는 원래 assertion.
- 정렬된 네 component lock 획득과 역순 해제, token 소유권 확인, 파일·directory sync.
- 실패 시 fail-closed, 기존 방치 lock 보존, 기존 skip 목록과 전체 검증 gate.
- `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`,
  `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false`.

deadline이 `Date.now()`에 의존한다는 코드 사실만으로 이번 과거 실패를 시계 문제로
판정하지 않는다. clock 변경, timeout 확대, retry 추가, process-local queue 도입,
fsync 생략 또는 병렬도 축소를 추측성 해결책으로 넣지 않는다.

## 재현 절차와 실행 결과

Node v24.19.0, Linux x64, `availableParallelism=12`에서 잠금 설정을 바꾸지 않았다.
기존 잠금 테스트는 실제 임시 파일을 사용하고 외부 provider를 호출하지 않는다.
각 실행은 별도 임시 root와 원문 stdout/stderr, 명령·환경·입력 manifest를 보존했다.

| 실행 | 대상 결과 | 전체 실행 판정 |
| --- | --- | --- |
| 계측 없는 baseline 전체 검증 | valuation 797.143919ms, pass | 5682개 / 5648 pass / 1 fail / 33 skip. 별도 turnover 동시 생성 lock timeout으로 실패 |
| 계측 없는 valuation 단독 20회 | 20/20 pass, 각 356.012569~406.110543ms | 각 프로세스 tests=1, fail/skip/cancel=0. 전체 검증 대체가 아님 |
| 별도 계측 전체 suite | valuation 837.070996ms, pass | 5682개 / 5648 pass / 1 fail / 33 skip. 별도 turnover 짧은 timeout assertion으로 실패 |

Baseline은 build/quality/tooling을 포함하는 merge profile이었다. 계측 suite는 baseline의
빌드 결과에서 두 테스트 파일에 외부 observer import만 삽입한 진단 실행이다. 따라서
계측 suite를 정식 merge profile 통과 증거로 쓰지 않는다. source/scripts/docs/dependencies
등 5122개 입력은 각 실행 전후 hash 변경이 없었다. 관측 대상 compiled 파일의 원본·계측
hash를 따로 저장하고, 진단 종료 후 원본 bytes 복원을 확인했다.

실행한 기본 명령:

```bash
/opt/node/bin/node scripts/verificationRunner.mjs merge
/opt/node/bin/node --test --test-name-pattern '^valuation application repository converges concurrent exact retries$' dist/portfolio/bucketValuationApplicationFiles.test.js
```

두 번째 명령은 별도 프로세스로 20회 실행했다. 필터는 단독 재현 범위이며 전체 runner의
선택 규칙이나 skip을 바꾸는 설정이 아니다.

## 별도 계측의 범위와 한계

외부 observer는 대상 테스트 프로세스에서만 `apply`와 filesystem promise/handle 작업의
시작·완료·오류를 `performance.now()`로 기록했다. source나 timeout/결과를 교체하지
않지만 wrapper와 AsyncLocalStorage가 스케줄링에 영향을 줄 수 있다.

Valuation 테스트 파일의 기록은 8560 events이며 상한 초과로 버린 event가 없다.
원래 동시 재시도에 해당하는 apply 2~9번은 모두 완료됐고 신규 1개·재시도 7개였다.

| 관측 | 값 | 해석 한계 |
| --- | ---: | --- |
| 최대 관측 lock wait | 446.477467ms | 첫 `open(wx)` 호출부터 성공 반환까지; 원래 deadline 시작과 정확히 같은 시각은 아님 |
| 최대 관측 lock hold | 89.002620ms | `open(wx)` 성공부터 `unlink` 완료까지; token fsync 및 해제 후 directory sync 경계와 구분 |
| 호출별 누적 fsync 최대 | 78.701995ms | 한 apply의 file/directory sync 합계, 병렬 호출을 합친 wall time 아님 |
| 파일 프로세스 전체 event-loop delay 최대 | 24.215551ms | 해당 동시 재시도만의 값이나 과거 실패 당시 값이 아님 |
| wall/monotonic delta 차이 최대 | 0.919804ms | 이번 valuation 계측 구간에서만 확인한 값 |

이 수치로 과거 지연의 원인이 없어졌거나 lock 누수가 불가능하다고 결론내리지 않는다.
고정된 방치 lock을 검증하는 별도 negative test의 의도된 예외는 원래 실패의 재현으로
계산하지 않는다. Turnover 테스트에는 별도 clock 조작 시험이 있으므로 해당 trace의
wall/monotonic 차이를 OS 시계 이상으로 해석하지 않는다.

## 조사 중 확인한 별도 실패

1. Baseline 전체 검증: `turnover-bound Risk concurrent creators converge to one persisted observation`.
   테스트 9307.344072ms, `turnover event repository lock is unavailable`, 원인 chain에 `EEXIST`.
   이는 valuation 저장소가 아닌 turnover event lock의 실패다.
2. 계측 전체 suite: `turnover Risk sources honor short lock timeouts throughout nonempty historical source resolution`.
   `matchedCauseRepository=turnover_window`, 측정 11172.016843ms로 원래 `<4000ms` assertion 실패.
   해당 테스트 파일 자체에는 observer를 주입하지 않았지만 같은 suite의 부하 영향은 분리되지 않았다.

두 실패를 valuation의 공통 원인으로 확정하지 않으며 계측 탓으로 단정하지도 않는다.
Observer를 제거한 뒤 위 두 테스트를 이름으로 선택한 별도 실행은 2/2 pass, fail 0이었다.
이 결과도 전체 검증 통과나 원인 해결의 증거로 확대하지 않는다.
실패 로그를 삭제하거나 통과로 바꾸지 않는다. 최종 후보는 observer 없이 새로 build하고
전체 merge profile을 검증해야 한다. 성공하더라도 위 실패의 원인이 해결됐다는 뜻은 아니다.
최종 검증·review·merge 결과는 해당 PR과 보존한 검증 기록에서 별도로 확인한다.

후보 검증 준비 중 두 실행은 검증 근거에서 제외했다. 첫 review는 Windows 문서의 CRLF를
정규화하는 동안 입력이 변경되어 중단했다. 후속 review는 앞 실행의 종료 확인 전에 시작한
운영 실수로 초반 전체 suite가 겹쳤으며 HTTP admission 시간 관련 실패를 관측했다. 이 실행도
중단하고 원문을 보존했다. 해당 실패의 원인을 중복 실행으로 확정한 것은 아니다. 최종 후보는
두 검증 프로세스와 소유 child의 종료 확인 후 단독 merge profile로 실행한다. suite 내부의
기존 병렬도는 유지한다.

## 다음 재현 시 필요한 근거

같은 기준을 유지한 실행에서 valuation timeout이 다시 발생하면, 해당 요청의 lock별 획득
시도·성공·해제 순서, sync 시작·완료, event-loop 지연과 deadline 관측을 함께 확보한다.
실패 root와 최초 오류를 보존하고, 고의 fault injection 결과와 자연 발생 실패를 구분한다.
원인을 입증한 뒤에만 해당 경계를 최소 수정하고 기존 negative/positive 및 전체 검증을 수행한다.

실거래·실계좌·실제 시장 데이터 검증은 이 조사에 포함되지 않는다. 실행 코드·저장 형식·API
변경이 없으므로 migration이나 배포 순서 변경은 없다. 이 문서를 되돌리는 데 데이터 변환은
필요 없으며, rollback을 이유로 진단 원문을 삭제하지 않는다.
