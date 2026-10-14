# C2-C3 — 고정 compiler artifact 실제 load 관측

기준 main `ab1b446c0c2c7dbce0f03c8a350356c1398d0d20`.
[C2 계약](child-runtime-launcher-contract.md) §4 source→build의 compiler artifact 의무를 좁힌
test-only 부분 단위다. [C2-C2](child-runtime-compiler-snapshot-scope.md)의 이미 load된 compiler
trust root 다음에 진행하며 기존 C2-B/C2-C1/C2-C2 코드는 변경하지 않는다.

## 범위와 한계

새 소유 child의 bootstrap은 Node built-in만 static import한다. TypeScript 5.9.3의 고정
`typescript.js` snapshot을 synchronous registerHooks의 commonjs source로 공급하고,
그 exports의 transpileModule로 고정 TS 한 줄을 실제 변환한다. 산출물은 실행하지 않는다.
이는 C2-C2의 3-file Program 시험과 별도의 load 관측이며 두 실험을 결합한 전체 build 인증이 아니다.

정상 artifact A는 기존 lockfile 설치에서 측정한 9,112,572 bytes,
SHA256 `3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`로 고정한다.
고정 반례 B는 A 뒤에 `module.exports.__c2c3Marker = 202` 한 문장을 추가한 소유 fixture다.
B는 9,112,608 bytes, SHA256 `ee733b7a5349430d9e46a995f815f777cb520421d92a44062f8aecf12ad2dcf3`다.
원래 node_modules/compiler/package/lock은 수정하지 않는다. 이 pin은 서명·공급망 출처 인증이 아니다.

bootstrap·Node executable·built-in/native 구현·OS는 선언된 trust root다. TypeScript의 초기화가
built-in fs/process/env를 사용하는 표면은 loader hook으로 인증하지 않는다. package metadata 해석,
전이 build dependency, compiler의 일반 filesystem asset 소비, arbitrary source/options,
전체 type checking/build 설정, memory image/native library와 production 지원은 범위 밖이다.
runtime/dependencies/result/comparability=unavailable,
completeRuntime/completeConfiguration/completeInput=false를 모든 report에 유지한다.

## 고정 사례

| case | 결과 |
| --- | --- |
| snapshot_baseline | A bytes 공급, 실제 compiler load1, marker0, 고정 변환 결과 |
| snapshot_after_disk_aba | capture A→소유 disk B→snapshot A 공급→disk A 복원; baseline과 같은 결과 |
| reread_during_disk_aba | capture A→소유 disk B를 재읽어 공급→disk A 복원; 전후 disk 같아도 실제 marker202 |
| cache_before_hook | 등록 전 B를 소유 child에서 load한 고정 반례; 사전 cache를 거절 |
| artifact_mismatch | 소유 artifact 내용 변경을 pin 비교에서 거절, compiler 미실행 |
| unlisted_builtin | 고정 fault suffix가 허용 밖 builtin require 오류를 삼켜도 latch된 실패를 유지 |
| unlisted_module | 고정 fault suffix가 추가 local module require 오류를 삼켜도 전체 관측 거절 |

B의 marker는 추가 문장 평가 관측이며 memory image hash가 아니다. B에서도 고정 변환 출력은 같을
수 있으며 출력이 같다는 사실을 artifact 동일성으로 해석하지 않는다. counterexample을 정상 인증으로
사용하지 않는다. 임의 JavaScript/경로/환경/options를 받는 진입점은 추가하지 않는다.

## 공급·해석·상한

- 지원 실측은 Node v24.19.0/Linux x64, TypeScript 5.9.3의 고정 pin과 기존 local Linux volume이다.
- compiler는 고정 file URL 하나로만 resolve하며 기본 package/file resolver로 넘기지 않는다.
- compiler가 요청하는 builtin은 `crypto`, `fs`, `os`, `path`, `perf_hooks` 5개뿐이다.
  각 canonical node: URL의 builtin load만 위임하고 다른 요청·parent·format·attribute는 거절한다.
- load가 공급한 string digest와 크기를 기록하고 compiler export version·실제 변환 결과와 cache
  객체 동일성을 확인한다. compiler load 정확히1, builtin 집합 정확히5를 요구한다.
- resolve+load callback 합계32, artifact 한 번 읽기10 MiB(+overflow 판별1byte), bootstrap64 KiB,
  stdout2,048 bytes, stderr4,096 bytes를 넘으면 실패한다. 무한 inventory를 기록하지 않는다.
- wire는 exact field set·canonical UTF-8 JSON 한 줄이다. 고정 관측/거절 union과 최대 fixture를
  protocol 시험에서 동결한다. 경로/env/argv/raw error/source/output은 wire에 넣지 않는다.
- stable reader는 regular file/single-link/O_NOFOLLOW, opened fd와 path의 dev/ino/size/mtime/ctime,
  fatal UTF-8을 확인한다. hash 후 default loader가 다시 읽는 경로는 정상 증거로 쓰지 않는다.

## 소유권과 실패

C2-B의 소유 child 관측 규칙을 별도 test-only harness에 유지한다. 최소 환경으로 spawn하며
NODE_OPTIONS/preload/compile-cache를 상속하지 않는다. 실행10초, TERM/KILL 각각1초,
정리 관측1초를 늘리지 않는다. signal 요청 성공은 종료 확인이 아니다. 불확실 종료·정리는
소유 root를 보존하고 같은 harness의 다음 할당을 차단한다. raw PID/group kill·다른 앱 종료·
자동 재시도·권한/보안 변경은 없다. 준비/reader/loader 첫 실패와 실패한 소스·로그를 보존한다.

## 완료 기준

1. 세 실제 관측과 네 고정 거절 사례를 지원 runtime에서 실행한다. marker·공급 digest·예상 출력,
   등록 전 cache·unknown module/builtin의 latch를 독립 assertion으로 확인한다.
2. artifact/bootstrapping reader의 실제 링크·교체·UTF-8·상한, canonical report와 소유 lifecycle
   timeout/종료/cleanup 불확실성 경계를 검증한다. 기존 assertion/timeout/skip은 완화하지 않는다.
3. diff check·현재 소스 check:review, 기능 Draft PR→최초 Ready 자동 Code/Security 검토,
   같은 후보 check:merge 전체와 보호 조건을 확인한 정상 병합을 완료한다.
4. 소스·실패/성공 증거를 체크포인트로 보존하고 별도 checkout으로 실제 복원한다. 공식 Library
   보존은 승인된 연결이 가능할 때 업로드·재다운로드를 확인하며, 막혔으면 원본/ref를 유지하고
   그 단계의 미완료를 보고한다. Library 미완료를 engineering 검증 통과로 바꾸지 않는다.

공식 [Node24.19 hooks](https://nodejs.org/download/release/v24.19.0/docs/api/module.html#customization-hooks)의
프로그램 등록 순서와 [TypeScript API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)를
참고하되 API 설명을 현재 artifact의 실제 load 측정 대신 사용하지 않는다.
