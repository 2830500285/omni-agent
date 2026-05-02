export interface WorkbenchApiOptions {
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
}

export class WorkbenchApi {
  private readonly fetchImpl: typeof fetch;

  public constructor(private readonly options: WorkbenchApiOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  public post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  public async optional<T>(path: string, fallback: T): Promise<T> {
    try {
      return await this.get<T>(path);
    } catch {
      return fallback;
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.options.token) {
      headers.set("authorization", `Bearer ${this.options.token}`);
    }
    const response = await this.fetchImpl(path, { ...init, headers });
    if (!response.ok) {
      throw new Error(`${path} -> ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
