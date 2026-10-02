"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
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

function writeFilters(query: string, status: StatusFilter, replace = false) {
  const url = new URL(window.location.href);
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
  const source = pageData.experimentList;
  const data = source.status === "ok" ? source.data : null;
  const rows = data?.rows.filter((row) => {
    const matchesStatus = status === "all" || row.status === (status === "partial" ? "completed_with_failures" : status);
    return matchesStatus && row.runId.toLowerCase().includes(query.toLowerCase());
  }) ?? [];

  useEffect(() => {
    // Update uncontrolled fields on browser Back/Forward without remounting or moving focus.
    if (inputRef.current) inputRef.current.value = query;
    if (selectRef.current) selectRef.current.value = status;
    writeFilters(query, status, true);
  }, [query, status, searchParams]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = normalizedQuery(inputRef.current?.value ?? "");
    if (inputRef.current) inputRef.current.value = nextQuery;
    writeFilters(nextQuery, normalizeStatus(selectRef.current?.value ?? null));
  }

  function clearFilters() {
    if (inputRef.current) inputRef.current.value = "";
    if (selectRef.current) selectRef.current.value = "all";
    writeFilters("", "all");
    inputRef.current?.focus({ preventScroll: true });
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
          </section>
        )}

        <section className={styles.listSection} aria-label="실험 목록" data-testid="experiment-list">
          <form className={styles.filters} onSubmit={applyFilters} role="search" aria-label="불러온 실험 필터">
            <div className={styles.searchGroup}>
              <label className={styles.srOnly} htmlFor="experiment-query">실험 ID 검색</label>
              <Icon name="search" />
              <input ref={inputRef} id="experiment-query" name="q" type="search" placeholder="실험 ID로 검색" defaultValue={query} maxLength={200} autoComplete="off" aria-describedby="filter-scope" />
            </div>
            <label className={styles.srOnly} htmlFor="experiment-status">실험 상태</label>
            <select ref={selectRef} id="experiment-status" name="status" defaultValue={status} onChange={(event) => writeFilters(inputRef.current?.value ?? "", normalizeStatus(event.currentTarget.value))}>
              {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button className={styles.searchButton} type="submit">검색</button>
            <button className={styles.clearButton} type="button" onClick={clearFilters}>초기화</button>
          </form>
          <div className={styles.listMeta}>
            <p aria-live="polite" aria-atomic="true">{data ? <>표시 <strong>{rows.length}</strong>개 <span>/ 불러온 child {data.rows.length}개</span></> : "실험 개수 미확인"}</p>
            <p id="filter-scope">검색과 상태 필터는 불러온 행에만 적용돼요</p>
          </div>

          {rows.length > 0 ? <ExperimentTable rows={rows} /> : (
            <div className={styles.emptyState}>
              <Icon name="experiment" />
              <h2>{!data ? "실험 목록을 불러오지 못했어요" : query || status !== "all" ? "조건에 맞는 실험이 없어요" : "표시할 실험 기록이 없어요"}</h2>
              <p>{!data ? "위 조회 상태를 확인해 주세요. API 연결 후 페이지를 다시 열어 조회할 수 있어요." : query || status !== "all" ? "검색어와 상태를 바꾸거나 필터를 초기화해 주세요." : "이 API 응답에서 표시 가능한 child 실행을 찾지 못했어요. 전체 기록이 없다는 뜻은 아니에요."}</p>
              {data && (query || status !== "all") ? <button className={styles.secondaryAction} onClick={clearFilters}>필터 초기화</button> : null}
            </div>
          )}
          <div className={styles.tableFooter}>
            <span>원본 저장 행은 최대 100개를 요청해요</span>
            <span>자동 갱신 없음 · 페이지를 다시 열어 재조회</span>
          </div>
        </section>
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
      <details ref={mobileMenuRef} className={styles.mobileNavigation} onKeyDown={closeMenuOnEscape}>
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
    <Link className={styles.navLink} href="/dashboard/validation#candidate-comparison"><Icon name="compare" /><span>비교<small>현재 검증 보고서</small></span></Link>
    <Link className={styles.navLink} href="/dashboard/validation#data-universe-coverage"><Icon name="data" /><span>데이터<small>현재 검증 보고서</small></span></Link>
  </>;
}

function OperationsLinks() {
  return <details className={styles.operationsMenu}>
    <summary><Icon name="settings" /><span>설정·운영</span></summary>
    <div className={styles.operationsLinks}>
      <Link href="/dashboard/operations">기존 운영 요약</Link>
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
    <div className={styles.batchLine}><span>선택 batch</span><strong>{data.batchId ?? "미확인"}</strong></div>
    <p className={styles.batchMetadata}>저장된 batch 설정 · 위험 프로필 {data.riskProfile ?? "미확인"} · 판단 제공자 {data.decisionProviderMode ?? "미확인"}</p>
    {notes.length ? <p className={styles.compactWarning}><strong>기록 확인</strong><span>{notes.join(" · ")}</span></p> : null}
    <div className={styles.sourceCounts}>
      <p>원본 저장 행 <strong>전체 {data.totalCount}개</strong> · 이번 응답 {data.count}개 (요청 한도 100)</p>
      <p>표시 가능한 child <strong>terminal {data.projectedTerminalCount}개</strong> · 진행 중 {data.projectedActiveCount}개</p>
    </div>
    <p className={styles.snapshotNotice}>진행 중은 저장된 상태예요. 현재 실행 여부를 실시간 확인한 값은 아니에요.</p>
    <details className={styles.diagnostics}>
      <summary>조회 정보와 기록 상태</summary>
      <div className={styles.diagnosticBody}>
        <dl>
          <Diagnostic label="API 소스 상태" value={`${data.endpointStatus} · ${SOURCE_LABELS[data.endpointStatus]}`} />
          <Diagnostic label="선택 batch 상태" value={data.batchStatus ?? "미확인"} />
          <Diagnostic label="집계 파일 읽기" value={data.aggregateStatus ?? "미확인"} />
          <Diagnostic label="진행 기록 읽기" value={data.activeRunProgressStatus ?? "미확인"} />
          <Diagnostic label="저장된 batch 갱신 시각 (UTC)" value={timestamp(data.batchUpdatedAt)} />
          <Diagnostic label="batch 요청 실행 수" value={number(data.requestedRunCount)} />
          <Diagnostic label="manifest 집계" value={`완료 ${number(data.manifestCounts.completed)} · 실패 ${number(data.manifestCounts.failed)} · 건너뜀 ${number(data.manifestCounts.skipped)}`} />
          <Diagnostic label="원본 저장 상태 집계" value={Object.entries(STATUS_LABELS).filter(([key]) => key !== "running").map(([key, label]) => `${label} ${number(data.statusCounts[key as keyof typeof data.statusCounts] ?? null)}`).join(" · ")} />
          <Diagnostic label="알 수 없는 원본 상태 수" value={number(data.unknownStatusCount)} />
          <Diagnostic label="JSONL 손상 줄" value={number(data.corruptLineCount)} />
          <Diagnostic label="조회 시각 (UTC)" value={timestamp(fetchedAt)} />
        </dl>
        {data.warnings.length ? <ul>{data.warnings.map((warning) => <li key={warning.code}>{WARNING_LABELS[warning.code]} · {warning.count}건</li>)}</ul> : null}
        <p>원본 행 수, manifest 집계, 표시 child 수는 서로 다른 기준이에요. 종료 기록이 있으면 같은 child의 진행 기록보다 우선해요.</p>
      </div>
    </details>
  </section>;
}

function Diagnostic({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function ExperimentTable({ rows }: { rows: ExperimentListRow[] }) {
  return <table className={styles.table} role="table">
    <caption className={styles.srOnly}>불러온 child 실행 목록. 각 실험 ID에서 실행 상세로 이동할 수 있어요.</caption>
    <thead role="rowgroup"><tr role="row">
      <th scope="col">실험 ID</th><th scope="col">상태</th><th scope="col">기록된 데이터 기간 (UTC)</th><th scope="col">시작·종료 (UTC)</th><th scope="col">결과 기록</th>
    </tr></thead>
    <tbody role="rowgroup">{rows.map((row) => <tr key={row.runId} role="row" data-testid="experiment-row">
      <td className={styles.identityCell} role="cell">
        <Link className={styles.runLink} href={row.detailHref} prefetch={false}>{row.runId}<Icon name="arrow" /></Link>
        <span className={styles.provenance}>{row.provenance === "unbound_stored" ? "저장 행 · batch 연결 미확인" : `child 실행${row.runIndex === null ? "" : ` · index ${row.runIndex}`}`}</span>
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
