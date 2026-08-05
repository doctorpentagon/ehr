import axios from 'axios';
import { toast } from 'sonner';
import { enqueue } from './offlineQueue';

const api = axios.create({
  baseURL: '/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 20000, // 20-second timeout — prevents indefinite hang when Supabase is paused
});

// Attach access token from memory
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('accessToken');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(p => error ? p.reject(error) : p.resolve(token));
  failedQueue = [];
};

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config;
    if (err.response?.status === 402) {
      const msg = err.response.data?.error || 'Plan limit reached. Please upgrade.';
      toast.error(msg, { action: { label: 'Upgrade', onClick: () => { window.location.href = '/dashboard/subscription'; } } });
      return Promise.reject(err);
    }
    if (err.response?.status === 403 && err.response.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
      if (window.location.pathname !== '/dashboard/settings') {
        window.location.href = '/dashboard/settings?passwordChange=required';
      }
      return Promise.reject(err);
    }
    if (err.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        });
      }
      original._retry = true;
      isRefreshing = true;
      try {
        const { data } = await axios.post('/v1/auth/refresh', {}, { withCredentials: true });
        localStorage.setItem('accessToken', data.accessToken);
        processQueue(null, data.accessToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        localStorage.removeItem('accessToken');
        window.location.href = '/login';
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(err);
  }
);

// Intercept network-offline errors for mutations — queue them for later sync
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const cfg = err.config;
    const method = cfg?.method?.toUpperCase();
    const isMutation = method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const isNetworkError = !err.response && !navigator.onLine;

    if (isMutation && isNetworkError) {
      try {
        await enqueue({
          method: cfg.method,
          url: cfg.url,
          data: cfg.data ? JSON.parse(cfg.data) : undefined,
          headers: { Authorization: cfg.headers?.Authorization },
        });
        toast.info('Saved offline — will sync when reconnected.', { duration: 4000 });
      } catch (_) {
        // IndexedDB write failed — just reject normally
      }
    }

    return Promise.reject(err);
  }
);

export default api;
