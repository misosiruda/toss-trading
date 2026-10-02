# 고정 fixture paper 실험

## 현재 사용 가능한 범위

EXP-01 입력 검증과 EXP-02 격리 저장 library만 구현했다. Runner/CLI/API 연결, 실제 fixture 실행과
한국어 결과 검토는 EXP-03~04의 후속 범위다. `paper:experiment` npm 명령은 아직 없다.
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
관측·결속하는 책임은 EXP-03 adapter에 남아 있다. 이 단계의 고정 test receipt는 실제 실행 증명이 아니다.

```text
<backend root>/<attemptId>/
  experiment-run.json
  input/experiment-input.json
  input/historical-market-snapshots.jsonl
  replay/                    # 처음에는 비어 있음
  review/                    # 후속 review용 예약 경로, 아직 생성/사용하지 않음
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
최종 audit portfolio는 report의 초기/최종 잔고·포지션 요약 및 progress의 full currentPortfolio와도 일치해야 한다.
기존 report의 전체 nested shape도 strict하게 검사하지만 재무·통계 계산을 새로 하지 않는다.
그 다음 input/source, 기존 manifest/metadata/progress/report, 5개 JSONL의 contract/format/record count와
기존 `createReplayResearchHash`의 parsed payload digest를 state의 `artifactInventory`에 기록한다.
기존 manifest의 세부 hash와 실행 options 간 결속 검증은 EXP-03에서 연결한다.

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
- report만 있고 terminal inventory가 없거나 무결성 불일치: `incomplete`
- 기존 attempt에 append/resume/overwrite/삭제 없음. Retry에는 새 identity가 필요함
- 입력을 복원할 수 없는 부모는 retry도 거절. 검증된 새 입력으로 별도 attempt를 준비해야 함
- cancel/resume/자동 retry는 미지원. Ctrl+C/강제 종료를 취소 성공으로 표시하지 않음

오류 출력은 고정 `PaperExperimentStorageError.code`만 노출한다. Filesystem path나 JSON/Zod 원문을
그대로 error message에 포함하지 않는다. Malformed replay JSON/JSONL, schema 위반과 잘못된 UTF-8은
`ARTIFACT_INTEGRITY`이며 실제 filesystem 접근 실패는 `IO_FAILURE`로 구분한다.
실제 path는 backend owner handle에만 별도로 제공한다.

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
검증 기록을 따른다. EXP-03~04나 Trainer/SPOM 최종 AC의 완료 증거로 읽지 않는다.
