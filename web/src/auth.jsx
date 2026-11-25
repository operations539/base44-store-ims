import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, post } from './api.js';

const AuthContext = createContext(null);

const EMPTY = {
  loading: true,
  user: null,
  actor: null,
  emulated: false,
  permissions: [],
  nav: [],
  googleEnabled: false,
};

export function AuthProvider({ children }) {
  const [state, setState] = useState(EMPTY);

  const refresh = useCallback(async () => {
    try {
      const data = await api('/auth/me');
      if (!data.user) {
        setState({ ...EMPTY, loading: false });
        return null;
      }
      setState({
        loading: false,
        user: data.user,
        actor: data.actor || data.user,
        emulated: !!data.emulated,
        permissions: data.permissions || [],
        nav: data.nav || [],
        googleEnabled: !!data.googleEnabled,
      });
      return data;
    } catch {
      setState({ ...EMPTY, loading: false });
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (identifier, password) => {
      await post('/auth/login', { identifier, password });
      return refresh();
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout', {});
    } finally {
      setState({ ...EMPTY, loading: false });
    }
  }, []);

  const emulate = useCallback(
    async (userId) => {
      await post('/auth/emulate', { user_id: userId });
      return refresh();
    },
    [refresh]
  );

  const exitEmulation = useCallback(async () => {
    await post('/auth/emulate/exit', {});
    return refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      ...state,
      refresh,
      login,
      logout,
      emulate,
      exitEmulation,
      has: (perm) => state.permissions.includes(perm),
    }),
    [state, refresh, login, logout, emulate, exitEmulation]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const MOBILE_ROLES = ['store_helper', 'supervisor'];

export function homeFor(role) {
  if (role === 'store_helper') return '/m/packing';
  if (role === 'supervisor') return '/m/requests';
  return '/';
}
