"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type {
  ExperimentListPageData,
  ExperimentListRow,
  ExperimentListView,
  ExperimentListWarning
} from "@/lib/dashboardViewModels";
import styles from "./ExperimentList.module.css";

const STATUS_OPTIONS = [
  ["all", "상태 전체"],
  ["running", "진행 중"],
  ["completed", "완료"],
  ["partial", "부분 실패"],
  ["failed", "실패"],
  ["skipped", "건너뜀"]
] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number][0];
type IconName = "experiment" | "policy" | "compare" | "data" | "settings" | "search" | "arrow" | "menu";

const STATUS_LABELS: Record<ExperimentListRow["status"], string> = {
  running: "진행 중",
  completed: "완료",
  completed_with_failures: "부분 실패",
  failed: "실패",
  skipped: "건너뜀"
};

const WARNING_LABELS: Record<ExperimentListWarning["code"], string> = {
  batch_metadata_invalid: "batch 메타데이터 확인 필요",
  batch_status_unknown: "batch 상태 미확인",
  aggregate_status_unknown: "집계 파일 상태 미확인",
  active_progress_status_unknown: "진행 기록 상태 미확인",
  row_invalid: "형식이 맞지 않는 행 제외",
  row_status_unknown: "상태가 확인되지 않은 행 제외",
  row_batch_mismatch: "선택 batch와 다른 행 제외",
  row_duplicate: "중복 행 제외",
  row_metadata_invalid: "행 메타데이터 일부 미확인",
  unbound_rows: "batch 연결이 확인되지 않은 저장 행",
  active_run_invalid: "진행 중 실행 정보 확인 필요",
  active_run_unbound: "진행 중 실행의 batch 연결 미확인",
  active_run_inconsistent: "진행 중 실행 정보 불일치",
  active_run_terminal_duplicate: "진행 기록보다 종료 기록 우선 표시",
  status_counts_unknown: "원본 상태 집계 일부 미확인",
  corrupt_lines: "손상된 JSONL 줄"
};

const SOURCE_LABELS: Record<ExperimentListView["endpointStatus"], string> = {
  ok: "정상",
  running: "실행 중",
  missing: "소스 없음",
  blocked: "소스 차단",
  degraded: "일부 기록만 사용"
};

function normalizeStatus(value: string | null): StatusFilter {
  return STATUS_OPTIONS.find(([key]) => key === value)?.[0] ?? "all";
}

function normalizedQuery(value: string | null): string {
  return (value ?? "").trim().slice(0, 200);
}

function filterKey(query: string, status: StatusFilter): string {
  return JSON.stringify([query, status]);
}

function readBrowserFilters() {
  const url = new URL(window.location.href);
  const query = normalizedQuery(url.searchParams.get("q"));
  const status = normalizeStatus(url.searchParams.get("status"));
  return { query, status, key: filterKey(query, status) };
}

function writeFilters(query: string, status: StatusFilter, replace = false) {
  const url = new URL(window.location.href);
  if (url.pathname !== "/dashboard") return;
  const cleanQuery = normalizedQuery(query);
  url.searchParams.delete("q");
  url.searchParams.delete("status");
  if (cleanQuery) url.searchParams.set("q", cleanQuery);
  if (status !== "all") url.searchParams.set("status", status);
  const target = `${url.pathname}${url.search}${url.hash}`;
  if (target === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  // Native history keeps this loaded data snapshot and the current scroll position.
  if (replace) window.history.replaceState(null, "", target);
  else window.history.pushState(null, "", target);
}

export function ExperimentList({ pageData }: { pageData: ExperimentListPageData }) {
  const searchParams = useSearchParams();
  const query = normalizedQuery(searchParams.get("q"));
  const status = normalizeStatus(searchParams.get("status"));
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const synchronizedFilters = useRef(filterKey(query, status));
  const draftUrlKey = useRef<string | null>(null);
  const [filtersReady, setFiltersReady] = useState(false);
  const source = pageData.experimentList;
  const data = source.status === "ok" ? source.data : null;
  const rows = data?.rows.filter((row) => {
    const matchesStatus = status === "all" || row.status === (status === "partial" ? "completed_with_failures" : status);
    return matchesStatus && row.runId.toLowerCase().includes(query.toLowerCase());
  }) ?? [];

  useEffect(() => {
    // A deferred render effect must never write its captured URL over a newer
    // selection or browser Back/Forward entry. Read the browser at execution.
    if (window.location.pathname !== "/dashboard") return;
    const current = readBrowserFilters();
    const staleDraft = draftUrlKey.current !== null && draftUrlKey.current !== current.key;
    if (synchronizedFilters.current !== current.key || staleDraft) {
      // A draft typed after this history entry became current belongs to this
      // entry, even if its synchronization effect has not run yet.
      if (draftUrlKey.current !== current.key) {
        if (inputRef.current && inputRef.current.value !== current.query) inputRef.current.value = current.query;
        draftUrlKey.current = null;
      }
      if (selectRef.current && selectRef.current.value !== current.status) selectRef.current.value = current.status;
      synchronizedFilters.current = current.key;
    }
    writeFilters(current.query, current.status, true);
    // SSR controls must remain disabled until their handlers and initial URL
    // synchronization are committed, so early native input cannot be lost.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFiltersReady(true);
  }, [query, status, searchParams]);

  useEffect(() => {
    function restoreNativeHistory(event: PopStateEvent) {
      if (event.state !== null || window.location.pathname !== "/dashboard") return;
      // Native fragment entries have null history state. Their traversal can
      // change filters without changing the hash, which Next's popstate handler
      // ignores. Its public History API integration restores useSearchParams
      // from this exact URL while retaining the loaded snapshot and entry.
      window.history.replaceState(null, "", window.location.href);
    }
    function restoreFragmentFocus() {
      if (window.location.pathname !== "/dashboard") return;
      const hash = window.location.hash;
      if (hash === "#experiment-source-summary" || hash === "#experiment-query") {
        document.getElementById(hash.slice(1))?.focus({ preventScroll: false });
      }
    }
    window.addEventListener("popstate", restoreNativeHistory);
    window.addEventListener("hashchange", restoreFragmentFocus);
    return () => {
      window.removeEventListener("popstate", restoreNativeHistory);
      window.removeEventListener("hashchange", restoreFragmentFocus);
    };
  }, []);

  function commitFilters(nextQuery: string, nextStatus: StatusFilter) {
    if (window.location.pathname !== "/dashboard") return false;
    const cleanQuery = normalizedQuery(nextQuery);
    if (inputRef.current && inputRef.current.value !== cleanQuery) inputRef.current.value = cleanQuery;
    if (selectRef.current && selectRef.current.value !== nextStatus) selectRef.current.value = nextStatus;
    // Commit local intent synchronously so a later effect cannot erase a draft
    // typed after this event but before React processes the URL update.
    synchronizedFilters.current = filterKey(cleanQuery, nextStatus);
    draftUrlKey.current = null;
    writeFilters(cleanQuery, nextStatus);
    return true;
  }

  function currentInputQuery(current: ReturnType<typeof readBrowserFilters>): string {
    const staleDraft = draftUrlKey.current !== null && draftUrlKey.current !== current.key;
    const pendingHistory = synchronizedFilters.current !== current.key;
    if (staleDraft || (pendingHistory && draftUrlKey.current !== current.key)) return current.query;
    return inputRef.current?.value ?? current.query;
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = readBrowserFilters();
    // Enter submits the query, not an unseen stale select from an older entry.
    const nextStatus = synchronizedFilters.current === current.key
      ? normalizeStatus(selectRef.current?.value ?? current.status)
      : current.status;
    commitFilters(currentInputQuery(current), nextStatus);
  }

  function applyStatusFilter(nextStatus: StatusFilter) {
    const current = readBrowserFilters();
    // A status choice must not also restore a stale query after Back/Forward.
    commitFilters(currentInputQuery(current), nextStatus);
  }

  function clearFilters() {
    if (commitFilters("", "all")) inputRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className={styles.workspace}>
      <a className={styles.skipLink} href="#experiments-main">본문으로 건너뛰기</a>
      <WorkspaceNavigation />
      <main className={styles.main} id="experiments-main" tabIndex={-1}>
        <header className={styles.pageHeader}>
          <div className={styles.titleGroup}>
            <h1>실험</h1>
            <p className={styles.sourceLabel}>API가 선택한 batch / 최신 여부 미확인</p>
          </div>
          <div className={styles.actionGroup}>
            <Link className={styles.primaryAction} href="/dashboard/lab/policies">기존 실행 설정<Icon name="arrow" /></Link>
            <p>현재 builder: 고정 balanced 설정 + policy hash seed<br />PortfolioPolicy 실행은 지원하지 않음</p>
          </div>
        </header>

        {data ? <SourceSummary data={data} fetchedAt={pageData.fetchedAt} /> : (
          <section className={styles.sourceNotice} aria-label="조회 상태">
            <strong>{source.status === "offline" ? "API에 연결할 수 없어요" : "API 응답을 확인할 수 없어요"}</strong>
            <p>{source.status === "offline" ? "조회가 오프라인 상태예요. 저장된 실험 유무와 개수는 확인되지 않았어요." : "응답이 실험 목록 계약과 맞지 않아 표시하지 않았어요. 저장된 실험 유무와 개수는 확인되지 않았어요."}</p>
            <ObservationTimes fetchedAt={pageData.fetchedAt} batchUpdatedAt={null} />
          </section>
        )}

        <section className={styles.listSection} aria-label="실험 목록" data-testid="experiment-list">
          <form className={styles.filters} onSubmit={applyFilters} role="search" aria-label="불러온 실험 필터" aria-busy={!filtersReady}>
            <div className={styles.searchGroup}>
              <label className={styles.srOnly} htmlFor="experiment-query">실험 ID 검색</label>
              <Icon name="search" />
              <input disabled={!filtersReady} ref={inputRef} id="experiment-query" name="q" type="search" onInput={() => { if (window.location.pathname === "/dashboard") draftUrlKey.current = readBrowserFilters().key; }} placeholder="실험 ID로 검색" defaultValue={query} maxLength={200} autoComplete="off" aria-describedby="filter-scope" />
            </div>
            <label className={styles.srOnly} htmlFor="experiment-status">실험 상태</label>
            <select disabled={!filtersReady} ref={selectRef} id="experiment-status" name="status" defaultValue={status} onChange={(event) => applyStatusFilter(normalizeStatus(event.currentTarget.value))}>
              {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button disabled={!filtersReady} className={styles.searchButton} type="submit">검색</button>
            <button disabled={!filtersReady} className={styles.clearButton} type="button" onClick={clearFilters}>초기화</button>
          </form>
          <div className={styles.listMeta}>
            <p aria-live="polite" aria-atomic="true">{data ? <>표시 <strong>{rows.length}</strong>개 <span>/ 불러온 개별 실행 {data.rows.length}개</span></> : "실험 개수 미확인"}</p>
            <p id="filter-scope">검색과 상태 필터는 불러온 행에만 적용돼요</p>
          </div>

          {rows.length > 0 ? <ExperimentTable rows={rows} /> : (
            <div className={styles.emptyState}>
              <Icon name="experiment" />
              <h2>{!data ? "실험 목록을 불러오지 못했어요" : query || status !== "all" ? "조건에 맞는 실험이 없어요" : "표시할 실험 기록이 없어요"}</h2>
              <p>{!data ? "위 조회 상태를 확인해 주세요. API 연결 후 페이지를 다시 열어 조회할 수 있어요." : query || status !== "all" ? "검색어와 상태를 바꾸거나 필터를 초기화해 주세요." : "이 API 응답에서 표시 가능한 개별 실행을 찾지 못했어요. 전체 기록이 없다는 뜻은 아니에요."}</p>
              {data && (query || status !== "all") ? <button disabled={!filtersReady} className={styles.secondaryAction} onClick={clearFilters}>필터 초기화</button> : null}
            </div>
          )}
          <div className={styles.tableFooter}>
            <span>원본 저장 행은 최대 100개를 요청해요</span>
            <span>자동 갱신 없음 · 페이지를 다시 열어 재조회</span>
          </div>
        </section>
        {data ? <SourceDetails data={data} /> : null}
        <footer className={styles.pageFooter}>paper-only · 실거래 주문과 연결되지 않아요</footer>
      </main>
    </div>
  );
}

function WorkspaceNavigation() {
  const mobileMenuRef = useRef<HTMLDetailsElement>(null);
  const mobileSummaryRef = useRef<HTMLElement>(null);

  function closeMenuOnEscape(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape" || !mobileMenuRef.current?.open) return;
    event.preventDefault();
    event.stopPropagation();
    mobileMenuRef.current.open = false;
    mobileSummaryRef.current?.focus({ preventScroll: true });
  }

  function closeMenuOnFocusLeave(event: FocusEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      // Preserve the browser's next focus target instead of covering it with this overlay.
      event.currentTarget.open = false;
    }
  }

  function closeMenuOnNavigation(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || !event.currentTarget.contains(link)) return;
    if (mobileMenuRef.current) mobileMenuRef.current.open = false;
    const destination = new URL(link.href);
    if (destination.origin === window.location.origin && destination.pathname === window.location.pathname) {
      // Same-page navigation can preserve this component; do not leave focus in the closed menu.
      document.getElementById("experiments-main")?.focus({ preventScroll: true });
    }
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>toss-trading<span>paper-only</span></div>
      <nav className={styles.desktopNavigation} aria-label="주 메뉴"><PrimaryLinks /></nav>
      <details ref={mobileMenuRef} className={styles.mobileNavigation} onKeyDown={closeMenuOnEscape} onBlur={closeMenuOnFocusLeave}>
        <summary ref={mobileSummaryRef}><Icon name="menu" /><span>메뉴</span></summary>
        <nav aria-label="모바일 주 메뉴" onClick={closeMenuOnNavigation}><PrimaryLinks /><OperationsLinks /></nav>
      </details>
      <div className={styles.sidebarBottom}><OperationsLinks /></div>
    </aside>
  );
}

function PrimaryLinks() {
  return <>
    <Link className={`${styles.navLink} ${styles.navCurrent}`} href="/dashboard" aria-current="page"><Icon name="experiment" /><span>실험</span></Link>
    <Link className={styles.navLink} href="/dashboard/lab/policies"><Icon name="policy" /><span>전략·정책</span></Link>
    <a className={styles.navLink} href="/dashboard/validation#candidate-comparison"><Icon name="compare" /><span>비교<small>현재 검증 보고서</small></span></a>
    <a className={styles.navLink} href="/dashboard/validation#data-universe-coverage"><Icon name="data" /><span>데이터<small>현재 검증 보고서</small></span></a>
  </>;
}

function OperationsLinks() {
  return <details className={styles.operationsMenu}>
    <summary><Icon name="settings" /><span>설정·운영</span></summary>
    <div className={styles.operationsLinks}>
      {/* Keep this compatibility destination a document navigation after report/Back traversal. */}
      <a href="/dashboard/operations">기존 운영 요약</a>
      <Link href="/dashboard/portfolio">포트폴리오</Link>
      <Link href="/dashboard/lab/strategy-tests">전략 테스트</Link>
      <Link href="/dashboard/risk-gate">Risk Gate</Link>
      <Link href="/dashboard/audit">감사 기록</Link>
      <Link href="/dashboard/live-readiness">Live Readiness</Link>
      <Link href="/dashboard/component-catalog">컴포넌트</Link>
    </div>
  </details>;
}

function SourceSummary({ data, fetchedAt }: { data: ExperimentListView; fetchedAt: string }) {
  const notes: string[] = [];
  if (data.endpointStatus === "missing") notes.push("소스 없음: 선택된 batch 기록을 확인할 수 없어요");
  if (data.endpointStatus === "blocked") notes.push("소스 차단: 접근 가능한 기록만 표시해요");
  if (data.endpointStatus === "degraded") notes.push("소스 저하: 일부 기록만 사용할 수 있어요");
  if (!data.batchId) notes.push("batch 미확인: 저장 행과 batch의 연결을 확정할 수 없어요");
  if (data.corruptLineCount > 0) notes.push(`JSONL ${data.corruptLineCount}줄 손상`);
  if (data.excludedRowCount > 0) notes.push(`표시 제외 ${data.excludedRowCount}행`);
  if (data.aggregateStatus === "corrupt") notes.push("집계 파일 손상");
  if (data.activeRunProgressStatus === "corrupt") notes.push("진행 기록 손상");
  if (notes.length === 0 && data.warnings.length > 0) notes.push("일부 기록의 연결 또는 메타데이터를 확인해야 해요");

  return <section className={styles.sourceSummary} aria-label="실험 데이터 출처">
    <ObservationTimes fetchedAt={fetchedAt} batchUpdatedAt={data.batchUpdatedAt} showDetailsLink />
    {notes.length ? <p className={styles.compactWarning}><strong>기록 확인</strong><span>{notes.join(" · ")}</span></p> : null}
    <div className={styles.sourceCounts}>
      <p data-testid="source-raw-counts">원본 응답 {data.count}개 / <strong>전체 {data.totalCount}개</strong></p>
      <p data-testid="source-projected-counts"><strong>저장 결과 {data.projectedTerminalCount}개</strong> · 진행 중 {data.projectedActiveCount}개</p>
    </div>
    <p className={styles.snapshotNotice}>진행 중은 저장 상태이며, 현재 실행 여부는 미확인</p>
  </section>;
}

function ObservationTimes({ fetchedAt, batchUpdatedAt, showDetailsLink = false }: { fetchedAt: string; batchUpdatedAt: string | null; showDetailsLink?: boolean }) {
  return <div className={styles.observationTimes} role="group" aria-label="조회와 저장 갱신 시각">
    <p data-testid="source-fetched-at"><span>조회 시각 (UTC)</span><time dateTime={fetchedAt}>{timestamp(fetchedAt)}</time></p>
    <p data-testid="source-updated-at"><span>저장 갱신 (UTC)</span>{batchUpdatedAt ? <time dateTime={batchUpdatedAt}>{timestamp(batchUpdatedAt)}</time> : <span>미확인</span>}</p>
    {showDetailsLink ? <a className={styles.sourceJump} href="#experiment-source-summary" onClick={(event) => focusFragment(event, "experiment-source-summary")}>조회 정보<Icon name="arrow" /></a> : null}
  </div>;
}

function SourceDetails({ data }: { data: ExperimentListView }) {
  return <details className={styles.diagnostics} aria-label="실험 조회 상세" data-testid="experiment-source-details">
      <summary id="experiment-source-summary">조회 정보와 기록 상태</summary>
      <div className={styles.diagnosticBody}>
        <div className={styles.batchLine}><span>선택 batch</span><strong>{data.batchId ?? "미확인"}</strong></div>
        <p className={styles.batchMetadata}>저장된 batch 설정 · 위험 프로필 {data.riskProfile ?? "미확인"} · 판단 제공자 {data.decisionProviderMode ?? "미확인"}</p>
        <dl>
          <Diagnostic label="원본 저장 행" value={`응답 ${data.count}개 / 전체 ${data.totalCount}개 · 요청 한도 100`} />
          <Diagnostic label="표시 가능한 개별 실행" value={`저장 결과 ${data.projectedTerminalCount}개 · 진행 중 ${data.projectedActiveCount}개`} />
          <Diagnostic label="API 소스 상태" value={`${data.endpointStatus} · ${SOURCE_LABELS[data.endpointStatus]}`} />
          <Diagnostic label="선택 batch 상태" value={data.batchStatus ?? "미확인"} />
          <Diagnostic label="집계 파일 읽기" value={data.aggregateStatus ?? "미확인"} />
          <Diagnostic label="진행 기록 읽기" value={data.activeRunProgressStatus ?? "미확인"} />
          <Diagnostic label="batch 요청 실행 수" value={number(data.requestedRunCount)} />
          <Diagnostic label="manifest 집계" value={`완료 ${number(data.manifestCounts.completed)} · 실패 ${number(data.manifestCounts.failed)} · 건너뜀 ${number(data.manifestCounts.skipped)}`} />
          <Diagnostic label="원본 저장 상태 집계" value={Object.entries(STATUS_LABELS).filter(([key]) => key !== "running").map(([key, label]) => `${label} ${number(data.statusCounts[key as keyof typeof data.statusCounts] ?? null)}`).join(" · ")} />
          <Diagnostic label="알 수 없는 원본 상태 수" value={number(data.unknownStatusCount)} />
          <Diagnostic label="JSONL 손상 줄" value={number(data.corruptLineCount)} />
        </dl>
        {data.warnings.length ? <ul>{data.warnings.map((warning) => <li key={warning.code}>{WARNING_LABELS[warning.code]} · {warning.count}건</li>)}</ul> : null}
        <p>원본 행 수, manifest 집계, 표시 개별 실행 수는 서로 다른 기준이에요. 종료 기록이 있으면 같은 개별 실행의 진행 기록보다 우선해요.</p>
        <a className={styles.sourceReturn} href="#experiment-query" onClick={(event) => focusFragment(event, "experiment-query")}>목록 필터로 돌아가기</a>
      </div>
    </details>;
}

function focusFragment(event: MouseEvent<HTMLAnchorElement>, targetId: "experiment-source-summary" | "experiment-query") {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  // Keep native fragment navigation/history, but move keyboard focus explicitly.
  document.getElementById(targetId)?.focus({ preventScroll: true });
}

function Diagnostic({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function ExperimentTable({ rows }: { rows: ExperimentListRow[] }) {
  return <table className={styles.table} role="table">
    <caption className={styles.srOnly}>불러온 개별 실행 목록. 각 실험 ID에서 실행 상세로 이동할 수 있어요.</caption>
    <thead role="rowgroup"><tr role="row">
      <th scope="col">실험 ID</th><th scope="col">상태</th><th scope="col">기록된 데이터 기간 (UTC)</th><th scope="col">시작·종료 (UTC)</th><th scope="col">결과 기록</th>
    </tr></thead>
    <tbody role="rowgroup">{rows.map((row) => <tr key={row.runId} role="row" data-testid="experiment-row">
      <td className={styles.identityCell} role="cell">
        <Link className={styles.runLink} href={row.detailHref} prefetch={false}>{row.runId}<Icon name="arrow" /></Link>
        <span className={styles.provenance}>{row.provenance === "unbound_stored" ? "저장 행 · batch 연결 미확인" : `개별 실행${row.runIndex === null ? "" : ` · index ${row.runIndex}`}`}</span>
      </td>
      <td className={styles.statusCell} role="cell"><span className={`${styles.status} ${styles[`status_${row.status}`]}`}><span aria-hidden="true" />{STATUS_LABELS[row.status]}</span></td>
      <td className={styles.windowCell} role="cell"><span className={styles.mobileLabel}>{row.provenance === "unbound_stored" ? "batch 연결 미확인 · " : ""}데이터 기간 (UTC) </span>{row.windowStartAt && row.windowEndAt ? <><span>{dateOnly(row.windowStartAt)}</span><span className={styles.windowEnd}>~ {dateOnly(row.windowEndAt)}</span></> : <span className={styles.unknown}>미확인</span>}</td>
      <td className={styles.timeCell} role="cell"><span><span className={styles.mobileLabel}>시작 (UTC) </span>{shortTimestamp(row.startedAt)}</span><small>종료<span className={styles.mobileLabel}> (UTC)</span> {shortTimestamp(terminalTimestamp(row))}</small></td>
      <td className={styles.resultsCell} role="cell"><span>거래 {number(row.tradeCount)} · 거절 {number(row.rejectedCount)}</span><small>판단 실패 {number(row.aiDecisionFailureCount)}</small></td>
    </tr>)}</tbody>
  </table>;
}

function number(value: number | null): string {
  return value === null ? "미확인" : value.toLocaleString("ko-KR");
}

function timestamp(value: string | null): string {
  if (!value) return "미확인";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "미확인" : date.toISOString().replace("T", " ").slice(0, 19);
}

function terminalTimestamp(row: ExperimentListRow): string | null {
  if (row.status === "failed") return row.failedAt;
  if (row.status === "skipped") return row.skippedAt;
  if (row.status === "running") return null;
  return row.completedAt;
}

function shortTimestamp(value: string | null): string {
  const formatted = timestamp(value);
  return formatted === "미확인" ? formatted : formatted.slice(0, 16);
}

function dateOnly(value: string): string {
  return timestamp(value).slice(0, 10);
}

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    experiment: <><path d="M9 3h6M10 3v6l-5.4 9.1A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.9L14 9V3" /><path d="M8 15h8" /></>,
    policy: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 7h6M9 11h6M9 15h3" /></>,
    compare: <><rect x="4" y="12" width="3" height="8" rx=".5" /><rect x="10.5" y="4" width="3" height="16" rx=".5" /><rect x="17" y="8" width="3" height="12" rx=".5" /></>,
    data: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></>,
    settings: <><path d="m9.5 3-.6 2a8 8 0 0 0-1.7 1L5.1 5.5 3 9l1.6 1.5a8 8 0 0 0 0 2L3 14l2.1 3.5 2.1-.5a8 8 0 0 0 1.7 1l.6 2h4l.6-2a8 8 0 0 0 1.7-1l2.1.5L20 14l-1.6-1.5a8 8 0 0 0 0-2L20 9l-2.1-3.5-2.1.5a8 8 0 0 0-1.7-1l-.6-2z" /><circle cx="11.5" cy="11.5" r="3" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    arrow: <path d="m9 5 7 7-7 7" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
