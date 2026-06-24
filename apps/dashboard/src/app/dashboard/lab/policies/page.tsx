import Link from "next/link";
import { PolicyBuilderForm } from "./PolicyBuilderForm";

export default function PolicyBuilderPage() {
  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="border-b border-[var(--border)] pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-[var(--accent)]">
                Policy Lab
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                Paper Policy Builder
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                PortfolioPolicy draft를 strategy bucket, cash reserve, hedge,
                exposure cap 단위로 구성합니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <Link
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-medium"
                href="/dashboard"
              >
                Dashboard
              </Link>
              <span className="rounded-[6px] border border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-2 font-semibold text-[var(--danger)]">
                paper-only draft
              </span>
            </div>
          </div>
        </header>

        <section
          aria-label="Policy safety boundary"
          className="grid gap-3 md:grid-cols-3"
        >
          <BoundaryCard label="Persistence" value="not stored" />
          <BoundaryCard label="Backend validation" value="required" />
          <BoundaryCard label="Live mutation" value="disabled" />
        </section>

        <PolicyBuilderForm />
      </div>
    </main>
  );
}

function BoundaryCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <h2 className="text-sm font-medium text-[var(--muted)]">{label}</h2>
      <p className="mt-3 font-mono text-lg font-semibold">{value}</p>
    </article>
  );
}
