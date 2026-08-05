import { create } from 'zustand';
import api from '../lib/api';
import { can as canFn } from '../lib/permissions';

const useAuthStore = create((set, get) => ({
  user: null,
  facility: null,
  subscription: null,
  loading: true,

  setAuth: ({ user, facility, subscription, accessToken }) => {
    if (accessToken) localStorage.setItem('accessToken', accessToken);
    set({
      user: user ?? get().user,
      facility: facility ?? get().facility,
      subscription: subscription !== undefined ? subscription : get().subscription,
      loading: false,
    });
  },

  logout: async () => {
    try { await api.post('/auth/logout'); } catch (_) {}
    localStorage.removeItem('accessToken');
    set({ user: null, facility: null, subscription: null, loading: false });
    window.location.href = '/login';
  },

  fetchMe: async () => {
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data.user, facility: data.facility, subscription: data.subscription ?? null, loading: false });
    } catch (_) {
      localStorage.removeItem('accessToken');
      set({ user: null, facility: null, subscription: null, loading: false });
    }
  },

  can: (module) => {
    const { user } = get();
    if (!user) return false;
    return canFn(user.role, user.subRole, module);
  },
}));

export default useAuthStore;
