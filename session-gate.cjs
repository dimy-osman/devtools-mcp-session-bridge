/**
 * DTMSB session gate.
 * The browser listens on an internal port. This process owns the public attach
 * port only while the toolbar switch is on, and drops every client when it is off.
 * Tabs stay open either way.
 *
 * Brave public 9223 -> internal 47223
 * Chrome public 9224 -> internal 47224
 */
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const CONTROL_PORT = 9334;

const BROWSERS = {
	brave: {
		publicPort: 9223,
		upstreamPort: 47223,
		processName: 'brave.exe',
		candidates: [
			path.join(process.env.ProgramFiles || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
			path.join(process.env['ProgramFiles(x86)'] || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
			path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
		],
	},
	chrome: {
		publicPort: 9224,
		upstreamPort: 47224,
		processName: 'chrome.exe',
		candidates: [
			path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
			path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
			path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
		],
	},
};

const proxies = { brave: null, chrome: null };
const sockets = { brave: new Set(), chrome: new Set() };

function flagPath(id) {
	return path.join(ROOT, `session-${id}.on`);
}

function enabledOnDisk(id) {
	return fs.existsSync(flagPath(id));
}

function setEnabled(id, on) {
	const flag = flagPath(id);
	if (on) {
		fs.writeFileSync(flag, `on ${new Date().toISOString()}\n`);
	} else if (fs.existsSync(flag)) {
		fs.unlinkSync(flag);
	}
}

function log(line) {
	fs.appendFileSync(path.join(ROOT, 'session-gate.log'), `${new Date().toISOString()} ${line}\n`);
}

function browserFrom(url) {
	const id = url.searchParams.get('browser') || 'brave';
	return BROWSERS[id] ? id : null;
}

function findBrowser(id) {
	return BROWSERS[id].candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function dropClients(id) {
	for (const socket of sockets[id]) {
		socket.destroy();
	}
	sockets[id].clear();
}

function stopProxy(id) {
	dropClients(id);
	if (!proxies[id]) return Promise.resolve();
	const current = proxies[id];
	proxies[id] = null;
	return new Promise((resolve) => {
		current.close(() => resolve());
	});
}

function startProxy(id) {
	if (proxies[id]) return Promise.resolve({ ok: true });
	const spec = BROWSERS[id];
	return new Promise((resolve) => {
		const server = net.createServer((client) => {
			const upstream = net.connect(spec.upstreamPort, '127.0.0.1');
			sockets[id].add(client);
			sockets[id].add(upstream);
			const drop = () => {
				client.destroy();
				upstream.destroy();
				sockets[id].delete(client);
				sockets[id].delete(upstream);
			};
			client.on('error', drop);
			upstream.on('error', drop);
			client.on('close', drop);
			upstream.on('close', drop);
			client.pipe(upstream);
			upstream.pipe(client);
		});
		server.on('error', (err) => {
			resolve({ ok: false, error: err.code || err.message });
		});
		server.listen(spec.publicPort, '127.0.0.1', () => {
			proxies[id] = server;
			resolve({ ok: true });
		});
	});
}

function probe(port) {
	return new Promise((resolve) => {
		const socket = net.connect({ host: '127.0.0.1', port, timeout: 400 }, () => {
			socket.end();
			resolve(true);
		});
		socket.on('error', () => resolve(false));
		socket.on('timeout', () => {
			socket.destroy();
			resolve(false);
		});
	});
}

async function status(id) {
	const spec = BROWSERS[id];
	const upstreamUp = await probe(spec.upstreamPort);
	const publicUp = proxies[id] ? true : await probe(spec.publicPort);
	const enabled = enabledOnDisk(id);
	return {
		browser: id,
		enabled,
		proxyListening: Boolean(proxies[id]),
		publicPort: spec.publicPort,
		upstreamPort: spec.upstreamPort,
		upstreamUp,
		publicUp,
		needsRestart: Boolean(enabled && !upstreamUp) || Boolean(enabled && !proxies[id] && publicUp),
	};
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function processRunning(image) {
	return new Promise((resolve) => {
		const child = spawn('tasklist', ['/FI', `IMAGENAME eq ${image}`], { windowsHide: true });
		let out = '';
		child.stdout.on('data', (chunk) => {
			out += chunk;
		});
		child.on('error', () => resolve(false));
		child.on('close', () => resolve(out.toLowerCase().includes(image.toLowerCase())));
	});
}

function restartBrowser(id) {
	const spec = BROWSERS[id];
	const exe = findBrowser(id);
	const shim = path.join(ROOT, 'dtmsb-shim.exe');
	if (!exe || !fs.existsSync(shim)) {
		log(`restart ${id} missing exe=${exe} shim=${fs.existsSync(shim)}`);
		return;
	}
	spawn('taskkill', ['/F', '/IM', spec.processName], { windowsHide: true, stdio: 'ignore' }).on('error', (err) => {
		log(`restart ${id} ${err.message}`);
	});
	(async () => {
		for (let i = 0; i < 20; i++) {
			if (!(await processRunning(spec.processName))) break;
			await sleep(500);
		}
		await sleep(400);
		const child = spawn(shim, [exe], { detached: true, stdio: 'ignore', windowsHide: true });
		child.on('error', (err) => log(`launch ${id} ${err.message}`));
		child.unref();
		log(`launched ${id}`);
	})().catch((err) => log(`restart ${id} ${err.message}`));
}

async function apply(id, on) {
	setEnabled(id, on);
	if (!on) {
		await stopProxy(id);
		return status(id);
	}
	const started = await startProxy(id);
	const body = await status(id);
	if (!started.ok) {
		body.proxyError = started.error;
		if (started.error === 'EADDRINUSE') body.needsRestart = true;
	}
	return body;
}

function originAllowed(req) {
	const origin = req.headers.origin;
	if (!origin) return true;
	return origin.startsWith('chrome-extension://');
}

const control = http.createServer(async (req, res) => {
	const url = new URL(req.url || '/', 'http://127.0.0.1');
	const origin = req.headers.origin;
	if (origin && originAllowed(req)) {
		res.setHeader('Access-Control-Allow-Origin', origin);
		res.setHeader('Vary', 'Origin');
	} else if (!origin) {
		res.setHeader('Access-Control-Allow-Origin', '*');
	}
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
	if (!originAllowed(req)) {
		res.writeHead(403, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'forbidden' }));
		return;
	}
	if (req.method === 'OPTIONS') {
		res.writeHead(204);
		res.end();
		return;
	}
	try {
		const id = browserFrom(url);
		if (!id) {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'browser must be brave or chrome' }));
			return;
		}
		let body;
		if (req.method === 'GET' && url.pathname === '/status') {
			body = await status(id);
		} else if (req.method === 'POST' && url.pathname === '/on') {
			body = await apply(id, true);
		} else if (req.method === 'POST' && url.pathname === '/off') {
			body = await apply(id, false);
		} else if (req.method === 'POST' && url.pathname === '/restart') {
			restartBrowser(id);
			body = await status(id);
			body.restarting = true;
		} else {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'not found' }));
			return;
		}
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(body));
	} catch (err) {
		res.writeHead(500, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: err.message }));
	}
});

control.on('error', (err) => {
	if (err.code === 'EADDRINUSE') {
		process.exit(0);
	}
	process.stderr.write(`[dtmsb] ${err.message}\n`);
	process.exit(1);
});

control.listen(CONTROL_PORT, '127.0.0.1', async () => {
	process.stderr.write(`[dtmsb] control http://127.0.0.1:${CONTROL_PORT}\n`);
	for (const id of Object.keys(BROWSERS)) {
		if (!enabledOnDisk(id)) continue;
		const result = await apply(id, true);
		process.stderr.write(`[dtmsb] restored ${id} ${JSON.stringify(result)}\n`);
	}
	setInterval(async () => {
		for (const id of Object.keys(BROWSERS)) {
			if (!enabledOnDisk(id) || proxies[id]) continue;
			const spec = BROWSERS[id];
			const upstreamUp = await probe(spec.upstreamPort);
			const publicUp = await probe(spec.publicPort);
			if (upstreamUp && !publicUp) {
				const started = await startProxy(id);
				process.stderr.write(`[dtmsb] ${id} upstream ready, proxy ${JSON.stringify(started)}\n`);
			}
		}
	}, 1500);
});
