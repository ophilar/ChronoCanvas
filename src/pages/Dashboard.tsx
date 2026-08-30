import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { subscribeToArtworks, createArtwork, deleteArtworkComplete } from '../lib/api';
import { Artwork } from '../types';
import { Plus, Loader2, Image as ImageIcon, Palette, Trash2, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    return subscribeToArtworks(
      user.uid,
      (data) => {
        setArtworks(data);
        setLoading(false);
      },
      (error) => {
        console.error('Artwork subscription error:', error);
        setLoadError(error.message);
        setLoading(false);
      },
    );
  }, [user]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    setIsCreating(true);
    try {
      const id = await createArtwork(title);
      setNewTitle('');
      toast.success('Artwork created');
      navigate(`/artwork/${id}`);
    } catch (error) {
      console.error('Create artwork error:', error);
      toast.error(errorMessage(error));
    } finally {
      setIsCreating(false);
    }
  };

  const executeDelete = async (id: string) => {
    const toastId = toast.loading('Deleting project and progress photos...');
    try {
      await deleteArtworkComplete(id);
      setConfirmDeleteId(null);
      toast.success('Project deleted', { id: toastId });
    } catch (error) {
      console.error('Delete artwork error:', error);
      toast.error(errorMessage(error), { id: toastId });
    }
  };

  if (loading) {
    return (
      <div className="py-20 flex justify-center" role="status" aria-label="Loading portfolio">
        <Loader2 className="w-6 h-6 animate-spin text-brand-accent" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 p-8 md:p-12 max-w-3xl mx-auto w-full">
        <div className="bg-white border border-red-200 rounded-2xl p-8 text-center shadow-sm">
          <AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-3" />
          <h1 className="text-2xl font-serif font-bold text-brand-text">Portfolio unavailable</h1>
          <p className="text-sm text-brand-muted mt-2">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 sm:p-8 md:p-12 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out max-w-7xl mx-auto w-full space-y-12">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-brand-border">
        <div>
          <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-brand-muted block mb-2">Overview</span>
          <h1 className="text-4xl font-serif italic font-bold">Your Portfolio</h1>
        </div>

        <form onSubmit={handleCreate} className="flex items-center gap-2 w-full sm:w-auto">
          <label htmlFor="new-artwork-title" className="sr-only">New artwork title</label>
          <input
            id="new-artwork-title"
            type="text"
            placeholder="New session title..."
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            className="min-w-0 flex-1 sm:w-64 bg-white border-2 border-brand-border rounded-full px-4 py-2 text-sm text-brand-text placeholder-brand-muted focus:outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent transition-all"
            maxLength={100}
          />
          <button
            type="submit"
            disabled={!newTitle.trim() || isCreating}
            className="bg-brand-text text-white px-5 py-2 rounded-full text-[10px] uppercase tracking-widest font-bold hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors shadow-sm"
          >
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span>Create</span>
          </button>
        </form>
      </div>

      {artworks.length === 0 ? (
        <div className="border border-brand-border bg-white p-12 sm:p-16 text-center flex flex-col items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-brand-surface text-brand-accent flex items-center justify-center mb-6">
            <ImageIcon className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-serif italic text-brand-text mb-2">The Canvas is Empty</h2>
          <p className="text-brand-muted text-sm font-medium">Begin by creating a new session above to track your artistic workflow.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {artworks.map((artwork) => (
            <article
              key={artwork.id}
              className="relative bg-white border border-brand-border shadow-sm hover:shadow-md transition-all duration-300 hover:border-brand-accent/50"
            >
              <Link to={`/artwork/${artwork.id}`} className="block p-6 pr-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-inset">
                <div className="w-10 h-10 rounded-xl bg-brand-surface flex items-center justify-center text-brand-accent mb-6">
                  <Palette className="w-5 h-5" />
                </div>
                <h2 className="font-serif italic text-2xl truncate font-bold mb-4">{artwork.title}</h2>
                <div className="flex items-center justify-between gap-3 pt-4 border-t border-brand-border/50">
                  <span className="text-[9px] uppercase tracking-[0.2em] font-bold text-brand-accent bg-brand-accent/5 px-2 py-1 rounded-sm">
                    {artwork.status.replaceAll('_', ' ')}
                  </span>
                  <span className="text-[10px] text-brand-muted font-bold tracking-wider uppercase text-right">
                    {formatDistanceToNow(new Date(artwork.updatedAt), { addSuffix: true })}
                  </span>
                </div>
              </Link>

              <div className="absolute top-6 right-6 z-10">
                {confirmDeleteId === artwork.id ? (
                  <div className="flex items-center gap-1.5 bg-white rounded-lg shadow-sm p-1 border border-brand-border">
                    <button
                      type="button"
                      onClick={() => void executeDelete(artwork.id)}
                      className="px-2.5 py-1 bg-red-600 text-white text-[9px] uppercase tracking-widest font-bold rounded hover:bg-red-700 transition-all"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2 py-1 bg-gray-100 text-brand-text text-[9px] uppercase tracking-widest font-bold rounded hover:bg-gray-200 transition-colors border border-black/5"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(artwork.id)}
                    className="p-2 text-brand-muted hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                    aria-label={`Delete ${artwork.title}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
