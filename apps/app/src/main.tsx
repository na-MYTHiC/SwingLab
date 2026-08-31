import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles.css';
import { VERSION } from './version.js';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support. Registration failure is not fatal — the app works fine
// without it, and a file:// load inside the desktop shell has no SW at all.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    // Relative to the deployed base, so this works at a GitHub Pages
    // subpath as well as at a domain root. The version rides along in the
    // query string: it changes the worker's URL on every release, which is
    // what makes the browser install the new one instead of quietly serving
    // a cached build under a new version number.
    const swUrl = new URL(`sw.js?v=${VERSION}`, document.baseURI).href;
    navigator.serviceWorker.register(swUrl).then((reg) => {
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // A new build is ready and an old one is still controlling the page.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            installing.postMessage('skip-waiting');
          }
        });
      });
    }).catch(() => {});

    // Reload once when the new worker takes over, so the visible version
    // always matches the code that is actually running.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}
