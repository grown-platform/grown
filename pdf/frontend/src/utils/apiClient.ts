// Standalone dev talks to the backend at /api and /auth/login. When integrated
// under grown-workspace the app is proxied: API at /pdf-api/api and login at
// /pdf-api/auth/login. Both are overridable at build/dev time via VITE_* env.
export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
export const LOGIN_URL =
  (import.meta.env.VITE_LOGIN_URL as string | undefined) ?? "/auth/login";
export const LOGOUT_URL =
  (import.meta.env.VITE_LOGOUT_URL as string | undefined) ?? "/auth/logout";

// When mounted inside grown (GROWN_PDF_BUILTIN), grown owns the session and the
// standalone PDF OIDC endpoints (/auth/login) don't exist. Redirect 401s to
// grown's OIDC start instead so there's no second login.
export const GROWN_INTEGRATED =
  (import.meta.env.VITE_GROWN_INTEGRATED as string | undefined) === "true";
export const loginRedirectURL = GROWN_INTEGRATED
  ? ((import.meta.env.VITE_GROWN_LOGIN_URL as string | undefined) ??
    "/api/v1/auth/login")
  : LOGIN_URL;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // CSRF gate: the backend requires this custom header on state-changing
    // /api/* requests when authenticating via cookie. Cross-origin pages
    // can't set custom headers without CORS preflight, which the server
    // denies for unknown origins.
    "X-Requested-With": "pdf-frontend",
  };

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: "include", // Send cookies for auth
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    // Redirect to login (grown's OIDC start when integrated, else the
    // standalone PDF login).
    window.location.href = loginRedirectURL;
    throw new Error("Unauthorized");
  }

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export const apiClient = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
