import { readRunWorkspacePageData } from '@/lib/runEvidenceReader';
import { RunWorkspace } from './RunWorkspace';
import { validRunLookupId } from '@/lib/runWorkspace';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export default async function RunDetailPage({ params }: { params: Promise<{runId: string}> }) {
  const { runId } = await params;
  const fetchedAt = new Date().toISOString();
  const initial = validRunLookupId(runId) ? await readRunWorkspacePageData(runId) : {
    apiBaseLabel: 'read-only operations endpoint', fetchedAt,
    runDetail: { status: 'invalid' as const, endpoint: '/batch/replay/runs', fetchedAt, data: null, message: 'Invalid run lookup ID' }
  };
  return <RunWorkspace key={runId} requestedId={runId} initial={initial} />;
}
