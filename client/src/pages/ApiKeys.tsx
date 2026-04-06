import { createSignal, createResource, For, Show } from "solid-js";
import { api } from "../lib/api";

interface ApiKey {
  id: string;
  label: string;
  prefix: string;
  scope: "read" | "write";
  createdAt: string;
  lastUsedAt: string | null;
}

export default function ApiKeys() {
  const [keys, { refetch }] = createResource(async () => {
    const data = await api.get<{ keys: ApiKey[] }>("/api-keys");
    return data.keys;
  });

  const [label, setLabel] = createSignal("");
  const [scope, setScope] = createSignal<"read" | "write">("read");
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [newToken, setNewToken] = createSignal<string | null>(null);

  async function handleCreate(e: Event) {
    e.preventDefault();
    if (!label().trim()) return;
    setCreating(true);
    setError(null);
    try {
      const data = await api.post<{ token: string }>("/api-keys", {
        label: label(),
        scope: scope(),
      });
      setNewToken(data.token);
      setLabel("");
      refetch();
    } catch (err: any) {
      setError(err.message ?? "Could not create key");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(key: ApiKey) {
    if (!confirm(`Revoke "${key.label}"? This cannot be undone.`)) return;
    await api.delete(`/api-keys/${key.id}`);
    refetch();
  }

  return (
    <div class="max-w-3xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 class="text-xl font-semibold text-white mb-1">API keys</h1>
        <p class="text-sm text-white/50">
          Issue keys to give external apps and AI agents access to your drive.
        </p>
      </div>

      <form onSubmit={handleCreate} class="border border-white/10 rounded-xl p-5 space-y-4 bg-white/[0.02]">
        <div class="flex gap-3">
          <input
            type="text"
            placeholder="Label (e.g. my-agent-prod)"
            value={label()}
            onInput={(e) => setLabel(e.currentTarget.value)}
            class="flex-1 px-3 py-2 rounded-md bg-white/[0.04] border border-white/10 focus:border-white/30 outline-none text-sm"
            required
          />
          <select
            value={scope()}
            onChange={(e) => setScope(e.currentTarget.value as "read" | "write")}
            class="px-3 py-2 rounded-md bg-white/[0.04] border border-white/10 outline-none text-sm"
          >
            <option value="read">Read-only</option>
            <option value="write">Read &amp; write</option>
          </select>
          <button
            type="submit"
            disabled={creating()}
            class="px-4 py-2 rounded-md bg-white text-black font-medium text-sm disabled:opacity-50"
          >
            {creating() ? "Creating…" : "Create key"}
          </button>
        </div>
        <p class="text-xs text-white/50">
          {scope() === "read"
            ? "Allows read-only access. This key cannot be used to modify or edit files in your drive."
            : "Allows reading, writing, and modifying files in your drive."}
        </p>
        {error() && <p class="text-red-400 text-sm">{error()}</p>}
      </form>

      <Show when={newToken()}>
        <div class="border border-amber-400/30 bg-amber-400/[0.05] rounded-xl p-5 space-y-3">
          <p class="text-sm text-amber-200 font-medium">
            Copy this key now — you won't see it again.
          </p>
          <code class="block text-xs break-all bg-black/40 rounded-md p-3 text-amber-100">
            {newToken()}
          </code>
          <button
            onClick={() => setNewToken(null)}
            class="text-xs text-white/60 hover:text-white"
          >
            I've copied it. Dismiss.
          </button>
        </div>
      </Show>

      <div>
        <h2 class="text-sm font-medium text-white/70 mb-3">Your keys</h2>
        <Show
          when={keys() && keys()!.length > 0}
          fallback={
            <p class="text-sm text-white/40 border border-dashed border-white/10 rounded-xl p-8 text-center">
              No API keys yet.
            </p>
          }
        >
          <div class="border border-white/10 rounded-xl divide-y divide-white/10">
            <For each={keys()}>
              {(key) => (
                <div class="flex items-center justify-between px-4 py-3">
                  <div class="min-w-0">
                    <p class="text-white text-sm">{key.label}</p>
                    <p class="text-xs text-white/40 mt-0.5">
                      <code>{key.prefix}…</code> · {key.scope === "write" ? "read & write" : "read-only"}
                      {key.lastUsedAt
                        ? ` · last used ${new Date(key.lastUsedAt).toLocaleString()}`
                        : " · never used"}
                    </p>
                  </div>
                  <button
                    onClick={() => revoke(key)}
                    class="text-xs text-white/40 hover:text-red-400"
                  >
                    Revoke
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
