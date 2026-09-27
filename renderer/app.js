// --- Window controls ---
document.getElementById('btn-min').onclick = () => window.glass.window.minimize();
document.getElementById('btn-max').onclick = () => window.glass.window.maximize();
document.getElementById('btn-close').onclick = () => window.glass.window.close();

// --- Navigation ---
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');
navItems.forEach((item) => {
  item.addEventListener('click', () => {
    navItems.forEach((n) => n.classList.remove('active'));
    views.forEach((v) => v.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('view-' + item.dataset.view).classList.add('active');
  });
});

// --- Formatting helpers ---
function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
function formatRate(bytesPerSec) {
  return formatBytes(bytesPerSec) + '/s';
}

// --- Dashboard live monitor ---
async function refreshDashboard() {
  try {
    const snap = await window.glass.monitor.snapshot();

    setRing('ring-cpu', 'cpu-pct', snap.cpu.load);
    document.getElementById('cpu-name').textContent = `${snap.cpu.brand} · ${snap.cpu.cores} cores`;

    setRing('ring-mem', 'mem-pct', snap.mem.usedPct);
    document.getElementById('mem-detail').textContent = `${formatBytes(snap.mem.used)} / ${formatBytes(snap.mem.total)}`;

    const mainDisk = snap.disks.find((d) => d.mount && d.mount.toLowerCase().startsWith('c')) || snap.disks[0];
    if (mainDisk) {
      setRing('ring-disk', 'disk-pct', mainDisk.usedPct);
      document.getElementById('disk-detail').textContent = `${formatBytes(mainDisk.used)} / ${formatBytes(mainDisk.size)}`;
    }

    document.getElementById('net-down').textContent = formatRate(snap.net.rx);
    document.getElementById('net-up').textContent = formatRate(snap.net.tx);

    renderProcTable('dash-proc-table', snap.topProcesses, false);
    renderProcTable('full-proc-table', snap.topProcesses, true);
  } catch (e) {
    console.error('monitor snapshot failed', e);
  }
}

function setRing(ringId, textId, pct) {
  const ring = document.getElementById(ringId);
  const text = document.getElementById(textId);
  const clamped = Math.max(0, Math.min(100, pct || 0));
  ring.style.setProperty('--pct', clamped);
  text.textContent = `${clamped}%`;
}

function renderProcTable(tableId, list, withPathAndPid) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = '';
  list.forEach((p) => {
    const tr = document.createElement('tr');
    if (withPathAndPid) {
      tr.innerHTML = `<td>${escapeHtml(p.name)}</td><td>${p.pid}</td><td>${p.cpu}%</td><td>${p.mem}%</td><td class="proc-path">${escapeHtml(p.path)}</td>`;
    } else {
      tr.innerHTML = `<td>${escapeHtml(p.name)}</td><td>${p.cpu}%</td><td>${p.mem}%</td>`;
    }
    tbody.appendChild(tr);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

refreshDashboard();
setInterval(refreshDashboard, 3000);

// --- Cleaner ---
const cleanerList = document.getElementById('cleaner-list');
const btnScanJunk = document.getElementById('btn-scan-junk');
const btnCleanSelected = document.getElementById('btn-clean-selected');
const cleanerStatus = document.getElementById('cleaner-status');
const cleanerTotalSize = document.getElementById('cleaner-total-size');

let lastScan = [];

btnScanJunk.addEventListener('click', async () => {
  btnScanJunk.disabled = true;
  btnScanJunk.textContent = 'Scanning...';
  cleanerList.innerHTML = '<p class="hint">Scanning temp folders, browser caches, and update leftovers...</p>';
  try {
    lastScan = await window.glass.cleaner.scan();
    renderJunkList();
  } catch (e) {
    cleanerList.innerHTML = `<p class="hint">Scan failed: ${escapeHtml(e.message)}</p>`;
  }
  btnScanJunk.disabled = false;
  btnScanJunk.textContent = 'Scan for Junk';
});

function renderJunkList() {
  cleanerList.innerHTML = '';
  lastScan.forEach((cat) => {
    const div = document.createElement('div');
    div.className = 'junk-item';
    const sizeLabel = cat.size === null ? (cat.note || '—') : formatBytes(cat.size);
    div.innerHTML = `
      <input type="checkbox" data-id="${cat.id}" ${cat.safe ? 'checked' : ''} />
      <div class="junk-item-main">
        <div class="junk-item-title">${escapeHtml(cat.label)} ${cat.safe ? '' : '<span class="tag-caution">Review first</span>'}</div>
        <div class="junk-item-desc">${escapeHtml(cat.description)}${cat.files ? ` · ${cat.files.toLocaleString()} files` : ''}</div>
      </div>
      <div class="junk-item-size">${sizeLabel}</div>
    `;
    cleanerList.appendChild(div);
  });
  cleanerList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', updateCleanerTotal);
  });
  updateCleanerTotal();
}

function updateCleanerTotal() {
  const checked = [...cleanerList.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => cb.dataset.id);
  const total = lastScan
    .filter((c) => checked.includes(c.id) && typeof c.size === 'number')
    .reduce((sum, c) => sum + c.size, 0);
  cleanerTotalSize.textContent = formatBytes(total);
  btnCleanSelected.disabled = checked.length === 0;
}

const categoryLabel = (id) => (lastScan.find((c) => c.id === id) || {}).label || id;

window.glass.cleaner.onProgress((progress) => {
  if (progress.stage === 'category-start') {
    cleanerStatus.textContent = `Cleaning ${categoryLabel(progress.categoryId)}...`;
  } else if (progress.stage === 'deleting') {
    cleanerStatus.textContent = `Cleaning ${categoryLabel(progress.categoryId)}... ${progress.filesDeleted.toLocaleString()} files removed so far`;
  } else if (progress.stage === 'category-done' && progress.freed !== undefined) {
    cleanerStatus.textContent = `Finished ${categoryLabel(progress.categoryId)} — freed ${formatBytes(progress.freed)}`;
  }
});

btnCleanSelected.addEventListener('click', async () => {
  const checked = [...cleanerList.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => cb.dataset.id);
  if (!checked.length) return;
  btnCleanSelected.disabled = true;
  btnScanJunk.disabled = true;
  cleanerStatus.textContent = 'Starting...';
  try {
    const result = await window.glass.cleaner.clean(checked);
    cleanerStatus.textContent = `Done — freed ${formatBytes(result.freed)} across ${result.deleted.toLocaleString()} files.`;
    lastScan = await window.glass.cleaner.scan();
    renderJunkList();
  } catch (e) {
    cleanerStatus.textContent = `Error: ${e.message}`;
  }
  btnCleanSelected.disabled = false;
  btnScanJunk.disabled = false;
});

// --- Security ---
const btnScanSecurity = document.getElementById('btn-scan-security');
const securityResults = document.getElementById('security-results');
const securityStage = document.getElementById('security-stage');

const STAGE_LABELS = {
  defender: 'Checking Windows Defender...',
  firewall: 'Checking firewall profiles...',
  startup: 'Reviewing startup items...',
  processes: 'Scanning running processes...',
  hosts: 'Checking hosts file...',
  ransomware: 'Looking for ransom-note patterns...',
};

window.glass.security.onProgress((stage) => {
  securityStage.textContent = STAGE_LABELS[stage] || '';
});

btnScanSecurity.addEventListener('click', async () => {
  btnScanSecurity.disabled = true;
  securityResults.innerHTML = '';
  try {
    const report = await window.glass.security.scan();
    renderSecurityReport(report);
  } catch (e) {
    securityResults.innerHTML = `<p class="hint">Scan failed: ${escapeHtml(e.message)}</p>`;
  }
  securityStage.textContent = '';
  btnScanSecurity.disabled = false;
});

function renderSecurityReport(report) {
  let html = '';
  report.findings.forEach((f) => {
    html += `
      <div class="finding ${f.severity}">
        <span class="finding-dot"></span>
        <div>
          <div class="finding-title">${escapeHtml(f.title)}</div>
          <div class="finding-detail">${escapeHtml(f.detail)}</div>
        </div>
      </div>`;
  });

  if (report.startupItems && report.startupItems.length) {
    html += `<div class="subsection"><div class="subsection-title">Startup Items (${report.startupItems.length})</div><div class="chip-row">`;
    report.startupItems.forEach((s) => {
      html += `<span class="chip ${s.suspicious ? 'warn' : ''}" title="${escapeHtml(s.command)}">${escapeHtml(s.name)}</span>`;
    });
    html += `</div></div>`;
  }

  if (report.suspiciousProcesses && report.suspiciousProcesses.length) {
    html += `<div class="subsection"><div class="subsection-title">Processes running from unusual folders</div><div class="chip-row">`;
    report.suspiciousProcesses.forEach((p) => {
      html += `<span class="chip warn" title="${escapeHtml(p.path)}">${escapeHtml(p.name)} (PID ${p.pid})</span>`;
    });
    html += `</div></div>`;
  }

  if (report.hosts && report.hosts.customEntries && report.hosts.customEntries.length) {
    html += `<div class="subsection"><div class="subsection-title">Custom hosts file entries</div><div class="chip-row">`;
    report.hosts.customEntries.forEach((e) => {
      html += `<span class="chip warn">${escapeHtml(e)}</span>`;
    });
    html += `</div></div>`;
  }

  if (report.ransomNotes && report.ransomNotes.length) {
    html += `<div class="subsection"><div class="subsection-title">Possible ransom notes</div><div class="chip-row">`;
    report.ransomNotes.forEach((p) => {
      html += `<span class="chip warn">${escapeHtml(p)}</span>`;
    });
    html += `</div></div>`;
  }

  securityResults.innerHTML = html;
}
