"use client";
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { buildRunEvidence, EVIDENCE_KINDS, evidenceReference, evidenceReferences, readEvidenceSelection, type EvidenceKind, type EvidenceRow, type RunEvidenceView } from '@/lib/runEvidence';
import { runWorkspaceHref } from '@/lib/runWorkspace';
import styles from './RunEvidenceWorkspace.module.css';
const LABEL: Record<EvidenceKind,string>={packet:'Packet',decision:'Provider 판단',risk:'Deterministic Risk',trade:'모의 체결'};
const STATE={linked:'명시적 참조 확인',missing:'연결 대상 없음',outside_loaded_range:'표시 범위 밖일 수 있음',ambiguous:'중복 ID · 연결 모호',unavailable:'자료 판독 불가',mismatch:'Packet 참조 불일치'};
const SOURCE={bound:'API가 선택한 child 자료',missing:'근거 자료 없음',mismatch:'다른 child 자료 · 연결 차단',blocked:'자료 경로 제한 · 연결 차단',invalid:'근거 계약 불일치 · 연결 차단'};
const amount=(value:number|null)=>value===null?'미관측':value.toLocaleString('ko-KR');

export function RunEvidenceWorkspace({model,requestedId,tab}:{model:RunEvidenceView|undefined;requestedId:string;tab:'replay'|'evidence'}) {
  const query=useSearchParams(),rawSelection=query.get('event'),selection=readEvidenceSelection(rawSelection);
  const view=model??buildRunEvidence(null,null);
  const region=useRef<HTMLElement|null>(null),focused=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const track=(event:FocusEvent)=>{focused.current=event.target instanceof HTMLElement && region.current?.contains(event.target)?event.target:null;};
    const pointer=(event:PointerEvent)=>{if(!(event.target instanceof Element)||!region.current?.contains(event.target)||!event.target.closest('a,button,summary'))focused.current=null;};
    document.addEventListener('focusin',track);document.addEventListener('pointerdown',pointer);
    return()=>{document.removeEventListener('focusin',track);document.removeEventListener('pointerdown',pointer);};
  },[]);
  useLayoutEffect(()=>{
    if(focused.current && !focused.current.isConnected && document.activeElement===document.body){
      region.current?.closest('main')?.querySelector<HTMLAnchorElement>('nav a[aria-current="page"]')?.focus({preventScroll:true});focused.current=null;
    }
  },[view]);
  const kindFilter=tab==='replay'?'packet':EVIDENCE_KINDS.includes(query.get('kind') as EvidenceKind)?query.get('kind') as EvidenceKind:null;
  const buckets=view.buckets.filter(b=>kindFilter===null||b.kind===kindFilter);
  const benchmarks=query.get('benchmarks');
  const href=(kind:EvidenceKind,id:string)=>runWorkspaceHref(requestedId,tab,benchmarks,{...(kindFilter?{kind:kindFilter}:{}),event:kind+':'+id});
  const reference=selection?evidenceReference(view,selection.kind,selection.id):null;
  const outOfScope=tab==='replay' && selection?.kind!=='packet';
  const row=selection && reference?.state==='linked' && !outOfScope ? view.buckets.find(b=>b.kind===selection.kind)?.rows.find(r=>r.id===selection.id):undefined;
  return <section ref={region} aria-label={tab==='replay'?'저장된 Packet 사건':'판단 근거'} className={styles.evidence}>
    <header className={styles.heading}>
      <h2>{tab==='replay'?'저장된 Packet 사건':'판단 근거'}</h2>
      <p>{SOURCE[view.source]} · {view.source==='bound'?'source child':'검증 대상 child'}: <strong>{view.runId??'미관측'}</strong></p>
      <p>저장된 사건과 명시적 참조만 읽습니다. 시각·종목이 같다는 이유로 판단의 인과 관계를 연결하지 않습니다.</p>
      {tab==='replay'&&<p>자산 시계열과 재생 계약이 없어 금융 차트·재생을 제공하지 않습니다. Packet 시각은 저장된 생성 시각이며 heartbeat가 아닙니다.</p>}
    </header>
    <ul className={styles.sources} aria-label="자료별 판독과 표시 범위">
      {view.buckets.map(bucket=><li key={bucket.kind}>
        <strong>{LABEL[bucket.kind]}</strong><span>판독: {bucket.status}</span>
        <p>원본 반환 {amount(bucket.returned)} / 전체 {amount(bucket.total)} · 검증 표시 {bucket.rows.length} · JSONL 손상 {amount(bucket.corrupt)}</p>
        {bucket.truncated&&<p>일부 표시 · 현재 마지막 100개 범위. 여기 없는 참조가 원본에도 없다는 뜻은 아닙니다.</p>}
        {(bucket.invalid>0||bucket.wrongRun>0||bucket.duplicates>0)&&<p className={styles.warning}>스키마 제외 {bucket.invalid} · 다른 run 제외 {bucket.wrongRun} · 중복 ID {bucket.duplicates}</p>}
        {(bucket.outOfOrder||bucket.sameTime)&&<p className={styles.warning}>{bucket.outOfOrder?'원본 시각 순서 역전 · ':''}{bucket.sameTime?'동일 시각 있음 · ':''}원본 순서를 유지합니다.</p>}
      </li>)}
    </ul>
    {tab==='evidence'&&<nav className={styles.filters} aria-label="근거 자료 종류">
      <Link href={runWorkspaceHref(requestedId,'evidence',benchmarks)} aria-current={kindFilter===null?'page':undefined}>모두</Link>
      {EVIDENCE_KINDS.map(kind=><Link key={kind} href={runWorkspaceHref(requestedId,'evidence',benchmarks,{kind})} aria-current={kindFilter===kind?'page':undefined}>{LABEL[kind]}</Link>)}
    </nav>}
    <div className={styles.split}>
      <section className={styles.events} aria-label="근거 사건 목록">
        {buckets.map(bucket=><section key={bucket.kind}>
          <h3>{LABEL[bucket.kind]}</h3>
          {bucket.rows.length===0&&<p>{bucket.status==='ok'&&bucket.returned===0?'정상 판독 · 0건':'표시 가능한 검증 자료 없음'}</p>}
          <ul>{bucket.rows.map((item,index)=><li key={`${item.kind}:${item.id}:${index}`}>
            {item.duplicate?<span className={styles.disabled}>{item.id}<small>중복 ID · 선택/연결 불가</small></span>:<Link href={href(item.kind,item.id)} aria-current={row?.kind===item.kind&&row.id===item.id?'true':undefined}>
              <strong>{item.id}</strong><small>{item.at??'개별 시각 미관측'}</small>
            </Link>}
          </li>)}</ul>
        </section>)}
      </section>
      <article className={styles.inspector} aria-label="선택 근거 상세">
        {!row?<><h3>선택 근거 상세</h3><p>{rawSelection===null?'사건을 선택하면 같은 child의 검증된 자료와 참조를 확인합니다.':!selection?'알 수 없는 선택 · 다른 사건으로 대체하지 않습니다.':outOfScope?'이 탭의 사건 범위 밖 · 연결 없음.':reference?STATE[reference.state]:'연결 없음'}</p></>:<>
          <h3>{LABEL[row.kind]} · {row.id}</h3><p>source child: {view.runId}</p>
          <RowFields row={row}/>
          <section className={styles.references} aria-label="명시적 자료 참조"><h4>명시적 자료 참조</h4>
            {row.kind==='packet'&&<p>이 Packet은 직접 선택된 원본입니다. 후보의 채택·체결을 추정하지 않습니다.</p>}
            {evidenceReferences(view,row).map(ref=><p key={ref.kind+':'+ref.id}>{LABEL[ref.kind]}: {ref.state==='linked'?<Link href={href(ref.kind,ref.id)}>{ref.id}</Link>:<span>{ref.id}</span>} · {STATE[ref.state]}</p>)}
            {row.kind==='trade'&&<p>이 자료의 decisionId는 Risk의 riskDecisionId 참조입니다. Provider 판단 ID가 아닙니다.</p>}
            {['decision','risk','trade'].includes(row.kind)&&<p>Provider 판단 항목 ↔ Risk 직접 인과 연결: unavailable. 독립 항목 참조가 저장되지 않아 추정 연결을 표시하지 않습니다.</p>}
          </section>
          <details className={styles.json}><summary>검증된 표시 필드 (JSON)</summary><pre>{JSON.stringify(row.details,null,2)}</pre></details>
        </>}
      </article>
    </div>
  </section>;
}
function RowFields({row}:{row:EvidenceRow}) {
  return <dl className={styles.fields}>{Object.entries(row.details).map(([key,value])=><div key={key}>
    <dt>{key}</dt><dd>{typeof value==='string'||typeof value==='number'||typeof value==='boolean'?String(value):Array.isArray(value)?value.length===0?'0건':value.map((item,index)=><p key={index}>{typeof item==='string'?item:Object.entries(item).map(([field,entry])=>`${field}: ${Array.isArray(entry)?entry.length?entry.join(', '):'0건':String(entry)}`).join(' · ')}</p>):'미관측'}</dd>
  </div>)}</dl>;
}
