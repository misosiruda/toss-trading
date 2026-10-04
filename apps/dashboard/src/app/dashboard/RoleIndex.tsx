import { LEGACY_DESTINATIONS, resolveLegacyCompatibility } from "@/lib/legacyCompatibility";
import styles from "./RoleIndex.module.css";

const roles = {
  strategy: { title: "전략·정책", description: "정책 작성과 포트폴리오 준수 현황, 전략 테스트를 구분해 조회합니다.", links: [
    ["/dashboard/lab/policies", "정책 작성·검증", "기존 정책 검증과 생성 화면. 정책 자체의 실험 적용은 지원하지 않습니다."],
    ["/dashboard/portfolio", "포트폴리오 준수 현황", "배정·현금·비용·준수 자료 조회"],
    ["/dashboard/lab/strategy-tests", "전략 테스트", "기존 bucket 테스트와 관측 상태"]
  ], legacy: "current" },
  data: { title: "데이터", description: "현재 검증 보고서의 자료 범위와 누락을 확인합니다. 실제 데이터 가용성을 새로 검증하지 않습니다.", links: [
    ["/dashboard/validation#data-universe-coverage", "데이터 범위·coverage", "현재 검증 보고서의 universe 자료"],
    ["/dashboard/validation", "전체 검증 보고서", "검증 상태와 출처"],
    ["/dashboard", "실행별 판단 근거", "목록에서 정확한 실행 ID를 선택한 뒤 상세의 근거 자료를 확인하세요."]
  ], legacy: "validation" },
  settings: { title: "설정·운영", description: "전체 운영 기록과 진단을 조회합니다. 이 화면에는 설정 변경이나 주문 실행 기능이 없습니다.", links: [
    ["/dashboard/operations", "기존 운영 요약", "기존 종합 dashboard를 그대로 조회"],
    ["/dashboard/risk-gate", "전체 Risk 조회", "읽기 전용 판단·Risk 추적"],
    ["/dashboard/audit", "전체 운영 기록", "기존 audit event 조회"],
    ["/dashboard/live-readiness", "진단 상태", "live disabled 상태의 진단 자료. legacy 내부 panel과 별도 화면입니다."],
    ["/dashboard/component-catalog", "UI catalog", "개발 검증용 기존 구성 요소"]
  ], legacy: "overview" }
} as const;

export function RoleIndex({ role }: { role: keyof typeof roles }) {
  const content = roles[role];
  const compatibility = resolveLegacyCompatibility(process.env.DASHBOARD_LEGACY_ORIGIN);
  const legacy = LEGACY_DESTINATIONS[content.legacy];
  return <div className={styles.page}>
    <a className={styles.skip} href="#role-main">본문으로 건너뛰기</a>
    <nav className={styles.nav} aria-label="역할별 화면">
      <a href="/dashboard">실험</a><a href="/dashboard/strategy" aria-current={role === "strategy" ? "page" : undefined}>전략·정책</a>
      <a href="/dashboard/experiments/compare">실행 비교</a><a href="/dashboard/data" aria-current={role === "data" ? "page" : undefined}>데이터</a>
      <a href="/dashboard/settings" aria-current={role === "settings" ? "page" : undefined}>설정·운영</a>
    </nav>
    <main id="role-main" tabIndex={-1}>
      <header><p className={styles.eyebrow}>Paper-only · 읽기 전용 안내</p><h1>{content.title}</h1><p>{content.description}</p></header>
      <section aria-label={`${content.title} 자료`} className={styles.cards}>
        {content.links.map(([href, label, detail]) => <article className={styles.card} key={href}><h2><a href={href}>{label}</a></h2><p>{detail}</p></article>)}
      </section>
      <section className={styles.card} aria-labelledby="compatibility-title" data-compatibility-status={compatibility.status}>
        <h2 id="compatibility-title">호환 화면</h2>
        <p>아직 이전하지 않은 자료는 별도 legacy 화면에서 확인합니다. Next 화면과 다른 운영 endpoint이며, 이 링크는 자료를 가져오거나 접근 가능 여부를 검사하지 않습니다.</p>
        {compatibility.status === "configured" ? <><p>운영자가 지정한 호환 origin: <span className={styles.origin}>{compatibility.origin}</span></p><a href={`${compatibility.origin}${legacy.path}`} rel="noreferrer">{legacy.label} · 별도 origin</a></> : <p role="status">{compatibility.status === "missing" ? "호환 origin이 설정되지 않았습니다." : "호환 origin 설정이 유효하지 않아 링크를 표시하지 않습니다."} 운영자의 로컬 dashboard runbook에서 실행 주소와 접근 조건을 확인하세요. 주소를 추정하거나 API proxy 주소로 대체하지 않습니다.</p>}
        <details><summary>문서와 접근 조건</summary><p>저장소 문서 <code>docs/runbooks/ai-paper-trading-runbook.md</code>의 dashboard 실행·접근 조건을 먼저 확인하세요. 문서 경로 안내이며 웹 문서나 실행 중인 panel 링크가 아닙니다. 자격증명은 이 화면에서 입력하지 않습니다.</p></details>
      </section>
    </main>
  </div>;
}
