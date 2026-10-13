# C2-C1 — 실행 파일 경로 교체 반례 관측

[C2 계약](child-runtime-launcher-contract.md) §7의 Node 의무를 위한 첫 test-only 단위다.
기준 main은 PR828 병합 commit `fdfc8e810621ab64f8222fdd783f38e7ca3da54c`다.
[C2-B](child-runtime-load-experiment-scope.md)의 module 소비 실험과 독립이며 기존 동작을 바꾸지 않는다.

## 목적과 한계

현재 execPath의 bytes, version 문자열, 실행 중인 process가 참조하는 executable file object가
항상 같은 대상을 뜻하지 않음을 실제 Linux의 고정 반례로 확인한다.
`/proc/self/exe`를 열어 얻는 것은 kernel이 연결한 실행 **파일** descriptor다.
wire의 imageBefore/imageAfter는 그 파일 bytes의 관측 이름이며 process memory image,
mapped segment, shared library, native addon, ICU/OpenSSL data 또는 완전한 startup attestation이 아니다.
build 입력·compiler 소비·configuration·native 영향 범위의 결속과 C2-D 발행은 남아 있다.

모든 관측은 runtime/dependencies/result/comparability=unavailable,
completeRuntime/completeConfiguration/completeInput=false다.
관측 hash와 inode 비교는 receipt, caller 권한, runtime 인증 또는 성과 비교 근거가 아니다.

## 입력과 고정 사례

일반 진입점 `runRuntimeExecutableExperiment(caseId: unknown)`은 고정 enum만 받는다.
임의 실행파일/source/path/env/argv/options 입력이나 public HTTP/MCP 표면이 없다.
다른 Node/OS/architecture는 root 생성 전에 unsupported다.
지원 후보는 Node v24.19.0 Linux x64이며 proc 접근이나 실제 관측 실패는 통과/skip으로 바꾸지 않는다.

| CaseId | 실제 수행 | 필수 관측 |
| --- | --- | --- |
| image_matches_path | 소유 root의 Node 복사본 실행 | self-exe descriptor와 현재 path의 file identity·digest 일치 |
| path_replaced | child가 고정 replacement를 자신의 execPath에 rename | 보유 fd와 새 self-exe는 A, 현재 path는 다른 B; 원래 file은 deleted link |
| path_unlinked | child가 자신의 복사본 pathname만 unlink | 보유 fd/self-exe A 유지, 현재 path ENOENT, deleted link |
| same_version_other_bytes | 실행 전 복사본 뒤에 고정 synthetic bytes를 추가하고 실제 실행 | Node version은 같고 원본 reference와 실행 파일 digest는 다름 |
| transport_invalid / transport_exit | 고정 malformed output / exit7 | INVALID_REPORT / EXIT_FAILURE, report 없음 |
| transport_stdout_limit / transport_stderr_limit | 각 4097 bytes 출력 | 해당 byte-limit 실패, report 없음 |

원본 Node를 변경하지 않는다. parent가 새 소유 root에 reference-node와 node를 복사하고,
path_replaced에만 replacement-node를 추가한다. B는 고정 trailing marker를 붙인 합성 ELF 파일이며
악성 코드나 다른 Node 빌드의 동작을 일반화하지 않는다. 실제 새 process에서 같은 version을
확인하는 것은 same_version_other_bytes다. 경로 교체와 삭제는 고정된 순서의 반례이며
임의의 공격적 filesystem race를 막았다는 증명이 아니다.

## 파일 읽기와 bootstrap

일반 경로는 lstat, O_NOFOLLOW, regular/single-link, 열린 fd와 현재 path의 dev/ino/size,
읽는 동안 mtime/ctime/link count 불변을 검사한다.
유일한 의도적 symlink 예외는 literal `/proc/self/exe`다. 이 descriptor는 pathname이 사라진 뒤
link count0도 허용하며, 열린 fd의 file identity와 bytes를 매번 확인한다.
비밀 env/argv/path나 그 추정 hash를 읽어 report에 넣지 않는다.

각 파일은 1MiB chunk, explicit read offset으로 최대128MiB+1 byte를 관측하여 overflow를 거절한다.
크기가 이미 상한을 넘으면 읽기 전에 거절한다. caller 소유 fd의 공유 cursor를 움직이지 않는다.
일반 reader는 파일 관측용 test helper이며 임의 파일을 executable로 승인하는 함수가 아니다.

trusted bootstrap은 고정 child와 reader의 compiled JS2개, package.json이다.
두 JS의 합은65,536 bytes 이하다. reader는 Node built-in만 import한다.
이 trust root 바깥 application/provider는 import하지 않는다.
bootstrap 자체의 source→compiler→output 소비 결속과 Node built-in/native 소비 완전성을 주장하지 않는다.
parent의 환경을 상속하지 않고 TZ=UTC, LANG=C, LC_ALL=C, NODE_DISABLE_COMPILE_CACHE=1만 설정한다.
shell, preload 옵션, .env 로딩, nested worker/subprocess는 추가하지 않는다.

## 동결 상한과 wire

| 항목 | 상한 |
| --- | ---: |
| 실행 파일 한 개 | 134,217,728 bytes |
| 준비된 binary 복사본 | 최대3개, 각 상한 적용 |
| trusted JS bootstrap 합계 | 65,536 bytes |
| stdout / stderr raw bytes | 각각4,096 bytes |
| schema-valid canonical report 최대 | 957 bytes |
| child 실행·stdio close 관측 | monotonic10,000ms |
| TERM grace / KILL 후 관측 / root cleanup 관측 | 각각1,000ms |

report는 strict field set, fixed enum, digest `sha256:`+lowercase hex64, bounded integer,
fatal UTF-8 및 `JSON.stringify(record)+LF`다.
duplicate key, 대체 escape/공백, trailing bytes, 잘린 문서, unknown field와 completeness 승격을 거절한다.
각 case의 equality/difference, nullable path와 deleted-link 상태도 맞아야 한다.
원본 key 순서는 canonical sort하지 않고 parse 후 직렬화와 동일해야 한다.
957byte 최대 fixture와 4096byte transport cap은 별개다.

이 상한은 kernel CPU/RSS quota나 preparation filesystem 작업의 완료 시간 보장이 아니다.
Node 복사와 filesystem 준비가 끝나지 않으면 child를 시작하지 않는다.

## 실패·소유권과 종료

C2-B와 동일한 소유 child lifecycle 원칙을 새 test-only harness에 적용한다.
같은 ChildProcess의 spawn/exit/close를 구분하고 첫 실패를 latch한다.
valid wire만 있거나 kill이 true라는 이유로 성공하지 않는다.
확인된 spawn, 아직 exit/close가 없는 동일 소유 child에만 TERM과 KILL을 각1회 보낸다.
raw PID 또는 process group kill, 다른 앱/프로세스 종료, 자동 재실행은 없다.

종료 미확인은 root를 보존하고 queued case의 새 child를 차단한다.
정리도 처음 root의 directory/non-symlink/dev/ino를 확인한 뒤1회 요청하고 deadline 뒤 늦은
identity 응답으로 삭제를 시작하지 않는다. 실패/미확인 정리는 report를 보류하고 이후 시작을 막는다.
확인된 종료와 root 제거가 모두 있어야 collected다. 가짜 process/clock fault는 unit 증거로 구분한다.

## 비범위·완료 기준

production ops:api/default HTTP/provider/receipt/admission, live broker/order,
기존 A/B/C1/C2-A/C2-B 소스·assertion·timeout·skip·runner 설정을 변경하지 않는다.
source/build/lock/native/library/configuration binding과 전체 C2-C 완료도 포함하지 않는다.

완료에는 다음이 모두 필요하다.

1. 위4개 실제 파일 관측과4개 실제 transport 실패가 정확한 Node/Linux에서 실행됨.
2. canonical wire, 파일 상한·symlink/hardlink·mutation/I/O, lifecycle·cleanup unit 경계 검증.
3. git diff --check, check:review, 독립 current-head Code/Security 검토와 finding 처리.
4. exact candidate의 check:merge 전체, 안전 기본값과 원본 Node 불변, 소유 child 종료 확인.
5. source/evidence 보존과 실제 복원, Draft PR·게시 HEAD 확인, 필수조건 충족 시 정상 main 병합.

기존 skip을 pass로 계산하지 않는다. 실패 로그와 불확실 root는 보존하며 성공을 위해 assertion이나
deadline을 완화하지 않는다. [검증 기록](child-runtime-executable-experiment-validation.md)에 실제 결과를 적는다.

## 공식 근거

Linux [proc_pid_exe(5)](https://man7.org/linux/man-pages/man5/proc_pid_exe.5.html)는 실행 파일을
descriptor로 열 수 있고 unlink 후 deleted 표기가 붙는 동작과 접근 권한 조건을 설명한다.
Node [process.execPath](https://nodejs.org/download/release/v24.19.0/docs/api/process.html#processexecpath)는
실행 시작 pathname 관측이다. 이 자료는 실험 설계 근거이며 실제 시험 통과나 runtime 완전성 인증을 대신하지 않는다.
