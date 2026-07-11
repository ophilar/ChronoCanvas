import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { subscribeToArtworks, createArtwork, deleteArtworkComplete } from '../lib/api';
import { Artwork } from '../types';
import { Plus, Loader2, Image as ImageIcon, Palette, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToArtworks(user.uid, (data) => {
      setArtworks(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setIsCreating(true);
    try {
      const id = await createArtwork(newTitle.trim());
      setNewTitle('');
      toast.success('Artwork created');
      navigate(`/artwork/${id}`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to create artwork');
    } finally {
      setIsCreating(false);
    }
  };

  const executeDelete = async (id: string) => {
    const toastId = toast.loading('Deleting project and progress photos...');
    try {
      await deleteArtworkComplete(id);
      setConfirmDeleteId(null);
      toast.success('Project deleted successfully', { id: toastId });
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to delete project', { id: toastId });
    }
  };

  if (loading) {
    return <div className="py-20 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-accent" /></div>;
  }

  return (
    <div className="flex-1 p-8 md:p-12 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out max-w-7xl mx-auto w-full space-y-12">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-brand-border">
        <div>
          <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-brand-muted block mb-2">Overview</span>
          <h1 className="text-4xl font-serif italic font-bold">Your Portfolio</h1>
        </div>
        
        <form onSubmit={handleCreate} className="flex items-center gap-2">
          <input 
            type="text"
            placeholder="New session title..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="bg-white border-2 border-brand-border rounded-full px-4 py-2 text-sm text-brand-text placeholder-brand-muted focus:outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent transition-all"
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
        <div className="border border-brand-border bg-white rounded-none p-16 text-center flex flex-col items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-brand-surface text-brand-accent flex items-center justify-center mb-6">
            <ImageIcon className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-serif italic text-brand-text mb-2">The Canvas is Empty</h3>
          <p className="text-brand-muted text-sm font-medium">Begin by creating a new session above to track your artistic workflow.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {artworks.map((art) => (
            <Link 
              key={art.id} 
              to={`/artwork/${art.id}`}
              className="block group bg-white border border-brand-border p-6 shadow-sm hover:shadow-md transition-all duration-300 hover:border-brand-accent/50"
            >
              <div className="flex justify-between items-center mb-6">
                <div className="w-10 h-10 rounded-xl bg-brand-surface flex items-center justify-center text-brand-accent group-hover:scale-110 transition-transform">
                  <Palette className="w-5 h-5" />
                </div>
                {confirmDeleteId === art.id ? (
                  <div className="flex items-center gap-1.5 z-10 relative">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        executeDelete(art.id);
                      }}
                      className="px-2.5 py-1 bg-red-600 text-white text-[9px] uppercase tracking-widest font-bold rounded hover:bg-red-700 transition-all shadow-sm"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                      }}
                      className="px-2 py-1 bg-gray-150 text-brand-text text-[9px] uppercase tracking-widest font-bold rounded hover:bg-gray-200 transition-colors border border-black/5"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setConfirmDeleteId(art.id);
                    }}
                    className="p-2 text-brand-muted hover:text-red-600 rounded-lg hover:bg-red-50 z-10 transition-colors"
                    title="Delete project"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-serif italic text-2xl truncate pr-2 font-bold">{art.title}</h3>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-brand-border/50">
                 <span className="text-[9px] uppercase tracking-[0.2em] font-bold text-brand-accent bg-brand-accent/5 px-2 py-1 rounded-sm">
                  {art.status.replace('_', ' ')}
                </span>
                <span className="text-[10px] text-brand-muted font-bold tracking-wider uppercase"> {formatDistanceToNow(new Date(art.updatedAt), { addSuffix: true })}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
