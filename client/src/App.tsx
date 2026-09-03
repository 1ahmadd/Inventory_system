import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
import { clearToken, fetchMe, getToken, logoutRequest, saveToken, type AuthUser } from "./lib/authClient";

type Session = { token: string; user: AuthUser };

export default function App() {
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setChecking(false);
      return;
    }
    fetchMe(token)
      .then((res) => setSession({ token, user: res.user }))
      .catch(() => clearToken())
      .finally(() => setChecking(false));
  }, []);

  const handleLogout = () => {
    if (session) void logoutRequest(session.token).catch(() => undefined);
    clearToken();
    setSession(null);
  };

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster position="top-center" richColors />
          {checking ? (
            <div className="app-loading" dir="rtl">
              <div className="app-loading-mark" />
              جارِ التحقق من الجلسة…
            </div>
          ) : session ? (
            <Home user={session.user} onLogout={handleLogout} />
          ) : (
            <Login
              onSuccess={(token, user) => {
                saveToken(token);
                setSession({ token, user });
              }}
            />
          )}
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
