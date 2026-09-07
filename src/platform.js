// Which HTTP implementation the app is allowed to use.
//
// On the device, API calls go through Capacitor's native HTTP so WKWebView's
// cross-origin rules do not block them. In a desktop browser (Vite dev server,
// Playwright) the same calls fall back to `fetch`, which is a development
// preview only -- it is not a CORS workaround and it is never used on device.

let override = null;

export function setTransport(transport) {
  override = transport;
}

export function resetTransport() {
  override = null;
}

export function isNative() {
  return Boolean(
    typeof globalThis !== 'undefined' &&
    globalThis.Capacitor &&
    typeof globalThis.Capacitor.isNativePlatform === 'function' &&
    globalThis.Capacitor.isNativePlatform()
  );
}

function nativeTransport(CapacitorHttp) {
  return {
    kind: 'native',
    async get(url, options) {
      const response = await CapacitorHttp.request({
        url,
        method: 'GET',
        // Redirects are off for API calls: a redirect off the allowed origin
        // would carry the credentials in the query string with it.
        disableRedirects: true,
        connectTimeout: options.timeoutMs,
        readTimeout: options.timeoutMs,
        responseType: 'text',
        headers: { Accept: options.format === 'json' ? 'application/json' : 'text/plain' }
      });
      return { status: Number(response.status), body: response.data };
    }
  };
}

function browserTransport() {
  return {
    kind: 'browser',
    async get(url, options) {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: options.signal
      });
      const body = await response.text();
      return { status: response.status, body };
    }
  };
}

export async function getTransport() {
  if (override) return override;
  if (isNative()) {
    // Imported lazily so Node tests and the browser preview never need the
    // native plugin to be loadable.
    const { CapacitorHttp } = await import('@capacitor/core');
    return nativeTransport(CapacitorHttp);
  }
  return browserTransport();
}
