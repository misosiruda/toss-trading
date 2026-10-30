# AI 호출 budget scope 계약

관련 이슈: #841. 이 계약은 호출 시도 수를 제한하며 외부 서비스 계정 quota·요금·비용 상한을 보장하지 않습니다. AI 활성화와 paper-only 안전 기본값은 변경하지 않습니다.

## 경로별 소유권

| 경로 | budget 소유 단위 | 날짜와 시계 | 새 인스턴스/프로세스 |
| --- | --- | --- | --- |
| one-shot / stored packet paper CLI | provider 인스턴스의 UTC 일자별 메모리 Map | `config.now()` 또는 실제 `new Date()`, UTC | 0부터 시작 |
| scheduler의 provider | 위와 동일, CLI가 provider를 생성 | provider wall-clock UTC | provider budget 초기화 |
| scheduler job gate | state/lock 경로로 구분되는 scheduler state의 job 시도 | `run({ now })`의 KST 날짜; CLI는 실제 시각 | 같은 state를 읽으며 별도 gate 적용 |
| single historical replay | 기본 provider UTC-day budget + replay wrapper의 실행별 delegate cap | provider는 실제 UTC, wrapper는 날짜 무관 | 새 replay/provider에서 초기화 |
| batch historical replay | 각 run factory가 만든 `InMemoryRunBudget` + replay wrapper | 날짜 무관, replay의 simulated time도 무관 | run별 초기화 |
| HTTP paper simulation | 각 run factory가 만든 `InMemoryRunBudget` + replay wrapper | 날짜 무관 | run별 초기화 |
| batch CLI preflight | 별도 provider에 별도 run budget | 날짜 무관 | preflight와 실제 run은 공유하지 않음 |

`InMemoryInstanceUtcDayRunBudget`은 같은 객체 안에서 각 UTC 날짜의 사용량을 보관합니다. 자정을 넘으면 새 날짜의 잔여량을 사용하고 시계가 이전 날짜로 돌아가면 그 날짜의 기존 사용량을 다시 확인합니다. `InMemoryRunBudget`은 객체 전체의 총 사용량을 보관하므로 날짜 변경으로 회복되지 않습니다.

## 설정 및 타입

- `RunBudget.scope`는 `instance_utc_day` 또는 `run`입니다. provider 실패 메시지는 이 범위를 명시하고 기존 `RUN_BUDGET_EXCEEDED` code를 유지합니다.
- provider의 `maxRunsPerDay`는 legacy 기본 budget 설정입니다. `dependencies.budget`이 있으면 그 객체가 우선하며 이 필드는 budget 생성에 쓰이지 않습니다.
- batch/API는 `maxCodexCallsPerRun`을 `maxRunsPerDay`로 다시 이름 붙여 전달하지 않고 `InMemoryRunBudget` 생성자에 직접 전달합니다.
- 일반 환경 변수는 `AI_DECISION_MAX_RUNS_PER_DAY` → `CODEX_DECISION_MAX_RUNS_PER_DAY` → 경로별 기본값 순서를 유지합니다. 일반 paper CLI는 `3`, single historical replay는 `5`입니다. 기존 명시적 `maxRunsPerDay` override도 유지합니다.
- 기존 `InMemoryDailyRunBudget` export는 새 이름의 alias로 유지합니다. 기존 주입 객체의 인스턴스 및 동작 호환성을 보존합니다.
- batch/API per-run cap의 숫자와 replay wrapper의 `maxCallsPerReplay`는 변경하지 않습니다.

## 차감 및 동시 호출

1. provider disabled이면 차감하지 않습니다.
2. `canConsume(now)`가 false이면 runner 호출 없이 차단하고 추가 차감하지 않습니다.
3. 통과하면 `consume(now)`를 runner의 첫 await 전에 동기 실행합니다.
4. 성공, timeout, nonzero exit, JSON/schema 실패, runner reject 모두 이미 소비한 시도를 환불하지 않습니다.

동일 객체를 명시적으로 공유한 provider의 동시 호출은 같은 JS event loop에서 검사와 차감 사이에 await가 없습니다. 서로 다른 객체·process·worker는 공유하지 않습니다. replay wrapper의 별도 카운터는 delegate를 부르기 전에 증가하므로 delegate가 disabled/budget gate에서 거절해도 wrapper 호출 시도는 소비됩니다.

Scheduler는 provider budget과 별도 구현입니다. KST job budget, 저장 state, lock, backoff를 유지하며 이번 변경은 scheduler의 원자성·장애 복구 보장을 확대하지 않습니다. 여러 실행을 합친 영속 AI quota는 별도 저장/원자적 차감/재시작/손상 시 fail-closed 계약이 필요한 후속 설계이며 여기서는 도입하지 않습니다.

## 검증과 변경 영향

- fake runner와 고정 시각으로 동일 일자 소진, UTC 경계, 새 provider, 공유 객체의 동시 호출, 실행별 cap, 실패/disabled 소비를 검증합니다.
- 실제 Node 자식 프로세스를 두 번 시작해 로컬 budget이 새로 시작됨을 검증합니다. 외부 AI를 호출하지 않습니다.
- env 우선순위·기본값, scheduler와 replay wrapper의 기존 회귀를 함께 실행합니다.
- 실패 reason 문자열이 구체화되지만 code/API/schema/저장 형식은 유지합니다. 문자열을 비교하는 소비자는 새 reason을 확인해야 합니다.
- DB migration과 데이터 변환이 없어 코드 롤백이 가능합니다. 롤백하면 batch/API provider 내부 한도는 UTC-day 방식으로 돌아가지만 기존 replay wrapper의 전체 run cap은 계속 적용됩니다.
