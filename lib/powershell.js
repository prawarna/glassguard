const { execFile } = require('child_process');

/**
 * Runs a PowerShell command and resolves with stdout.
 * Uses execFile (not exec) with args passed separately to avoid shell injection.
 */
function runPS(command, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 16, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

async function runPSJson(command, timeoutMs = 20000) {
  const out = await runPS(command, timeoutMs);
  if (!out) return [];
  try {
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    return [];
  }
}

module.exports = { runPS, runPSJson };
