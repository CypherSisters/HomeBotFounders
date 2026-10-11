// Base API client for PuffPAI backend.
//
// THE BROWSER NEVER HOLDS THE BACKEND KEY.
//
// Every call below goes to the same-origin proxy at /api/pai, which attaches
// `Authorization: Bearer <PUFFPAI_API_KEY>` server-side and rebuilds the
// forwarded headers from an allow-list — so a client-sent Authorization was
// already being DROPPED, not used. The old getApiKey()/setApiKey() pair
// therefore bought nothing and cost plenty: it kept the appliance's backend
// credential in localStorage on the wall kiosk and on every household phone,
// where any script on the page could read it. Both are gone.
//
// A NEXT_PUBLIC_ env var was never used here and must never be: Next inlines
// those into the client bundle, which ships the key to every browser on the
// LAN in plain JavaScript. If a future call needs a credential the proxy
// cannot supply, add it to the proxy, not to this file.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Removing the code that WROTE the key does not remove the copies it already
// left behind: every browser that used the old Profile > API Key card still has
// the credential in localStorage, including the always-on kiosk. Purge on
// module load. Safe to run forever — a no-op once the key is gone, and nothing
// reads that entry any more.
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('puffpai_api_key');
  } catch {
    /* storage disabled or partitioned: nothing to clean up */
  }
}

function getHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' };
}

export async function apiGet<T = any>(
  endpoint: string,
  // `signal` lets a caller put a deadline on a request that can legitimately
  // hang: the ZIM title index on an 8-million-article pack is the known case,
  // and a spinner that never resolves is what made the Knowledge page look
  // broken. Optional, so every existing call is unchanged.
  opts?: { cache?: RequestCache; signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: getHeaders(),
    cache: opts?.cache,
    signal: opts?.signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

/**
 * GET that keeps the HTTP status instead of throwing.
 *
 * A 404 is part of the contract for routes that may not be deployed yet
 * (`/ha/home` on a box running an older backend): the caller has to tell
 * "not built yet" apart from "the request failed", and apiGet flattens both
 * into one Error.
 */
export async function apiGetRaw<T = any>(
  endpoint: string,
  // `signal` as in apiGet: a poll that can hang needs a deadline, otherwise a
  // stalled socket freezes the caller's retry loop.
  opts?: { cache?: RequestCache; signal?: AbortSignal },
): Promise<{ status: number; ok: boolean; data: T | null }> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: getHeaders(),
    cache: opts?.cache ?? 'no-store',
    signal: opts?.signal,
  });
  const data = (await res.json().catch(() => null)) as T | null;
  return { status: res.status, ok: res.ok, data };
}

export async function apiPost<T = any>(endpoint: string, body?: any): Promise<T> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

/**
 * POST that keeps the HTTP status and the raw body instead of throwing.
 *
 * Some backend routes (e.g. POST /dashboard/cameras) answer non-2xx with a
 * human-readable `message` and no `error` key — apiPost would discard both.
 * Use this when the status code is part of the contract.
 */
export async function apiPostRaw<T = any>(
  endpoint: string,
  body?: any
): Promise<{ status: number; ok: boolean; data: T | null }> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as T | null;
  return { status: res.status, ok: res.ok, data };
}

export async function apiPut<T = any>(endpoint: string, body?: any): Promise<T> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export async function apiDelete<T = any>(endpoint: string): Promise<T> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// SSE streaming for chat
export function apiStream(endpoint: string, body: any, onChunk: (text: string) => void, onDone: () => void) {
  fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
  }).then(async (res) => {
    if (!res.ok) throw new Error(res.statusText);
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) { onDone(); return; }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') { onDone(); return; }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) onChunk(content);
          } catch { /* skip non-JSON lines */ }
        }
      }
    }
    onDone();
  }).catch(() => onDone());
}

// Health check
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export { API_URL };
