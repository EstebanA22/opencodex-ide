/**
 * Full OpenCodex registry catalog (providers + seed models).
 * Live models from the proxy are merged on top at runtime.
 * No API keys are stored here.
 */

export type ProviderAuth = "oauth" | "key" | "local" | "forward";

export type ProviderPreset = {
  id: string;
  name: string;
  auth: ProviderAuth;
  seedModels: string[];
};

/** Seed models commonly routed through each provider (provider/model or bare ids). */
export const PROVIDER_CATALOG: ProviderPreset[] = [
  { id: "openai", name: "OpenAI (Codex login)", auth: "forward", seedModels: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"] },
  { id: "openai-apikey", name: "OpenAI API", auth: "key", seedModels: ["openai-apikey/gpt-5.6-sol", "openai-apikey/gpt-5.6-terra", "openai-apikey/gpt-5.6-luna", "openai-apikey/gpt-5.6-sol-pro", "openai-apikey/gpt-5.6-terra-pro", "openai-apikey/gpt-5.6-luna-pro"] },
  { id: "anthropic", name: "Anthropic Claude", auth: "oauth", seedModels: ["anthropic/claude-opus-4-6", "anthropic/claude-sonnet-4-6", "anthropic/claude-haiku-4-5"] },
  { id: "anthropic-apikey", name: "Anthropic (API key)", auth: "key", seedModels: ["anthropic-apikey/claude-opus-4-6", "anthropic-apikey/claude-sonnet-4-6", "anthropic-apikey/claude-haiku-4-5"] },
  { id: "google", name: "Google Gemini", auth: "key", seedModels: ["google/gemini-3-pro-preview", "google/gemini-3-flash-preview", "google/gemini-2.5-pro", "google/gemini-2.5-flash"] },
  { id: "google-vertex", name: "Google Vertex AI", auth: "key", seedModels: ["google-vertex/gemini-2.5-pro", "google-vertex/gemini-2.5-flash"] },
  { id: "google-antigravity", name: "Google Antigravity", auth: "oauth", seedModels: ["google-antigravity/gemini-2.5-pro"] },
  { id: "xai", name: "xAI Grok", auth: "oauth", seedModels: ["xai/grok-4.5", "xai/grok-4", "xai/grok-3", "xai/grok-3-mini"] },
  { id: "kimi", name: "Kimi", auth: "oauth", seedModels: ["kimi/kimi-k2.7", "kimi/kimi-k2.6", "kimi/kimi-k2.5"] },
  { id: "kimi-code", name: "Kimi (coding)", auth: "key", seedModels: ["kimi-code/kimi-k2.7", "kimi-code/kimi-k2.5"] },
  { id: "moonshot", name: "Moonshot (Kimi API)", auth: "key", seedModels: ["moonshot/kimi-k2.5", "moonshot/moonshot-v1-128k"] },
  { id: "openrouter", name: "OpenRouter", auth: "key", seedModels: ["openrouter/openai/gpt-5.6-sol", "openrouter/anthropic/claude-opus-4.6", "openrouter/google/gemini-3-pro-preview", "openrouter/deepseek/deepseek-r1", "openrouter/meta-llama/llama-4-maverick"] },
  { id: "deepseek", name: "DeepSeek", auth: "key", seedModels: ["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"] },
  { id: "groq", name: "Groq", auth: "key", seedModels: ["groq/llama-3.3-70b-versatile", "groq/qwen/qwen3-32b", "groq/deepseek-r1-distill-llama-70b"] },
  { id: "mistral", name: "Mistral", auth: "key", seedModels: ["mistral/mistral-large-latest", "mistral/codestral-latest", "mistral/pixtral-large-latest"] },
  { id: "together", name: "Together", auth: "key", seedModels: ["together/meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", "together/deepseek-ai/DeepSeek-R1"] },
  { id: "fireworks", name: "Fireworks", auth: "key", seedModels: ["fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct", "fireworks/accounts/fireworks/models/deepseek-r1"] },
  { id: "cerebras", name: "Cerebras", auth: "key", seedModels: ["cerebras/llama-3.3-70b", "cerebras/qwen-3-32b"] },
  { id: "ollama", name: "Ollama (local)", auth: "local", seedModels: ["ollama/llama3.3", "ollama/qwen3", "ollama/deepseek-r1", "ollama/codellama"] },
  { id: "ollama-cloud", name: "Ollama Cloud", auth: "key", seedModels: ["ollama-cloud/gpt-oss:120b", "ollama-cloud/deepseek-v3.1"] },
  { id: "lm-studio", name: "LM Studio (local)", auth: "local", seedModels: ["lm-studio/local-model"] },
  { id: "vllm", name: "vLLM (local)", auth: "local", seedModels: ["vllm/local-model"] },
  { id: "azure-openai", name: "Azure OpenAI", auth: "key", seedModels: ["azure-openai/gpt-5", "azure-openai/gpt-4.1"] },
  { id: "huggingface", name: "Hugging Face", auth: "key", seedModels: ["huggingface/meta-llama/Llama-3.3-70B-Instruct", "huggingface/Qwen/Qwen3-32B"] },
  { id: "nvidia", name: "NVIDIA NIM", auth: "key", seedModels: ["nvidia/meta/llama-3.3-70b-instruct", "nvidia/deepseek-ai/deepseek-r1"] },
  { id: "qwen-cloud", name: "Qwen Cloud", auth: "key", seedModels: ["qwen-cloud/qwen3-max", "qwen-cloud/qwen3-coder-plus"] },
  { id: "zai", name: "Z.AI — GLM Coding Plan", auth: "key", seedModels: ["zai/glm-5", "zai/glm-4.7"] },
  { id: "zhipu-bigmodel", name: "Zhipu AI — BigModel", auth: "key", seedModels: ["zhipu-bigmodel/glm-4.7", "zhipu-bigmodel/glm-4.6"] },
  { id: "zhipu-bigmodel-coding", name: "Zhipu AI — BigModel Coding Plan", auth: "key", seedModels: ["zhipu-bigmodel-coding/glm-4.7"] },
  { id: "minimax", name: "MiniMax — Coding Plan", auth: "key", seedModels: ["minimax/MiniMax-M2.5", "minimax/MiniMax-M1"] },
  { id: "minimax-cn", name: "MiniMax — Coding Plan (CN)", auth: "key", seedModels: ["minimax-cn/MiniMax-M2.5"] },
  { id: "venice", name: "Venice", auth: "key", seedModels: ["venice/llama-3.3-70b", "venice/qwen3-235b"] },
  { id: "siliconflow", name: "SiliconFlow", auth: "key", seedModels: ["siliconflow/deepseek-ai/DeepSeek-V3", "siliconflow/Qwen/Qwen3-235B-A22B"] },
  { id: "deepinfra", name: "DeepInfra", auth: "key", seedModels: ["deepinfra/meta-llama/Meta-Llama-3.1-405B-Instruct", "deepinfra/deepseek-ai/DeepSeek-R1"] },
  { id: "hyperbolic", name: "Hyperbolic", auth: "key", seedModels: ["hyperbolic/meta-llama/Meta-Llama-3.1-405B-Instruct"] },
  { id: "cursor", name: "Cursor (experimental)", auth: "oauth", seedModels: ["cursor/gpt-5.6-sol", "cursor/gpt-5.6-terra", "cursor/gpt-5.6-luna", "cursor/claude-4.6-sonnet"] },
  { id: "github-copilot", name: "GitHub Copilot", auth: "oauth", seedModels: ["github-copilot/gpt-5", "github-copilot/claude-sonnet-4.6"] },
  { id: "kiro", name: "Kiro (AWS CodeWhisperer)", auth: "oauth", seedModels: ["kiro/auto"] },
  { id: "command-code", name: "Command Code - Auth", auth: "oauth", seedModels: ["command-code/default"] },
  { id: "commandcode", name: "Command Code - API", auth: "key", seedModels: ["commandcode/default"] },
  { id: "umans", name: "Umans AI Coding Plan", auth: "key", seedModels: ["umans/default"] },
  { id: "opencode-go", name: "opencode go", auth: "key", seedModels: ["opencode-go/default"] },
  { id: "opencode-zen", name: "opencode zen", auth: "key", seedModels: ["opencode-zen/default"] },
  { id: "opencode-free", name: "OpenCode Free", auth: "key", seedModels: ["opencode-free/default"] },
  { id: "neuralwatt", name: "Neuralwatt Cloud", auth: "key", seedModels: ["neuralwatt/default"] },
  { id: "cline", name: "Cline", auth: "key", seedModels: ["cline/default"] },
  { id: "cline-pass", name: "ClinePass", auth: "key", seedModels: ["cline-pass/default"] },
  { id: "orcarouter", name: "OrcaRouter", auth: "key", seedModels: ["orcarouter/auto"] },
  { id: "bizrouter", name: "BizRouter", auth: "key", seedModels: ["bizrouter/auto"] },
  { id: "nscale", name: "Nscale Serverless Inference", auth: "key", seedModels: ["nscale/default"] },
  { id: "vultr", name: "Vultr Serverless Inference", auth: "key", seedModels: ["vultr/default"] },
  { id: "baseten", name: "Baseten Model APIs", auth: "key", seedModels: ["baseten/default"] },
  { id: "sambanova", name: "SambaNova Cloud", auth: "key", seedModels: ["sambanova/default"] },
  { id: "nebius", name: "Nebius Token Factory", auth: "key", seedModels: ["nebius/default"] },
  { id: "digitalocean", name: "DigitalOcean Serverless Inference", auth: "key", seedModels: ["digitalocean/default"] },
  { id: "scaleway", name: "Scaleway Generative APIs", auth: "key", seedModels: ["scaleway/default"] },
  { id: "firepass", name: "Fire Pass (Fireworks Kimi)", auth: "key", seedModels: ["firepass/default"] },
  { id: "nanogpt", name: "NanoGPT", auth: "key", seedModels: ["nanogpt/default"] },
  { id: "synthetic", name: "Synthetic", auth: "key", seedModels: ["synthetic/default"] },
  { id: "tencent-coding-plan", name: "Tencent Cloud Coding Plan", auth: "key", seedModels: ["tencent-coding-plan/default"] },
  { id: "volcengine", name: "Volcengine Ark", auth: "key", seedModels: ["volcengine/default"] },
  { id: "volcengine-coding-plan", name: "Volcengine Ark Coding Plan", auth: "key", seedModels: ["volcengine-coding-plan/default"] },
  { id: "volcengine-agent-plan", name: "Volcengine Ark Agent Plan", auth: "key", seedModels: ["volcengine-agent-plan/default"] },
  { id: "qianfan", name: "Qianfan (Baidu)", auth: "key", seedModels: ["qianfan/default"] },
  { id: "alibaba", name: "Alibaba Coding Plan", auth: "key", seedModels: ["alibaba/default"] },
  { id: "alibaba-token-plan", name: "Alibaba Token Plan (Beijing)", auth: "key", seedModels: ["alibaba-token-plan/default"] },
  { id: "alibaba-token-plan-intl", name: "Alibaba Token Plan (International)", auth: "key", seedModels: ["alibaba-token-plan-intl/default"] },
  { id: "parallel", name: "Parallel", auth: "key", seedModels: ["parallel/default"] },
  { id: "zenmux", name: "ZenMux", auth: "key", seedModels: ["zenmux/default"] },
  { id: "litellm", name: "LiteLLM (self-hosted)", auth: "key", seedModels: ["litellm/default"] },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", auth: "key", seedModels: ["vercel-ai-gateway/default"] },
  { id: "xiaomi", name: "Xiaomi MiMo", auth: "key", seedModels: ["xiaomi/default"] },
  { id: "mimo", name: "Xiaomi MiMo (token plan)", auth: "key", seedModels: ["mimo/default"] },
  { id: "mimo-free", name: "MiMo Free", auth: "key", seedModels: ["mimo-free/default"] },
  { id: "kilo", name: "Kilo", auth: "key", seedModels: ["kilo/default"] },
  { id: "cloudflare-ai-gateway", name: "Cloudflare AI Gateway", auth: "key", seedModels: ["cloudflare-ai-gateway/default"] },
  { id: "cloudflare-workers-ai", name: "Cloudflare Workers AI", auth: "key", seedModels: ["cloudflare-workers-ai/default"] },
  { id: "gitlab-duo", name: "GitLab Duo", auth: "key", seedModels: ["gitlab-duo/default"] },
  { id: "custom", name: "Custom provider", auth: "key", seedModels: [] },
];

export function allSeedModels(): string[] {
  const set = new Set<string>();
  for (const p of PROVIDER_CATALOG) {
    for (const m of p.seedModels) set.add(m);
  }
  return [...set].sort();
}

export function mergeModelCatalog(live: string[]): Array<{ id: string; source: "live" | "catalog" }> {
  const map = new Map<string, "live" | "catalog">();
  for (const id of allSeedModels()) map.set(id, "catalog");
  for (const id of live) map.set(id, "live");
  return [...map.entries()]
    .map(([id, source]) => ({ id, source }))
    .sort((a, b) => {
      if (a.source !== b.source) return a.source === "live" ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
}
