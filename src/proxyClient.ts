export type ProxySettings = {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type SettingsFn = () => ProxySettings;

export class ProxyClient {
  constructor(private readonly settings: SettingsFn) {}

  rootUrl(): string {
    const base = this.settings().baseUrl.replace(/\/+$/, "");
    return base.replace(/\/v1$/, "") || "http://127.0.0.1:10100";
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.rootUrl()}/healthz`, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    const { baseUrl, apiKey } = this.settings();
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`models HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => m.id);
  }

  async chat(params: {
    model: string;
    messages: ChatMessage[];
    onDelta: (text: string) => void;
    signal?: AbortSignal;
  }): Promise<string> {
    const { baseUrl, apiKey } = this.settings();
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        stream: true,
      }),
      signal: params.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(`chat HTTP ${res.status}: ${errText.slice(0, 400)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            params.onDelta(delta);
          }
        } catch {
          // ignore partial JSON frames
        }
      }
    }

    return full;
  }
}
