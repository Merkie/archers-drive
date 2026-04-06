import { RouteSectionProps, useLocation, useNavigate, A } from "@solidjs/router";
import { onMount, Show, createEffect } from "solid-js";
import { user, authLoading, initAuth, logout } from "./state/auth";

const PUBLIC_ROUTES = ["/login", "/register"];

export default function App(props: RouteSectionProps) {
  const location = useLocation();
  const navigate = useNavigate();

  onMount(() => {
    initAuth();
  });

  createEffect(() => {
    if (authLoading()) return;
    const isPublic = PUBLIC_ROUTES.includes(location.pathname);
    if (!user() && !isPublic) navigate("/login");
    if (user() && isPublic) navigate("/");
  });

  return (
    <Show when={!authLoading()} fallback={<Loading />}>
      <Show when={user()} fallback={props.children}>
        <div class="min-h-screen flex flex-col">
          <header class="border-b border-white/10 px-6 py-3 flex items-center justify-between">
            <div class="flex items-center gap-6">
              <span class="font-semibold tracking-tight text-white">archers-drive</span>
              <nav class="flex items-center gap-4 text-sm">
                <A
                  href="/"
                  end
                  class="text-white/60 hover:text-white"
                  activeClass="!text-white"
                >
                  Drive
                </A>
                <A
                  href="/api-keys"
                  class="text-white/60 hover:text-white"
                  activeClass="!text-white"
                >
                  API Keys
                </A>
              </nav>
            </div>
            <div class="flex items-center gap-3 text-sm">
              <span class="text-white/50">{user()?.email}</span>
              <button
                onClick={async () => {
                  await logout();
                  navigate("/login");
                }}
                class="text-white/60 hover:text-white"
              >
                Sign out
              </button>
            </div>
          </header>
          <main class="flex-1">{props.children}</main>
        </div>
      </Show>
    </Show>
  );
}

function Loading() {
  return (
    <div class="min-h-screen flex items-center justify-center text-white/50 text-sm">
      Loading…
    </div>
  );
}
