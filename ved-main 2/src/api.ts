import type { FlowType, OfferingStats, SessionPayload } from './types';
import { API_BASE } from './apiBase';

async function post(path: string, payload: SessionPayload): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
  } catch {
    // UI remains usable while the Python API is offline during frontend work.
  }
}

const emptyStats: OfferingStats = { ok: false, is_new_user: true, counts_30d: {}, recently_used_item_id: null };

async function getStats(flowType: FlowType, userId: string): Promise<OfferingStats> {
  try {
    const response = await fetch(`${API_BASE}/stats/${flowType}?user_id=${encodeURIComponent(userId)}`);
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    return await response.json();
  } catch {
    return emptyStats;
  }
}

export const vedApi = {
  start: (payload: SessionPayload) => post('/session/start', payload),
  progress: (payload: SessionPayload) => post('/session/progress', payload),
  complete: (payload: SessionPayload) => post('/session/complete', payload),
  getStats
};
