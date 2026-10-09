/* Runs in the page's main world so it can see the portal's own network calls.
   It only reads responses the portal already made and forwards them to the
   content script with postMessage; it never issues a request of its own. */
(() => {
  if (globalThis.__ubifPlusPage) return;
  globalThis.__ubifPlusPage = true;
  const SOURCE = 'ubif-plus';
  const isWorkorders = url => /\/api\/workorders(?:\?|$)/.test(String(url));
  const isArrivals = url => /\/api\/arrivals\/upcoming-arrivals(?:\?|$)/.test(String(url));
  const methodOf = (input, init) => String(
    (init && init.method) || (typeof Request !== 'undefined' && input instanceof Request ? input.method : (input && input.method)) || 'GET'
  ).toUpperCase();
  const send = payload => {
    try { window.postMessage({ source: SOURCE, ...payload }, '*'); } catch (_) { /* page gone */ }
  };

  const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    window.fetch = async function (input, init) {
      // Universal search results must not replace the workorder table feed.
      if (init?.ubifPlusSearch || init?.ubifPlusBoard) return nativeFetch(input, init);
      // The portal can hand the body over inside a Request object. A Request body
      // can only be read once, so clone it before the request goes out.
      let pendingBody = null;
      try {
        const url = (input && input.url) || input;
        if (isWorkorders(url) && methodOf(input, init) === 'POST') {
          if (init && typeof init.body === 'string') pendingBody = Promise.resolve(init.body);
          else if (init && init.body && Object.prototype.toString.call(init.body) === '[object URLSearchParams]') pendingBody = Promise.resolve(String(init.body));
          else if (typeof Request !== 'undefined' && input instanceof Request) pendingBody = input.clone().text().catch(() => null);
        }
        // Remember the list URL so the content script can repeat it once if this
        // response never arrives (for example when the table mounted first).
        if (isArrivals(url) && methodOf(input, init) === 'GET') send({ type: 'arrivals-url', url: String(url) });
      } catch (_) { /* never break the portal's request */ }
      const response = await nativeFetch(input, init);
      try {
        const url = (input && input.url) || input;
        if (response && response.ok && isWorkorders(url) && methodOf(input, init) === 'POST') {
          if (pendingBody) pendingBody.then(body => { if (body) send({ type: 'workorders-request', body }); }).catch(() => {});
          const clone = response.clone();
          clone.json().then(json => {
            const records = json && Array.isArray(json.workOrders) ? json.workOrders : null;
            if (records) send({ type: 'workorders', records });
          }).catch(() => {});
        }
        if (response && response.ok && isArrivals(url) && methodOf(input, init) === 'GET') {
          const clone = response.clone();
          clone.json().then(json => {
            const records = json && Array.isArray(json.data) ? json.data : null;
            if (records) send({ type: 'arrivals', records, url: String(url) });
          }).catch(() => {});
        }
      } catch (_) { /* never break the portal's request */ }
      return response;
    };
  }

  const XHR = typeof XMLHttpRequest === 'function' ? window.XMLHttpRequest : null;
  if (XHR) {
    const open = XHR.prototype.open;
    const sendXhr = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__ubifPlus = { method: String(method || 'GET').toUpperCase(), url: String(url || '') };
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function (body) {
      try {
        const meta = this.__ubifPlus;
        if (meta && isWorkorders(meta.url) && meta.method === 'POST') {
          if (typeof body === 'string') send({ type: 'workorders-request', body });
          this.addEventListener('load', () => {
            try {
              const json = JSON.parse(this.responseText);
              if (json && Array.isArray(json.workOrders)) send({ type: 'workorders', records: json.workOrders });
            } catch (_) { /* not json */ }
          });
        }
        if (meta && isArrivals(meta.url) && meta.method === 'GET') {
          send({ type: 'arrivals-url', url: meta.url });
          this.addEventListener('load', () => {
            try {
              const json = JSON.parse(this.responseText);
              if (json && Array.isArray(json.data)) send({ type: 'arrivals', records: json.data, url: meta.url });
            } catch (_) { /* not json */ }
          });
        }
      } catch (_) { /* never break the portal's request */ }
      return sendXhr.apply(this, arguments);
    };
  }
})();
