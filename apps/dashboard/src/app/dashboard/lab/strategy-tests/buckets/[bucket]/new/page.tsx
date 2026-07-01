import Link from "next/link";
import { notFound } from "next/navigation";

import type { StrategyBucket } from "@/lib/policyDraft";
import { StrategyBucketTestValidationForm } from "../../../StrategyBucketTestValidationForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUCKET_LABELS: Record<StrategyBucket, string> = {
  long_term: "Long-term",
  swing: "Swing",
  short_term: "Short-term",
  intraday: "Intraday",
  hedge: "Hedge"
};

const BUCKET_DESCRIPTIONS: Record<StrategyBucket, string> = {
  long_term: "multi-month 장기 bucket을 다른 전략과 분리해 paper-only 조건으로 검증합니다.",
  swing: "multi-week swing bucket을 독립 config와 validation split으로 검증합니다.",
  short_term: "multi-day short-term bucket을 별도 replay candidate로 검증합니다.",
  intraday: "intraday bucket의 초단기 조건을 live order 없이 paper-only로 검증합니다.",
  hedge: "hedge bucket은 수익률 순위가 아니라 downside reduction, cost drag, exposure effect를 확인하는 후보로 검증합니다."
};

export function generateStaticParams() {
  return Object.keys(BUCKET_LABELS).map((bucket) => ({ bucket }));
}

export default async function StrategyBucketNewPage({
  params
}: {
  params: Promise<{ bucket: string }>;
}) {
  const { bucket: rawBucket } = await params;
  if (!isStrategyBucket(rawBucket)) {
    notFound();
  }

  const bucket = rawBucket;

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="border-b border-[var(--border)] pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-[var(--accent)]">
                Isolated Strategy Bucket Test
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                {BUCKET_LABELS[bucket]} Bucket Test
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                {BUCKET_DESCRIPTIONS[bucket]} Backend validation을 통과한 뒤에만
                queued record를 만들 수 있고, replay runner와 live order surface는
                이 화면에서 시작되지 않습니다.
              </p>
            </div>
            <nav
              aria-label="Bucket test navigation"
              className="flex flex-wrap gap-2 text-sm"
            >
              <Link
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-medium"
                href="/dashboard/lab/strategy-tests"
              >
                Strategy Lab
              </Link>
              <Link
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-medium"
                href="/dashboard"
              >
                Dashboard
              </Link>
              <span className="rounded-[6px] border border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-2 font-semibold text-[var(--danger)]">
                paper-only
              </span>
            </nav>
          </div>
        </header>

        <section
          aria-label="Isolated bucket safety boundary"
          className="grid gap-3 md:grid-cols-3"
        >
          <BoundaryCard label="Bucket" tone="ok" value={bucket} />
          <BoundaryCard label="Mutation" tone="watch" value="queued record only" />
          <BoundaryCard label="Runner" tone="blocked" value="not started" />
        </section>

        <StrategyBucketTestValidationForm
          initialBucket={bucket}
          lockedBucket={true}
        />

        <footer className="border-t border-[var(--border)] pt-4 text-xs leading-5 text-[var(--muted)]">
          Bucket-specific route is a paper-only test entrypoint. It does not
          start a replay runner, send live orders, or expose broker mutation.
        </footer>
      </div>
    </main>
  );
}

function BoundaryCard({
  label,
  tone,
  value
}: {
  label: string;
  tone: "ok" | "watch" | "blocked";
  value: string;
}) {
  return (
    <article className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--muted)]">{label}</h2>
        <Badge tone={tone} value={tone === "blocked" ? "disabled" : tone} />
      </div>
      <p className="mt-3 break-words font-mono text-sm font-semibold">{value}</p>
    </article>
  );
}

function Badge({
  tone,
  value
}: {
  tone: "ok" | "watch" | "blocked";
  value: string;
}) {
  const className =
    tone === "ok"
      ? "bg-[var(--success-soft)] text-[var(--success)]"
      : tone === "watch"
        ? "bg-[var(--warning-soft)] text-[var(--warning)]"
        : "bg-[var(--danger-soft)] text-[var(--danger)]";
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-[6px] px-2 py-1 text-xs font-semibold ${className}`}
    >
      {value}
    </span>
  );
}

function isStrategyBucket(value: string): value is StrategyBucket {
  return (
    value === "long_term" ||
    value === "swing" ||
    value === "short_term" ||
    value === "intraday" ||
    value === "hedge"
  );
}
