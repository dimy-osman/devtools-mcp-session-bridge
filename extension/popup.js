const detail = document.getElementById('detail');
const actions = document.getElementById('actions');
const toggle = document.getElementById('toggle');
const restart = document.getElementById('restart');
const note = document.getElementById('note');
const base = 'http://127.0.0.1:9334';
const helper = 'com.dtmsb.helper';
let browser = 'chrome';
let switchDown = false;

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

function endpoint(path) {
  return `${base}${path}?browser=${browser}`;
}

function iconPath(on) {
  const name = on ? 'on' : 'off';
  return {
    16: `icon16-${name}.png`,
    48: `icon48-${name}.png`,
    128: `icon128-${name}.png`,
  };
}

function paintIcon(on) {
  chrome.action.setIcon({ path: iconPath(on) });
  chrome.action.setTitle({
    title: on
      ? 'DevTools MCP Session Bridge: on'
      : 'DevTools MCP Session Bridge: off',
  });
  chrome.runtime.sendMessage({ type: 'refresh-icon' });
}

function browserLabel() {
  return browser === 'brave' ? 'Brave' : 'Chrome';
}

function restartFailed(message) {
  detail.textContent = message;
  restart.disabled = false;
  toggle.disabled = switchDown;
  restart.querySelector('span').textContent = 'Restart browser';
}

function paint(body, error) {
  switchDown = Boolean(error);
  toggle.disabled = false;
  restart.disabled = false;
  actions.classList.remove('needs-restart', 'switch-down');
  if (error) {
    const label = browserLabel();
    detail.textContent =
      `The local switch is not running. This ${label} window started before the switch could attach. Restart ${label} once to start it.`;
    actions.classList.add('switch-down');
    toggle.textContent = 'Unavailable';
    toggle.className = 'off';
    toggle.disabled = true;
    note.textContent =
      'This restart closes your tabs once, including the tray icon. After that, the switch can turn on and off without closing tabs.';
    paintIcon(false);
    return;
  }
  const live = Boolean(body.enabled && body.proxyListening);
  paintIcon(live);
  if (body.needsRestart) {
    detail.textContent =
      'This browser needs one full restart before an MCP client can attach. This restart closes your tabs once.';
    actions.classList.add('needs-restart');
    toggle.textContent = body.enabled ? 'Turn off' : 'Turn on';
    toggle.className = body.enabled ? 'off' : 'on';
    note.textContent = 'After this restart, the switch does not close your tabs.';
    return;
  }
  if (live) {
    detail.textContent = 'On. An MCP client can attach to this browser.';
    toggle.textContent = 'Turn off';
    toggle.className = 'off';
    note.textContent =
      'Some sites and human checks fail while this is on. Your tabs stay open. Turning this off drops the connection immediately.';
    return;
  }
  detail.textContent = 'Off. An MCP client cannot attach.';
  toggle.textContent = 'Turn on';
  toggle.className = 'on';
  note.textContent =
    'Some sites and human checks fail while this is on. Turning it on does not reload your tabs.';
}

async function refresh() {
  browser = await detectBrowser();
  try {
    const res = await fetch(endpoint('/status'));
    paint(await res.json());
  } catch {
    paint(null, true);
  }
}

toggle.addEventListener('click', async () => {
  toggle.disabled = true;
  restart.disabled = true;
  const turnOn = toggle.className === 'on';
  try {
    const res = await fetch(endpoint(turnOn ? '/on' : '/off'), { method: 'POST' });
    paint(await res.json());
  } catch {
    paint(null, true);
  }
});

function ensureSwitch() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(helper, { action: 'ensure', browser }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      if (!response || !response.ok) {
        reject(new Error((response && response.error) || 'helper failed'));
        return;
      }
      resolve(response);
    });
  });
}

async function waitForSwitch() {
  for (let i = 0; i < 15; i++) {
    try {
      const res = await fetch(endpoint('/status'));
      if (res.ok) return true;
    } catch {
      /* the gate is still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

restart.addEventListener('click', async () => {
  toggle.disabled = true;
  restart.disabled = true;
  restart.querySelector('span').textContent = 'Restarting';
  detail.textContent = 'Quitting this browser, including the tray icon, then opening it again.';
  try {
    if (switchDown) {
      await ensureSwitch();
      if (!(await waitForSwitch())) {
        restartFailed('The local switch did not start. Run Install-DTMSB.ps1, then try again.');
        return;
      }
    }
    const res = await fetch(endpoint('/restart'), { method: 'POST' });
    const body = await res.json();
    if (!res.ok || !body.restarting) {
      restartFailed('Restart did not start. Try the button again.');
    }
  } catch (err) {
    const text = String((err && err.message) || '');
    if (/native messaging host|forbidden|not found/i.test(text)) {
      restartFailed('The restart helper is not registered. Run Install-DTMSB.ps1, reload this extension, then try again.');
      return;
    }
    restartFailed('Restart did not start. Try the button again.');
  }
});

refresh();
