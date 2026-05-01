// Wires the "Install app" button to the browser's PWA install flow.
//
// Flow:
//   1. Browser fires `beforeinstallprompt` when the site meets install criteria
//      (manifest + service worker + HTTPS-or-localhost + not already installed).
//      We stash the event and reveal the button.
//   2. On click, we call prompt() and let the OS show its install dialog.
//   3. If the user installs (or the page is already running standalone), we
//      hide the button — there's nothing left to install.
//   4. If the browser never fires the event (Safari, Firefox, mobile Firefox,
//      or any browser that doesn't support installs), we show a small hint
//      pointing the user at Edge/Chrome instead. We only show the hint on
//      desktop, since on mobile this app isn't really meant to be installed.

export function initInstallPrompt() {
  const btn = document.getElementById('btn-install');
  const hint = document.getElementById('install-hint');
  if (!btn) return;

  if (isStandalone()) return;

  let deferredPrompt = null;
  let promptFired = false;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    promptFired = true;
    if (hint) hint.hidden = true;
    btn.hidden = false;
  });

  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    btn.disabled = true;
    try {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } finally {
      deferredPrompt = null;
      btn.disabled = false;
      btn.hidden = true;
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    btn.hidden = true;
    if (hint) hint.hidden = true;
  });

  // Fallback hint for browsers that don't fire `beforeinstallprompt`.
  // Wait a beat — Chrome/Edge fire the event a little after load.
  if (hint) {
    setTimeout(() => {
      if (promptFired) return;
      if (isStandalone()) return;
      if (isLikelyMobile()) return;
      hint.hidden = false;
    }, 1500);
  }
}

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    // Safari on iOS exposes navigator.standalone
    window.navigator.standalone === true
  );
}

function isLikelyMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
