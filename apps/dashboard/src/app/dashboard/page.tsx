const safetyRows = [
  {
    label: "TRADING_ENABLED",
    value: "false",
    tone: "ok",
    detail: "Live trading is not enabled from this dashboard.",
  },
  {
    label: "BROKER_PROVIDER",
    value: "mock",
    tone: "ok",
    detail: "N1 skeleton keeps broker mutation outside the UI surface.",
  },
  {
    label: "OrderRouter",
    value: "not connected",
    tone: "blocked",
    detail: "No live OrderIntent path is exposed.",
  },
  {
    label: "MCP mutation tools",
    value: "not exposed",
    tone: "blocked",
    detail: "No place_order or raw command surface is available.",
  },
];

const plannedSections = [
  ["Portfolio", "Strategy bucket, cash, and hedge compliance"],
  ["Risk Gate", "AI decision to deterministic gate trace"],
  ["Validation", "Policy and strategy bucket robustness comparison"],
  ["Strategy Tests", "Isolated bucket replay matrix and progress"],
  ["Audit", "Masked event and rejected action review"],
];

export default function DashboardPage() {
  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-[var(--border)] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--accent)]">
              Paper-only operations
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
              Live Readiness
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Next.js dashboard skeleton for read-only safety posture and future
              paper replay workflows. This screen does not enable live orders.
            </p>
          </div>
          <nav aria-label="Dashboard sections" className="flex flex-wrap gap-2">
            <a
              className="rounded-[6px] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white"
              href="/dashboard"
            >
              Readiness
            </a>
            {plannedSections.map(([label]) => (
              <span
                aria-disabled="true"
                className="rounded-[6px] border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]"
                key={label}
              >
                {label}
              </span>
            ))}
          </nav>
        </header>

        <section
          aria-label="Live trading disabled status"
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
        >
          {safetyRows.map((row) => (
            <article
              className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4"
              key={row.label}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-[var(--muted)]">
                  {row.label}
                </h2>
                <span
                  className={
                    row.tone === "ok"
                      ? "rounded-[6px] bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent)]"
                      : "rounded-[6px] bg-[var(--danger-soft)] px-2 py-1 text-xs font-semibold text-[var(--danger)]"
                  }
                >
                  {row.tone === "ok" ? "safe" : "disabled"}
                </span>
              </div>
              <p className="mt-3 font-mono text-lg font-semibold">
                {row.value}
              </p>
              <p className="mt-3 text-sm leading-5 text-[var(--muted)]">
                {row.detail}
              </p>
            </article>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <div>
            <div className="py-3">
              <h2 className="text-base font-semibold">N1 Scope</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {plannedSections.map(([label, description]) => (
                <div
                  className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-3"
                  key={label}
                >
                  <p className="text-sm font-semibold">{label}</p>
                  <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
                    {description}
                  </p>
                  <p className="mt-3 font-mono text-xs text-[var(--warning)]">
                    planned
                  </p>
                </div>
              ))}
            </div>
          </div>

          <aside className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
            <h2 className="text-base font-semibold">Boundary</h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <div>
                <dt className="text-[var(--muted)]">Mutation surface</dt>
                <dd className="mt-1 font-mono">none in N1</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Data source</dt>
                <dd className="mt-1 font-mono">static placeholder</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Backend behavior</dt>
                <dd className="mt-1 font-mono">unchanged</dd>
              </div>
            </dl>
          </aside>
        </section>
      </div>
    </main>
  );
}
