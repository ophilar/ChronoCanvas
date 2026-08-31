import React, { Suspense, lazy, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Toaster, toast } from 'react-hot-toast';
import Layout from './components/Layout';
import { Loader2, Palette } from 'lucide-react';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const ArtworkPage = lazy(() => import('./pages/ArtworkPage'));

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg" role="status" aria-label="Loading application">
      <Loader2 className="w-8 h-8 animate-spin text-brand-accent" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function LandingPage() {
  const { signIn } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      await signIn();
    } catch (error) {
      console.error('Sign-in error:', error);
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-brand-bg text-brand-text p-6 border-8 border-white box-border">
      <div className="absolute top-8 left-8 text-[10px] uppercase font-bold tracking-[0.2em] text-brand-muted">Studio Portal</div>
      <div className="max-w-md w-full space-y-10 text-center">
        <div className="w-20 h-20 bg-brand-surface mx-auto rounded-full flex items-center justify-center border-2 border-brand-accent shadow-sm">
          <Palette className="w-8 h-8 text-brand-accent" />
        </div>
        <div>
          <h1 className="text-5xl font-serif italic font-bold mb-4 text-brand-text tracking-tight">chrono.canvas</h1>
          <p className="text-brand-muted font-medium text-sm leading-relaxed px-4">Track your artistic workflow, generate time-lapses, and explore your milestones.</p>
        </div>
        <button
          type="button"
          onClick={() => void handleSignIn()}
          disabled={signingIn}
          className="mx-auto px-8 py-3 bg-brand-text text-white text-[11px] uppercase tracking-[0.2em] font-bold rounded-full hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {signingIn && <Loader2 className="w-4 h-4 animate-spin" />}
          Sign in with Google
        </button>
      </div>
    </main>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Toaster position="bottom-center" />
      <BrowserRouter>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<PublicRoute><LandingPage /></PublicRoute>} />
            <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/artwork/:id" element={<ArtworkPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
