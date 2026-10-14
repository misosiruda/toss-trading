# Child runtime C2 — launcher/load 설계 계약

기준 main `26813e50f6c887f56aa4157e91f21d82658543cb`.
[범위와 완료 기준](child-runtime-launcher-scope.md), [상위 정본](input-runtime-provenance-contract.md),
[C1 v1](child-process-observation-contract.md)을 따른다. 이 문서는 구현 또는 지원 인증이 아니다.
현재 runtime/dependencies/result/comparability unavailable과 세 complete flag=false는 그대로다.

## 1. 현재 경로와 증거 부족

- `package.json`의 `ops:api`는 build 뒤 `dist/cli/localOperationsApi.js`를 실행한다.
  [entry](../../../src/cli/localOperationsApi.ts)는 application을 static import하며
  [loadEnv](../../../src/config/loadEnv.ts)는 `.env`를 읽는다. entry의 본문에 관측 함수를 추가해도
  그보다 앞선 module 평가·환경 효과까지 관측한 것이 아니다.
- default HTTP batch의 child는 현재 같은 Node process의 논리적 replay invocation이다.
  [C1](child-process-observation-contract.md)은 실제 runner가 포착한 scalar와 durable B를 묶지만,
  별도의 깨끗한 OS process, module load coverage 또는 Node executable을 증명하지 않는다.
- [EXP launcher](../../../scripts/paperExperiment.mjs)와
  [build receipt](../../../src/replay/paperExperimentRuntime.ts)는 다른 경로다. 기존 검증 의미는
  보존하며 HTTP C2 receipt로 복사하지 않는다. 같은 lock·source·compiled hash도 actual load 증거는 아니다.

## 2. 위협모형과 trust root

대상은 신뢰된 owner의 paper-only 코드에서 발생할 수 있는 stale build, 잘못된 설치/해석 경로,
사전 module cache, preload, 검사 후 파일 교체, 미지원 설정 및 다른 child로의 잘못된 결속이다.
caller JSON의 `verified`, hash, process 값과 receipt는 권한 있는 발행 근거가 아니다.
악의적 OS 관리자·kernel·Node 자체 또는 검증기를 포함한 모든 자료의 동시 위조를 방어하는 서명
체계가 아니다. 그렇다고 writable package의 검사-소비 사이 변경을 신뢰 가정으로 제외하지 않는다.

검증기는 application 및 외부 dependency load 전에 시작해야 한다. 검증기 자신의 bootstrap bytes,
사용하는 Node built-in, executable과 실행 설정은 별도 명시된 trust root/증거 범위다. application
내부에서 나중에 환경을 지우거나 getter를 읽고 'clean start'라고 표시하지 않는다. 시작 전 preload,
loader, debugger, cache, snapshot/config 또는 native 주입을 배제·검증할 수 없으면 unsupported다.

C2는 코드 sandbox 또는 권한 시스템을 새로 제공하지 않는다. 지원 검증을 위해 권한·OS 설정 변경이
필요하다면 이 문서의 승인으로 실행하지 않으며, 가능한 credential-free 계약·합성 시험을 계속한다.

## 3. 지원 후보와 fail-closed 지원표

첫 합성 검증 후보는 Node `v24.19.0`, Linux `x64`, local regular-file workspace와 mock/deterministic
paper provider다. 이는 현재 개발 시험 후보이며 production 지원이나 모든 Linux filesystem에 대한
보장이 아니다. 실제 Node artifact·linkage·filesystem·startup 설정까지 식별한 검증표를 후속 구현에
붙여야 지원으로 등록할 수 있다. 다른 Node/OS는 기존 replay를 유지하되 C2 완전성은 unavailable이다.

| 경계 | 최초 구현 후보 | 증명 전 또는 범위 밖 처리 |
| --- | --- | --- |
| 시작 | application을 아직 import하지 않은 전용 bootstrap | 기존 장수 API process·test runner·injected runner를 소급 인증하지 않음 |
| module | 검증된 local ESM/CJS/JSON의 actual resolve/load | custom loader chain, hook 교체, 외부 URL/path, symlink/hardlink/alias는 unsupported |
| cache | 시작부터 소유하고 관측한 module cache 재사용만 | 사전 module cache, compile cache/snapshot의 소비 증거 없으면 unsupported |
| code/assets | 명시적 inventory에 결속된 JS/JSON bytes | native addon, WASM, generated code/asset, eval/VM, worker/subprocess는 별도 계약 전 unsupported |
| Node | 실제 실행 artifact와 영향 runtime 설정의 결속 | version/execPath label, 현재 그 경로 hash만 있으면 unavailable |
| provider | mock 또는 통제된 deterministic fixture | 외부 Codex 결정은 기존 비교 unavailable; raw provider 출력 저장 확대 없음 |

package가 loader 밖에서 fs로 읽는 asset과 dynamic import도 검증 대상이다. loader event 수만으로
이런 소비가 없다고 결론내리지 않는다. reachable 코드·dependency의 소비 표면 audit와 이를 강제하는
지원 경계를 함께 검증한다. proof coverage가 불명확하면 목록에 없는 항목을 자동 허용하지 않는다.
새 runtime에서 기존 provider/clock/sampler를 주입받는 경우 그 주입의 구현·state까지 관측한 것으로
취급하지 않는다. 부분 configuration A의 unavailable 사유는 C2가 자동 해제하지 않는다.

## 4. 증명 의무

### source → build

clean tracked source revision, 원본 source bytes, compiler artifact/설정/전이 build dependency,
실제 build 입력과 산출물을 결속한다. build 전후 source/HEAD 동일성만으로 compiler 소비 bytes가
검증된 것은 아니다. isolated build의 실제 입력·도구·출력 증거와 실행할 출력의 연결이 필요하다.
old dist 추가 파일, dirty source, stale 출력, build 도중 변경은 거절한다. document-only Git revision
변화와 실제 runtime 입력 동일성은 별도 근거로 기록하고 hash 값을 이름만 바꿔 재사용하지 않는다.

### lock → 설치 → resolve → load

lock은 의도한 dependency 해석이다. 설치 inventory와 package manifest/exports/conditions, 전이
package, resolved identity, format, 실제 loader에 공급한 bytes를 각각 결속한다. 설치 후 다른 package
내용, 외부 resolution 또는 검사 후 교체가 있으면 기존 digest를 재사용하지 않는다.

검사한 bytes와 소비된 bytes의 동일성이 핵심이다. disk hash 후 default loader가 다시 읽는 방식은
그 사이 race를 닫지 못한다. 고정된 bytes를 loader에 직접 공급하거나 동등한 소비 경계를 증명하는
방식을 독립 검토한다. path·mtime·전후 directory hash의 일치만으로 대체하지 않는다. module
resolution이 읽은 package metadata도 동일 원칙을 적용한다. 첫 load 이후 cache hit는 원래 관측한
bytes 및 cache identity에 결속하고, loader 누락·deregister/교체·unknown resolution은 완전성 실패다.

### 실제 Node와 영향 설정

실제로 실행 중인 executable bytes와 시작부터의 소유권을 증명한다. `process.execPath` 위치의
현재 파일을 hash한 것은 label/경로 관측일 뿐 실행 image의 증거가 아니다. 플랫폼의 실행 image
결속 방식과 교체 race를 검증해야 한다. 외부 shared library, ICU/OpenSSL data 및 native/runtime
asset이 결과에 영향을 준다면 명시적 content/linkage 범위에 포함하고, 관측하지 못하면 unavailable이다.

versioned allowlist는 argv/Node 옵션, timezone/locale, startup config·환경의 결과 영향 요소를
빠짐없이 다룬다. `.env` 자동 load나 unknown options가 있는 경로는 소급 clean으로 만들지 않는다.
민감 env/argv/경로 전체나 개별 secret 추정 hash를 저장하지 않는다. 지원하지 않는 설정은 내용 없는
고정 reason만 남긴다. 실제 값의 존재·absence·default를 구분하고 default 추측으로 빈칸을 채우지 않는다.

## 5. 소유권, 시간 범위와 발행

bootstrap 시작, build/load 관측, actual runner invocation, terminal load closure를 구분한다.
runner 진입에서 닫은 inventory는 이후 lazy load를 포함하지 않는다. 종료 전 새 load가 있으면 해당
invocation의 증거에 반영해야 하며, 감시 중단·한도·관측 실패가 있으면 terminal complete를 발행하지 않는다.
모든 logical child는 자기 invocation 구간과 사용 runtime session에 결속된다. 같은 process와 digest여도
다른 child 또는 이전 session의 receipt는 대체할 수 없다.

첫 지원 구현이 별도 OS process를 선택한다면 parent-created 전용 통신 경로, 실제 process lifecycle,
요청 소유권, reply 검증과 cancellation/종료 정책을 먼저 고정한다. HTTP가 제공한 nonce/UUID 또는
일치하는 label만으로 인증하지 않는다. 현재 B의 module-private context를 JSON으로 직렬화해 같은
발행 권한이라고 간주하지 않는다. cross-process admission binding은 별도 작은 계약/구현 책임이다.

C2의 새 artifact/schema/byte cap/record cap/deadline은 producer를 추가하기 전에 구체적인 strict union과
schema-valid 최대 fixture로 별도 동결한다. 상한 미확정 상태에서 무한 inventory를 기록하지 않는다.
현재 C1의 4,096byte envelope에 load graph를 끼워 넣거나 v1 bytes를 변경하지 않는다.

발행 순서는 다음 의무를 유지한다.

1. 지원 여부·bootstrap 소유권을 application load 전에 확인한다. 불가한 C2가 기존 일반 replay를
   무조건 금지하는 것은 아니다. C2 전용 실행을 선택했을 때 fail-closed할 범위는 후속 진입 계약이 정한다.
2. 실제 child의 initial/source/A/B/C1 기존 durable 순서와 안전 중단을 보존한다. B가 없거나 redacted
   issuer인 child에 C2 identity envelope·파생 ID를 새로 보존하지 않는다.
3. runtime 관측이 진행 중이면 partial 관측일 뿐 terminal completeness가 아니다. 후속 C2 artifact는
   actual durable B/C1 및 자신의 versioned runtime session/closure와 결속한다. caller hash나 현재 파일
   재hash로 과거 결속을 보충하지 않는다.
4. writer의 exclusive write/file sync/close/directory sync/close가 끝나기 전 해당 증거를 durable로
   공개하지 않는다. 실패는 fixed error, 원본/partial/reservation 보존이며 자동 재실행·복구는 없다.
5. terminal 관측의 실패가 실행 후에 발생하면 이미 일어난 paper 작업을 provider0으로 거짓 표시하거나
   accepted202를 소급503으로 바꾸지 않는다. 실패 단계와 실제 실행 상태를 분리한다. 결과 producer는
   그 상태에서 runtime-complete result를 발행할 수 없다.

이 PR과 C2-A는 모두 runtime/dependencies unavailable, completeRuntime/Configuration/Input=false다.
나중에 runtime의 개별 의무가 충족돼도 source/configuration/input/result와 comparability는 각각 별도다.
특히 외부 AI 결정 재현성, initial/source·A의 부분 상태, report 결속을 runtime 증거로 대신하지 않는다.

## 6. 구현 전에 만족할 검증표

아래는 요구되는 미래 시험이다. 현재 실행 또는 통과 기록이 아니다.

| 의무 | positive | negative / 기대 결과 |
| --- | --- | --- |
| 선행 bootstrap | 실제 startup 이후 첫 application load를 관측 | static import 선행, require/import preload, NODE_OPTIONS/config/inspector 주입은 unavailable |
| source/build | 실제 도구·입력 bytes와 같은 출력의 소비 | dirty/stale/extra output, compiler·source·dist 교체는 결속 거절 |
| dependency | ESM/CJS/JSON 및 전이 package actual bytes/해석 결속 | 같은 lock/version에서 package 변조·stale 설치·exports/condition·외부 resolution 변경 거절 |
| race/cache | 공급한 snapshot bytes와 소비 bytes 일치, 관측된 cache hit | hash 이후 파일교체/원복, 사전 cache, compile cache, hook 체인 변경은 거절 |
| 늦은 소비 | runner 이후 dynamic import도 closure에 포함 | missing event, terminal 직전 새 module, 한도 초과·중단 시 complete 없음 |
| Node/settings | 실제 image·native 영향·명시적 설정 근거 | 같은 version의 다른 binary, execPath 교체, unknown 설정/ICU/native asset은 unavailable |
| child 소유권 | 실제 default HTTP의 single/multi logical child와 exact B/C1 | cross-child/session receipt, forged/clone/proxy/getter/JSON 입력은 권한 없음 |
| 발행 | 실제 파일·directory sync 뒤 terminal evidence | write/sync/close/orphan/경합/재시도 실패는 기존 bytes·barrier 보존 |
| 개인정보/호환 | direct/legacy/unsupported에서 기존 실행 의미 유지 | redacted issuer에 새 ID·hash·env/argv/경로·raw 오류 marker0 |

실제 합성 HTTP→default batch→runner→저장 artifact로 확인하며 response spy만 쓰지 않는다.
실패 단계별 provider/tick 횟수를 검증한다. 실행 전 실패는0, terminal 실패는 실제 수행 횟수와 불가
상태를 확인한다. 테스트 성공을 위해 assertion/timeout/skip·보호 조건을 약화하지 않는다.

## 7. 다음 기능 PR 순서

- **C2-A, startup 지원 판정 계약:** pure strict plain-data preflight와 typed unsupported 사유를 만든다.
  허용 descriptor만 다루고 process/env 스캔, launcher 실행, receipt/file 생성은 하지 않는다.
  이 판정은 eligibility이며 verified runtime이 아니다. schema의 입력 trust/상한·presence·unknown key·
  proxy/accessor/serialization hook 검사 및 positive/negative fixture를 먼저 동결하고 독립 검토한다.
- **C2-B, clean-start/소비 bytes 실험:** 격리 합성 fixture에서 startup/resolve/load/cache coverage와
  race를 증명한다. 실제 loader API 선택, ESM/CJS/JSON·metadata 지원표와 한도를 구체화한다.
  production `ops:api`는 바꾸지 않으며 구현이 불가능한 경로는 지원표를 정직하게 좁힌다.
- **C2-C, build/Node/설정 결속:** build 도구를 포함한 실제 입력과 실행 image·native 영향 범위의
  증거를 결속한다. 지원 환경의 positive/negative 없이는 completeRuntime을 발행하지 않는다.
  첫 부분 단위 [C2-C1](child-runtime-executable-experiment-scope.md)은 Linux executable file과 현재 path의 교체 반례만 관측한다.
  memory image/build/native/configuration의 결속과 전체 C2-C 완전성은 후속 의무로 남긴다.
  다음 부분 단위 [C2-C2](child-runtime-compiler-snapshot-scope.md)는 고정 compiler 입력3개와 emit2개를 관측한다.
  compiler artifact의 actual load와 산출물 실행, 전체 build/Node/settings 결속은 이 부분 관측으로 대체하지 않는다.
- **C2-D, actual child producer:** 필요한 lifecycle/IPC·admission 계약과 durable schema를 먼저
  확정한 뒤 default HTTP와 actual child에 연결한다. 기존 C1 호환·부재 경계와 terminal 실패를 검증한다.

각 단위는 별도 scope/완료 기준/책임 commit/검증/독립 검토/자동 검수/보호 gate를 갖는다.
C2의 부분 PR 종료를 전체 완료로 표시하지 않는다. 결과 producer→bounded reader→비교 UI는 이후다.

## 8. 공식 API 참고와 선택 한계

Node v24.19.0의 [module 문서](https://nodejs.org/download/release/v24.19.0/docs/api/module.html#customization-hooks)는
등록 전에 평가되는 static import와 등록 뒤 dynamic import를 구분하며 synchronous/asynchronous
hooks의 적용 범위가 다름을 설명한다. 따라서 API 이름만으로 모든 소비 coverage를 보장하지 않는다.
[CLI 문서](https://nodejs.org/download/release/v24.19.0/docs/api/cli.html#node_optionsoptions)는 startup
NODE_OPTIONS와 config가 실행에 영향을 줄 수 있음을 설명한다. [process 문서](https://nodejs.org/download/release/v24.19.0/docs/api/process.html#processexecpath)의
실행 경로 관측은 이 계약에서 요구하는 실행 image bytes/소유권 proof와 구분한다.
후속 선택은 정확한 API 버전의 실제 합성 측정·위협모형을 함께 검토하며 이 문서는 loader API를 확정하지 않는다.
