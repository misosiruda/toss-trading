# C2-B3: 고정 조건부·전이 package metadata 소비

기준 main `5941bd47de7d4aa56c52b334e73cf56548f5b897`.
[C2-B2](child-runtime-package-metadata-scope.md)는 단일 flat exports의 소비만 관측한다.
다음 선행 의무는 actual conditions 및 전이 parent에 따른 metadata 해석이다.
이번 단위는 두 고정 package의 ESM import graph 하나만 다루며 일반 dependency 설치를 인증하지 않는다.

## 포함 범위와 완료 조건

- 기존 소유 child/builtin-only bootstrap/bounded reader를 재사용한다. 신규 case에서만 inventory의
  네 경로를 고정 leaf package 경로로 치환한다. 과거 50개 C2-B 및 17개 B2 case의 입력은 보존한다.
- root `c2b-fixture` → leaf `c2c-leaf`의 실제 static import를 실행한다. 각 package는 canonical
  `name,exports,type` JSON이고 exports는 `import/default` 두 key의 평면 object만 지원한다.
  key 순서대로 첫 matching condition을 선택하므로 default가 앞서면 default가 선택된다.
- actual resolve context의 conditions를 정렬된 `import,module-sync,node,node-addons` 집합으로 확인한다.
  unknown/missing/duplicate condition은 거절한다. actual parent는 bootstrap→선택 root→선택 leaf만 허용한다.
- 두 metadata의 snapshot 원문을 JSON parser에 직접 공급하고 선택된 module의 snapshot도 load hook에
  직접 공급한다. 각 소비 metadata digest·conditions·parent·selected condition·target·module digest와
  최종 token을 연결한다. load가 끝난 binding만 결과에 넣는다.
- 두 metadata를 A→B→A로 바꾸는 snapshot 및 reread 대조를 실행한다. metadata 재읽기 대조는 고정
  custom resolver의 반례이며 Node default resolver의 ABA 관측으로 주장하지 않는다.
- 잘못된 leaf metadata, 직접 bootstrap→leaf 요청, 다른 package/subpath/attribute,
  conditions chain fault, 복원 실패 및 byte 초과를 실제 child/준비 경계에서 거절한다.
  전이 단계의 거절은 이미 resolve/load한 개수도 기록하여 첫 module까지 실행되지 않았다고 표시하지 않는다.
- 신규 report는 `runtime_conditional_package_experiment.v1` 별도 finite canonical protocol이다.
  producer 전에 성공/거절 golden fixture를 정의하고 최대 **LF 포함 1088bytes**, binding2개로 동결한다.
  기존 wire 상한과 parser 의미는 유지한다. digest/condition/parent/target/순서/개수/complete flag 변조를 거절한다.
- 실행10초, TERM/KILL/cleanup 각1초, bootstrap64KiB, inventory16, 파일4KiB, 합계32KiB,
  stdout32KiB/stderr4KiB 및 첫 실패 보존 정책을 변경하지 않는다. 교체된 두 metadata 추가 버전도 합계에 센다.

고정 case23개는 정상/순서/ABA5개, 거절16개, 복원 실패/4097byte 초과2개다.
조건 집합 fault는 실제 hook chain의 고정 context 주입이며 OS startup 설정이 바뀐 증거는 아니다.
Node의 [조건부 exports 순서](https://nodejs.org/download/release/v24.19.0/docs/api/packages.html#conditional-exports)와
[synchronous hooks](https://nodejs.org/download/release/v24.19.0/docs/api/module.html#customization-hooks)를 따른
좁은 합성 부분집합이다. 일반 Node resolver나 sandbox 구현으로 표시하지 않는다.

## 미충족 조건과 보존

npm lock→실제 설치 identity, nested/subpath/array/사용자 conditions, CJS/require 조건부 해석,
임의 깊이 전이·cycle/cache/late load closure, asset/fs 소비, hook chain 강제는 남는다.
일반 build와 Node image/native/configuration 결속, C2-D IPC/admission/durable schema와 HTTP도 미완료다.
다음 dependency 의무는 이 고정 graph의 lock/설치 의도와 실제 inventory 결속을 별도 범위로 동결하는 것이다.

runtime/dependencies/result/comparability는 unavailable이며 completeRuntime/Configuration/Input은 false다.
production HTTP/provider/Risk/실거래/receipt, package/lock/runner/보호 설정을 변경하지 않는다.
기존 문서·테스트·검증/실패 기록은 보존하고 B2 문서에는 후속 링크만 추가한다.
review profile→현재 HEAD 자동 검수→최종 전체 merge profile→보호 조건→expected-head 병합을 따른다.
실제 검증 결과는 PR과 외부 로그에 남기며 이 범위 문서 자체를 실행 성공으로 취급하지 않는다.
DB/API migration은 없고 이 test-only 변경을 되돌려 rollback할 수 있다.
