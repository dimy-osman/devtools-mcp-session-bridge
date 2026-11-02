const base = 'http://127.0.0.1:9334';

async function detectBrowser() {
  try {
    if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
      if (await navigator.brave.isBrave()) return 'brave';
    }
  } catch {
    /* use the other checks */
  }
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  if (brands.some((item) => /brave/i.test(item.brand))) return 'brave';
  if (/Brave/i.test(navigator.userAgent || '')) return 'brave';
  return 'chrome';
}

function iconPath(on) {
  const name = on ? 'on' : 'off';
  return {
    16: `icon16-${name}.png`,
    48: `icon48-${name}.png`,
    128: `icon128-${name}.png`,
  };
}

async function paintIcon() {
  let on = false;
  try {
    const browser = await detectBrowser();
    const res = await fetch(`${base}/status?browser=${browser}`);
    const body = await res.json();
    on = Boolean(body.enabled && body.proxyListening);
  } catch {
    on = false;
  }
  await chrome.action.setIcon({ path: iconPath(on) });
  await chrome.action.setTitle({
    title: on
      ? 'DevTools MCP Session Bridge: on'
      : 'DevTools MCP Session Bridge: off',
  });
}

chrome.runtime.onInstalled.addListener(() => {
  paintIcon();
});

chrome.runtime.onStartup.addListener(() => {
  paintIcon();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'refresh-icon') return;
  paintIcon().then(
    () => sendResponse({ ok: true }),
    () => sendResponse({ ok: false }),
  );
  return true;
});

chrome.alarms.create('paint-icon', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'paint-icon') paintIcon();
});

paintIcon();
