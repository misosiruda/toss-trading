# C2-C1 — 실행 파일 관측 검증 기록

[범위와 동결 계약](child-runtime-executable-experiment-scope.md)을 따른다.
이 기록은 실행 파일 관측의 부분 증거다. memory image/build/native/configuration 완전성이나 receipt가 아니다.

## 환경과 정확한 소스

- 기준 main: `fdfc8e810621ab64f8222fdd783f38e7ca3da54c`
- 기능·시험 source commit: `bfa1bb2d4e7a4935a3c91316371c9dc2237403db`
- Node v24.19.0 / Linux x64, UID1000, ext4 named volume의 기존 격리 lab.
- Node executable: 125,989,464 bytes;
  SHA256 `bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12`.
- lockfile·dependencies·기존 A/B/C1/C2-A/C2-B·runner 설정은 변경하지 않았다.
- safe defaults는 mock, trading disabled, paper_only, AI decision disabled다.

## 실행 기록

| 실행 | UTC | 결과 |
| --- | --- | --- |
| 최초 check:review | 10:04:05–10:10:02 | build/quality/tooling 통과, 영향 불명확으로 전체 fallback; total5420, pass5386, fail1, skip33, exit1 |
| 수정 뒤 build | 10:16:15–10:16:29 | exit0 |
| 수정 뒤 신규4개 시험 파일 | 10:16:29–10:16:33 | 49 pass, fail0, skip0, cancelled0, exit0 |
| LF 정규화·계약 문서 반영 후 check:review | 10:22:40–10:28:49 | build/quality/tooling 통과, 전체 fallback; total5420, pass5387, fail0, skip33, cancelled0, exit0 |

첫 실패는 새 stdout 경계 fixture의 수치 변환 누락이다. 계약과 assertion은4096/4097 경계였지만
입력에 C2-B의32_768/32_769가 남아 있었다. 입력만4_096/4_097로 바꾸고1byte전 분할 위치도4_095로
맞췄다. 실제 상한·assertion·timeout·기존 시험은 바꾸지 않았다.
당시 source9개 tar와 stdout/stderr, 시작·종료 및 source hash를 별도 보존했다.

첫 실행에서도 실제4개 executable-file 사례와4개 transport 실패 사례는 모두 통과했다.
수정 후49개에는 reader4, lifecycle30, wire6, actual parent1+case8이 포함된다.
실제 reader filesystem 사례는 Linux 지원 경계이며 다른 OS의 skip을 통과로 계산하지 않는다.

수정 후 gate 전후 source snapshot은
`5d5458e0874586c8cc09b04eca77ef66ef2fb0423eb41ea1b9643df69de01b3d`로 동일했다.
그 뒤 새 파일의 CRLF를 git diff --check가 거절하여 원문을 보존하고9개를 LF로 정규화했다.
semantic assertion 변경 없이 위 source commit을 만들었다.
정규화·계약 문서를 포함한 HEAD `aaa632409ceb4d294ca16c38d43ba8c075616b6e`의
check:review는 368.27초에 통과했다. 전후 source snapshot
`68c043c9d58dca83fb3d0e7680b054ab96e1a4f237d62871b82201bff40b5c32`는 동일했다.
이 결과를 추가한 문서 커밋까지 포함한 exact 게시 HEAD에서 최종 full을 실행한다.

## 관측한 반례

- 정상: held fd, self-exe와 현재 path의 file identity·digest가 일치.
- rename replacement: held fd/self-exe A 유지, 현재 path B, deleted link 관측.
- unlink: held fd/self-exe A 유지, 현재 path ENOENT, deleted link 관측.
- 다른 bytes: trailing marker가 붙은 별도 Node 복사본을 실제 실행해 같은 version과 다른 digest 확인.
- 원본 parent Node digest/size/file identity는 전체 actual 사례 전후 동일.
- malformed wire, exit7, stdout4097, stderr4097은 valid report를 발행하지 않고 소유 child의 실제
  close와 root 제거를 확인했다.
- raw path/env/argv/error는 report에 없다. 모든 completeness/status는 unavailable/false를 유지했다.

lifecycle은 fake clock/ChildProcess fault와 actual child 사례를 구분한다.
가짜 fault가 실제 OS timeout/kill 상황까지 증명했다고 표시하지 않는다.
기존33개 skip은 pass가 아니며 새49개는 Linux에서 모두 실행됐다.

## 게시·최종 게이트

현재 source와 문서의 check:review, exact 게시 HEAD의 자동 Code/Security 검토,
최종 check:merge 및 실제 GitHub 병합 상태는 후속 기록과 PR 본문에 연결한다.
이 표의 focused 통과나 이전 main의 full 통과만으로 새 PR 병합을 승인하지 않는다.
실패/불확실 종료를 보존하며 수동 Codex/Actions 중복 요청과 보호 설정 변경은 하지 않는다.
