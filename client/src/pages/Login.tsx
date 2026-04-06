import { createSignal } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { login } from "../state/auth";

export default function Login() {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const navigate = useNavigate();

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email(), password());
      navigate("/");
    } catch (err: any) {
      setError(err.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        class="w-full max-w-sm space-y-5 border border-white/10 rounded-xl p-8 bg-white/[0.02]"
      >
        <h1 class="text-xl font-semibold text-white">Sign in to archers-drive</h1>
        <div class="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            class="w-full px-3 py-2 rounded-md bg-white/[0.04] border border-white/10 focus:border-white/30 outline-none text-sm"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            class="w-full px-3 py-2 rounded-md bg-white/[0.04] border border-white/10 focus:border-white/30 outline-none text-sm"
            required
          />
        </div>
        {error() && <p class="text-red-400 text-sm">{error()}</p>}
        <button
          type="submit"
          disabled={busy()}
          class="w-full py-2 rounded-md bg-white text-black font-medium text-sm disabled:opacity-50"
        >
          {busy() ? "Signing in…" : "Sign in"}
        </button>
        <p class="text-sm text-white/50 text-center">
          New here?{" "}
          <A href="/register" class="text-white hover:underline">
            Create an account
          </A>
        </p>
      </form>
    </div>
  );
}
