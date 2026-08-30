import React from 'react';
import { Outlet, Link } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { LogOut } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Layout() {
  const { user, logOut } = useAuth();

  const handleLogOut = async () => {
    try {
      await logOut();
    } catch (error) {
      console.error('Sign-out error:', error);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text font-sans flex flex-col selection:bg-brand-accent/20">
      <header className="h-20 border-b border-brand-border px-4 sm:px-8 flex items-center justify-between gap-4 bg-white/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-6 md:gap-10 min-w-0">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent rounded"
          >
            <h1 className="text-2xl font-serif italic tracking-tight font-bold">chrono.canvas</h1>
          </Link>
          <nav className="hidden md:flex gap-8 text-xs uppercase tracking-widest font-semibold text-brand-muted" aria-label="Studio navigation">
            <Link to="/dashboard" className="text-brand-text border-b-2 border-brand-accent pb-1">
              Studio
            </Link>
            <span className="hover:text-brand-text transition-colors cursor-not-allowed" aria-disabled="true">
              Gallery
            </span>
            <span className="hover:text-brand-text transition-colors cursor-not-allowed" aria-disabled="true">
              Analytics
            </span>
          </nav>
        </div>

        <div className="flex items-center gap-4 min-w-0">
          <div className="hidden sm:flex items-center space-x-2 min-w-0">
            <div
              className="w-8 h-8 rounded-full bg-brand-surface border-2 border-brand-bg flex items-center justify-center text-[10px] font-bold text-brand-accent flex-shrink-0"
              aria-hidden="true"
            >
              {user?.email?.charAt(0).toUpperCase() ?? 'U'}
            </div>
            <span className="text-xs font-mono font-medium text-brand-muted truncate max-w-56">{user?.email}</span>
          </div>
          <button
            type="button"
            onClick={() => void handleLogOut()}
            className="px-4 py-2 bg-brand-surface border border-brand-border text-brand-text text-[10px] uppercase tracking-widest font-bold rounded-full hover:bg-brand-border transition-colors flex items-center gap-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
          >
            <LogOut className="w-3 h-3" />
            <span className="hidden sm:inline">Sign out</span>
            <span className="sm:hidden sr-only">Sign out</span>
          </button>
        </div>
      </header>
      <main className="flex-1 flex flex-col w-full">
        <Outlet />
      </main>
    </div>
  );
}
