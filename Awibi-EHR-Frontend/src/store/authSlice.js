import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import api from '@/lib/api';

export const login = createAsyncThunk('auth/login', async ({ email, password }, { rejectWithValue }) => {
  try {
    const res = await api.post('/auth/login', { email, password });
    const { accessToken, user, facility } = res.data;
    if (accessToken) localStorage.setItem('accessToken', accessToken);
    return { user, facility };
  } catch (err) {
    return rejectWithValue(err.response?.data || { error: err.message });
  }
});

export const demoLogin = createAsyncThunk('auth/demoLogin', async ({ userId, accessCode }, { rejectWithValue }) => {
  try {
    // A hosted demo may require a shared code; a local one never does.
    const res = await api.post('/auth/local-demo-login', { userId, ...(accessCode ? { accessCode } : {}) });
    const { accessToken, user, facility } = res.data;
    if (accessToken) localStorage.setItem('accessToken', accessToken);
    return { user, facility };
  } catch (err) {
    return rejectWithValue(err.response?.data || { error: err.message });
  }
});

export const fetchMe = createAsyncThunk('auth/fetchMe', async (_, { rejectWithValue }) => {
  try {
    // Session restore is on the critical render path. Fail quickly when the API is
    // stopped or Supabase is unreachable instead of holding a blank/spinner screen.
    const res = await api.get('/auth/me', { timeout: 6000 });
    return res.data; // { user, facility, subscription }
  } catch (err) {
    const isTimeout = err.code === 'ECONNABORTED' || (err.message || '').includes('timeout');
    const error = isTimeout ? 'timeout' : (err.response?.data?.error || err.message);
    return rejectWithValue({ error });
  }
});

export const logout = createAsyncThunk('auth/logout', async (_, { rejectWithValue }) => {
  try {
    await api.post('/auth/logout');
  } catch (_) {}
  localStorage.removeItem('accessToken');
  return null;
});

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: null,
    facility: null,
    subscription: null,
    isAuthenticated: false,
    // True only on a cold load where there's a token but no persisted user yet.
    // When redux-persist rehydrates isAuthenticated=true, fetchMe.pending skips the spinner.
    loading: !!localStorage.getItem('accessToken'),
    error: null,
  },
  reducers: {
    setCredentials(state, action) {
      state.user = action.payload.user;
      state.facility = action.payload.facility;
      if ('subscription' in action.payload) state.subscription = action.payload.subscription ?? null;
      state.isAuthenticated = true;
      state.loading = false;
    },
    clearAuth(state) {
      state.user = null;
      state.facility = null;
      state.subscription = null;
      state.isAuthenticated = false;
      state.loading = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => { state.loading = true; state.error = null; })
      .addCase(login.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload.user;
        state.facility = action.payload.facility;
        state.isAuthenticated = true;
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.error || 'Login failed';
      })
      .addCase(demoLogin.pending, (state) => { state.loading = true; state.error = null; })
      .addCase(demoLogin.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload.user;
        state.facility = action.payload.facility;
        state.isAuthenticated = true;
      })
      .addCase(demoLogin.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.error || 'Demo entry failed';
      })
      // Only block with spinner on cold load (no persisted session).
      // If we already have a user, the dashboard stays visible while we silently re-validate.
      .addCase(fetchMe.pending, (state) => { if (!state.isAuthenticated) state.loading = true; })
      .addCase(fetchMe.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload.user;
        state.facility = action.payload.facility;
        state.subscription = action.payload.subscription ?? null;
        state.isAuthenticated = true;
      })
      .addCase(fetchMe.rejected, (state, action) => {
        state.loading = false;
        // Network timeout — don't kick user out, let them keep working offline.
        // A real 401 (invalid token) is handled by the axios interceptor → /login redirect.
        const isTimeout = action.payload?.error === 'timeout';
        if (!isTimeout) {
          state.user = null;
          state.facility = null;
          state.subscription = null;
          state.isAuthenticated = false;
        }
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.facility = null;
        state.subscription = null;
        state.isAuthenticated = false;
        state.loading = false;
      });
  },
});

export const { setCredentials, clearAuth } = authSlice.actions;
export default authSlice.reducer;
