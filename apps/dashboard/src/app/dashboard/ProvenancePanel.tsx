import {provenanceFieldGroups,type ProvenanceObservation} from '@/lib/runProvenance';
import styles from './ProvenancePanel.module.css';
const statusLabels:Record<ProvenanceObservation['status'],string>={partial:'일부 저장 관측',missing:'저장 조건 미관측',invalid:'응답 확인 필요',blocked:'조회 차단',limit:'조회 한도 도달',ambiguous:'중복 실행 ID',offline:'조회 연결 불가'};
const reasons={not_persisted:'저장되지 않음',not_present:'저장 field 없음',invalid:'값 확인 불가',missing:'저장 파일 없음',blocked:'조회 차단',limit:'조회 한도 도달',ambiguous:'중복 ID',identity_mismatch:'실행 identity 불일치',redacted_text:'민감 정보 보호로 값 숨김'};
const sources={batch_manifest:'batch manifest',run_record:'저장 실행 기록',run_metadata:'실행 metadata',research_manifest:'research manifest'};
export function ProvenancePanel({observation:o}:{observation:ProvenanceObservation}){
  return <section className={styles.panel} aria-label="저장 실행 조건" data-testid="run-provenance">
    <h2>저장 실행 조건</h2><p className={styles.status}>{statusLabels[o.status]}</p>
    <p>요청 exact ID: <span className={styles.wrap}>{o.requestedId}</span><br/>조건 조회 시각: {o.fetchedAt.replace('T',' ').replace('Z',' UTC')}</p>
    <p>문서 조회 시 읽은 독립 관측입니다. 상세 상태의 자동 갱신과는 별개예요. 저장 hash는 현재 자료·코드·정책과 대조 검증하지 않았어요.</p>
    <p>전체 원래 입력과 runtime은 복원되지 않았어요. 미확인 값끼리 같다고 판단하지 않으며 지표 동등성·순위·입력 복제는 사용할 수 없어요.</p>
    {o.status==='partial'?Object.entries(provenanceFieldGroups).map(([group,keys])=><details key={group} className={styles.group}><summary>{group}</summary><dl>{keys.map(key=>{const field=o.fields[key];return <div key={key}><dt>{key}</dt><dd>{field?.status==='recorded'?<><span>{field.value===null?'저장된 null':Array.isArray(field.value)?field.value.join(', '):String(field.value)}</span><small>저장 관측 · {sources[field.source]}{key.endsWith('Hash')?' · 현재 자료와 미검증':''}</small></>:<span>{field?.status==='unavailable'?reasons[field.reason]:'저장 field 없음'} · unavailable</span>}</dd></div>;})}</dl></details>):<p>이 ID의 저장 조건을 확인할 수 없어요. 다른 실행이나 기본 설정으로 대체하지 않았어요.</p>}
  </section>;
}
