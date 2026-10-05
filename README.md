# DevTools MCP Session Bridge

Codename: **DTMSB**

A small Windows switch that lets an MCP client attach to the Chrome or Brave window you already have open. The toolbar extension opens and closes that attach port without quitting the browser.

While the switch is on, some sites and human checks fail.

This is the bridge. The MCP server is [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp), pointed at the attach URL below.

## Attach URLs

| Browser | URL |
|---|---|
| Brave | `http://127.0.0.1:9223` |
| Chrome | `http://127.0.0.1:9224` |

## Install

Windows, with Node.js and either Chrome, Brave, or both.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-DTMSB.ps1
```

Then in each browser: `chrome://extensions` or `brave://extensions`, turn on Developer mode, and load the unpacked `extension` folder. Restart that browser once.

## MCP client

Brave:

```json
{
  "mcpServers": {
    "devtools-brave": {
      "command": "node",
      "args": ["C:/path/to/dtmsb-connect.cjs", "brave"]
    }
  }
}
```

Chrome:

```json
{
  "mcpServers": {
    "devtools-chrome": {
      "command": "node",
      "args": ["C:/path/to/dtmsb-connect.cjs", "chrome"]
    }
  }
}
```

`dtmsb-connect.cjs` waits for the toolbar switch, then runs `chrome-devtools-mcp` against that browser.

## What the switch does

Each browser keeps an internal DevTools port from the moment it starts. The public attach port opens only while the extension is on, and it closes immediately when you turn the extension off. Open tabs stay open.

The attach port gives the MCP client the same reach as DevTools: pages, cookies, and signed-in sessions in that window. Turn it off when you do not want that.

## License

MIT
