const detail = document.getElementById('detail');
const actions = document.getElementById('actions');
const toggle = document.getElementById('toggle');
const restart = document.getElementById('restart');
const note = document.getElementById('note');
const base = 'http://127.0.0.1:9334';
const browser = navigator.userAgent.includes('Brave') ? 'brave' : 'chrome';

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

function paint(body, error) {
  toggle.disabled = false;
  restart.disabled = false;
  actions.classList.remove('needs-restart');
  if (error) {
    detail.textContent =
      'The local switch is not running. Open this browser once after installing, then try again.';
    toggle.textContent = 'Unavailable';
    toggle.className = 'off';
    toggle.disabled = true;
    note.textContent = '';
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

restart.addEventListener('click', async () => {
  toggle.disabled = true;
  restart.disabled = true;
  restart.querySelector('span').textContent = 'Restarting';
  detail.textContent = 'Quitting this browser, including the tray icon, then opening it again.';
  try {
    const res = await fetch(endpoint('/restart'), { method: 'POST' });
    const body = await res.json();
    if (!res.ok || !body.restarting) {
      detail.textContent = 'Restart did not start. Try the button again.';
      restart.disabled = false;
      toggle.disabled = false;
      restart.querySelector('span').textContent = 'Restart browser';
    }
  } catch {
    paint(null, true);
  }
});

refresh();
