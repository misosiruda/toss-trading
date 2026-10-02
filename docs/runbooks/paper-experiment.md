# 고정 fixture paper 실험

## 현재 사용 가능한 범위

EXP-01 입력 검증, EXP-02 격리 저장, EXP-03 fixture runner/CLI와 EXP-04 근거 검토·반복 비교를 구현했다.
기존 single historical workflow와 report/audit를 재사용하며 API/dashboard 연결은 없다.
계획은 [기획](../plans/reproducible-paper-experiment/product-plan.md),
[기술 설계](../plans/reproducible-paper-experiment/technical-design.md),
[PR 작업 계획](../plans/reproducible-paper-experiment/pr-work-plan.md)을 따른다.

## 입력 검증

정본 fixture는 [`paper-experiment.v1.json`](../../src/replay/fixtures/paper-experiment.v1.json)이다.
`parsePaperExperimentInput(json, { implementationRevision })`은 full normalized input,
`inputHash`, bounded source preflight를 반환한다. Caller가 독립적으로 검증한 revision을 받아
정규화하며 Git, 환경변수, filesystem, provider 또는 network를 조사하지 않는다.
입력은 synthetic 100 snapshots/10 symbols/100 ticks/100 calls 및 2 MiB로 제한한다.
저장할 full normalized JSON의 확장 크기도 attempt 생성 전에 같은 byte 상한으로 검사한다.
실제 시장·전략 선택이나 투자 성과의 증거가 아니다.

## 저장 library의 호출 계약

[`paperExperimentStore.ts`](../../src/storage/paperExperimentStore.ts)의 public 함수:

- `createPaperExperimentAttempt`: `inputJson`, backend-controlled `rootDir`, `protectedPaths`,
  `runtimeIdentity`, `createdAt`을 받는다. 같은 input을 다시 parse하여 caller의 hash/preflight
  자기 선언을 받지 않는다. `attemptId`는 기본 `exp-<UUID>`이며 옵션은 backend allocator/test용이다
- `inspectPaperExperimentAttempt(location, attemptId)`: 원래 source 파일이나 현재 환경변수 없이
  보존된 input·source·runtime receipt를 읽는다. writer handle을 만들지 않고 파일을 고치지 않는다
- `retryPaperExperimentAttempt`: 검증 가능한 부모 input에서 새 attempt와 `parentAttemptId`를 만든다.
  부모의 코드 revision/dependency lock hash/Node version과 caller receipt가 모두 같아야 한다

`protectedPaths`는 backend가 아는 source 파일/디렉터리와 공유 paper storage root의 명시적인 목록이다.
Root와 보호 경로의 동일·상위·하위 겹침을 모두 거절한다. 목록 밖의 임의 디렉터리 의미를 추측하지
않으므로 후속 adapter가 목록을 채워야 한다. Input JSON에서 경로나 provider를 받지 않는다.
Root의 부모는 필요하면 생성하지만 attempt 자체는 non-recursive exclusive `mkdir`로 한 번만 만든다.
이미 있는 파일·빈 디렉터리·실패/완료 attempt는 언제나 충돌이며 기존 데이터를 정리하지 않는다.

Runtime receipt에는 `implementationRevision`, `dependencyLockHash`, `nodeVersion`을 저장한다.
저장 library는 caller가 검증한 receipt를 보존한다. 실제 clean HEAD/lockfile/Node와 compiled build를
관측·결속은 아래 EXP-03 지원 entry point가 담당한다. 저장 unit test의 고정 receipt는 실제 실행 증명이 아니다.

```text
<backend root>/<attemptId>/
  experiment-run.json
  input/experiment-input.json
  input/historical-market-snapshots.jsonl
  replay/                    # 처음에는 비어 있음
  review/<reviewId>/          # 새 generation에만 JSON/Markdown/완료 marker 작성
```

State와 input은 exclusive write한다. Input/source를 갱신하는 API는 없다.
생성한 process만 받는 owner handle의 `start(at)`, `complete(at)`, `fail(reason, at)`은 lifecycle만
기록하며 runner를 실행하지 않는다. `start` 직전 source/input과 빈 replay를 다시 확인한다.
Mutation handle 재구성·resume은 없다. 새 process는 inspect 또는 명시적인 새 attempt retry만 한다.

## 상태와 완료 무결성

저장 상태는 `preparing → prepared → running → completed` 또는 `failed`다.
Read projection은 terminal 증거가 없으면 `incomplete`이고 저장된 마지막 `storedStatus`를 함께
반환한다. `prepared`나 `running`에서 process가 살아 있는지 PID/시간으로 추측하지 않는다.
`failed`여도 input/source 자체가 누락·손상되면 `incomplete`다. `completed`는 투자 성공을 뜻하지 않는다.

완료 전에 고정 allowlist 11개 artifact의 schema, identity/path, input/config, 비용 모델 hash,
packet/decision/Risk/trade count, 모든 tick의 audit timeline과 report timeline을 대조한다.
V1은 기존 report 기본 title과 paper-only disclaimer를 고정한다. Metadata/progress의 disclaimer도
기존 공통 문구와 같아야 한다. 일반 report builder의 별도 custom title 기능은 변경하지 않지만
이 fixture 저장 계약에서는 사용하지 않는다. Manifest의 execution model version과 log에 명시된
trade cost model version은 보존 input의 cost model version과 일치해야 한다.

Report 초기 현금은 고정 input과 일치해야 한다. 최종 audit portfolio는 report의 최종 잔고·포지션
요약 및 progress의 full currentPortfolio와 일치해야 한다.
기존 report의 전체 nested shape를 strict하게 검사하고, 보존한 log·input에서 복원할 수 있는
summary는 기존 report/portfolio/hash helper를 재사용한 순수 adapter로 대조한다. 새 재무·통계
공식이나 Risk/매매 계산 구현을 만들지 않는다.
그 다음 input/source, 기존 manifest/metadata/progress/report, 5개 JSONL의 contract/format/record count와
기존 `createReplayResearchHash`의 parsed payload digest를 state의 `artifactInventory`에 기록한다.
EXP-03 adapter는 기존 `createWorkflowResearchManifest`를 재사용하여 예상 full manifest와 실제 파일을 대조한다.
기존 report builder의 반환 payload와 저장 파일, recorder가 부여한 decision hash까지 대조한 뒤 완료한다.

보존 근거로 확인 가능한 범위와 없는 범위를 구분한다. Decision/trade/cost/Risk 요약,
portfolio/analytics/performance/benchmark와 progress의 tick·bounded recent projections는
canonical logs·고정 input과 대조한다. V1은 기존 recorder 기본 한도(최근 packets 10개,
결정/Risk/trade 각 50개, timeline 1,500개)를 고정하며 custom limit은 받지 않는다.
Packet의 tick, decision/packet hash, Risk/trade의 참조와 simulated timestamp도 대조한다. EXP-02만 사용한 저장 evidence에는 전체 provider/sampling/warning 원본이 없으므로
그 값을 schema/상호 count·상한과 sealed digest까지만 검사한다. EXP-03 실행은 별도의 고정
`replay/paper-experiment-execution.json` (`paper_experiment_execution.v1`)을 반드시 남긴다.
기존 runner의 `auditEvents`, `warnings`, `samplingDecisions`를 그대로 보존하며 input/run ID,
예상 manifest와 manifest/report/packet/decision/Risk/trade digest를 결속한다. `executionReceiptRequired: true`
attempt는 이 파일을 12번째 terminal inventory 항목으로 검사하고 누락·변조를 완료로 읽지 않는다.
Legacy 저장-only 호출의 11개 inventory는 유지되지만 CLI는 이를 실제 실행 완료로 승격하지 않는다.
Provider failure는 실제 `HISTORICAL_AI_DECISION_FAILED`, no-candidate는 `HISTORICAL_PACKET_SKIPPED`
event에서 읽으며 호출 수와 decision 수의 차이로 실패를 추측하지 않는다. 새로운 금융 계산은 없다.


JSONL은 존재해야 하며 invalid/blank/torn line을 건너뛰지 않는다. 빈 log는 실제 파일이 있고
schema·count가 0인 경우만 허용한다. Input은 2 MiB, state는 64 KiB, replay artifact 각각은 16 MiB,
JSONL은 10,000 rows를 읽기 상한으로 둔다. 배열 순서를 보존한 digest이므로 whole-row truncation,
유효 숫자로 바뀐 report, record reorder도 검출한다. 의미가 같은 JSON whitespace/key 순서 변화는
byte 손상이 아니라 같은 canonical payload로 취급한다.

State는 같은 directory의 exclusive temp file을 쓰고 rename한다. `completed`는 검증 뒤 마지막
상태 교체다. Write/crash fault 때 partial 파일과 남은 temp 파일을 보존하며 reader는 삭제·수정하지
않는다. Directory sync나 기존 JSONL write의 transaction/power-loss durability를 보증하지 않는다.
Lifecycle와 inventory는 외부 공격자에게서 인증된 증거가 아니다.

모든 접근에서 경로 ancestor와 파일 leaf의 symlink를 거절하고 파일은 regular/single-link 및
bounded read를 확인한다. Stored path는 파일을 여는 권한이 아니며 고정 allowlist와 일치해야 한다.
알 수 없는 파일이나 `review/`는 재귀 탐색하지 않는다. 같은 ID의 cooperating process 경쟁은 하나만
생성에 성공한다. Hostile 외부 process의 검사·사용 사이 rename/symlink 교체를 차단하는 OS sandbox나
공유/multi-bucket lock이라고 주장하지 않는다.

## 오류·중단·재시도

- Admission 실패: attempt를 만들기 전에 거절
- 준비/실행/완료 기록 실패: 가능한 실패 상태와 partial artifacts 보존, 성공으로 추정하지 않음
- Exclusive attempt 할당 뒤 준비 실패는 `stage: preparation`, attempt ID/artifact root와 failureRecorded를 반환한다.
  최초 state write 또는 실패 marker까지 실패해도 partial 위치를 잃지 않는다. Admission/collision 실패에는 새 attempt를 주장하지 않는다
- report만 있고 terminal inventory가 없거나 무결성 불일치: `incomplete`
- 기존 attempt에 append/resume/overwrite/삭제 없음. Retry에는 새 identity가 필요함
- 입력을 복원할 수 없는 부모는 retry도 거절. 검증된 새 입력으로 별도 attempt를 준비해야 함
- cancel/resume/자동 retry는 미지원. Ctrl+C/강제 종료를 취소 성공으로 표시하지 않음

오류 출력은 고정 `PaperExperimentStorageError.code`만 노출한다. Filesystem path나 JSON/Zod 원문을
그대로 error message에 포함하지 않는다. Malformed replay JSON/JSONL, schema 위반과 잘못된 UTF-8은
`ARTIFACT_INTEGRITY`다. 보존 input/source의 parse/schema/UTF-8/크기 손상은 `INPUT_INTEGRITY`,
state 손상은 `STATE_INVALID`, 잘못된 caller identity/token은 `INVALID_REQUEST`로 구분한다.
경로 alias는 `PATH_UNSAFE`, 실제 filesystem 접근 실패는 `IO_FAILURE`다.
실제 path는 backend owner handle 및 CLI가 할당한 attempt의 `artifactRoot`에만 별도로 제공한다.

## 로컬 검증

```sh
npm run build
node --test dist/storage/paperExperimentStore.test.js dist/storage/artifactPaths.test.js
```

테스트는 임시 디렉터리의 synthetic 입력과 저장 evidence만 사용한다. Separate-process 생성 경쟁,
원 source 삭제 뒤 재구성, preparation crash, explicit retry, symlink/hardlink/traversal/겹침,
write/sync/rename/read fault, malformed report, timeline 누락과 완료 뒤 변조를 검사한다.
저장 fixture 생성에는 기존 recorder/report builder만 사용하며 workflow/runner/provider를 실행하지
않는다. 외부 AI/Codex CLI/broker/live/source 호출은 하지 않는다.
최종 candidate의 aggregate/full 및 independent/current-head review 결과는 해당 PR의 exact SHA
검증 기록을 따른다. 저장 unit test만으로 EXP-03~04나 Trainer/SPOM 최종 AC를 완료로 읽지 않는다.


## EXP-03 지원 CLI와 build 결속

의존성을 lockfile 기준으로 준비한 clean Git checkout에서 실행한다. Node 22 이상이 필요하다.

```sh
npm run paper:experiment -- validate --input src/replay/fixtures/paper-experiment.v1.json
npm run paper:experiment -- run --input src/replay/fixtures/paper-experiment.v1.json
npm run paper:experiment -- inspect --attempt <returned-attempt-id>
npm run paper:experiment -- retry --attempt <returned-attempt-id>
```

- Root는 repository의 `data/paper-experiments/`로 고정하며 ID는 backend가 할당한다
- CLI는 output/provider/model/raw command/attempt allocator 옵션을 받지 않는다
- `validate/run/retry` launcher는 clean HEAD를 확인하고 현재 source를 새로 build한다. Build 전후 source와
  HEAD를 대조하며 build 실패는 이전 receipt를 남겨 유효한 실행으로 사용하지 않는다
- `dist/paper-experiment-build.json`은 HEAD, normalized lock hash, 실제 Node version, tracked source bytes와
  모든 compiled JS bytes의 기존 research hash를 결속한다. 실제 entry는 이를 다시 확인하고 dirty source,
  미추적/ignored TS source, stale/추가/tampered compiled JS, missing receipt, lock/Node/revision 불일치를 거절한다
- Git 조회는 shell 없는 fixed argv이며 상속 `GIT_*` redirection/config와 fsmonitor를 사용하지 않는다.
  Source/output ancestor와 dist 내부 symlink/hardlink는 compiler 실행 전에 거절한다. Compiler subprocess도 고정 Node/tsc 인자다. Provider/Codex CLI/외부 source/broker subprocess가 아니다
- `inspect/review`는 기존 built CLI만 사용하여 재build·Git 확인·source 재읽기 없이 retained evidence를 읽는다.
  `dist`가 없는 checkout에서는 먼저 `npm run build`가 필요하다. 다른 코드에서 retry는 거절되지만 inspect는 가능하다
- `run`은 준비 직후 attempt ID/artifact root와 중단 제한을 JSON으로 출력한다. 성공 상태와 provider failure/
  insufficient-data quality는 별개이며 inspect가 이를 구분한다. HOLD/Risk 결과는 기존 decision/Risk/report에 남는다
- `cancel/resume`과 알려지지 않은 옵션은 build/storage mutation 전에 실패한다. Ctrl+C/SIGKILL은 partial
  artifact를 보존하는 프로세스 중단이다. inspect는 preparing/prepared/running을 incomplete로 읽고 상태를 고치지 않는다
- retry는 원 입력과 같은 runtime identity만 허용하며 새 ID와 parent lineage를 기록한다. 이전 파일은 변하지 않는다

Build receipt는 임의 외부 writer나 변조된 설치 의존성·컴파일러를 인증하는 보안 장치가 아니다.
Dependency lock hash만으로 설치된 `node_modules`의 모든 byte를 입증하지 않는다. 동시에 source/dist를
수정하는 외부 process와 hostile filesystem race는 지원하지 않는다. 직접 compiled 파일을 실행하여
지원 launcher를 우회해도 실행 admission은 receipt를 요구하지만 임의 JS 자체를 안전하게 sandbox하지는 않는다.
실제 Linux x64 / Node v24.19.0에서 CLI child process·SIGINT·SIGKILL·새 process inspect/retry를 검증한다.
Windows용 shell 없는 argv/경로와 Git null-device 처리는 있지만 Windows 실행 증거는 아직 없다.
POSIX signal test는 Windows에서 명시적으로 skip하며 Windows 종료 semantics를 검증했다고 주장하지 않는다.

EXP-03 집중 검증:

```sh
npm run build
node --test dist/workflows/paperExperimentWorkflow.test.js dist/cli/paperExperiment.test.js
```

Synthetic golden fixture는 3 packet / 3 decision / 1 paper fill / 2 Risk rejection을 남긴다. 이는
안전한 backend 연결의 관찰이며 전략 우월성·수익률·실제 시장 적합성 주장이 아니다. 정적 테스트 결정도
기존 schema, static identity/packet hash, semantic/candidate scope와 Risk gate를 통과해야 한다.
검증은 별도 output의 동일 semantic 결과·manifest hash, 비용 변경과 실제 fill cost, HOLD/Risk denial/
no-candidate/provider failure, 시작·완료 recorder fault, receipt 손상, fresh-process 중단·retry를 포함한다.
AI/live hostile env에서도 external process/network 호출 0이며 실제 계좌·broker·외부 AI/source를 실행하지 않는다.


## EXP-04 근거 검토와 반복 비교

```sh
npm run paper:experiment -- review --attempt <returned-attempt-id>
npm run paper:experiment -- review --attempt <returned-attempt-id> --compare-attempt <retry-attempt-id>
```

`review`는 기존 built CLI에서 입력과 고정 allowlist의 evidence만 읽는다. Runner, provider, 외부 AI,
network, Git 조회와 rebuild를 실행하지 않는다. `dist`가 없으면 먼저 `npm run build`로 reader를 준비한다.
원래 입력 파일이나 build receipt가 없어도 보존 evidence를 검토할 수 있다. 현재 reader 코드로
과거 파일을 읽을 수 있다는 뜻이며 과거 execution runtime과 같다는 주장은 아니다.

Public library는 역할을 나눈다.

- [`createPaperExperimentReview`](../../src/reports/paperExperimentReview.ts): read-only JSON projection
- [`renderPaperExperimentReviewMarkdown`](../../src/reports/paperExperimentReview.ts): 한국어 overview와 근거 링크
- [`writePaperExperimentReview`](../../src/reports/paperExperimentReviewOutput.ts): 새 review generation에만 출력
- [`readPaperExperimentReviewEvidence`](../../src/reports/paperExperimentReviewEvidence.ts): strict allowlist reader와 semantic projection

보고서는 질문 → 범위·cutoff·source/coverage → effective policy와 비용 모델 → 각 decision의
packet/decisionHash/dataRefs/Risk/fill/portfolio → HOLD·no-candidate·sampling skip·provider failure →
기존 비용·cashOnly/보조 benchmark·통계 한계 → 다음 질문 순서다. 모든 핵심 수치와 행동은 고정
artifact basename 및 JSON pointer/row로 연결한다. Local absolute path나 source가 제공한 링크를
따라 읽지 않는다. 자유 문자열은 credential/경로 패턴을 가리고 Markdown/HTML을 data로 escape한다.
숫자·비용·benchmark·통계는 기존 report에서 읽고 새 재무·통계 공식이나 AI 요약을 만들지 않는다.
Account/order/execution identifier와 credential의 labeled 값(quoted/JSON-like/case/구분자 변형 포함)은
보고서의 문자열·구조화 key에서 가린다. Authorization/Cookie header는 scheme·여러 cookie 값까지
함께 가린다. 이 표현 단계 redaction은 원본 evidence와 raw semantic 비교에 적용하지 않는다.
Labeled key 문법은 ASCII 문자·숫자와 dot/underscore/hyphen/수평 공백(space/tab)의 단일·반복·혼합
구분자를 지원하며 같은 정규화로 문자열·구조화 key·header를 분류한다. JSON-like quoted key의
Unicode escape 및 중첩 JSON 문자열의 escaped quote도 이 key 분류에만 반영한다. 안전한 source/version
문자열을 통째로 decode하지 않으며, 임의의 unlabeled 민감 정보를 모두 탐지한다고 보장하지 않는다.
별도로 자유 문자열의 standalone 10~20자리 ASCII 숫자는 계좌형으로 보수적으로 가린다. Bare 또는
hyphen/dot/space/tab의 반복·혼합 그룹과 JSON 문자 escape를 포함하며 연속 20자리 초과 숫자의
일부만 가리지 않는다. 구분자로 연결된 stream은 계좌형 값 여러 개가 이어진 경우도 놓치지 않도록
총 20자리 초과여도 전체를 가린다. 따라서 자유 문자열의 긴 숫자 목록도 가려질 수 있다.
완전한 hash/UUID/ISO timestamp, 날짜와 문자에 붙은 identifier는 보존한다. Epoch·큰 금액을 문자열로
쓴 값도 모호하면 가려질 수 있으나 typed numeric 비용·count에는 적용하지 않는다. 계좌 여부를 판정하는
검증기가 아닌 표현 경계의 heuristic이며 원본과 비교용 숫자는 변하지 않는다.
Bare `ord_`/`exec_`(payload 6자 이상), `sk-`/`gh[pousr]_`/`github_pat_`(8자 이상)는 대소문자와
quote/backtick/Markdown underscore wrapper에 관계없이 가린다. JSON으로 표현한 공백·control escape
및 non-alphanumeric ASCII punctuation escape 뒤의 literal prefix도 같은 경계로 처리한다.
Unsafe 실제 control 문자는 공백으로 바꿔 단어와 민감 token을 붙이지 않으며 encoded ASCII
문자·숫자를 구분자로 오인하지 않는다.
Payload는 ASCII 문자·숫자·underscore·hyphen을 포함하며 끝의 구분자도 최소 길이에 포함한다.
`word_ord_...`처럼 underscore로 연결된 known prefix도 가리되 prefix 앞에 ASCII 문자·숫자가
직접 붙은 임의 단어는 known token이라고 추측하지 않는다. JWT 형태는 다른 prefix보다
먼저 전체를 가려 header만 제거하고 payload/signature를 남기지 않는다. 이 알려진 민감 token 분류는
canonical UUID/hash 보존보다 우선한다.
최종 assembled review(비교 ID 포함), 직접 Markdown renderer 입력, CLI review envelope, completion marker와
writer 반환 metadata에서 각각 출력 직전 sanitization을 적용한다. 내부 lookup/semantic 비교는 raw 값을
사용하며 원본 evidence는 변경하지 않는다. 경로 마스킹 예외는 producer가 생성하는 고정 field와 bounded
row pointer만 허용하여 token 모양의 임의 reference field가 그대로 링크가 되지 않게 한다.
JSON pointer의 전체 문서는 RFC 6901의 빈 문자열(`""`)로 가리킨다. `/`는 빈 key를 뜻하므로
root 별칭으로 사용하지 않는다. decisionHash/packetHash와 packet generatedAt은 각각 실제 field를
따로 연결한다. Coverage는 clock/freshness/universe/cutoff를 포함한 전체 normalized input을 참조하고
`parsePaperExperimentInput` 산출임을 `derivation`으로 표시한다. Event 건수도 원본 auditEvents와
`paperExperimentExecutionFacts` 분류를 명시한다. Execution 무결성·입력 적격성·research quality의
파생 상태는 raw storedStatus/runtime/inputHash field와 검증에 사용한 input/inventory/receipt를 구분한다.

### 세 상태를 따로 읽기

- `execution`: 저장 상태, terminal inventory/receipt 무결성, 실패·중단 경계. `completed`는 투자 성공이 아니다
- `inputEligibility`: 보존 input/source의 무결성과 `available_fixture`/`insufficient_data`/`unavailable`
- `researchQuality`: `usable_fixture`/`provider_failure`/`insufficient_data`/`unavailable`. 통계·투자 결론은 항상 판단 불가

Missing/corrupt/hash mismatch, receipt 없는 legacy 저장-only 완료, 변하는 read snapshot은 결과를
완료로 승격하지 않는다. 이때 actions/outcomes/costs/benchmarks/statistics와 provider/no-candidate
건수는 `null`이며 0건이나 성공으로 대체하지 않는다. 읽을 수 있는 개별 파일의 schema 상태와
record count, partial progress를 별도로 표시하지만 전체 이력/완료 증거로 사용하지 않는다.
정책의 `null`은 미사용 설정일 수 있으므로 결과 unavailable과 구분한다.

Provider failure/no-candidate는 고정 실행 receipt의 해당 event를 분류한다. Decision 수 차이로
실패를 추측하지 않는다. Receipt는 기존 runner가 반환한 bounded 운영 events/warnings/sampling을
보존할 뿐 provider 내부 전체 이력은 아니다. `recent*` progress 배열을 전체 이력으로 사용하지 않는다.

### 동일 조건 semantic 비교 v1

비교에는 서로 다른 attempt의 검증된 terminal inventory와 `executionReceiptRequired: true`가 필요하다.
같은 `inputHash`와 backend가 보존한 `runtimeIdentity`의 revision/dependencyLockHash/Node가 모두
일치해야 한다. 입력의 revision 문자열 자기 선언만으로 비교를 허용하지 않는다.

`paper_experiment_semantic.v1`은 full normalized input/preflight와 모든 allowlisted replay payload를
비교하며 아래 field만 제외한다. 포괄적인 timestamp/ID 제거 규칙은 없다.

- manifest 및 metadata/receipt의 nested manifest: `runId`, `batchId`
- metadata: `identity`, `logPaths`, `startedAt`, `updatedAt`, `completedAt`, `failedAt`
- progress: `startedAt`, `updatedAt`, `completedAt`, `failedAt`, `performance`, `finalReportPath`
- report reproducibility: `manifestPath`
- receipt: `runId`; artifactDigests의 `manifest`/`report`는 위 identity/path를 포함한 파생 digest이므로 제외
- attempt lifecycle/lineage와 inventory 자체는 equality payload가 아니다. 비교 전 원본 inventory 검증은 필수다

`simulatedAt`, snapshot의 observedAt/createdAt, generatedAt/cutoff, packet/decision/Risk/trade/record ID,
배열 순서, dataRefs, source/coverage, 모든 정책·비용, audit summary/시각, sampling fingerprint/warnings는
유지한다. Redaction 이전 raw semantic payload를 기존 hash helper로 비교한다. 따라서 출력에서
같이 가려지는 문자열 차이도 비교에서 사라지지 않는다.

결과는 `identical`, `mismatch` 또는 `incomparable`이다. 입력/runtime/완료 무결성 불일치와 같은
attempt의 자기 비교(`DISTINCT_ATTEMPTS_REQUIRED`)는 `incomparable`이다. 다른 조건의 성과 순위나
전략 추천은 제공하지 않는다. `mismatch`는 다른 의미의 최상위 evidence section을 표시한다.
CLI exit 0은 verified review 및 요청한 비교의 `identical`만 뜻한다. 불완전·mismatch·incomparable은
보고서를 남기되 exit 1이다. Provider failure가 기록된 completed execution은 quality 필드도 함께 읽는다.

### 별도 출력과 중단 안전성

```text
<attempt>/review/review-<UUID>/
  review.json
  review.md
  review-complete.json
```

새 generation directory는 exclusive `mkdir`로 할당한다. 각 파일은 같은 directory의 exclusive
`.tmp`를 write/sync한 뒤 rename하고 마지막에 `review-complete.json`을 작성한다. Marker에는 JSON과
Markdown digest가 있다. Marker가 없는 generation은 부분 출력이며 완성 보고서로 읽지 않는다.
Marker는 보고서 파일 발행 완료를 뜻하며 실험 성공을 뜻하지 않는다. 재생성은 새 generation만 만들며
기존 review/input/source/replay/state를 덮어쓰거나 삭제하지 않는다. 실패한 temp/부분 output은 보존한다.
Symlink/hardlink/ancestor/protected-root 경계는 기존 저장 helper를 사용한다. Directory fsync,
power-loss transaction, hostile external writer 차단 또는 공유 runtime locking을 보장하지 않는다.

### 2026-10-02 실제 fixture 실행 기록

Linux x64, Node `v24.19.0`, 코드 `64b7bd8870b080b3efe251478ffa277bf91b8649`에서 빈
`data/paper-experiments/`로 시작했다. 이 SHA는 아래 기록의 실행 코드이며 후속 문서 커밋이나
최종 PR gate의 SHA를 대신하지 않는다. Dependency lock hash는
`sha256:a0426916a74e2fab3a1eb5a2dcd4a6a7f9afdb2b7a40051a2af27fb77498f971`이다.

실제로 실행한 명령:

```sh
npm run paper:experiment -- validate --input src/replay/fixtures/paper-experiment.v1.json
# 위 지원 launcher가 생성한 현재 HEAD/lock/Node/source/dist receipt를 같은 프로세스 환경에서 재검증
node dist/cli/paperExperiment.js run --input src/replay/fixtures/paper-experiment.v1.json
node scripts/paperExperiment.mjs inspect --attempt exp-c68e77bf-339f-4ee8-a005-c471b7ebd758
node scripts/paperExperiment.mjs review --attempt exp-c68e77bf-339f-4ee8-a005-c471b7ebd758
node scripts/paperExperiment.mjs retry --attempt exp-c68e77bf-339f-4ee8-a005-c471b7ebd758
node scripts/paperExperiment.mjs review --attempt exp-c68e77bf-339f-4ee8-a005-c471b7ebd758 --compare-attempt exp-93635079-fbdc-4d68-9028-9a35050f79ea
```

- 최초 attempt: `exp-c68e77bf-339f-4ee8-a005-c471b7ebd758`
- retry attempt: `exp-93635079-fbdc-4d68-9028-9a35050f79ea`
- inputHash: `sha256:4b376fb33a100a05c256ba1613ee9ad55ae0063fb4d0fffe1f2da8fcd7f0ccff`
- 양쪽 semantic hash: `sha256:f55425813af433b4363a610cd1ce7dde011d8cac7d77bc404e424323af8daa3f` (`identical`)
- 두 실행은 3 packet / 3 decision / 1 paper fill / 2 Risk rejection. 기존 비용 합계 80 KRW,
  cashOnly 최종 가상 자산 1,000,000 KRW를 그대로 읽음. 수익성 또는 실제 시장 검증 주장이 아님
- 동일 attempt 자기 비교는 실제 CLI에서 `incomparable`, `DISTINCT_ATTEMPTS_REQUIRED`, exit 1 확인
- 별도 빈 root의 supported-launcher 실행과 cross-root semantic equality는 CLI integration test에서 검증

EXP-04 집중 검증:

```sh
npm run build
node --test dist/reports/paperExperimentReview.test.js dist/cli/paperExperiment.test.js
```

Golden/HOLD/Risk denial/provider failure/no-candidate/sampling skip, input/runtime mismatch,
missing/corrupt/torn/whole-row truncation, schema-valid 값 변조, path aliases, escaping/redaction,
read snapshot 변경, concurrent generation, write/sync/rename fault, 실제 SIGINT/SIGKILL 후 fresh-process
review와 retry를 검사한다. 원본 source/replay/state와 과거 review의 byte 불변성을 검증한다.
최종 aggregate/full·독립/current-head review·필수 GitHub gate는 exact candidate PR 기록을 따른다.
실제 AI/Codex CLI/provider/broker/source network 호출은 없으며 cooperative cancel, 실제 전략·시장·AI
비교, UI/API와 사용자 학습 수용은 아직 검증하지 않았다. 이 slice 뒤 별도 기능을 자동 포함하지 않는다.
