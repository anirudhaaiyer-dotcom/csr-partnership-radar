export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class SourceError extends Error {
  constructor(public errorClass: string, message: string) {
    super(message);
  }
}

export class QuotaError extends Error {
  constructor(public retryAfterSeconds: number | null, message = 'quota exhausted') {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Controlled retries: at most `retries` extra attempts on network errors, timeouts and 5xx. 429 is never retried here. */
export async function fetchRetry(
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number; backoffMs?: number } = {},
  f: FetchLike = fetch,
): Promise<Response> {
  const { timeoutMs = 10000, retries = 2, backoffMs = 600, ...rest } = init;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await f(url, { ...rest, signal: ctl.signal });
      clearTimeout(timer);
      if (res.status === 429) return res;
      if (res.status >= 500 && attempt < retries) {
        lastErr = new SourceError(`http_${res.status}`, `HTTP ${res.status}`);
        await sleep(backoffMs * (attempt + 1));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      const aborted = (e as Error)?.name === 'AbortError';
      lastErr = new SourceError(aborted ? 'timeout' : 'network', aborted ? 'request timed out' : String((e as Error)?.message ?? e));
      if (attempt < retries) await sleep(backoffMs * (attempt + 1));
    }
  }
  throw lastErr instanceof SourceError ? lastErr : new SourceError('network', String(lastErr));
}
