/**
 * Make a pre-React startup failure visible without allowing inline scripts.
 * CSP blocks inline JavaScript by design, so this file must remain external.
 */
window.__awibiStartupErrors = [];

function recordError(label, detail) {
  window.__awibiStartupErrors.push(`${label}: ${detail}`);
}

window.addEventListener('error', (event) => {
  if (event.message) {
    const ownScript = !event.filename || new URL(event.filename, window.location.href).origin === window.location.origin;
    if (ownScript) recordError('Error', `${event.message}${event.filename ? ` (${event.filename}:${event.lineno})` : ''}`);
  } else if (event.target?.src) {
    const failed = new URL(event.target.src, window.location.href);
    if (failed.origin === window.location.origin) recordError('Failed to load', failed.pathname);
  }
}, true);

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason?.message || String(event.reason || 'Unknown startup error');
  recordError('Unhandled promise', reason);
});

setTimeout(() => {
  const loader = document.getElementById('app-loader');
  if (!loader) return;
  loader.remove();

  const root = document.getElementById('root');
  if (!root || root.childElementCount !== 0) return;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'font-family:system-ui,sans-serif;max-width:40rem;margin:10vh auto;padding:0 1.5rem;color:#111';
  const title = document.createElement('h1');
  title.textContent = 'Awibi EHR did not start';
  title.style.cssText = 'font-size:1.25rem;margin:0 0 .5rem';
  const message = document.createElement('p');
  message.textContent = 'The page loaded, but the application did not. Reload it; if this happens again, share the time shown below with support.';
  message.style.cssText = 'color:#4B5563;font-size:.9rem;line-height:1.5;margin:0 0 1rem';
  const detail = document.createElement('pre');
  detail.textContent = (window.__awibiStartupErrors || []).join('\n\n') || `No application error was reported. Time: ${new Date().toISOString()}`;
  detail.style.cssText = 'white-space:pre-wrap;word-break:break-word;background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:.75rem;border-radius:.5rem;font-size:.75rem;line-height:1.45;margin:0 0 1rem;max-height:16rem;overflow:auto';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Reload';
  retry.style.cssText = 'padding:.6rem 1.1rem;border:0;border-radius:.5rem;background:#335CF4;color:#fff;font-size:.875rem;cursor:pointer';
  retry.addEventListener('click', () => window.location.reload());
  wrapper.append(title, message, detail, retry);
  root.append(wrapper);
}, 10000);
