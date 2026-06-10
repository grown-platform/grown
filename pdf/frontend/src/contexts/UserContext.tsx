import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import {
  API_BASE,
  loginRedirectURL,
  LOGOUT_URL,
} from "../utils/apiClient";

interface UserInfo {
  id: string;
  name: string;
  email: string;
  isSuperadmin: boolean;
}

interface UserContextType {
  user: UserInfo | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => void;
}

const UserContext = createContext<UserContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  logout: () => {},
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    console.log(
      "[UserContext] checkAuth called, path:",
      window.location.pathname,
    );

    // Prevent redirect loop - if we just tried to login, don't redirect again
    const lastLoginAttempt = sessionStorage.getItem("lastLoginAttempt");
    const now = Date.now();
    if (lastLoginAttempt && now - parseInt(lastLoginAttempt) < 10000) {
      console.error(
        "[UserContext] LOOP DETECTED - not redirecting to login again",
      );
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/user/me`, {
        credentials: "include",
      });

      console.log(
        "[UserContext] /api/user/me response status:",
        response.status,
        "ok:",
        response.ok,
      );

      if (response.status === 401) {
        // Not authenticated - redirect to login
        console.log("[UserContext] 401 - redirecting to login");
        sessionStorage.setItem("lastLoginAttempt", now.toString());
        window.location.href = loginRedirectURL;
        return;
      }

      if (response.ok) {
        const data = await response.json();
        console.log("[UserContext] Got user data:", data);
        // Clear the login attempt tracker on success
        sessionStorage.removeItem("lastLoginAttempt");
        setUser({
          id: data.id,
          name: data.name,
          email: data.email,
          isSuperadmin: data.isSuperadmin ?? false,
        });
      } else {
        // Other error - redirect to login
        console.log(
          "[UserContext] Non-ok response:",
          response.status,
          "- redirecting to login",
        );
        sessionStorage.setItem("lastLoginAttempt", now.toString());
        window.location.href = loginRedirectURL;
      }
    } catch (err) {
      console.error("[UserContext] Auth check failed:", err);
      sessionStorage.setItem("lastLoginAttempt", now.toString());
      window.location.href = loginRedirectURL;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Check if we're on a public route that doesn't need auth
    const path = window.location.pathname;
    if (path.includes("/sign/") || path.includes("/auth")) {
      setIsLoading(false);
      return;
    }

    checkAuth();
  }, [checkAuth]);

  const logout = useCallback(() => {
    // Redirect to backend logout which will clear cookies and redirect to Zitadel
    window.location.href = LOGOUT_URL;
  }, []);

  return (
    <UserContext.Provider
      value={{ user, isLoading, isAuthenticated: !!user, logout }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
