# C2-B — 고정 module 소비 실험 범위

[C2 launcher 계약](child-runtime-launcher-contract.md) §7의 C2-B를 수행한다.
기준은 PR827 `114a1afc8c06fd443da870805b25826f4af5083b`다.
이 문서와 [상세 계약](child-runtime-load-experiment-contract.md),
[검증 기록](child-runtime-load-experiment-validation.md)은 2026-10-13에 새로 작성했다.
과거 미복구 문서 3개를 복원한 것으로 표시하지 않는다.

## 목적

Node v24.19.0/Linux x64의 새 소유 child에서 고정 ESM/CJS/JSON graph를 실행하고,
실제 resolve/load callback, 공급 source digest, 평가 sentinel과 object identity를 대조한다.
snapshot 공급과 default loader의 disk 재읽기를 비교하고, callback이 소비를 증명하지 못하는
cache/hook chain/package metadata/fs asset 반례를 분리한다.

모든 report는 runtime/dependencies/result/comparability=`unavailable`,
completeRuntime/completeConfiguration/completeInput=false다.
`observed`는 고정 합성 assertion의 관측이며 verified runtime, admission 권한 또는 receipt가 아니다.
`counterexample`도 같은 불완전성을 유지한다.

## 포함 범위와 책임

- 고정 CaseId만 받는 test-only harness, 새 임시 root의 fixture 준비 및 소유 child 수명 관리.
- builtin-only bootstrap 뒤 synchronous `registerHooks`, dynamic import와 `createRequire` 소비.
- 첫 ESM/CJS/ESM→CJS/JSON import·require, ESM/CJS 반복 identity와 평가1회.
- JSON 양방향 cache bridge, require A 뒤 ESM load에서 다른 B bytes를 공급해도 A가 반환되는 반례와 fresh B 대조.
- snapshot 뒤 고정 disk 교체, default 재읽기 대조, closure 전 늦은 import와 closure 뒤 신규 거절/cached CJS 접근.
- 늦은 등록, 후등록 short circuit/rewrite/deregister, metadata default 해석과 bootstrap의 실제 fs asset 읽기.
- 고정 resolve mapping/attribute/format/path 거절, byte/event 상한, canonical wire, 실제 transport 실패 및 결정적 lifecycle fault.

## 비범위

production `ops:api`, HTTP/default batch, provider, 실제 거래, 기존 A/B/C1/C2-A와 receipt 발행을 변경하지 않는다.
외부 package/임의 source/path/env/argv/node option을 실행하는 표면을 추가하지 않는다.
test-only dependency seam의 가짜 process 결과를 실제 child 관측으로 보고하지 않는다.

Node executable image·shared library·native/config/build/source 결속은 C2-C,
actual child admission/producer는 C2-D다. hook은 eval/VM/WASM/native/worker/subprocess sandbox가 아니다.
Linux 이외 결과나 skipped actual suite를 Linux 통과로 표시하지 않는다.

## 완료 조건

1. 상세 설계의 신규 독립 검토와 actionable finding 처리.
2. 정확한 복구 바이트를 보존하고 실제 Linux build·관측·fault·상한 시험의 결과/실패를 기록.
3. `git diff --check`, `npm run check:review`, 독립 구현검토.
4. 책임별 Korean Conventional Commit, push, Draft PR 및 게시 HEAD/tree 확인.
5. exact HEAD 자동 Code/Security 검토, 최종 `check:merge` 전체와 현재 보호 조건 확인.

PR826/827은 이 문서 작성 시 미병합이다. stacked PR은 의존 branch로 병합하지 않는다.
선행 PR이 정상 병합된 뒤 main retarget 시 base/diff/검증/review를 다시 확인한다.
CodeOwner 또는 보안/보호 설정을 우회하지 않고 수동 Codex/Actions 중복 요청도 하지 않는다.

작업의 각 단계는 source archive 또는 Git bundle을 별도 경로에서 실제 복원하고 hash/tree를 대조한다.
실패 로그를 덮어쓰거나 assertion/timeout/skip을 완화하지 않는다.
