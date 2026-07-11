import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Toaster } from 'react-hot-toast';
import Dashboard from './pages/Dashboard';
import ArtworkPage from './pages/ArtworkPage';
import Layout from './components/Layout';
import { Loader2, Palette } from 'lucide-react';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center bg-brand-bg"><Loader2 className="w-8 h-8 animate-spin text-brand-accent" /></div>;
  if (!user) return <Navigate to="/" />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center bg-brand-bg"><Loader2 className="w-8 h-8 animate-spin text-brand-accent" /></div>;
  if (user) return <Navigate to="/dashboard" />;
  return <>{children}</>;
}

function LandingPage() {
  const { signIn } = useAuth();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-brand-bg text-brand-text p-6 border-8 border-white box-border">
      <div className="absolute top-8 left-8 text-[10px] uppercase font-bold tracking-[0.2em] text-brand-muted">Studio Portal</div>
      <div className="max-w-md w-full space-y-10 items-center justify-center text-center">
        <div className="w-20 h-20 bg-brand-surface mx-auto rounded-full flex items-center justify-center border-2 border-brand-accent shadow-sm">
           <Palette className="w-8 h-8 text-brand-accent" />
        </div>
        <div>
          <h1 className="text-5xl font-serif italic font-bold mb-4 text-brand-text tracking-tight">chrono.canvas</h1>
          <p className="text-brand-muted font-medium text-sm leading-relaxed px-4">Track your artistic workflow, generate time-lapses, and explore your layers.</p>
        </div>
        <button 
          onClick={signIn}
          className="mx-auto block px-8 py-3 bg-brand-text text-white text-[11px] uppercase tracking-[0.2em] font-bold rounded-full hover:bg-black transition-colors"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Toaster position="bottom-center" />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PublicRoute><LandingPage /></PublicRoute>} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/artwork/:id" element={<ArtworkPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
