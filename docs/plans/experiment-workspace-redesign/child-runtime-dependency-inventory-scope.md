# C2-B4: 고정 dependency 계획과 파일 snapshot 결속

기준 main `6d168f93ca5f7a6cfb66689fe998143fba731322`.
[B3](child-runtime-conditional-package-scope.md)는 실제 조건부·전이 소비를 관측하지만,
그 파일들이 사전에 의도한 dependency inventory인지 대조하지 않는다.
이번 단위는 두 고정 package의 6개 metadata/module snapshot을 독립된 계획과 결속한 뒤 B3의 실제 소비로 연결한다.

## 포함 범위와 완료 조건

- 고정 합성 `c2_dependency_snapshot_plan.v1` JSON에 두 package 이름·file ID와 6개 source digest를 담는다.
  이 계획은 관측된 현재 디스크에서 재생성하지 않는다. producer의 trusted bootstrap에 고정한 계획 digest와
  실제 parser 입력 snapshot digest가 일치해야 한다. 계획과 파일을 함께 바꿔도 계획 anchor를 변경하지 않는다.
- 계획은 LF 포함785bytes이며 trusted digest는
  `sha256:2e7f03d7626bc3932c5174bcc334508b2a50873fd2918f83947492b881398606`이다.
  canonical JSON·정확한 schema·package/file 순서·ID·digest를 확인한다.
- package directory 두 개와 각각의 package.json/original.mjs/replacement.mjs만 허용한다.
  bounded directory enumeration은 root에서 최대3개, package별 최대4개 entry만 읽고 추가 file/package/directory를 거절한다.
  기존 regular-file·symlink/hardlink·ancestor·file size 경계를 그대로 사용한다.
- 선택되지 않은 replacement module도 포함한 6개 snapshot digest를 계획과 대조한다.
  stale metadata/선택 module/비선택 module 및 누락 파일은 actual resolve/load 이전에 거절한다.
- 허용한 동일 snapshot을 실제 B3 resolve/load에 공급하고 root→leaf 실행 token1101을 확인한다.
  계획 A와 leaf module A를 포착한 뒤 disk B로 바꾸는 ABA에서도 snapshot A가 소비됨을 확인한다.
  같은 ABA 중 계획 재읽기는 trusted digest 불일치로 load 전에 거절한다. 두 파일은 A 복원 확인 뒤 report를 발행한다.
- producer 전 신규 finite wire `runtime_dependency_inventory_experiment.v1`을 별도 동결한다.
  최대 **LF 포함1198bytes**, binding2개, verified file6개다. 기존 schema·상한·case 입력은 보존한다.
- 실행10초, TERM/KILL/cleanup 각1초, bootstrap64KiB, inventory16, source4KiB, total32KiB,
  stdout32KiB/stderr4KiB를 유지한다. ABA의 추가 계획/module 버전도 total에 포함한다.
- 계획 변조, 재결속, stale 파일, 미등록 directory entry, 누락/크기 초과, 복원 실패를 실제 소유 fixture에서 검증한다.
  실패는 fixed reason 또는 report 없음으로 남기며 원시 source/path/env/error를 출력하지 않는다.

## 미충족 조건과 증거 한계

계획은 고정 합성 fixture의 trust anchor다. npm package-lock/tarball integrity, 실제 npm 설치 과정,
registry provenance·install scripts 또는 임의 dependency graph의 인증을 구현한 것은 아니다.
다음 설치 의무는 명시적으로 제한한 offline package artifact의 integrity→실제 설치 bytes 결속이다.
directory enumeration은 bounded 초기 관측이다. 이후 filesystem 변경 전체의 원자적 배제나 late-load closure로 승격하지 않는다.
bootstrap/Node가 신뢰 경계이며 임의 사용자 계획을 승인하는 API나 코드 sandbox가 아니다.

runtime/dependencies/result/comparability는 unavailable, completeRuntime/Configuration/Input은 false다.
일반 lock/설치, nested/custom/CJS 조건, 임의 전이·cycle/cache/late closure, asset/fs, hook chain 강제,
일반 build와 Node image/native/configuration, C2-D IPC/admission/durable schema/HTTP는 남는다.
production provider/Risk/실거래/receipt, package/lock/runner/보호 설정은 변경하지 않는다.

## 검증과 보존

기존90개 case의 모든 fixture byte, 이전 문서와 검증·실패 로그·refs·진단 root를 보존한다.
기존 assertion·timeout·skip은 완화하지 않는다. review→현재 HEAD 자동 검수→최종 전체 검증→보호 조건→expected-head 병합을 따른다.
실제 명령·결과는 PR과 외부 로그에 남긴다. 이 문서 자체는 실행 성공이나 C2 전체 완료의 증거가 아니다.
DB/API migration은 없고 test-only 변경을 되돌려 rollback할 수 있다.
