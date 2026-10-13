# C2-B — 고정 module 소비 실험 계약

[범위](child-runtime-load-experiment-scope.md), [상위 계약](child-runtime-launcher-contract.md)을 따른다.
이는 test-only 합성 관측 계약이며 production 지원표 또는 runtime 완전성 인증이 아니다.

## 입력과 시작

`runRuntimeLoadExperiment(caseId: unknown)`의 유일한 일반 입력은 protocol의 고정 CaseId enum이다.
잘못된 입력은 root 생성/spawn 전에 `INVALID_CASE`, 다른 runtime은 `RUNTIME_UNSUPPORTED`다.
임의 source/path/env/argv/실행파일/함수 옵션이 없다. dependency seam은 결정적 unit fault 전용이다.
이를 production API 또는 launcher 권한 표면으로 연결하지 않는다.

하나의 harness는 호출을 직렬화한다. parent는 새 root와 고정 inventory16개를 만들고
exclusive write로 fixture 및 standalone bootstrap을 준비한다. bootstrap은 build 산출물 중 고정 파일만
최대65,536 bytes로 읽고 regular/single-link/dev/inode/크기 검사를 수행한다.
실제 child argv는 내부 bootstrap path와 고정 CaseId다. shell은 사용하지 않고 stdin은 ignore한다.
환경은 `TZ=UTC`, `LANG=C`, `LC_ALL=C`, `NODE_DISABLE_COMPILE_CACHE=1` 네 값만 준다.
부모의 NODE_OPTIONS/NODE_PATH/secret/trading enable 값을 상속하지 않는다.

bootstrap은 built-in만 static import한다. 정상 사례는 application 평가 전에 synchronous
`registerHooks`를 설치하고 이후 dynamic import와 `createRequire`의 require를 실행한다.
createRequire 함수 생성 자체는 평가가 아니며 실제 require를 등록 뒤에 실행한다.
`late_registration`만 고정 반례로 등록 전에 CJS를 평가한다.
새 child/root와 초기 sentinel0은 이 실험의 소유 경계다. ESM cache 전체 열거,
실제 executable image, preload 부재의 외부 인증 또는 OS 설정 완전성을 주장하지 않는다.

## inventory와 resolve/load

고정 ID f01–f16이 entry/leaf ESM·CJS, JSON, late/extra module, asset,
package metadata와 replacement 입력을 가리킨다. wire에는 실제 경로를 넣지 않는다.
각 파일은 local regular/single-link여야 하며 ancestor/root realpath, symlink,
열린 fd와 path의 dev/inode, 크기 및 읽는 동안 mtime/ctime을 검사한다.
이는 고정 실험의 파일 읽기 경계이며 공격적인 OS 전체에 대한 원자적 filesystem sandbox가 아니다.

normal resolver는 parent ID와 specifier의 고정 관계만 허용한다.
unknown mapping, query/fragment, 지원하지 않는 import attributes 또는 format은 거절한다.
Node24.19.0 CJS가 주는 `importAttributes=undefined`는 속성 없음이고 null/primitive/array는 거절이다.
load hook은 snapshot source/format을 `shortCircuit:true`로 직접 공급한다.
기록된 SHA256은 그 callback에서 공급한 고정 bytes의 digest이며 실제 평가의 충분조건이 아니다.

`race_snapshot`은 snapshot 후 leaf를 B로 교체해도 A exports와 평가1회를 확인한다.
`race_default`는 같은 교체 후 `nextLoad`가 공급한 B digest와 실제 B exports를 확인한다.
이 두 사례는 controlled rewrite이며 모든 임의 동시 교체 schedule의 검증이 아니다.

## cache와 coverage 반례

| 사례 | 관측과 판정 |
| --- | --- |
| `esm_first`, `cjs_first`, `esm_cjs_first`, JSON first 둘 | 등록→resolve→load 순서, 실제 A sentinel, 공급 digest |
| `esm_cache`, `cjs_cache` | 같은 object, 평가1회, 두 번째 load callback 부재; ESM resolve 재호출 가능 |
| `json_import_require`, `json_require_import` | 양방향 같은 JSON object. JSON에 JS 평가 counter를 꾸미지 않음 |
| `json_cache_source_b` | require A 뒤 같은 URL의 import hook은 다른 B를 공급하지만 cached A object가 반환됨 |
| `json_fresh_b` | 별도 clean child에서 같은 B 공급이 실제 B 값을 반환함 |
| `late_new` / `closed_new` | closure 전 새 module load 관측 / closure 뒤 새 import는 `LOAD_CLOSED` |
| `closed_cached` | cached CJS는 closure 뒤 callback 없이 같은 object를 반환; sandbox가 아님 |
| `late_registration` | 등록 전 평가를 나중 callback으로 소급 관측하지 못함 |
| `chain_short_circuit`, `chain_rewrite`, `chain_deregister` | 후등록 hook/해제가 관측 누락 또는 공급 뒤 source 교체를 만들 수 있음 |
| `metadata_default` | 고정 package exports를 B로 바꾼 뒤 default resolve/load가 B를 선택하지만 metadata bytes는 load event에 없음 |
| `asset_outside_loader` | bootstrap의 실제 고정 fs 읽기 동안 asset loader event0. fixture 코드의 fs containment 시험은 아님 |

first-load 순서는 resolve index≥0 및 resolve index<load index를 모두 요구한다.
callback 존재만으로 실제 소비를 승인하지 않는다. 모든 observed/counterexample/rejected report는
runtime/dependencies/result/comparability unavailable와 세 complete flag=false를 유지한다.

## 동결 상한과 wire

| 항목 | 상한 |
| --- | ---: |
| unique fixture path | 16 |
| 각 source version | 4,096 bytes |
| initial/replacement의 모든 version 합계 | 32,768 bytes |
| 별도 trusted bootstrap | 65,536 bytes |
| resolve/load event / 고정 observation | 128 / 16 |
| stdout / stderr 수신 raw bytes | 32,768 / 4,096 |
| schema-valid 최대 canonical wire | 21,335 bytes |
| child 실행 및 stdio close 관측 | monotonic 10,000ms |
| TERM grace / KILL 후 관측 / root 정리 관측 | 각 1,000ms |

stdout transport 상한과 schema-valid 최대는 별개다. 전체 canonical record는
`JSON.stringify(report)+LF`, fatal UTF-8 및 정확한 field/enum/shape/CaseId를 요구한다.
parse 후 동일 객체의 JSON 직렬화와 원본 bytes가 같아야 하므로 duplicate key,
대체 escape/공백/다중 문서/trailing log/truncation을 거절한다.
원본 key 순서는 추가 canonical sort를 하지 않으며 parser의 재직렬화와 같은 순서를 요구한다.
load event의 sourceDigest는 `sha256:`와 lowercase hex64만 허용한다.
stderr는 bytes만 세고 보존하지 않으며 원본 source/path/env/argv/error를 report에 넣지 않는다.

source/inventory/total/bootstrap 초과는 parent preparation에서 child 시작 전에 거절한다.
이 시험을 child bounded reader의 overflow branch 실행으로 보고하지 않는다.
이 상한은 OS 전체 CPU/RSS quota가 아니며 preparation filesystem I/O의 완료 시간을 증명하지 않는다.

## child 종료와 정리

성공은 같은 소유 child의 valid report, 실제 close(code0/no signal), 일관된 exit/close,
확인된 root 정리를 모두 요구한다. exit만 받았거나 kill이 true인 상태는 성공이 아니다.
첫 실패 사유를 latch하고 이후 정상 wire가 덮어쓰지 못하게 한다.

spawn event를 확인했고 아직 exit/close가 없는 동일 ChildProcess에만 TERM을 한 번 보낸다.
1,000ms 뒤 같은 소유 조건을 다시 확인해 KILL을 한 번 보내고 1,000ms 더 close를 관측한다.
raw PID/process group kill, 자동 child 재실행, PID 재사용을 가정한 종료는 없다.
종료가 unconfirmed이면 root를 보존하고 harness의 이후 queued 호출은 새 child를 시작하지 않는다.

종료 확인 뒤 cleanup은 root identity 재검사부터 1,000ms 안에서 관측한다.
처음 root와 dev/inode/directory/non-symlink가 같을 때만 remove를 한 번 요청한다.
시간이 지난 identity 응답으로 뒤늦게 삭제를 시작하지 않는다.
이미 요청한 filesystem 삭제의 취소/완료를 가정하지 않고 deadline을 넘으면 unconfirmed로 기록한다.
cleanup 실패/불확실성은 report를 보류하고 이후 child를 중단한다. 이전 transport 실패를 보존한다.
준비 실패도 소유 root의 동일 정리 절차를 거치며 root identity 자체가 불명확하면 보존한다.

일반 transport 거절 뒤 종료와 정리가 모두 확인된 경우 다음 독립 고정 사례를 실행할 수 있다.
가짜 clock/ChildProcess fault는 이 상태기계의 unit 증거이며 실제 Linux child 관측과 구분한다.

## 검증과 참고

검증 순서와 실제 실행 기록은 [검증 문서](child-runtime-load-experiment-validation.md)에 둔다.
Node의 [v24.19.0 synchronous hooks](https://nodejs.org/download/release/v24.19.0/docs/api/module.html#customization-hooks)는
API 선택의 근거다. Node 문서나 과거 정적 검토로 actual fixture 통과를 대체하지 않는다.
