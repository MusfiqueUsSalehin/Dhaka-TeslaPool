/**
 * Thin fetch wrapper. The session is an httpOnly cookie, so there is no token to
 * handle here: same-origin requests carry it automatically.
 * Every non-2xx response becomes an ApiError with the server's code and message.
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  let res;
  try {
    res = await fetch(`/api${path}${qs}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = payload?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return payload?.data;
}

/** Human-friendly message, including field-level validation details. */
export function errorMessage(error) {
  if (!error) return null;
  if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
    return error.details.map((d) => d.message).join(' · ');
  }
  return error.message || 'Something went wrong';
}
