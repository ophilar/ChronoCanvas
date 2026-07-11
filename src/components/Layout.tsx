import React from 'react';
import { Outlet, Link } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Palette, LogOut } from 'lucide-react';

export default function Layout() {
  const { user, logOut } = useAuth();

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text font-sans flex flex-col selection:bg-brand-accent/20">
      <header className="h-20 border-b border-brand-border px-8 flex items-center justify-between bg-white/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-10">
          <Link to="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <h1 className="text-2xl font-serif italic tracking-tight font-bold">chrono.canvas</h1>
          </Link>
          <nav className="hidden md:flex gap-8 text-xs uppercase tracking-widest font-semibold text-brand-muted">
            <Link to="/dashboard" className="text-brand-text border-b-2 border-brand-accent pb-1">Studio</Link>
            <span className="hover:text-brand-text transition-colors cursor-not-allowed">Gallery</span>
            <span className="hover:text-brand-text transition-colors cursor-not-allowed">Analytics</span>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center space-x-2">
            <div className="w-8 h-8 rounded-full bg-brand-surface border-2 border-brand-bg flex items-center justify-center text-[10px] font-bold text-brand-accent">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <span className="text-xs font-mono font-medium text-brand-muted">{user?.email}</span>
          </div>
          <button 
            onClick={logOut}
            className="px-4 py-2 bg-brand-surface border border-brand-border text-brand-text text-[10px] uppercase tracking-widest font-bold rounded-full hover:bg-brand-border transition-colors flex items-center gap-2"
          >
            <LogOut className="w-3 h-3" />
            <span className="hidden xs:inline">Sign out</span>
          </button>
        </div>
      </header>
      <main className="flex-1 flex flex-col w-full">
        <Outlet />
      </main>
    </div>
  );
}
