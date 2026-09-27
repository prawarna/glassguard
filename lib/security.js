const fs = require('fs');
const path = require('path');
const os = require('os');
const { runPSJson, runPS } = require('./powershell');

const SUSPICIOUS_DIR_HINTS = ['\\temp\\', '\\appdata\\local\\temp\\', '\\downloads\\', '\\public\\'];
const RANSOM_NOTE_HINTS = [
  'readme_to_decrypt',
  'how_to_decrypt',
  'decrypt_instructions',
  'restore_files',
  '_recover_',
  '_ransom_',
];

function isSuspiciousPath(p) {
  if (!p) return false;
  const lower = p.toLowerCase();
  return SUSPICIOUS_DIR_HINTS.some((hint) => lower.includes(hint));
}

async function checkDefender() {
  try {
    const rows = await runPSJson(
      'Get-MpComputerStatus | Select-Object AntivirusEnabled,RealTimeProtectionEnabled,AntispywareEnabled,AntivirusSignatureAge,IoavProtectionEnabled | ConvertTo-Json -Compress'
    );
    const status = rows[0];
    if (!status) return { available: false };
    return {
      available: true,
      antivirusEnabled: !!status.AntivirusEnabled,
      realTimeProtection: !!status.RealTimeProtectionEnabled,
      antispyware: !!status.AntispywareEnabled,
      signatureAgeDays: status.AntivirusSignatureAge,
    };
  } catch (e) {
    return { available: false, error: 'Windows Defender not accessible (may be managed by a 3rd-party AV, or requires admin rights)' };
  }
}

async function checkFirewall() {
  try {
    const rows = await runPSJson(
      'Get-NetFirewallProfile | Select-Object Name,Enabled | ConvertTo-Json -Compress'
    );
    return { available: true, profiles: rows.map((r) => ({ name: r.Name, enabled: !!r.Enabled })) };
  } catch (e) {
    return { available: false };
  }
}

async function checkStartupItems() {
  try {
    const rows = await runPSJson(
      'Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location,User | ConvertTo-Json -Compress'
    );
    return rows.map((r) => ({
      name: r.Name,
      command: r.Command,
      location: r.Location,
      user: r.User,
      suspicious: isSuspiciousPath(r.Command),
    }));
  } catch (e) {
    return [];
  }
}

async function checkSuspiciousProcesses() {
  try {
    const rows = await runPSJson(
      "Get-Process | Where-Object { $_.Path } | Select-Object ProcessName,Id,Path | ConvertTo-Json -Compress"
    );
    return rows
      .filter((r) => isSuspiciousPath(r.Path))
      .map((r) => ({ name: r.ProcessName, pid: r.Id, path: r.Path }));
  } catch (e) {
    return [];
  }
}

function checkHostsFile() {
  const hostsPath = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
  try {
    const content = fs.readFileSync(hostsPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const activeEntries = lines
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .filter((l) => !l.includes('localhost') || !l.match(/^(127\.0\.0\.1|::1)\s+localhost/));
    return { path: hostsPath, customEntries: activeEntries, modified: activeEntries.length > 0 };
  } catch (e) {
    return { path: hostsPath, customEntries: [], modified: false, error: e.message };
  }
}

function scanForRansomNotes() {
  const dirsToCheck = [
    os.homedir(),
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'Downloads'),
  ];
  const hits = [];
  for (const dir of dirsToCheck) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const lower = entry.name.toLowerCase();
        if (RANSOM_NOTE_HINTS.some((hint) => lower.includes(hint))) {
          hits.push(path.join(dir, entry.name));
        }
      }
    } catch (e) {
      // unreadable dir, skip
    }
  }
  return hits;
}

async function runSecurityScan(onStage) {
  const stage = (name) => onStage && onStage(name);

  stage('defender');
  const defender = await checkDefender();

  stage('firewall');
  const firewall = await checkFirewall();

  stage('startup');
  const startupItems = await checkStartupItems();

  stage('processes');
  const suspiciousProcesses = await checkSuspiciousProcesses();

  stage('hosts');
  const hosts = checkHostsFile();

  stage('ransomware');
  const ransomNotes = scanForRansomNotes();

  const findings = [];
  if (defender.available && !defender.realTimeProtection) {
    findings.push({ severity: 'high', title: 'Real-time protection is off', detail: 'Windows Defender real-time protection is disabled. Turn it on unless another antivirus is active.' });
  }
  if (firewall.available && firewall.profiles.some((p) => !p.enabled)) {
    findings.push({ severity: 'medium', title: 'Firewall disabled on a network profile', detail: 'One or more Windows Firewall profiles are turned off.' });
  }
  const suspiciousStartup = startupItems.filter((s) => s.suspicious);
  if (suspiciousStartup.length) {
    findings.push({ severity: 'medium', title: `${suspiciousStartup.length} startup item(s) launch from an unusual folder`, detail: 'Programs starting from Temp, Downloads, or Public folders are worth reviewing manually.' });
  }
  if (suspiciousProcesses.length) {
    findings.push({ severity: 'medium', title: `${suspiciousProcesses.length} running process(es) from an unusual folder`, detail: 'Processes executing from Temp or Downloads folders are a common malware pattern.' });
  }
  if (hosts.modified) {
    findings.push({ severity: 'medium', title: 'Hosts file has custom entries', detail: 'The hosts file can be used to redirect domains. Review the entries below.' });
  }
  if (ransomNotes.length) {
    findings.push({ severity: 'high', title: 'Possible ransomware note found', detail: 'File name(s) matching common ransom-note patterns were found in your user folders.' });
  }
  if (!findings.length) {
    findings.push({ severity: 'ok', title: 'No obvious issues found', detail: 'These heuristic checks did not turn up anything suspicious.' });
  }

  return { defender, firewall, startupItems, suspiciousProcesses, hosts, ransomNotes, findings, scannedAt: Date.now() };
}

module.exports = { runSecurityScan };
