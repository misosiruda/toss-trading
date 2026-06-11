# PR Review Log

> 각 PR 단위는 merge-ready로 간주하기 전에 3회 검토를 수행합니다. 검토는 `scope/safety`, `tests/validation`, `diff/integration` 순서로 기록합니다.

## PR-00: Repository Baseline

### Review 1: Scope and Safety

- 범위는 repository baseline에 한정합니다.
- runtime code, package manager 설정, MCP server 구현은 포함하지 않습니다.
- `.gitignore`는 `.env`와 local runtime state를 제외하고 `.env.example`은 추적 가능하게 유지합니다.
- `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, read-only-first 문서 경계를 변경하지 않습니다.

### Review 2: Tests and Validation

- `git init` 이후 `git status --short`로 추적 대상 파일을 확인합니다.
- 문서에서 real credential, API key, token 원문이 없는지 검색합니다.
- `.env` 파일이 없는지 확인합니다.

### Review 3: Diff and Integration

- README가 `docs/pr-implementation-plan.md`를 링크하는지 확인합니다.
- baseline commit은 문서와 safe defaults만 포함합니다.
- PR-01에서 TypeScript scaffold를 별도 commit으로 시작할 수 있어야 합니다.

## PR-01: TypeScript Runtime Scaffold

### Review 1: Scope and Safety

- 범위는 TypeScript/Node runtime scaffold에 한정했습니다.
- domain logic, MCP tool, `tossctl` 호출, Codex CLI 호출은 추가하지 않았습니다.
- `src/index.ts`는 safe default metadata만 노출합니다.
- scope 검색에서 `tossctl`, `codex exec`, `place_order`, `TradingSignal`, `TRADING_ENABLED=true`, `AI_DECISION_ENABLED=true`가 `src`, `package.json`, `tsconfig.json`에 없음을 확인했습니다.

### Review 2: Tests and Validation

- `npm install` 성공.
- `npm run build` 성공.
- `npm test` 성공.
- Node built-in test runner로 scaffold safe default test 1개가 통과했습니다.

### Review 3: Diff and Integration

- `package.json`, `package-lock.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`만 runtime scaffold로 추가했습니다.
- `dist/`와 `node_modules/`는 `.gitignore`에 의해 추적되지 않습니다.
- PR-02에서 domain schema를 추가할 수 있는 `src/` 기반이 준비되었습니다.
