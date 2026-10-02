// Keep selectors semantic and centralized. WhatsApp may change its DOM without notice;
// any required selector failure must stop outbound sending.
export const SELECTORS = Object.freeze({
  appRoot: "#app",
  readySidebar: "#pane-side",
  qrCode:
    'canvas[aria-label*="QR" i], [data-testid="qrcode"] canvas, div[data-ref] canvas',
  conversationPanel: "#main",
  conversationHeader: "#main header",
  headerTitle: '#main header [title]',
  identityAttributes:
    '#main header [data-jid], #main header [data-chat-id], #main header [data-id]',
  identityLinks:
    '#main header a[href^="tel:"], #main header a[href*="wa.me/"], #main header a[href*="phone="]',
  messages: "#main div[data-id]",
  inboundMessages: "#main div.message-in[data-id]",
  outboundMessages: "#main div.message-out[data-id]",
  messageText:
    '[data-testid="selectable-text"], .selectable-text, span[dir="ltr"]',
  messageTimestamp: "[data-pre-plain-text]",
  composer:
    '#main footer [contenteditable="true"][role="textbox"], #main footer div[contenteditable="true"]',
});
