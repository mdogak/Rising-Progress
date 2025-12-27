/*
 © 2025 Rising Progress LLC. All rights reserved.
 URL-based PRGS loader
*/
import { loadFromPrgsText } from './save-load.js';

export function initUrlLoader(){
  try {
    const params = new URLSearchParams(window.location.search || '');
    const raw = params.get('prgs');
    if (!raw) return;

    window.__RP_URL_LOAD_PROMISE = (async () => {
      try {
        let target = raw;

        if (raw.startsWith('rel:')) {
          target = raw.slice(4);
        } else if (raw.startsWith('url:')) {
          target = raw.slice(4);
        } else {
          console.warn('[RP][URL] Invalid prgs= format:', raw);
          return false;
        }

        try { target = decodeURIComponent(target); } catch(_) {}

        const res = await fetch(target, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);

        const text = await res.text();
        if (!text.trim()) throw new Error('Empty PRGS file');

        loadFromPrgsText(text);

        // Treat as new project
        sessionStorage.removeItem('historyDateSuppressedUntil');

        window.__RP_URL_HYDRATED = true;
        return true;
      } catch (err) {
        console.warn('[RP][URL] Failed to load PRGS from URL:', err);
        if (typeof window.showToast === 'function') {
          window.showToast('Failed to load project from URL');
        }
        return false;
      }
    })();
  } catch (e) {
    console.warn('[RP][URL] URL loader initialization failed', e);
  }
}
