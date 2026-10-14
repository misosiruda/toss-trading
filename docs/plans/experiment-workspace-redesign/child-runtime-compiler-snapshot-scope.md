# C2-C2 — 고정 compiler 입력 snapshot과 산출물 관측

[C2 계약](child-runtime-launcher-contract.md) §4 source→build와 §7 C2-C의 다음 부분 단위다.
기준 main은 C2-C1 병합 `2b8cb7abdc012c6b1fca35fd60689bffe1b7289f`다.
[C2-C1](child-runtime-executable-experiment-scope.md)의 실행 파일 관측은 그대로 보존한다.

## 목적과 증거 경계

고정 source 3개의 보존 snapshot을 실제 TypeScript CompilerHost에 공급하고, compiler의
SourceFile과 writeFile 산출물을 같은 관측 세션에 연결한다. 검사 전후 disk 내용이 같아도
그 사이 다시 읽은 B가 compiler에 소비될 수 있는 A→B→A 반례를 함께 남긴다.

대상은 신뢰된 test-only TypeScript 5.9.3 API와 고정 합성 graph다. compiler 자체는 이미
Node가 load한 trust root이며 이 실험이 compiler artifact·전이 dependency의 actual load,
Node memory image·native library·전체 build 설정을 인증하지 않는다. 문자열·hash 관측은
원래 저장소 전체 build의 증명, 실행될 dist의 load 증명, receipt 또는 caller 권한이 아니다.
새 child/worker/VM/eval, HTTP/provider/production build 경로를 추가하지 않는다.

runtime/dependencies/result/comparability=unavailable,
completeRuntime/completeConfiguration/completeInput=false를 모든 성공 관측에서 유지한다.
전체 C2-C와 C2-D는 미완료다.

## 고정 graph와 compiler 정책

- 지원 실측: Node v24.19.0/Linux x64, TypeScript 5.9.3, 기존 격리 local Linux workspace.
- source: entry.ts, value.ts, lib.d.ts 3개. lib는 필요한 기본 global type만 고정 선언한다.
- entry의 유일한 import는 `./value.js`이며 value.ts로 해석한다. package/tsconfig 탐색,
  ambient @types, default library 내용 읽기와 다른 import는 허용하지 않는다.
- virtual compiler root는 고정 식별자다. 실제 host path/env/argv/raw 오류를 report에 넣지 않는다.
- 옵션은 ES2022 ESM, strict, noLib, types=[], noEmitOnError, LF, comments 제거,
  declaration/sourceMap/incremental=false이며 mutable caller options를 받지 않는다.
- getDefaultLibFileName의 고정 이름 조회는 허용한다. TypeScript는 noLib에서도 이를 호출하지만,
  이름 조회만으로 해당 파일을 소비했다고 기록하지 않는다.
- default CompilerHost/ts.sys에 위임하지 않는다. source bytes는 snapshot의 불변 string을
  제공하며 실제 getSourceFile 호출과 반환 SourceFile.text를 확인한다.
- output은 entry.js와 value.js 2개만 허용한다. writeFile의 sourceFiles 연결, UTF-8 bytes,
  중복/추가/누락, BOM과 상한을 확인한 뒤에만 하나의 관측을 만든다. disk output은 생성하지 않는다.
  TypeScript emit의 sourceFiles는 변환 객체이므로 getOriginalNode가 정확한 host SourceFile로
  돌아오는지와 양쪽의 이름·text를 확인한다. 이름/text가 같은 별도 객체는 허용하지 않는다.

일반 진입점은 고정 caseId만 받는다. 내부 CompilerHost fault seam은 신뢰된 unit 시험용이며
public API나 임의 code/path/options 실행 진입점이 아니다.

## 사례와 실패

| 사례 | 필수 결과 |
| --- | --- |
| snapshot_baseline | captured=consumed=restored input, 정확히 output2 |
| snapshot_after_disk_aba | A 보존 뒤 disk B, compiler에는 보존 A를 공급, disk A 복원; baseline과 같은 output |
| reread_during_disk_aba | A 보존 뒤 disk B를 새로 읽어 실제 compile, disk A 복원; before/after는 같아도 consumed/output은 다름 |
| unlisted_import | 고정 graph 밖 module resolution 거절, report 없음 |
| type_error | 실제 compiler diagnostic, emit 성공·report 없음 |
| stale_output | 새 output 집합이 아닌 상태를 compiler 실행 전에 거절 |
| extra_output | 실제 compile 뒤 observer에 추가 write fault 주입 시 전체 관측 거절 |

마지막 두 사례는 output observer의 고정 fault 주입이다. compiler가 실제로 그런 잘못된 output을
자발적으로 생성했다고 주장하지 않는다. SourceFile 누락/변조, unknown read/resolve/write,
중복 emit, 입력·출력 overflow와 compiler throw는 별도 unit fault로 검증한다.

## 동결 상한과 저장 형태

| 항목 | 상한 |
| --- | ---: |
| source 파일 수 / output 파일 수 | 3 / 2 |
| source 한 파일 / 합계 | 16,384 / 49,152 bytes |
| output 한 파일 / 합계 | 16,384 / 32,768 bytes |
| source 제공 요청 / module resolution 요청 | 16 / 8 |
| canonical 관측 JSON / schema-valid 최대 | 2,048 / 908 bytes |

source는 새 소유 temp root의 고정 파일만 읽는다. lstat·O_NOFOLLOW·regular/single-link,
열린 descriptor와 현재 path의 dev/ino/size·mtime/ctime 불변 및 fatal UTF-8을 검사한다.
각 읽기는 고정 buffer의 최대16,385 bytes이고 overflow를 성공으로 축약하지 않는다.
immutable snapshot string을 복사·보존하므로 이후 Map 교체나 disk 변경이 기존 소비 내용을 바꾸지 않는다.
reader의 내부 onOpenedForTest seam으로 같은 내용의 새 inode 교체와 열린 뒤 경로 부재를
정확한 순서에 주입한다. 일반 실험은 이 callback을 받거나 실행하지 않는다.

compiler 입력/출력 inventory digest는 고정 logical id·bytes·content digest의 정렬된 JSON으로
계산한다. options도 고정 데이터로 식별한다. raw source/output/path/env/diagnostic는 report에 없다.
fixed field set·enum·bounded count·canonical JSON을 확인하며 completeness 승격과 모순된 case를 거절한다.
이 cap은 compiler CPU/RSS quota, preparation 또는 cleanup의 OS 완료 시간 보장이 아니다.

## 실패와 소유권

unknown case/runtime는 root 생성 전에 거절한다. 첫 compiler/observer 실패를 유지하고 partial
output을 성공으로 돌려주지 않는다. 실험이 변경하는 것은 자신이 만든 고정 fixture뿐이다.
기존 Node/compiler/package/source/dist는 변경하지 않는다.

root의 directory/non-symlink/dev/ino 동일성을 확인한 뒤 한 번만 정리한다. cleanup 실패나
소유 root 확인 불가 시 보존하고 같은 harness의 후속 실험 시작을 차단한다. raw PID/group kill,
다른 앱 종료, 권한/보안 설정 변경, retry와 기존 worktree 정리는 포함하지 않는다.

## 완료 기준

1. 위3개 실제 compiler 관측과4개 실패 사례를 정확한 Linux/Node/TypeScript에서 확인한다.
2. 공급한 SourceFile.text·emit source 연결·snapshot 불변성·상한·unknown/missing/duplicate와
   fixed failure/cleanup 경계를 시험한다. 출력 문자열의 예상 내용도 독립 assertion으로 확인한다.
3. 기존 A/B/C1/C2-A/C2-B/C2-C1와 dependency/lock/runner/production 동작은 바꾸지 않는다.
4. 현재 소스의 diff check, check:review, 독립 current-head 검토, 최종 check:merge를 통과한다.
5. Draft→최초 Ready 자동 Code/Security 1회와 실제 보호 조건을 확인한 정상 main 병합,
   source/실패·성공 증거의 Library 보존·재다운로드·실제 checkout 복원을 완료한다.

기존 skip은 실제 pass가 아니다. 실패를 보존하고 assertion/timeout/선택 규칙을 약화하지 않는다.

## 근거

TypeScript의 [Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)는
Program, CompilerHost, SourceFile과 writeFile을 통한 입력·출력 경계를 제공한다.
[noLib](https://www.typescriptlang.org/tsconfig/noLib.html)는 default library의 자동 포함을 끄며
필요한 기본 global 선언은 별도로 제공해야 한다. 일반 API 설명을 현재 버전의 실측 대신 사용하지 않는다.
