import * as React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { DirectionProvider } from '@radix-ui/react-direction';
import { fetchJson, type SessionUser } from '@/lib/api';
import { useDirection } from '@/hooks/useDirection';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import Login from '@/pages/Login';
import AccessDenied from '@/pages/AccessDenied';
import Dashboard from '@/pages/Dashboard';
import { Skeleton } from '@/components/ui/skeleton';

type AuthState = { loading: true } | { loading: false; user: SessionUser | null };

function RequireAuth({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ loading: true });
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    fetchJson<SessionUser>('/api/session')
      .then((user) => { if (!cancelled) setState({ loading: false, user }); })
      .catch(() => { if (!cancelled) setState({ loading: false, user: null }); });
    return () => { cancelled = true; };
  }, []);

  if (state.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (!state.user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const dir = useDirection();
  return (
    <DirectionProvider dir={dir}>
      <TooltipProvider delayDuration={200}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/denied" element={<AccessDenied />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
        </Routes>
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    </DirectionProvider>
  );
}
