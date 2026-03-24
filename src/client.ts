/**
 * Gateway HTTP client — stateless, no API keys.
 * All requests are public or use body params for identity.
 */

export interface GakiConfig {
  gatewayUrl: string;
}

export interface GakiResponse {
  status: number;
  body: any;
}

export class GakiClient {
  private config: GakiConfig;

  constructor(config: GakiConfig) {
    this.config = config;
  }

  /** GET request — no auth. */
  async get(path: string): Promise<GakiResponse> {
    const res = await fetch(`${this.config.gatewayUrl}${path}`, {
      headers: { "Content-Type": "application/json" },
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  /** POST request — no auth, body params only. */
  async post(path: string, body?: any): Promise<GakiResponse> {
    const opts: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${this.config.gatewayUrl}${path}`, opts);
    return { status: res.status, body: (await res.json()) as any };
  }

  /** PUT request — body params for identity. */
  async put(path: string, body?: any): Promise<GakiResponse> {
    const opts: RequestInit = {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${this.config.gatewayUrl}${path}`, opts);
    return { status: res.status, body: (await res.json()) as any };
  }

  /** DELETE request — params in query string. */
  async delete(path: string): Promise<GakiResponse> {
    const res = await fetch(`${this.config.gatewayUrl}${path}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    return { status: res.status, body: (await res.json()) as any };
  }
}
