const si = require('systeminformation');

let lastNet = null;

async function getSnapshot() {
  const [cpu, mem, fsSize, currentLoad, netStats, temp, processes] = await Promise.all([
    si.cpu(),
    si.mem(),
    si.fsSize(),
    si.currentLoad(),
    si.networkStats(),
    si.cpuTemperature().catch(() => ({ main: null })),
    si.processes().catch(() => ({ list: [] })),
  ]);

  const net = netStats && netStats[0] ? netStats[0] : { rx_sec: 0, tx_sec: 0 };

  const topProcesses = (processes.list || [])
    .slice()
    .sort((a, b) => (b.cpu || 0) - (a.cpu || 0))
    .slice(0, 8)
    .map((p) => ({
      pid: p.pid,
      name: p.name,
      cpu: Math.round((p.cpu || 0) * 10) / 10,
      mem: Math.round((p.mem || 0) * 10) / 10,
      path: p.path || '',
    }));

  return {
    cpu: {
      brand: cpu.brand,
      cores: cpu.cores,
      load: Math.round(currentLoad.currentLoad || 0),
    },
    mem: {
      total: mem.total,
      used: mem.active,
      usedPct: Math.round((mem.active / mem.total) * 100),
    },
    disks: fsSize.map((d) => ({
      fs: d.fs,
      mount: d.mount,
      size: d.size,
      used: d.used,
      usedPct: Math.round(d.use || 0),
    })),
    net: {
      rx: net.rx_sec || 0,
      tx: net.tx_sec || 0,
    },
    temp: temp.main,
    topProcesses,
    timestamp: Date.now(),
  };
}

module.exports = { getSnapshot };
