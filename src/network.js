import { isApiUrl } from './sources.js';
import { getTransport } from './platform.js';

export const DEFAULT_TIMEOUT_MS = 15000;

export class NetworkError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = 'NetworkError';
    this.kind = kind;
    this.status = status;
  }
}

function classify(status) {
  if (status === 401 || status === 403) {
    return new NetworkError('auth', 'The source rejected your account details.', status);
  }
  if (status === 429) {
    return new NetworkError('throttled', 'The source is rate limiting this app. Wait a moment and retry.', status);
  }
  if (status === 503 || status === 502 || status === 504) {
    return new NetworkError('unavailable', 'The source is temporarily unavailable.', status);
  }
  if (status >= 500) {
    return new NetworkError('server', 'The source had a server error (' + status + ').', status);
  }
  return new NetworkError('http', 'The source refused the request (' + status + ').', status);
}

function looksBlocked(body) {
  return /<\s*(html|!doctype)|just a moment|cloudflare|captcha|enable javascript/i.test(String(body || ''));
}

/**
 * A checked GET against one of the two allowed API origins.
 *
 * A native request cannot actually be cancelled once dispatched, so an abort or
 * a timeout settles the caller immediately and a generation flag makes the late
 * native result a no-op. Error messages never include the URL, because the URL
 * carries the user's API key.
 */
export function request(url, options = {}) {
  const { format = 'json', signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  if (!isApiUrl(url)) {
    return Promise.reject(new NetworkError('denied', 'Request blocked: unsupported address.'));
  }
  if (signal && signal.aborted) {
    return Promise.reject(new NetworkError('aborted', 'Request cancelled.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let onAbort = null;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
        onAbort = null;
      }
    };

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(value);
    };

    timer = setTimeout(() => {
      finish(new NetworkError('timeout', 'The source took too long to respond.'));
    }, timeoutMs);

    if (signal) {
      onAbort = () => finish(new NetworkError('aborted', 'Request cancelled.'));
      signal.addEventListener('abort', onAbort, { once: true });
    }

    (async () => {
      const transport = await getTransport();
      const response = await transport.get(url, { format, timeoutMs, signal });
      const status = Number(response.status);

      if (!Number.isFinite(status)) {
        throw new NetworkError('invalid-format', 'The source returned no status.');
      }
      if (status < 200 || status >= 300) throw classify(status);

      let body = response.body;
      if (format === 'json' && typeof body === 'string') {
        const trimmed = body.trim();
        if (looksBlocked(trimmed)) {
          throw new NetworkError('blocked', 'The source answered with a block page instead of data.');
        }
        if (!trimmed) return '';
        try {
          return JSON.parse(trimmed);
        } catch (e) {
          throw new NetworkError('invalid-format', 'The source returned data this app could not read.');
        }
      }
      if (format === 'text' && typeof body !== 'string') {
        body = body === undefined || body === null ? '' : JSON.stringify(body);
      }
      return body;
    })().then(
      value => finish(null, value),
      error => {
        if (error instanceof NetworkError) return finish(error);
        const message = String((error && error.message) || '');
        if (/abort/i.test(message)) return finish(new NetworkError('aborted', 'Request cancelled.'));
        // Never surface the transport's own message: on native it can contain
        // the full request URL, API key included.
        finish(new NetworkError('offline', 'Could not reach the source. Check your connection.'));
      }
    );
  });
}

const RETRYABLE = ['timeout', 'offline', 'throttled', 'unavailable', 'server', 'blocked'];

/** Turn any thrown error into something worth putting on screen. */
export function describeError(error) {
  const kind = (error && error.kind) || 'unknown';
  const known = {
    auth: 'Your account details for this source were rejected.',
    throttled: 'Too many requests. Wait a moment before trying again.',
    timeout: 'The source took too long to respond.',
    offline: 'Could not reach the source. Check your connection.',
    blocked: 'The source answered with a block page instead of data.',
    unavailable: 'The source is temporarily unavailable.',
    server: 'The source had a server error.',
    denied: 'That address is not allowed in this app.',
    aborted: 'Request cancelled.',
    'invalid-format': 'The source returned data this app could not read.',
    'unsupported-source': 'That source is not available in this app.',
    'source-error': (error && error.message) || 'The source reported an error.'
  };
  return {
    kind,
    message: known[kind] || 'Something went wrong loading this source.',
    canRetry: RETRYABLE.includes(kind),
    needsSettings: kind === 'auth'
  };
}
