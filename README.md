# GlassGuard

A free, open-source system utility for Windows: junk/temp cleaner, live system monitor, and a heuristic security scanner — wrapped in a glass-morphism UI.

## What it actually does

- **Dashboard** — live CPU, memory, disk, and network usage, plus top processes by CPU.
- **Cleaner** — scans and clears common junk: user/Windows temp folders, Prefetch, browser caches, leftover Windows Update downloads, and the Recycle Bin. Shows sizes before you clean anything and lets you deselect categories.
- **Security Center** — runs heuristic checks that are genuinely useful but are **not** a replacement for a real antivirus engine:
  - Windows Defender status (real-time protection on/off, signature age)
  - Firewall profile status
  - Startup items, flagging ones that launch from unusual folders (Temp, Downloads, Public)
  - Running processes executing from unusual folders
  - Hosts file tampering (custom redirect entries)
  - File names matching common ransom-note patterns in your user folders
- **Processes** — a live, sortable-by-scan table of running processes with PID, CPU%, memory%, and executable path.

## Honest scope note

Building a full antivirus/anti-malware engine (signature databases, real-time file-system interception, a driver-level scanning stack, cloud reputation lookups) is a sustained effort by dedicated security companies — not something that can be responsibly built or claimed in a small open-source utility. GlassGuard's security checks are **heuristic and diagnostic**: they surface things worth a human looking at (an unusual startup entry, real-time protection being off, a suspicious hosts entry) rather than detecting and removing malware itself. Run it alongside Windows Defender or another real antivirus product, not instead of one.

## Tech stack

- [Electron](https://www.electronjs.org/) for the desktop shell
- [systeminformation](https://www.npmjs.com/package/systeminformation) for CPU/memory/disk/network stats
- Windows PowerShell (via `child_process.execFile`, no shell interpolation) for Defender/firewall/startup-item queries
- Plain HTML/CSS/JS for the UI — no framework, keeps the app small and easy to audit

## Running it

```bash
npm install
npm start
```

Requires Node.js and runs on Windows (the security and cleaner checks use Windows-specific paths and PowerShell cmdlets).

## Building an installer

```bash
npm run dist
```

Produces a Windows NSIS installer via `electron-builder` (add an `assets/icon.ico` first, or remove the `icon` field from `package.json`'s `build.win` section).

## Safety notes for contributors

- The cleaner only ever deletes *contents* of well-known, non-critical temp/cache directories — never arbitrary user files.
- All PowerShell calls use `execFile` with arguments passed as an array, never string-interpolated into a shell command, to avoid injection.
- The app requests no elevation by default; some Defender/firewall reads may report "not accessible" without admin rights, which the UI surfaces rather than failing silently.

## License

MIT — see [LICENSE](LICENSE). Contributions welcome.
