const base = 'http://127.0.0.1:9334';
const browser = navigator.userAgent.includes('Brave') ? 'brave' : 'chrome';

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
