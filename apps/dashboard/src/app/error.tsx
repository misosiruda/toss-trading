"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <section className="w-full max-w-lg rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-5">
        <p className="text-sm font-semibold text-[var(--danger)]">
          Dashboard render failed
        </p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {error.message || "Unknown dashboard error"}
        </p>
        <button
          className="mt-4 rounded-[6px] border border-[var(--border)] px-3 py-2 text-sm font-medium"
          onClick={reset}
          type="button"
        >
          Retry
        </button>
      </section>
    </main>
  );
}
