// Registers the service worker so the app is installable on Windows / macOS / mobile.
// Skipped during `vite dev` because Vite serves modules in a way that confuses the SW cache;
// the SW is only registered in production builds (where the bundled assets are stable).
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env && import.meta.env.DEV) return;

  window.addEventListener('load', () => {
    const swUrl = new URL('./sw.js', document.baseURI).toString();
    navigator.serviceWorker.register(swUrl).catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
