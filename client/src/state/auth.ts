import { createSignal } from "solid-js";
import { api } from "../lib/api";

export interface User {
  id: string;
  email: string;
  name: string;
}

const [user, setUser] = createSignal<User | null>(null);
const [authLoading, setAuthLoading] = createSignal(true);

export { user, authLoading };

export async function initAuth() {
  try {
    const data = await api.get<{ user: User }>("/auth/me");
    setUser(data.user);
  } catch {
    // not logged in
  } finally {
    setAuthLoading(false);
  }
}

export async function login(email: string, password: string) {
  const data = await api.post<{ user: User }>("/auth/login", { email, password });
  setUser(data.user);
}

export async function register(email: string, name: string, password: string) {
  const data = await api.post<{ user: User }>("/auth/register", { email, name, password });
  setUser(data.user);
}

export async function logout() {
  await api.post("/auth/logout");
  setUser(null);
}
