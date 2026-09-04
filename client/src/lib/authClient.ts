export type UserRole = "admin" | "user";

export type AuthUser = {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
};

export type LoginResponse = {
  ok: boolean;
  otpSentTo: string;
  emailSent: boolean;
  emailConfigured: boolean;
  debugCode?: string;
};

const TOKEN_KEY = "field-ledger-auth-token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const saveToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  const activeToken = token ?? getToken();
  if (activeToken) headers.Authorization = `Bearer ${activeToken}`;

  const response = await fetch(path, { ...options, headers });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error || "تعذر الاتصال بالخادم");
  return data as T;
}

export const loginRequest = (username: string, password: string) =>
  request<LoginResponse>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }, null);

export const verifyOtpRequest = (username: string, code: string) =>
  request<{ ok: boolean; token: string; user: AuthUser }>("/api/auth/verify-otp", { method: "POST", body: JSON.stringify({ username, code }) }, null);

export const fetchMe = (token: string) => request<{ ok: boolean; user: AuthUser }>("/api/auth/me", {}, token);

export const logoutRequest = (token: string) => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }, token);

export const listUsers = () => request<{ ok: boolean; users: AuthUser[] }>("/api/users");

export const createUser = (username: string, password: string, role: UserRole) =>
  request<{ ok: boolean; user: AuthUser }>("/api/users", { method: "POST", body: JSON.stringify({ username, password, role }) });

export const updateUserPassword = (id: string, password: string) =>
  request<{ ok: boolean }>(`/api/users/${id}/password`, { method: "PATCH", body: JSON.stringify({ password }) });

export const deleteUser = (id: string) => request<{ ok: boolean }>(`/api/users/${id}`, { method: "DELETE" });

export type InventoryState = { buildingName: string; apartments: unknown[]; items: unknown[] };
export type AuditLog = { id: string; username: string; action: string; entity: string; details?: string; createdAt: string };
export const fetchInventory = () => request<{ ok: boolean; state: InventoryState }>("/api/inventory");
export const saveInventory = (state: InventoryState) => request<{ ok: boolean; state: InventoryState }>("/api/inventory", { method: "PUT", body: JSON.stringify({ state }) });
export const listAudit = () => request<{ ok: boolean; logs: AuditLog[] }>("/api/audit");
