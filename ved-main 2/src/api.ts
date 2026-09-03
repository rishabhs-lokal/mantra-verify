import type { SessionPayload } from './types';

async function post(path: string, payload: SessionPayload): Promise<void> {
  try {
    const response = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
  } catch {
    // UI remains usable while the Python API is offline during frontend work.
  }
}

export const vedApi = {
  start: (payload: SessionPayload) => post('/session/start', payload),
  progress: (payload: SessionPayload) => post('/session/progress', payload),
  complete: (payload: SessionPayload) => post('/session/complete', payload)
};
