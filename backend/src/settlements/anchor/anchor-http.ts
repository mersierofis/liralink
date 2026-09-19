/** IBAN-shaped tokens (compact or grouped in fours) — redacted once, here, at the anchor boundary. */
const IBAN_LIKE = /\bTR\d{2}(?:\s?[\d*]{4}){5}\s?[\d*]{2}\b/gi;

export function redactIban(text: string): string {
  return text.replace(IBAN_LIKE, (m) => {
    const c = m.replace(/\s/g, '');
    return `${c.slice(0, 4)} **** **** **** **** **** ${c.slice(-2)}`;
  });
}

export class AnchorHttpError extends Error {
  override readonly name = 'AnchorHttpError';
  constructor(
    readonly status: number,
    readonly body: string,
    what: string,
  ) {
    super(redactIban(`${what} → HTTP ${status}: ${body.slice(0, 300)}`));
  }
}

export interface AnchorRequest {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  jwt?: string;
  query?: Record<string, string>;
  /** Sent as multipart/form-data. */
  form?: Record<string, string>;
  json?: unknown;
}

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 256 * 1024;

/** JSON over HTTPS to the anchor. Non-2xx throws AnchorHttpError (body kept for classification). */
export class AnchorHttp {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async call<T = Record<string, unknown>>(what: string, req: AnchorRequest): Promise<T> {
    const url = new URL(req.url);
    if (req.query) for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, v);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (req.jwt) headers.authorization = `Bearer ${req.jwt}`;
    let body: BodyInit | undefined;
    if (req.form) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(req.form)) fd.append(k, v);
      body = fd;
    } else if (req.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(req.json);
    }
    const res = await this.fetchFn(url, { method: req.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error(`${what}: response over ${MAX_BYTES} bytes`);
    if (!res.ok) throw new AnchorHttpError(res.status, text, what);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`${what}: response is not JSON`);
    }
  }
}
