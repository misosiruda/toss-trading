# C2-C4 검증 기록

구현 checkpoint의 기준은 main `efcdfb8a009543e978a4ff1f91323b50006f7411`,
tree `55a863d143ec03f68ae5f59cacc8fbfecab1ab57`다. 허용 변경은 새 test/fixture7개, scope/validation2개와
launcher 계약 §7 링크로 총10파일이다. 기존 실험, package/lock과 runner를 수정하지 않는다.
이 문서는 각 단계의 당시 결과를 기록하며 최종 현재 HEAD의 gate와 병합 상태는 PR 검증 기록에서 확인한다.

## 사전 설계와 독립 구현 검토

producer 전에 schema와 LF 포함 최대1,376bytes를 독립 검토했다. 첫 diagnostic 뒤 복원 실패가
가려질 수 있는 P2는 artifact/input 복원 상태를 각각 기록하고 root 보존·후속 child 차단으로 수정했다.
후속 설계 검토의 잔여 P1/P2는 없었다.

구현 검토의 P2 세 건은 실제 emit callback의 다른 SourceFile 주입, 실제 output Map의 stale 항목
검사, hook/require 전 immutable compiler A/B의 정확한 크기·digest 검사로 수정했다.
그 수정본과 마지막 EOF 빈 줄만 제거한 후보에서 독립 검토의 잔여 P1/P2는 없었다.
검토된 child SHA256은 `6c426bee46536788ab4caf17405f26bbf68a30897437b15043ea75db5cc0c58e`다.
reviewer는 소스만 읽었으며 실행 결과는 실제 검증 로그로 별도 확인했다.

## 첫 게시 후보의 실제 결과

최초 타입 빌드는 배열 bracket 누락과 optional cache 항목의 타입 좁히기 문제로 각각 실패했다.
두 오류를 수정한 빌드는 통과했다. 2026-10-14 06:25 UTC 첫 Linux focused 실행은 81개 중80개 통과,
1개 실패, skip/cancel0이었다. 7개 ABA, 상한3개, 일반 negative28개와 실제 복원 실패는 통과했다.
실패는 child source의 CRLF가 정확한 type-only import 원문 검사와 맞지 않은 것이었다.
소스를 LF로 정규화했으며 assertion을 완화하지 않았다.

pin 수정 후 06:30:25 UTC check:review는 build·quality·tooling23·affected81을 통과했다.
게시 HEAD `88c64ae18f960e89f7bd5e3becee118ee78aa229`, tree `7e011390198597e8eb7ce98d19c36fc242de46f7`에서도
06:34:49 UTC check:review가 같은 범위로 통과했다. 실패·skip·cancel은 모두0이었다.
06:35:13–06:41:38 UTC check:merge는 build·quality·tooling23과 전체5584개를 실행했다.
전체 결과는5551pass/0fail/33기존skip/0cancel, exit0, 약372.9초다. C2-C4의81개는 skip없이 통과했다.
전후 source SHA256은 `9015b5dfd4975b08954fecdd12be7d6f398a9f3e5022f37aae94e8654b9e7d70`로 동일했다.
이 결과를 이후 수정된 후보의 현재 HEAD 통과로 표시하지 않는다.

첫 Ready 자동 Code/Security는 해당 HEAD에서 완료됐다. Code Review는 주요 계획 문서의 한국어 작성
규칙(P1)과 root identity 검사 후 pathname 기반 재귀 삭제 사이의 교체 경쟁(P2)을 지적했다.
이에 문서 번역과 cleanup 보완을 진행하며, 해당 thread와 최종 후보의 review/full gate를 확인하기 전에는 병합하지 않는다.
수동 Codex/Actions 중복 요청이나 보호조건 변경은 하지 않는다.

## 보존 방식 변경과 새 후보

root identity 확인 뒤 pathname 삭제를 수행하는 P2에 대해 사용자는 자동 삭제 없는 보존을 승인했다.
독립 검토는 상위 지침 충돌 없음과 새 신뢰 전제 불필요를 확인했다. `cleanup_not_performed`는
삭제 요청을 하지 않았다는 상태이며 실제 경로 보존의 보증이나 기존 cleanup 성공이 아니다.
할당40회, 후속 할당 fail-closed 조건, 반복 실행의 용량 누적과 향후 정리 의무를 scope에 동결했다.
기존 lifecycle/wire 상한은 유지하고 삭제 성공 assertion만 승인된 보존 계약의 반례로 바꾼다.
이 변경 후보의 영향·전체 검증과 독립 구현 검토는 별도로 수행하며 이전 HEAD 통과로 대신하지 않는다.

보존 후보 첫 review는 after hook의 diagnostic context 타입 오류로 build에서 실패했다.
후속 review는 복원 상태 fixture에 잘못 들어간 parent cleanup literal로 실패했다. 또한 실제 filesystem
반례의 fake spawn 이벤트가 listener 준비 전에 발생하여 unit process가 대기했다. 정확한 소유 PID와
cwd/executable을 확인한 뒤 그 process만 SIGTERM으로 종료하고 실패 실행·소스·신호 기록을 보존했다.
독립 검토로 두 오류와 실패 manifest의 조기 assertion, 최초 root 관측의 무제한 대기를 수정했다.
manifest는 가능한 모든 root/파일과 읽기 미확인 상태를 먼저 기록한 뒤 개수·완전성을 검사한다.

07:10:08–07:10:32 UTC 수정 후보 check:review는 build·quality·tooling23·affected83을 통과했다.
fail/skip/cancel0, exit0이며 전후 source SHA256은
`4bc7658f1b4aa1cd44a3cb9a20907daa69e92a19645abc5e27851a2b78f1828d`로 동일했다.
실제 harness root40개와 별도 reader/preparation root2개를 남기고 파일 manifest를 기록했다.
실제 디렉터리 교체 반례의 별도 root1개도 남겼다. 다음 최종 HEAD 검증을 이 결과로 대신하지 않는다.

## 보존과 환경

각 실행은 source-before/source-after manifest, 원본 source archive, 명령·안전한 환경,
Node/lock hash, 시각, stdout/stderr와 exit code를 전용 C2-C4 증거 경로에 보존한다.
실패와 미확인 root는 남긴다. 과거 C2-C3 통과를 C2-C4 통과로 대신하지 않는다.

기존 전용 Ubuntu24.04 WSL에서 공식 Node v24.19.0 Linux x64를 사용한다.
가상화·보안 설정, 공유 WSL 수명주기, CMS 배포판과 production process는 변경하지 않는다.
Windows나 미지원 runtime의 skip은 Linux 검증으로 세지 않는다.

검토 checkpoint는 Library `libfile_59a8b6b7fcf48191be0d97160e183bb4` v0으로 저장했다.
39,075,286bytes, SHA256 `a6aed64445227d7c56eec657a586ae5eb7e58c5f33637e744a0e22bd63f63902`다.
공식 prepare_materialize 반환과 공식 helper로 집컴 WSL의 새 소비자 경로에 다시 내려받아 ZIP,
payload64개와 실제 checkout의 Git 파일1543개를 검증했다. HEAD/tree가 일치하며 checkout은 clean이었다.
Windows 원본 파일의 xattr helper는 os.setxattr 미지원으로 실패했고, Library 식별자는 별도 기록했다.
Linux 소비자 다운로드의 공식 helper와 metadata 적용은 성공했다. 과거 Library 대용량 prepared-upload
미완료 backup/ref/checkout과 기존 실패 증거는 계속 보존한다. URL 추정이나 다른 저장 API로 우회하지 않는다.

cleanup 결정 전 checkpoint는 Library `libfile_23f91fabd2dc8191a48ba3c3cbffeab7` v0이다.
28,964,656bytes, SHA256 `8f199ad7b043bb0de2ca5419d847c9797da49432d0ad83370555a1de970fe384`다.
공식 prepare_materialize/helper로 새 소비자 경로에 다시 내려받아 payload56개와 Git 파일1543개,
HEAD `56609afe95094c98c469958f0ecf07d121130904`, tree `afaa9026b39249d611c5429bc4d9b4ac39d45b50`를
검증했고 checkout은 clean이었다. 원본 NTFS 파일 metadata도 WSL의 공식 helper로 적용했다.
이전 전체 gate, 문서 review, 당시 복원 실패 root6개와 소유 Node/npm process0 기록을 함께 보존했다.
