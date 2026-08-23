/**
 * Desktop Agent Bridge
 * Invokes native desktop operations on the local Python agent.
 */

export class DesktopBridge {
  private static baseUrl = "http://127.0.0.1:8765";

  public static async call(tool: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; result?: any; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, args }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error || `HTTP ${res.status} from desktop agent` };
      }

      const data = await res.json();
      if (data.error) {
        return { ok: false, error: data.error };
      }
      return { ok: true, result: data.result ?? data };
    } catch (err: any) {
      return { ok: false, error: `Desktop agent unreachable at ${this.baseUrl}: ${err.message}` };
    }
  }

  public static async isAlive(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }
}
