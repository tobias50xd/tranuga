export interface ApiCall { url: string; status: 'pending' | 'ok' | 'error'; at: number; duration?: number; error?: string; cached?: boolean }
export class ApiError extends Error {
  constructor(message: string, public readonly url: string, public readonly status?: number) { super(message); this.name = 'ApiError'; }
}
/** Browser requests remain same-origin; no upstream cookies or credentials are sent. */
export class ApiClient {
  readonly calls: ApiCall[] = [];
  private cache = new Map<string, { expires: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis), private readonly gateway = '/api', private readonly timeout = 15000) {}
  clear() { this.cache.clear(); }
  async get<T = unknown>(url: string, ttl = 15000, format: 'json' | 'text' = 'json'): Promise<T> {
    const key = `${format}:${url}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value as T;
    const running = this.pending.get(key);
    if (running) return running as Promise<T>;
    const promise = this.request<T>(url, format).then(value => { if (ttl > 0) this.cache.set(key, { expires: Date.now() + ttl, value }); return value; }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
  private async request<T>(url: string, format: 'json' | 'text'): Promise<T> {
    const call: ApiCall = { url, status: 'pending', at: Date.now() };
    this.calls.unshift(call); this.calls.splice(100);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const target = this.gateway ? `${this.gateway}?url=${encodeURIComponent(url)}` : url;
      const response = await this.fetcher(target, { method: 'GET', signal: controller.signal, credentials: 'omit', headers: { Accept: format === 'json' ? 'application/json' : 'application/vnd.google-earth.kml+xml, application/xml, text/xml' } });
      if (!response.ok) throw new ApiError(`Transit request failed (${response.status}).`, url, response.status);
      const value = format === 'json' ? await response.json() : await response.text();
      call.status = 'ok'; return value as T;
    } catch (error) {
      const problem = error instanceof ApiError ? error : new ApiError(controller.signal.aborted ? 'Transit request timed out.' : error instanceof SyntaxError ? 'Transit server returned invalid JSON.' : 'Transit server could not be reached.', url);
      call.status = 'error'; call.error = problem.message; throw problem;
    } finally { clearTimeout(timer); call.duration = Date.now() - call.at; }
  }
}
