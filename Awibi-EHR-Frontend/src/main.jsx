import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { store, persistor } from './store';
import { Toaster } from './components/ui/sonner';
import './index.css';
import App from './App.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function PersistSpinner() {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fff', gap: '16px' }}>
      <div style={{ width: '40px', height: '40px', border: '4px solid #e8eeff', borderTopColor: '#335CF4', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <p style={{ fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#6B7280', margin: 0 }}>Loading…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/**
 * Register the service worker, and make sure a broken one can be replaced.
 *
 * An earlier version cached the HTML document indefinitely. Because that
 * document names every other file by content hash, a stale copy asks for
 * bundles that no longer exist and the application never starts — and it
 * cannot recover, because the fix is inside the bundle it will not load.
 *
 * Checking for an update on every load, and reloading once when a new worker
 * takes control, is what breaks that cycle for anyone already caught in it.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      // Ask immediately rather than waiting for the browser's own schedule.
      registration.update().catch(() => {});

      // Only reload when an EXISTING worker is being replaced.
      //
      // On a first visit there is no controller until the new worker calls
      // clients.claim(), which fires this event too. Reloading then starts the
      // whole sequence again on the next load — an endless reload that looks
      // exactly like a page which never finishes loading.
      const hadController = Boolean(navigator.serviceWorker.controller);
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true;
        window.location.reload();
      });
    } catch { /* no service worker: the app works, just without offline */ }
  });
}

/**
 * Dismiss the pre-React loading shell.
 *
 * index.html paints a full-screen spinner so the first frame is not blank. It
 * sits at z-index 9999 over everything, so if it is not removed the application
 * renders perfectly underneath and the user still sees only a spinner.
 *
 * It was removed by a MutationObserver that waited for #root to hold more than
 * one child — a guess about how React attaches, which is true in some versions
 * and not others. Calling this directly after render is not a guess.
 */
function dismissLoadingShell() {
  const loader = document.getElementById('app-loader');
  if (loader) loader.remove();
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Provider store={store}>
      <PersistGate loading={<PersistSpinner />} persistor={persistor}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
            <Toaster richColors position="top-right" />
          </BrowserRouter>
        </QueryClientProvider>
      </PersistGate>
    </Provider>
  </React.StrictMode>,
);

// After the first paint, not before — otherwise there is a blank frame between
// removing the shell and React drawing.
requestAnimationFrame(dismissLoadingShell);
