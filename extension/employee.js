/* Keep the employee label and template detail in sync. Only the local name
 * override is persisted; the authenticated Portal profile stays in memory. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusEmployee) return;
  globalThis.__ubifPlusEmployee = true;
  const S = globalThis.UBIFPlusSettings;
  let config = { employeeName: true, employeeFirstName: '', checkin: true, checkinBattery: true }, profileName = '';
  const label = document.createElement('span');
  label.dataset.ubifEmployeeName = '';
  let profileButton;
  const style = document.createElement('style');
  style.textContent = `
    header [data-ubif-profile-name]{display:inline-flex!important;align-items:center;justify-content:center;width:auto!important;min-width:0!important;height:3.125rem;flex-direction:row!important;gap:8px;padding:0 12px!important;border-radius:var(--aui-border-radius-100,8px)!important;background:transparent!important;color:var(--aui-on-surface,#1a1c1e);font-family:inherit;}
    header [data-ubif-profile-name]>:not([data-ubif-employee-name]){display:none!important;}
    header [data-ubif-profile-name]>[data-ubif-employee-name]{font-family:inherit;font-size:1rem;font-weight:400;line-height:1.5;white-space:nowrap;}
    header [data-ubif-profile-name]::after{content:'';width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg);}
    header [data-ubif-profile-name]:hover{background:var(--aui-sub-surface,#f1f0f4)!important;}
    header [data-ubif-profile-name]:focus-visible{outline:2px solid var(--aui-on-surface,#1a1c1e)!important;outline-offset:2px;}
  `;
  function restoreButton() {
    profileButton?.removeAttribute('data-ubif-profile-name');
    label.remove();
    profileButton = null;
  }
  function refresh() {
    if (!globalThis.document?.body) return;
    const firstName = config.employeeFirstName || profileName;
    if (globalThis.UBIFPlusEmployee?.firstName !== firstName) {
      globalThis.UBIFPlusEmployee = Object.freeze({ firstName });
      dispatchEvent(new Event('ubif-plus-employee'));
    }
    // Restrict the anchor to the header's profile control, never a customer avatar.
    const anchor = document.querySelector('header .components-header-opts-avatar, header [data-testid="user-avatar"], header [data-testid="user-menu"], header [aria-label="User menu"], header [aria-label="Profile"], header [aria-label="Account"], header .components-header-avatar');
    const button = anchor?.matches('button') ? anchor : anchor?.closest('button');
    if (profileButton && profileButton !== button) restoreButton();
    if (config.employeeName && firstName && button) {
      profileButton = button;
      if (!style.isConnected) document.head.append(style);
      if (!button.hasAttribute('data-ubif-profile-name')) button.setAttribute('data-ubif-profile-name', '');
      if (label.textContent !== firstName) label.textContent = firstName;
      if (label.parentElement !== button) button.append(label);
    } else restoreButton();
  }
  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || data?.source !== 'ubif-plus') return;
    if (data.type === 'employee-context' && typeof data.firstName === 'string') { profileName = data.firstName.trim().slice(0, 80); refresh(); }
    if (data.type === 'feature-settings-request') publish();
  });
  function publish() { window.postMessage({ source: 'ubif-plus', type: 'feature-settings', checkin: config.checkin, checkinBattery: config.checkinBattery }, '*'); }
  function apply(next) { config = next; refresh(); publish(); }
  if (S) { S.subscribe(apply); S.get().then(apply, () => {}); }
  const observer = new MutationObserver(refresh);
  const observe = () => { if (globalThis.document?.body) { observer.observe(document.body, { childList: true, subtree: true }); refresh(); } };
  observe();
  addEventListener('pagehide', () => observer.disconnect());
  addEventListener('pageshow', observe);
  window.postMessage({ source: 'ubif-plus', type: 'message-context-request' }, '*');
  refresh();
})();
