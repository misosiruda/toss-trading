# C2-B2: 고정 package metadata snapshot 해석

2026-10-29 후속: [C2-B3 고정 조건부·전이 package metadata 소비](child-runtime-conditional-package-scope.md).
아래 B2 범위·완료 조건·과거 기록은 유지한다.

기준 main `37f738f0177316e69520f18f9011c5fbe3f558b4`.
[상위 계약](child-runtime-launcher-contract.md)의 lock→설치→resolve→load 의무 중,
기존 C2-B `metadata_default`는 metadata 소비를 관측하지 못하는 반례만 제공한다.
C2-C1~C5의 고정 compiler 실험도 이 package 해석 공백을 닫지 않는다.
일반 dependency·Node/native/configuration 결속이나 C2-D보다 앞선 이 작은 경계를 먼저 구현한다.

## 포함 범위와 완료 조건

- 기존 test-only C2-B의 고정 inventory16개, 소유 child 및 bounded reader를 재사용한다.
- package 하나의 canonical JSON `name, exports, type`만 해석한다. 이름은 `c2b-fixture`,
  type은 `module`, exports는 `./original.mjs` 또는 `./replacement.mjs`만 허용한다.
  조건부/배열 exports, 외부·상대 이탈·subpath·query·다른 type 및 unknown/duplicate key는 거절한다.
- bootstrap의 정확한 bare specifier 요청만 해석한다. module hook에서 parent와 attributes를 검증한다.
  snapshot의 immutable string을 JSON parser에 직접 공급하고, 선택한 고정 URL과 module bytes도
  snapshot에서 공급한다. default package resolver의 metadata 재읽기에 의존하지 않는다.
- baseline, snapshot A 후 disk B 교체, 같은 교체 중 metadata 재읽기 B 대조를 실제 child에서 실행한다.
  뒤의 두 경우 모두 disk를 A로 복원한 다음 결과를 공개하여 전후 disk hash만으로 소비를 설명할 수
  없음을 확인한다. 재읽기 대조는 고정 custom resolver 반례이며 Node default resolver의 ABA 관측이 아니다.
- metadata digest→선택 URL ID→공급 module digest→실제 token101/202를 같은 child에서 대조한다.
  거절은 고정 reason만 기록하고 source/path/env/raw error를 wire에 넣지 않는다.
- 과거 `runtime_load_experiment.v1` 문서·보고서·상한과 기존 테스트를 보존한다. 새 사례는 별도
  `runtime_package_metadata_experiment.v1`이며 기존 harness의 parser dispatch만 확장한다.
- 기존 10초 실행, 1초 TERM/KILL/cleanup, bootstrap64KiB, inventory16, 파일4KiB,
  합계32KiB, stdout32KiB/stderr4KiB를 바꾸지 않는다. 새 canonical wire의 최대는 producer 전
  protocol/golden fixture에서 **LF 포함 783bytes**로 동결했다. 상한+1·잘못된 UTF8/field/CaseId/승격을 거절한다.

고정 사례17개 중3개는 baseline/snapshot ABA/reread ABA,12개는 metadata JSON/duplicate/unknown key,
조건부·배열·이탈·query·format·이름 및 parent/attribute/subpath 거절이다.
나머지2개는 복원 실패 시 report0/exit 실패, metadata4097bytes 준비 실패다.
`metadata_parent`는 실제 resolve chain에서 parentURL을 바꾸는 고정 fault이며 별도 caller의 진짜 실행으로
표시하지 않는다. 새 report parser는 각 case의 독립 golden bytes와 정확히 일치하는 경우만 수용한다.

## 미충족 조건과 다음 경계

이번 단위는 고정 flat exports package 하나의 합성 소비 관측이다. npm lock·실제 설치 inventory,
조건부 exports/conditions, 전이 package, asset/fs 소비, hook chain 강제, 전체 cache/closure,
일반 source/build 및 Node memory image/native/configuration 지원은 미충족이다.
다음 dependency 단위는 명시적으로 지원할 조건부/전이 해석과 그 metadata 소비를 먼저 동결해야 한다.
C2-D의 lifecycle/IPC·admission·durable schema, 결과 producer, reader/UI도 아직 미완료다.

모든 report의 runtime/dependencies/result/comparability는 unavailable,
completeRuntime/completeConfiguration/completeInput은 false다. partial 관측을 상위 완료로 올리지 않는다.
production HTTP/provider/Risk/실거래/receipt, package/lock/runner/OS·보호 설정은 변경하지 않는다.

## 검증과 보존

새 Linux actual 사례와 strict protocol negative, 원래 C2-B 전체 회귀를 실행한다.
기존 검증 절차의 review→현재 HEAD Code/Security→전체 merge profile→보호 조건→expected-head
병합을 따른다. 실패·skip은 별도 보존하고 assertion/timeout/skip을 완화하지 않는다.
기존 B harness의 확인된 소유 root 정리만 재사용하며 과거 C2-C5 진단 root·문서·refs를 삭제하지 않는다.
실제 명령·결과는 해당 PR과 외부 검증 기록에 남기며 이 설계 문서를 실행 성공으로 표시하지 않는다.

Node [v24.19.0 synchronous hooks](https://nodejs.org/download/release/v24.19.0/docs/api/module.html#customization-hooks)의
resolve/load shortCircuit를 사용한다. 이 API를 sandbox 또는 일반 Node resolver의 재구현으로 주장하지 않는다.
데이터/schema migration은 없고 test-only 변경을 되돌려 rollback할 수 있다.
