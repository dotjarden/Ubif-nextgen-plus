/* Portal dark mode. Dark Reader's dynamic engine (vendor/darkreader.js, loaded
   just before this file) rewrites the colors of the portal's own stylesheets
   and of this extension's open shadow roots, so nothing here depends on the
   portal's class names. Its styles are screen-only: printing is unchanged.

   This runs at document_start. The settings record is asynchronous, so the
   last on/off state is mirrored to a one-character localStorage hint that
   paints a dark page background until the engine takes over, avoiding a white
   flash on reload.

   The engine recolors CSS, inline SVG and background images but leaves <img>
   elements alone, so black or grey logos and icons would sit dark-on-dark.
   Partly transparent images are sampled: one-color black or grey icons are
   recolored to the light text tone, and mostly black logos with colored
   accents are inverted with their hue kept. Photos and colorful artwork are
   not touched. Images a canvas cannot read (another site without CORS) stay
   as they are. */
(() => {
  'use strict';
  const DR = globalThis.DarkReader;
  const S = globalThis.UBIFPlusSettings;
  if (!DR || !S || globalThis.__ubifPlusTheme) return;
  globalThis.__ubifPlusTheme = true;
  const HINT = 'ubif-plus.dark-hint';
  // Dark Reader's default backgrounds for dark and dimmed (light scheme) modes.
  const BACKGROUND = { dark: '#181a1b', dim: '#dcdad7' };
  // The portal's CSP blocks the engine's optional inline main-world proxy,
  // which would also patch the page's CSSStyleSheet and customElements. The
  // engine detects stylesheet changes without it.
  const FIXES = Object.freeze({
    invert: [], css: '', ignoreInlineStyle: [], ignoreImageAnalysis: [],
    disableStyleSheetsProxy: true, disableCustomElementRegistryProxy: true
  });
  const system = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia('(prefers-color-scheme: dark)') : null;
  let settings = null, applied = '', guard = null;

  /* '' reads the saved state; 'dark', 'dim' or false saves it. */
  function hint(state = '') {
    try {
      if (state === '') { const saved = localStorage.getItem(HINT); return saved === '1' ? 'dark' : saved === 'dim' ? 'dim' : ''; }
      if (state) localStorage.setItem(HINT, state === 'dim' ? 'dim' : '1'); else localStorage.removeItem(HINT);
    } catch { /* storage blocked: no flash guard */ }
    return '';
  }

  function dropGuard() {
    const style = guard;
    guard = null;
    if (!style) return;
    // Let the engine's first styles paint before the guard goes.
    const frame = globalThis.requestAnimationFrame || (fn => setTimeout(fn, 16));
    frame(() => frame(() => style.remove()));
  }

  const MARK = 'data-ubif-plus-invert'; // "mono" or "invert"
  const verdicts = new Map(); // image URL -> Promise<"mono" | "invert" | "">
  let observer = null, imageStyle = null;

  /* RGBA pixels -> how to show this image on a dark page. Only images that
     are at least 20% transparent qualify (photos are opaque). Saturated colors
     such as brand purple are dark by luminance too, so only neutral pixels
     (low chroma) count as black or grey. */
  function classifyImage(data) {
    let total = 0, visible = 0, neutral = 0, dark = 0, light = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
      total++;
      if (data[i + 3] < 26) continue;
      visible++;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      light += luminance;
      if ((Math.max(r, g, b) - Math.min(r, g, b)) / 255 >= 0.2) continue;
      neutral++;
      if (luminance < 0.35) dark++;
    }
    if (!visible || (total - visible) / total < 0.2) return '';
    // A one-color icon in black or any grey: inverting mid-grey leaves it
    // grey, so it is recolored to the light text tone instead.
    if (neutral / visible >= 0.9 && light / visible < 0.65) return 'mono';
    if (dark / visible >= 0.5) return 'invert';
    return '';
  }

  function readImage(img) {
    const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
    if (!width || !height) return '';
    const scale = Math.min(1, 48 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext && canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return '';
    try {
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      return classifyImage(context.getImageData(0, 0, canvas.width, canvas.height).data);
    } catch { return ''; } // cross-origin pixels are unreadable
  }

  function verdict(img) {
    const src = img.currentSrc || img.src;
    if (!src) return Promise.resolve('');
    if (!verdicts.has(src)) {
      const loaded = img.complete && img.naturalWidth ? Promise.resolve() : new Promise((resolve, reject) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', reject, { once: true });
      });
      verdicts.set(src, loaded.then(() => readImage(img), () => ''));
    }
    return verdicts.get(src);
  }

  function markImage(img) {
    verdict(img).then(kind => {
      if (!observer || !img.isConnected) return;
      if (kind) img.setAttribute(MARK, kind); else img.removeAttribute(MARK);
    });
  }

  function scanImages(node) {
    if (node.nodeName === 'IMG') markImage(node);
    else if (node.querySelectorAll) node.querySelectorAll('img').forEach(markImage);
  }

  function startImages() {
    if (observer) return;
    imageStyle = document.createElement('style');
    imageStyle.id = 'ubif-plus-dark-images';
    imageStyle.media = 'screen';
    imageStyle.textContent = [
      `img[${MARK}=mono] { filter: brightness(0) invert(0.84) !important; }`,
      `img[${MARK}=invert] { filter: invert(1) hue-rotate(180deg) !important; }`
    ].join('\n');
    (document.head || document.documentElement).append(imageStyle);
    observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') markImage(record.target);
        else record.addedNodes.forEach(scanImages);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });
    scanImages(document.documentElement);
  }

  function stopImages() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
    imageStyle.remove();
    imageStyle = null;
    document.querySelectorAll(`img[${MARK}]`).forEach(img => img.removeAttribute(MARK));
  }

  const wanted = s => Boolean(s && s.darkMode && (!s.darkModeFollowSystem || (system && system.matches)));

  function apply() {
    if (!settings) return; // a system change before the first read
    const on = wanted(settings);
    hint(on && (settings.darkDimmed ? 'dim' : 'dark'));
    try {
      if (on) {
        // Dimmed (mode 0) softens the page instead of fully darkening it.
        const theme = { mode: settings.darkDimmed ? 0 : 1, brightness: settings.darkBrightness, contrast: settings.darkContrast, sepia: settings.darkSepia, grayscale: settings.darkGrayscale || 0 };
        const key = JSON.stringify(theme);
        if (key !== applied) {
          // Cross-origin stylesheets (fonts, CDNs) are read with the page's own
          // fetch; anything CORS refuses is skipped by the engine.
          if (typeof DR.setFetchMethod === 'function') DR.setFetchMethod(url => globalThis.fetch(url));
          DR.enable(theme, FIXES); // calling again updates the live theme
          applied = key;
        }
        // Inverting dark icons only suits a dark page, not a dimmed one.
        if (settings.darkDimmed) stopImages(); else startImages();
      } else if (applied) {
        DR.disable();
        stopImages();
        applied = '';
      }
    } catch (error) {
      console.warn('[UBIF NextGen Plus] dark mode could not be applied', error);
    }
    dropGuard();
  }

  globalThis.UBIFPlusTheme = Object.freeze({ classifyImage });
  const saved = hint();
  if (saved) {
    guard = document.createElement('style');
    guard.id = 'ubif-plus-dark-guard';
    guard.textContent = `html { background: ${BACKGROUND[saved]} !important;${saved === 'dark' ? ' color-scheme: dark;' : ''} }`;
    (document.head || document.documentElement).append(guard);
  }
  const update = next => { settings = next; apply(); };
  if (system) {
    if (typeof system.addEventListener === 'function') system.addEventListener('change', apply);
    else if (typeof system.addListener === 'function') system.addListener(apply);
  }
  S.subscribe(update);
  S.get().then(update, () => dropGuard());
})();
