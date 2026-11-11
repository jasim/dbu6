# dbu6 Scripts & Server Management

This directory contains standalone, 100% path-independent automation scripts for starting, stopping, and toggling the dbu6 server on Windows.

## 📁 Directory Contents

| Script | Purpose |
| :--- | :--- |
| `start_server.bat` (alias `start.bat`) | Starts dbu6 server completely hidden in the background and opens `http://localhost:2345` |
| `stop_server.bat` (alias `stop.bat`) | Instantly stops the dbu6 server, frees port 2345, and cleans up lockfiles |
| `toggle_server.bat` (alias `toggle.bat`) | Checks server state: starts if stopped, or stops if already running |
| `start_hidden.vbs` | Native Windows VBScript engine for zero-flash hidden execution |
| `start_server.ps1` | PowerShell launcher for dbu6 background server |
| `stop_server.ps1` | PowerShell stopper for dbu6 server |
| `toggle_server.ps1` | PowerShell 1-click toggle runner |
| `esm-loader.mjs` | Node.js ESM loader hook for Windows absolute paths |
| `patch-antigravity.mjs` | Deterministic patcher ensuring Antigravity schema support across contracts, client bundle, and cache headers |

## 🚀 Dynamic Path Portability
All batch and PowerShell scripts resolve the project root dynamically using `%~dp0..` and `$PSScriptRoot\..`. The project folder can be renamed or moved anywhere on your system without breaking these scripts.

## 🖥️ Desktop Master Toggle
`C:\Users\Atul Verma\Desktop\dbu6_server_toggle.bat` links to `scripts/toggle_server.bat` dynamically to provide a single 1-click toggle on the Desktop.
