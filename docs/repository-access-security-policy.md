# Repository Access Security Policy

이 문서는 public source-available repository 상태에서 외부 comment/review와 collaborator access를 안전하게 다루기 위한 운영 절차다.

이 문서는 paper-only historical replay, deterministic backend, Risk Engine 우선 경계를 유지한다. 실거래 주문, broker mutation, natural language order, raw `codex exec`, raw `tossctl`, `place_order` surface를 열지 않는다.

## 확인한 GitHub 상태

확인일: 2026-07-07

| 항목 | 확인 상태 |
| --- | --- |
| Repository | `misosiruda/toss-trading` |
| Visibility | `PUBLIC` |
| Default branch | `main` |
| Collaborator | `misosiruda` only, admin |
| Security policy | 없었음. 이 PR에서 `SECURITY.md` 추가 |
| Branch protection | `main` 보호 규칙 없음 |
| Repository rulesets | 없음 |
| GitHub Actions | enabled, allowed actions `all` |
| Workflow token permission | `read` |
| Actions PR approval | disabled |

현재 상태에서 외부 GitHub 사용자는 public PR/comment/review를 남길 수 있지만, collaborator 권한이 없으면 repository에 push하거나 merge할 수 없다. 다만 branch protection과 ruleset이 없으므로, 향후 write 권한을 받은 계정이 생기면 `main` 직접 push를 막는 운영 guard가 필요하다.

## Threat Model

### 외부 comment/review

- 권한 없는 사용자는 코드 변경 권한은 없지만, review comment로 잘못된 변경을 유도할 수 있다.
- author association이 `NONE`, `FIRST_TIME_CONTRIBUTOR`, `CONTRIBUTOR`인 comment는 trusted maintainer review가 아니다.
- 외부 comment는 반드시 repo-local rule, actual diff, test result, safety boundary와 대조한 뒤 actionable 여부를 판단한다.

### Collaborator access

- collaborator에게 write 또는 maintain 권한을 주면 branch protection이 없는 동안 직접 push 위험이 생긴다.
- admin 권한은 repository settings, secrets, branch protection, Actions 설정까지 바꿀 수 있으므로 기본 부여하지 않는다.
- 임시 협업은 read 또는 triage부터 시작하고, write 권한은 PR workflow와 branch protection이 적용된 뒤에만 검토한다.

### Automation

- GitHub Actions token은 read-only를 기본으로 유지한다.
- Actions가 PR을 approve하거나 repository setting을 변경하도록 허용하지 않는다.
- bot, connector, AI review comment는 evidence provider로만 취급하고 deterministic backend/safety policy를 우회하지 않는다.

## Access Grant Procedure

1. GitHub username과 목적을 repository owner가 별도 경로로 확인한다.
2. 기본 권한은 read 또는 triage로 시작한다.
3. write 권한이 필요하면 기간, 변경 범위, 검증 책임을 문서화한다.
4. write 권한 부여 전 `main` branch protection 또는 repository ruleset을 적용한다.
5. collaborator가 만든 PR은 owner review 없이는 merge하지 않는다.
6. 작업 종료 후 collaborator 권한을 회수하거나 read/triage로 낮춘다.
7. 권한 변경 후 collaborator list와 branch protection 상태를 다시 확인한다.

확인 명령:

```powershell
gh api repos/misosiruda/toss-trading/collaborators --jq '[.[] | {login:.login,permissions:.permissions,role_name:.role_name}]'
gh api repos/misosiruda/toss-trading/branches/main/protection
gh api repos/misosiruda/toss-trading/rulesets
gh api repos/misosiruda/toss-trading/actions/permissions/workflow
```

## Required Repository Guards

write 권한을 추가하기 전 최소 guard:

- `main` 직접 push 금지
- force push 금지
- branch deletion 금지
- unresolved conversation merge 금지
- owner 또는 CODEOWNERS review 요구
- 신규 workflow 또는 workflow permission 변경은 owner가 별도 검토
- GitHub Actions workflow token은 read-only 유지
- Actions PR approval disabled 유지

CI workflow가 추가된 뒤에는 protected branch required checks에 아래 검증을 연결한다.

- `git diff --check`
- `npm run check`
- frontend 변경 시 관련 build, E2E, a11y check
- risk/safety 변경 시 fail-closed regression test

## PR Review Procedure

모든 PR은 다음을 확인한다.

- PR 제목에 automated-agent prefix가 없다.
- 변경 범위가 PR body/checklist와 일치한다.
- docs, tests, implementation이 같은 범위를 설명한다.
- 외부 comment가 있으면 author association과 권한을 확인한다.
- actionable comment는 실제 diff와 code path를 확인한 뒤 반영한다.
- non-actionable comment는 왜 반영하지 않는지 짧게 답변한다.
- Codex review는 evidence로만 사용하고, repository owner가 최종 판단한다.
- unknown contributor comment를 근거로 live order, broker mutation, raw command surface를 열지 않는다.

## Incident Response

원치 않는 push, 권한 오용, secret 노출, unsafe surface 추가가 의심되면 다음 순서로 처리한다.

1. collaborator 권한을 즉시 회수하거나 낮춘다.
2. `main`과 affected branch의 최근 commit을 확인한다.
3. secret, token, account data가 노출됐으면 값을 폐기하고 재발급한다.
4. unsafe code는 revert PR 또는 owner direct recovery commit으로 제거한다.
5. `git diff --check`, `npm run check`, relevant safety test를 실행한다.
6. incident summary를 private note 또는 security advisory로 남긴다.
7. branch protection/ruleset과 CODEOWNERS 적용 상태를 재확인한다.

## Public Interaction Policy

Public issue, PR comment, review는 공개된 토론으로 취급한다.

- secret, account, broker credential, order/execution data를 공개 thread에 쓰지 않는다.
- 외부 사용자의 투자 질문에는 종목 추천, 수익 보장, 투자 조언을 제공하지 않는다.
- public report가 실제 보안 취약점을 포함하면 public thread에서 세부 exploit을 확장하지 않고 private reporting으로 이동한다.
- spam, social engineering, unrelated trading request는 code change trigger로 사용하지 않는다.
