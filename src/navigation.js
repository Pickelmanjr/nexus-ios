import { SOURCES } from './sources.js';

// A link opened inside the web view would run on the app's own origin, with the
// Capacitor bridge attached. Every external link therefore leaves through the
// system browser, and only after the address has been checked.

const ALLOWED_HOSTS = Object.values(SOURCES).flatMap(source => [
  new URL(source.site).hostname,
  new URL(source.api).hostname
]);

// Loopback and private ranges are refused outright.
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|\[?::1\]?)/i;

let plugins = null;

export function setNavigationPlugins(next) {
  plugins = next;
}

export function isSafeExternalUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch (e) {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;

  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host)) return false;
  // Boundary match: "gelbooru.com.attacker.test" must not pass as Gelbooru.
  return ALLOWED_HOSTS.some(allowed => host === allowed || host.endsWith('.' + allowed));
}

// Wrapped in an object on purpose. Capacitor's plugin proxies expose a `then`,
// so returning one straight out of an async function makes `await` treat it as
// a thenable and call `Browser.then()`, which the web implementation throws on.
async function browserPlugin() {
  if (plugins && plugins.Browser) return { plugin: plugins.Browser };
  const module = await import('@capacitor/browser');
  return { plugin: module.Browser };
}

/** Open a validated source link outside the app. Returns false if refused. */
export async function openExternal(value) {
  if (!isSafeExternalUrl(value)) return false;
  const url = new URL(String(value)).href;
  try {
    const { plugin } = await browserPlugin();
    await plugin.open({ url });
    return true;
  } catch (e) {
    // In the browser preview there is no plugin; fall back to a new tab that
    // cannot reach back into this window.
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    }
    return false;
  }
}
