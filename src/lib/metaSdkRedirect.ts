const META_REDIRECT_HOST = "staticxx.facebook.com";
const META_REDIRECT_PATH = "/x/connect/xd_arbiter/";
const MAX_META_REDIRECT_LENGTH = 4096;
const MAX_META_FRAGMENT_LENGTH = 2048;
type WindowOpen = (
  url?: string | URL,
  target?: string,
  features?: string,
) => Window | null;

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function validateMetaSdkRedirectUri(value: unknown): string | null {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_META_REDIRECT_LENGTH
  ) return null;
  if (value !== value.trim() || hasControlCharacters(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.hostname !== META_REDIRECT_HOST ||
      url.pathname !== META_REDIRECT_PATH
    ) return null;
    if (
      url.username || url.password || url.port || !url.pathname.endsWith("/")
    ) return null;
    const queryEntries = [...url.searchParams.entries()];
    if (
      queryEntries.length !== 1 || queryEntries[0][0] !== "version" ||
      !/^\d{1,4}$/.test(queryEntries[0][1])
    ) return null;
    if (
      !url.hash || url.hash.length <= 1 ||
      url.hash.length - 1 > MAX_META_FRAGMENT_LENGTH
    ) return null;
    return value;
  } catch {
    return null;
  }
}

function isMetaOAuthPopup(value: string | URL | undefined) {
  if (!value) return null;
  try {
    const popupUrl = new URL(String(value), window.location.href);
    if (!["www.facebook.com", "web.facebook.com"].includes(popupUrl.hostname)) {
      return null;
    }
    if (!popupUrl.pathname.endsWith("/dialog/oauth")) return null;
    return popupUrl.searchParams.get("redirect_uri");
  } catch {
    return null;
  }
}

export function captureNextMetaSdkRedirect(timeoutMs = 2_000) {
  const browserWindow = window as unknown as Window & { open: WindowOpen };
  const originalOpen = browserWindow.open;
  let captured: string | null = null;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    window.clearTimeout(timer);
    if (browserWindow.open === wrappedOpen) browserWindow.open = originalOpen;
  };
  const wrappedOpen: WindowOpen = (url, target, features) => {
    const popup = originalOpen.call(browserWindow, url, target, features);
    const candidate = isMetaOAuthPopup(url);
    const validated = validateMetaSdkRedirectUri(candidate);
    if (!captured && validated) {
      captured = validated;
      queueMicrotask(restore);
    }
    return popup;
  };
  const timer = window.setTimeout(restore, timeoutMs);
  browserWindow.open = wrappedOpen;
  return { getCaptured: () => captured, restore };
}
