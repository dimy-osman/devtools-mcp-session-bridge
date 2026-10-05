/**
 * DTMSB connector. Waits for the toolbar switch, then runs chrome-devtools-mcp
 * against that browser's attach port.
 *
 *   node dtmsb-connect.cjs brave
 *   node dtmsb-connect.cjs chrome
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const BROWSERS = {
	brave: { port: 9223, label: 'Brave' },
	chrome: { port: 9224, label: 'Chrome' },
};

const id = process.argv[2] || 'brave';
const spec = BROWSERS[id];
if (!spec) {
	process.stderr.write('[dtmsb] browser must be brave or chrome\n');
	process.exit(1);
}

const FLAG = path.join(__dirname, `session-${id}.on`);
const RETRY_MS = Number(process.env.DTMSB_RETRY_MS || 30000);

function sessionOn() {
	return fs.existsSync(FLAG);
}

function checkPort() {
	return new Promise((resolve) => {
		const req = http.get(
			{
				host: '127.0.0.1',
				port: spec.port,
				path: '/json/version',
				timeout: 2000,
			},
			(res) => {
				res.resume();
				resolve(res.statusCode === 200);
			},
		);
		req.on('error', () => resolve(false));
		req.on('timeout', () => {
			req.destroy();
			resolve(false);
		});
	});
}

async function waitForPort(ms) {
	const deadline = Date.now() + ms;
	let hit = await checkPort();
	while (!hit && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		hit = await checkPort();
	}
	return hit;
}

async function main() {
	const hit = await waitForPort(RETRY_MS);
	if (!hit) {
		if (!sessionOn()) {
			process.stderr.write(
				`[dtmsb] DevTools MCP Session Bridge is off for ${spec.label}.\n` +
					'Turn it on from the toolbar extension. That does not close your tabs.\n',
			);
		} else {
			process.stderr.write(
				`[dtmsb] ${spec.label} is not accepting DevTools on 127.0.0.1:${spec.port}.\n` +
					'Restart that browser once from the toolbar extension, then try again.\n',
			);
		}
		process.exit(1);
	}

	const browserUrl = `http://127.0.0.1:${spec.port}`;
	process.stderr.write(`[dtmsb] attaching to ${spec.label} at ${browserUrl}\n`);
	const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
	const child = spawn(npx, ['-y', 'chrome-devtools-mcp@latest', '--browserUrl', browserUrl], {
		stdio: 'inherit',
		shell: process.platform === 'win32',
		windowsHide: true,
	});
	child.on('exit', (code, signal) => {
		if (signal) process.kill(process.pid, signal);
		process.exit(code == null ? 1 : code);
	});
}

main().catch((err) => {
	process.stderr.write(`[dtmsb] ${err.message}\n`);
	process.exit(1);
});
