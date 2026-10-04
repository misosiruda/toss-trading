# UX-03 구현 범위와 검증 경계

기준 main `8a33ef4` (PR #801). 최종 검증 head·결과는 PR의 검증 기록에서 확인한다.

## 구현

- 목록의 새 실험은 `/dashboard/experiments/new`로 연결한다. 기존 builder·policy·bucket·상세 경로를 유지한다.
- 세 단계는 built-in riskProfile, 시장 **배분**과 historical replay 조건을 입력받는다. 기간·source·자본은 사용자가 입력하며 기존 PolicyBuilder 고정 config를 재사용하지 않는다.
- 판단 provider는 `dry_run_fixture`다. source 종류는 `unknown`, 가용성은 미검증이며 provider로 추론하지 않는다. 비용·benchmark는 backend가 허용한 기본값만 요청한다.
- `/dashboard/experiments/validate` BFF는 별도 `paper-simulation-validate` intent, 명시적 동일 Origin, JSON object와 32,768-byte streamed body 제한을 적용한다. 읽기 전용 검증에는 mutation token을 전달하지 않는다.
- raw 입력에서 숫자·enum의 typed candidate를 만들 뿐, 날짜·횟수·risk·비용 등 backend 실효값은 계산하지 않는다. 현재 입력 identity와 편집 version에 일치하는 성공 응답만 표시한다.
- 편집 즉시 기존 결과를 무효화하고 요청을 abort한다. version 검사로 취소를 무시한 늦은 응답도 채택하지 않는다. 검증 중 중복 click과 생성 중 click/Enter는 ref guard로 차단한다.
- 확인 화면은 7개 묶음, 중요 차이·제약, 전체 requested/effective/notices의 native details로 구성한다. 새 notice code는 기본 화면에도 표시한다.
- 생성에는 기존 guarded create BFF와 검증한 원본 typed body를 그대로 한 번 사용한다. token은 React 메모리에서 header에만 전달한다.
- sessionStorage에는 raw 입력과 재전송 방지 표식/정확한 접수 ID만 보존한다. token과 검증 성공 자격은 보존하지 않는다. reload는 재검증이 필요하다. 생성 응답 불확실·이탈 후에는 POST를 자동 재전송하지 않는다. ID가 없으면 추측하지 않고 목록으로 안내한다.
- 확실한 400/401/403/409 및 admission-failed 503은 값을 보존하고 재검증을 요구한다. timeout·네트워크·malformed/기타 응답은 불확실 상태다.
- 접수된 `simulationRunId=batchId`는 기존 상세 URL과 GET query에 그대로 사용한다. 상세 projection은 accepted-only unknown, runner failure, missing/invalid/unavailable과 wrapper 실패를 구분하며 child 결과와 batch 관측을 독립 표시한다. 새 조회는 GET만 수행한다.

## 검증

새 브라우저 suite는 `npm --prefix apps/dashboard run test:e2e:experiment-wizard`로 실행한다.
root backend를 build한 뒤 고립된 합성 KR/US snapshot·fixture 판단·실제 기존 runner를 사용한다.
1440×1000 / 1024×900 / 390×844에서 validation 무변경, 요청·실효·manifest 일치, 단일 POST,
정확한 ID 상세, 오류·경합·history/reload, keyboard/axe/overflow를 확인한다.
추적·screenshot은 test 결과 폴더이며 실제 credentials나 시장 데이터는 사용하지 않는다.
기존 dashboard 전체 UI suite와 app lint/unit/type/default build, root 표준 전체 gate도 별도 완료 조건이다.

2026-10-03 노트북 Windows Node 22.15에서는 같은 observation file의 `lstat.dev=0`과
열린 descriptor의 `fstat.dev=3163395652` 불일치가 관측되어 기존 backend reader가
`unavailable`을 반환했다. 이 UI PR은 그 filesystem 보호 검사를 완화하지 않는다.
실제 관측 계약의 integration은 승인된 WSL UID1000·Linux Node24·native `/tmp` filesystem에서
실행하고 노트북의 sandboxed headless Chrome으로 검증한다. Windows에서도 UI가 이 판독 불가를
runner 실패·접수 완료로 바꾸지 않는 점은 유지한다. Linux 결과를 Windows 관측 통과로 보고하지 않는다.

범위 밖: live/외부 유료 AI/provider credential, 새 runner·정규화·관측 저장 계약,
PortfolioPolicy 직접 실행, 선택 비용·benchmark·universe 확장, 취소·재개·자동 retry와 상세 전면 개편.

## 늦은 접수 응답과 최신 사용자 이동

생성 POST를 기다리다가 사용자가 목록으로 이동했지만 목록 Flight가 아직 commit되지 않으면
Wizard의 mount 상태만으로 최신 이동 의도를 판단할 수 없다. 이때 늦게 도착한 유효한 202의
자동 상세 `router.push`가 더 최근의 목록 이동을 덮는 경합을 결정적으로 재현했다.

별도 navigation intent 세대를 생성 시작 시 기록한다. 같은 탭의 다른 목적지 링크 또는
Wizard 경로를 벗어나는 popstate가 발생하면 세대를 증가시키고, 202 처리 마지막에 세대가
같을 때만 자동 상세 이동한다. 정확한 접수 ID·재전송 방지 표식 저장과 token 제거는 유지한다.
링크 click에서 POST를 abort하거나 alive를 미리 해제하지 않는다. 본문 hash, 내부 단계,
modifier click, 새 browsing context 대상과 download는 이탈 의도로 처리하지 않는다.

회귀는 실제 synthetic API/runner의 valid 202와 목록 Flight의 전달 순서를 제어한다.
목록 링크와 Back 두 경로에서 Wizard가 아직 표시되는 동안 응답을 처리하고, 정확한 ID가
저장됐음을 먼저 확인한 뒤 목록 Flight를 해제한다. 정상 목록 전환 후 Back/reload 또는
Forward 복귀에서 같은 ID·빈 token·비활성 생성 버튼·POST 1회를 확인한다. 내부 단계 Back,
본문 skip-link와 실제 Ctrl-click 새 탭은 정상 자동 상세 이동을 과도하게 막지 않는지 확인한다.

보류된 목록 Flight 중 기존 input DOM 값이 즉시 비워져야 한다는 초기 진단 assertion은
최종 회귀 계약에 포함하지 않는다. React transition이 이전 commit의 disabled DOM을 유지한
상태에서도 exact ID의 동기 저장은 먼저 관측될 수 있다. ID 저장과 Wizard 표시를 통해
늦은 응답이 unmount 이전에 처리됐음을 입증하고, 응답 해제·정상 전환·복귀 후 token 제거와
중복 POST 차단을 검증하는 것이 사용자에게 관측 가능한 계약이다. 이 조정은 생성/ID/token
assertion을 없애거나 timeout·worker·retry 조건을 완화한 것이 아니다.

이 수정은 기존 1024px production의 간헐적인 최초 상세 이동 또는 Back/reload 후 상세
재진입 정체와 별도다. 해당 정체는 실제 5초 URL 미반영으로 관측됐고 원인은 아직 확정되지
않았다. 추가 제한 추적의 성공을 해결 증거로 사용하지 않으며, 그 문제의 merge hold는 유지한다.
