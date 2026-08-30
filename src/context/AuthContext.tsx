import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth } from '../firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => onAuthStateChanged(auth, (currentUser) => {
    setUser(currentUser);
    setLoading(false);
  }), []);

  const signIn = useCallback(async () => {
    await signInWithPopup(auth, new GoogleAuthProvider());
  }, []);

  const logOut = useCallback(async () => {
    await signOut(auth);
  }, []);

  const value = useMemo<AuthContextType>(() => ({ user, loading, signIn, logOut }), [user, loading, signIn, logOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
