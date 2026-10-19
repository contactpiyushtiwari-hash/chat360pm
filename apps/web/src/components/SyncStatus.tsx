import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtInstant } from '../lib/format';
import { Badge } from './ui';

interface WorkbookInfo {
  state: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  webUrl: string | null;
}

const LABEL: Record<string, string> = {
  synced: 'Excel up to date',
  pending: 'Excel update pending',
  syncing: 'Updating Excel…',
  failed: 'Excel update failed',
  conflict: 'Excel conflict — review needed',
  not_created: 'No workbook yet',
};

/**
 * Shows the real Excel synchronisation outcome. While an update is pending it polls the project
 * (briefly) so the user sees success or failure rather than an optimistic "saved".
 */
export function SyncStatus({
  projectId,
  initial,
  poll = false,
}: {
  projectId: string;
  initial: WorkbookInfo;
  poll?: boolean;
}) {
  const [wb, setWb] = useState(initial);
  useEffect(() => setWb(initial), [initial]);
  useEffect(() => {
    if (!poll && wb.state !== 'pending' && wb.state !== 'syncing') return;
    let stopped = false;
    let tries = 0;
    const tick = async () => {
      if (stopped || tries++ > 10) return;
      try {
        const r = await api<{ project: { workbook: WorkbookInfo } }>(`/api/projects/${projectId}`);
        if (stopped) return;
        setWb(r.project.workbook);
        if (r.project.workbook.state === 'pending' || r.project.workbook.state === 'syncing')
          setTimeout(tick, 1500);
      } catch {
        /* the badge keeps its last known state */
      }
    };
    const t = setTimeout(tick, 800);
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }, [projectId, poll]);
  return (
    <span className="sync-status" aria-live="polite">
      <Badge value={wb.state} label={LABEL[wb.state] ?? wb.state} />
      {wb.state === 'synced' && wb.lastSyncedAt && (
        <span className="hint"> {fmtInstant(wb.lastSyncedAt)}</span>
      )}
      {(wb.state === 'failed' || wb.state === 'conflict') && wb.lastError && (
        <span className="hint"> {wb.lastError}</span>
      )}
    </span>
  );
}
