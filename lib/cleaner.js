const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

// How many files to process before yielding back to the event loop.
// Keeps the Electron main process (and its IPC/UI) responsive during
// large deletes instead of blocking for the whole operation.
const YIELD_EVERY = 100;

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

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
      description: 'Downloaded update packages already installed (freed after next update check). Can contain hundreds of thousands of small files, so this is the slowest category to clean.',
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

async function walkSize(dir, counter) {
  let size = 0;
  let files = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return { size, files };
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        const sub = await walkSize(full, counter);
        size += sub.size;
        files += sub.files;
      } else if (entry.isFile()) {
        const stat = await fsp.stat(full);
        size += stat.size;
        files += 1;
      }
    } catch (e) {
      // skip locked/permission-denied entries
    }
    counter.n += 1;
    if (counter.n % YIELD_EVERY === 0) await yieldToEventLoop();
  }
  return { size, files };
}

async function scanJunk(progressCb) {
  const categories = getCategories();
  const results = [];
  const counter = { n: 0 };
  for (const cat of categories) {
    if (cat.special === 'recycleBin') {
      results.push({ ...cat, size: null, files: null, note: 'Size shown by Windows Explorer' });
      continue;
    }
    let total = { size: 0, files: 0 };
    for (const p of cat.paths) {
      if (p && fs.existsSync(p)) {
        const r = await walkSize(p, counter);
        total.size += r.size;
        total.files += r.files;
      }
    }
    results.push({ ...cat, size: total.size, files: total.files });
    if (progressCb) progressCb({ stage: 'category-done', categoryId: cat.id });
  }
  return results;
}

async function deleteContents(dir, counter, onProgress) {
  let freed = 0;
  let deleted = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return { freed, deleted };
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        const sub = await deleteContents(full, counter, onProgress);
        freed += sub.freed;
        deleted += sub.deleted;
        await fsp.rmdir(full);
      } else {
        const stat = await fsp.stat(full);
        await fsp.unlink(full);
        freed += stat.size;
        deleted += 1;
      }
    } catch (e) {
      // locked or in-use file, skip it rather than fail the whole clean
    }
    counter.n += 1;
    if (counter.n % YIELD_EVERY === 0) {
      await yieldToEventLoop();
      if (onProgress) onProgress({ stage: 'deleting', filesDeleted: counter.n });
    }
  }
  return { freed, deleted };
}

async function cleanJunk(categoryIds, onProgress) {
  const categories = getCategories().filter((c) => categoryIds.includes(c.id));
  let freed = 0;
  let deleted = 0;
  const details = [];
  const counter = { n: 0 };

  for (const cat of categories) {
    if (onProgress) onProgress({ stage: 'category-start', categoryId: cat.id, label: cat.label });

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
    const perCategoryProgress = onProgress
      ? (p) => onProgress({ ...p, categoryId: cat.id })
      : null;
    for (const p of cat.paths) {
      if (p && fs.existsSync(p)) {
        const r = await deleteContents(p, counter, perCategoryProgress);
        catFreed += r.freed;
        catDeleted += r.deleted;
      }
    }
    freed += catFreed;
    deleted += catDeleted;
    details.push({ id: cat.id, freed: catFreed, deleted: catDeleted, ok: true });
    if (onProgress) onProgress({ stage: 'category-done', categoryId: cat.id, freed: catFreed, deleted: catDeleted });
  }

  return { freed, deleted, details };
}

module.exports = { scanJunk, cleanJunk, getCategories };
