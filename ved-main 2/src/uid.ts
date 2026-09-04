let cachedUserId: string | null = null;

export function getUserId(): string {
  if (cachedUserId) return cachedUserId;

  const fromUrl = new URLSearchParams(window.location.search).get('uid');
  if (fromUrl) {
    cachedUserId = fromUrl;
    return cachedUserId;
  }

  console.warn('[ved] No ?uid= param found — falling back to dev-guest. This should never happen in the real webview.');
  cachedUserId = 'dev-guest';
  return cachedUserId;
}
