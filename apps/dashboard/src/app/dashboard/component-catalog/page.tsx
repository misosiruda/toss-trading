import Link from "next/link";
import type { ReactNode } from "react";

export const dynamic = "force-static";

const SAMPLE_BUCKETS = [
  {
    bucket: "long_term",
    label: "Long-term",
    target: "35.00%",
    current: "32.40%",
    gap: "-2.60%",
    status: "under"
  },
  {
    bucket: "swing",
    label: "Swing",
    target: "20.00%",
    current: "22.10%",
    gap: "+2.10%",
    status: "ok"
  },
  {
    bucket: "hedge",
    label: "Hedge",
    target: "10.00%",
    current: "8.00%",
    gap: "-2.00%",
    status: "watch"
  }
] as const;

const SAMPLE_BOUNDARIES = [
  ["Source", "backend ViewModel", "ok"],
  ["Actions", "read-only", "ok"],
  ["Live order", "not exposed", "blocked"],
  ["Runner", "not started", "blocked"]
] as const;

export default function ComponentCatalogPage() {
  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="border-b border-[var(--border)] pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-[var(--accent)]">
                Dashboard component catalog
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                Component Catalog
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                Next.js dashboard의 반복 UI primitive를 같은 route에서 확인합니다.
                이 화면은 Storybook 대체 검증 표면이며 backend 호출, replay 실행,
                broker mutation을 수행하지 않습니다.
              </p>
            </div>
            <nav
              aria-label="Component catalog navigation"
              className="flex flex-wrap gap-2 text-sm"
            >
              <CatalogLink href="/dashboard">Dashboard</CatalogLink>
              <CatalogLink href="/dashboard/portfolio">Portfolio</CatalogLink>
              <CatalogLink href="/dashboard/lab/strategy-tests">
                Strategy Lab
              </CatalogLink>
              <span className="rounded-[6px] border border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-2 font-semibold text-[var(--danger)]">
                no mutation
              </span>
            </nav>
          </div>
        </header>

        <section
          aria-label="Component catalog safety boundary"
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
        >
          {SAMPLE_BOUNDARIES.map(([label, value, tone]) => (
            <BoundaryCard
              key={label}
              label={label}
              tone={tone}
              value={value}
            />
          ))}
        </section>

        <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
          <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
            <SectionHeader
              eyebrow="tokens"
              status="ok"
              title="Status and Metric Cards"
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Metric label="Net worth" value="KRW 10,000,000" />
              <Metric label="Cash reserve" value="15.00%" />
              <Metric label="Risk rejects" value="3" />
              <Metric label="Updated" value="2026. 07. 01. 09:00:00" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="ok" value="ok" />
              <Badge tone="watch" value="watch" />
              <Badge tone="blocked" value="blocked" />
              <Badge tone="neutral" value="missing" />
            </div>
          </section>

          <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
            <SectionHeader
              eyebrow="matrix"
              status="watch"
              title="Bucket Allocation Table"
            />
            <div className="mt-4 overflow-x-auto">
              <table
                aria-label="Component catalog bucket allocation sample"
                className="min-w-full text-left text-sm"
              >
                <thead className="text-xs uppercase text-[var(--muted)]">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Bucket</th>
                    <th className="py-2 pr-3 font-medium">Target</th>
                    <th className="py-2 pr-3 font-medium">Current</th>
                    <th className="py-2 pr-3 font-medium">Gap</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {SAMPLE_BUCKETS.map((bucket) => (
                    <tr key={bucket.bucket}>
                      <td className="py-2 pr-3">
                        <span className="font-medium">{bucket.label}</span>
                        <span className="mt-1 block font-mono text-xs text-[var(--muted)]">
                          {bucket.bucket}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {bucket.target}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {bucket.current}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {bucket.gap}
                      </td>
                      <td className="py-2">
                        <Badge tone={statusTone(bucket.status)} value={bucket.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <section className="grid gap-5 xl:grid-cols-3">
          <StatePanel
            detail="Backend ViewModel payload passed schema checks."
            status="ok"
            title="Available State"
          />
          <StatePanel
            detail="Artifact exists but some optional metrics are unavailable."
            status="watch"
            title="Partial State"
          />
          <StatePanel
            detail="Route renders an explicit unavailable state instead of starting a runner."
            status="blocked"
            title="Blocked State"
          />
        </section>

        <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
          <SectionHeader
            eyebrow="forms"
            status="blocked"
            title="Guarded Form Controls"
          />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="grid gap-2 text-sm font-medium" htmlFor="catalog-bucket">
              Bucket
              <select
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2"
                defaultValue="swing"
                id="catalog-bucket"
              >
                <option value="long_term">Long-term</option>
                <option value="swing">Swing</option>
                <option value="short_term">Short-term</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium" htmlFor="catalog-seed">
              Seed
              <input
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2 font-mono text-xs"
                defaultValue="catalog-preview-seed"
                id="catalog-seed"
              />
            </label>
            <button
              className="self-end rounded-[6px] border border-[var(--border)] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              disabled
              type="button"
            >
              Preview only
            </button>
          </div>
        </section>

        <footer className="border-t border-[var(--border)] pt-4 text-xs leading-5 text-[var(--muted)]">
          Component catalog is static and paper-only. It does not fetch account,
          broker, replay, or order data.
        </footer>
      </div>
    </main>
  );
}

function CatalogLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Link
      className="rounded-[6px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-medium"
      href={href}
    >
      {children}
    </Link>
  );
}

function BoundaryCard({
  label,
  tone,
  value
}: {
  label: string;
  tone: "ok" | "blocked";
  value: string;
}) {
  return (
    <article className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--muted)]">{label}</h2>
        <Badge tone={tone} value={tone === "ok" ? "safe" : "disabled"} />
      </div>
      <p className="mt-3 break-words font-mono text-sm font-semibold">{value}</p>
    </article>
  );
}

function SectionHeader({
  eyebrow,
  status,
  title
}: {
  eyebrow: string;
  status: "ok" | "watch" | "blocked";
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="font-mono text-xs text-[var(--muted)]">{eyebrow}</p>
        <h2 className="mt-1 text-base font-semibold">{title}</h2>
      </div>
      <Badge tone={status} value={status} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3">
      <p className="text-xs font-medium uppercase text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-2 break-words font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}

function StatePanel({
  detail,
  status,
  title
}: {
  detail: string;
  status: "ok" | "watch" | "blocked";
  title: string;
}) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader eyebrow="state" status={status} title={title} />
      <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{detail}</p>
    </section>
  );
}

function Badge({
  tone,
  value
}: {
  tone: "ok" | "watch" | "blocked" | "neutral";
  value: string;
}) {
  const className =
    tone === "ok"
      ? "bg-[var(--success-soft)] text-[var(--success)]"
      : tone === "watch"
        ? "bg-[var(--warning-soft)] text-[var(--warning)]"
        : tone === "blocked"
          ? "bg-[var(--danger-soft)] text-[var(--danger)]"
          : "bg-[var(--panel-muted)] text-[var(--muted)]";
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-[6px] px-2 py-1 text-xs font-semibold ${className}`}
    >
      {value}
    </span>
  );
}

function statusTone(status: string): "ok" | "watch" | "blocked" | "neutral" {
  if (status === "ok") {
    return "ok";
  }
  if (status === "under" || status === "over" || status === "blocked") {
    return "blocked";
  }
  if (status === "watch") {
    return "watch";
  }
  return "neutral";
}
