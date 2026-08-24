const CONNECTION_MARKERS = [
  'econnrefused',
  'network error',
  'failed to fetch',
  'proxy error',
  'socket hang up',
  'timeout',
];

/**
 * Turn Axios/proxy failures into an error a clinician can act on.
 *
 * When Vite is running but the API is still starting, its development proxy
 * returns HTTP 500. Passing Axios' default `Request failed with status code
 * 500` to the login screen makes a startup-order problem look like rejected
 * credentials. Preserve structured API errors, but name connectivity and
 * server failures explicitly.
 */
export function normalizeAuthError(err, fallback = 'Could not sign in') {
  const data = err?.response?.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data.error ? data : { ...data, error: fallback };
  }

  const status = Number(err?.response?.status) || undefined;
  const raw = [typeof data === 'string' ? data : '', err?.message || '', err?.code || '']
    .join(' ')
    .trim();
  const lower = raw.toLowerCase();
  const connectionFailure = !err?.response || CONNECTION_MARKERS.some((marker) => lower.includes(marker));

  if (connectionFailure) {
    return {
      error: 'The EHR API is not ready. Run the local project launcher and wait for "EHR API is ready", then try again.',
      code: 'API_UNAVAILABLE',
      ...(status ? { status } : {}),
    };
  }

  if (status >= 500) {
    return {
      error: `Could not sign in (HTTP ${status}). For local use, check that the server is running on port 8000.`,
      code: 'AUTH_SERVICE_ERROR',
      status,
    };
  }

  const responseMessage = typeof data === 'string' ? data.trim() : '';
  return { error: responseMessage || err?.message || fallback, ...(status ? { status } : {}) };
}
