// Outbound HTTP to VATSIM/vNAS: one place for the timeout, User-Agent and error shape.

export class UpstreamError extends Error {
  /** Upstream HTTP status, or null when the request never got a response. */
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.status = status;
  }
}

export interface UpstreamOptions {
  userAgent: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export async function fetchUpstream(url: string, opts: UpstreamOptions): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { "User-Agent": opts.userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (e) {
    throw new UpstreamError(`${url}: ${e instanceof Error ? e.message : String(e)}`, null);
  }
  if (!res.ok) throw new UpstreamError(`${url}: HTTP ${res.status}`, res.status);
  return res;
}
