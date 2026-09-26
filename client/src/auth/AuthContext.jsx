import { createContext, useContext } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/endpoints.js';

const AuthContext = createContext(null);

/**
 * Session state = the result of GET /api/auth/me. A 401 simply means "signed out".
 * Login/signup/logout update the cached user and clear everything else, so one
 * person's rides never flash on screen after another signs in.
 */
export function AuthProvider({ children }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await authApi.me()).user;
      } catch (err) {
        if (err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });

  const onSignedIn = (data) => {
    qc.clear();
    qc.setQueryData(['me'], data.user);
  };

  const login = useMutation({ mutationFn: ({ phone, password }) => authApi.login(phone, password), onSuccess: onSignedIn });
  const signup = useMutation({ mutationFn: authApi.signup, onSuccess: onSignedIn });
  const logout = useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  });

  const value = { user: me.data ?? null, isLoading: me.isLoading, error: me.error, login, signup, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
