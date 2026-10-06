import { SAFE_CHILD_LOOKUP_PATTERN } from '@/lib/childLookupId';
import Link from 'next/link';
import {readRunProvenance,type ProvenanceObservation} from '@/lib/runProvenance';
import {ProvenancePanel} from '../../ProvenancePanel';
import { readComparisonPage, readComparisonSelection, type ComparisonObservation } from '@/lib/runComparison';
import { WorkspaceNavigation } from '../../ExperimentList';
import shell from '../../ExperimentList.module.css';
import styles from './comparison.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const statuses: Record<string,string> = {incomplete:'전체 기록 확인 불가',available:'조회됨',missing:'저장 실행 없음',offline:'조회 연결 불가',invalid:'응답 확인 필요',identity_mismatch:'실행 ID 불일치',ambiguous:'중복 실행 ID',running:'진행 중',completed:'완료',completed_with_failures:'부분 실패',failed:'실패',skipped:'건너뜀',ok:'정상',corrupt:'손상',degraded:'일부 기록만 사용',blocked:'차단'};
const kinds = {packet:'Packet',decision:'판단',risk:'Risk',trade:'가상 체결'};
const text = (value:string|null)=>value ? statuses[value] ?? '미확인' : '미확인';
const count = (value:number|null)=>value === null ? '미확인' : String(value);
const time = (value:string|null)=>value ? value.replace('T',' ').replace('Z',' UTC') : '미확인';
const reasons: Record<string,string> = {
  blocked:'저장 경로 조회가 차단됐어요. 실행 기록이 없다는 뜻은 아니에요.',
  incomplete:'전체 실행 기록의 중복 여부를 확인할 수 없어 이 실행의 근거를 연결하지 않았어요.',
  missing:'이 정확한 실행 ID에 해당하는 저장 실행을 찾지 못했어요. batch 별칭으로 다른 실행을 선택하지 않았어요.',
  offline:'이 실행을 조회할 수 없어요. 저장 기록이 없다는 뜻은 아니에요.',
  invalid:'응답 계약을 확인할 수 없어 이 실행의 관측을 표시하지 않았어요.',
  identity_mismatch:'요청한 실행과 응답의 child ID가 달라 관측을 표시하지 않았어요. 정확한 child ID를 입력해 주세요.',
  ambiguous:'동일한 child ID의 원본 기록이 여러 개여서 하나를 임의로 선택하지 않았어요.'
};

export default async function ComparisonPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const selection = readComparisonSelection(await searchParams);
  const [observations,provenance]=await Promise.all([readComparisonPage(selection),selection.status==='valid'?Promise.all([readRunProvenance(selection.baseline),readRunProvenance(selection.candidate)]):Promise.resolve([])]);
  return <div className={shell.workspace}>
    <a className={shell.skipLink} href="#experiments-main">본문으로 건너뛰기</a>
    <WorkspaceNavigation />
    <main id="experiments-main" tabIndex={-1} className={`${shell.main} ${styles.main}`}>
      <header className={styles.header}><div><h1>실행 비교</h1><p>두 실행의 저장 관측을 확인해요. 지표의 동등성은 확인되지 않았어요.</p></div><Link className={styles.link} href="/dashboard">실험 목록</Link></header>
      <form action="/dashboard/experiments/compare" method="get" className={styles.selection} aria-label="비교 실행 선택">
        <label>기준 실행 ID<input name="baseline" defaultValue={selection.baseline} required maxLength={256} pattern={SAFE_CHILD_LOOKUP_PATTERN} autoComplete="off" spellCheck={false} /></label>
        <label>후보 실행 ID<input name="candidate" defaultValue={selection.candidate} required maxLength={256} pattern={SAFE_CHILD_LOOKUP_PATTERN} autoComplete="off" spellCheck={false} /></label>
        <button type="submit">두 실행 조회</button>
      </form>
      {selection.status !== 'valid' && <p role={selection.status === 'invalid' ? 'alert' : undefined} className={styles.selectionNotice}>{selection.reason}</p>}
      <section className={styles.limit} aria-labelledby="comparison-limit"><h2 id="comparison-limit">비교 제한</h2><p>완전한 입력과 자료 provenance가 제공되지 않아 지표 비교를 사용할 수 없어요. 같은 조건의 실행인지 확인되지 않았으므로 차이·순위·공통 기간 성과를 계산하지 않아요.</p><p>아래 기록 시각은 실행 시각이며, 시장 자료의 관측 기간이나 timezone을 뜻하지 않아요. 양쪽의 미확인 값은 동일하다고 판단하지 않아요.</p></section>
      {observations.length === 2 && <section className={styles.columns} aria-label="두 실행의 독립 관측"><Observation roleLabel="기준" observation={observations[0]} provenance={provenance[0]}/><Observation roleLabel="후보" observation={observations[1]} provenance={provenance[1]}/></section>}
      <section className={styles.clone} aria-labelledby="clone-title"><div><h2 id="clone-title">입력 복제</h2><p id="clone-reason">저장된 완전한 요청·유효 입력을 읽는 계약이 없어 복제할 수 없어요. 기존 실행의 입력이나 상태를 변경하지 않아요.</p></div><button disabled aria-describedby="clone-reason">입력 복제 사용 불가</button></section>
    </main>
  </div>;
}

function Observation({roleLabel,observation:o,provenance}:{roleLabel:string;observation:ComparisonObservation;provenance?:ProvenanceObservation}) {
  return <article className={styles.observation} aria-label={`${roleLabel} 실행 관측`} data-testid={`comparison-${roleLabel === '기준' ? 'baseline' : 'candidate'}`}>
    <header><h2>{roleLabel} 실행</h2><p className={styles.id}>{o.requestedId}</p><strong className={styles.status}>{text(o.status)}</strong></header>
    <dl className={styles.facts}><div><dt>관측 출처</dt><dd>{o.observationSource === 'manifest_active' ? 'manifest 진행 관측' : o.observationSource === 'stored_terminal' ? '저장 종료 기록' : '미확인'}</dd></div><div><dt>실행 상태</dt><dd>{text(o.runStatus)}</dd></div><div><dt>실행 시작</dt><dd>{time(o.startedAt)}</dd></div><div><dt>실행 종료</dt><dd>{time(o.endedAt)}</dd></div><div><dt>조회 시각</dt><dd>{time(o.fetchedAt)}</dd></div><div><dt>소스 응답</dt><dd>{text(o.sourceStatus)}</dd></div></dl>
    {o.status !== 'available' ? <p className={styles.notice}>{reasons[o.status]}</p> : <>
      <h3>저장 근거의 관측 범위</h3>
      <p className={styles.scopeNote}>실행 ID 연결: {o.artifactBinding === 'bound' ? '일치' : '사용 불가'} · report {text(o.reportStatus)} · progress {text(o.progressStatus)}</p>
      {o.scopes.length > 0 ? <table className={styles.table}><caption>{roleLabel} 실행의 반환 범위 · 각 종류 최대 100건</caption><thead><tr><th scope="col">근거</th><th scope="col">읽기 상태</th><th scope="col">API 반환 / 전체</th></tr></thead><tbody>{o.scopes.map(s=><tr key={s.kind}><th scope="row">{kinds[s.kind]}</th><td>{text(s.status)}</td><td>{count(s.returned)} / {count(s.total)}<small>유효 {s.displayed} · 제외 {s.excluded}<br />손상 {count(s.corrupt)} · {s.truncated === null ? '범위 미확인' : s.truncated ? '일부 반환' : '잘림 없음'}</small></td></tr>)}</tbody></table> : <p className={styles.notice}>이 실행에 연결된 근거를 사용할 수 없어요. 다른 실행의 자료나 0건으로 대체하지 않아요.</p>}
      <Link className={styles.link} href={`/dashboard/lab/runs/${encodeURIComponent(o.requestedId)}`}>이 실행 상세 보기</Link>
    </>}
    {provenance&&<ProvenancePanel observation={provenance}/>}
    <h3>확인되지 않은 비교 조건</h3><p className={styles.scopeNote}>전체 요청·유효 입력과 완전한 자료·scope·cost·benchmark·runtime provenance는 미확인이에요. 표시된 저장 부분 값도 비교 가능성의 증명이 아니에요.</p>
  </article>;
}
