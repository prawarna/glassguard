const fs = require('fs');
const path = require('path');
const os = require('os');

function envPath(p) {
  return p ? path.normalize(p) : null;
}

function getCategories() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const winDir = process.env.WINDIR || 'C:\\Windows';

  const categories = [
    {
      id: 'userTemp',
      label: 'User Temp Files',
      description: 'Temporary files left behind by apps and installers',
      paths: [envPath(process.env.TEMP)],
      safe: true,
    },
    {
      id: 'windowsTemp',
      label: 'Windows Temp Files',
      description: 'System-level temporary files',
      paths: [envPath(path.join(winDir, 'Temp'))],
      safe: true,
    },
    {
      id: 'prefetch',
      label: 'Prefetch Cache',
      description: 'Windows app-launch prefetch data (safe to clear, rebuilds automatically)',
      paths: [envPath(path.join(winDir, 'Prefetch'))],
      safe: true,
    },
    {
      id: 'chromeCache',
      label: 'Chrome Browser Cache',
      description: 'Cached web content from Google Chrome',
      paths: [envPath(path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'))],
      safe: true,
    },
    {
      id: 'edgeCache',
      label: 'Edge Browser Cache',
      description: 'Cached web content from Microsoft Edge',
      paths: [envPath(path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'))],
      safe: true,
    },
    {
      id: 'windowsUpdate',
      label: 'Windows Update Leftovers',
      description: 'Downloaded update packages already installed (freed after next update check)',
      paths: [envPath(path.join(winDir, 'SoftwareDistribution', 'Download'))],
      safe: false,
    },
    {
      id: 'recycleBin',
      label: 'Recycle Bin',
      description: 'Files you already deleted, still taking up space',
      paths: [],
      safe: true,
      special: 'recycleBin',
    },
  ];

  return categories.filter((c) => c.special || (c.paths[0] && fs.existsSync(c.paths[0])));
}

function walkSize(dir) {
  let size = 0;
  let files = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return { size, files };
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        const sub = walkSize(full);
        size += sub.size;
        files += sub.files;
      } else if (entry.isFile()) {
        const stat = fs.statSync(full);
        size += stat.size;
        files += 1;
      }
    } catch (e) {
      // skip locked/permission-denied entries
    }
  }
  return { size, files };
}

async function scanJunk(progressCb) {
  const categories = getCategories();
  const results = [];
  for (const cat of categories) {
    if (cat.special === 'recycleBin') {
      results.push({ ...cat, size: null, files: null, note: 'Size shown by Windows Explorer' });
      continue;
    }
    let total = { size: 0, files: 0 };
    for (const p of cat.paths) {
      if (p && fs.existsSync(p)) {
        const r = walkSize(p);
        total.size += r.size;
        total.files += r.files;
      }
    }
    results.push({ ...cat, size: total.size, files: total.files });
    if (progressCb) progressCb(cat.id);
  }
  return results;
}

function deleteContents(dir) {
  let freed = 0;
  let deleted = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return { freed, deleted };
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        const sub = deleteContents(full);
        freed += sub.freed;
        deleted += sub.deleted;
        fs.rmdirSync(full);
      } else {
        const stat = fs.statSync(full);
        fs.unlinkSync(full);
        freed += stat.size;
        deleted += 1;
      }
    } catch (e) {
      // locked or in-use file, skip it rather than fail the whole clean
    }
  }
  return { freed, deleted };
}

async function cleanJunk(categoryIds) {
  const categories = getCategories().filter((c) => categoryIds.includes(c.id));
  let freed = 0;
  let deleted = 0;
  const details = [];
  const { shell } = require('electron');

  for (const cat of categories) {
    if (cat.special === 'recycleBin') {
      try {
        await require('./powershell').runPS('Clear-RecycleBin -Force -ErrorAction SilentlyContinue');
        details.push({ id: cat.id, freed: null, deleted: null, ok: true });
      } catch (e) {
        details.push({ id: cat.id, ok: false, error: e.message });
      }
      continue;
    }
    let catFreed = 0;
    let catDeleted = 0;
    for (const p of cat.paths) {
      if (p && fs.existsSync(p)) {
        const r = deleteContents(p);
        catFreed += r.freed;
        catDeleted += r.deleted;
      }
    }
    freed += catFreed;
    deleted += catDeleted;
    details.push({ id: cat.id, freed: catFreed, deleted: catDeleted, ok: true });
  }

  return { freed, deleted, details };
}

module.exports = { scanJunk, cleanJunk, getCategories };
