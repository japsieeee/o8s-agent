#!/usr/bin/env node

const os = require("os");
const { execSync } = require("child_process");
const fs = require("fs");
const yaml = require("js-yaml");
const WebSocket = require("ws");

const serviceName = 'o8s-agent'

// ---------------- CONFIG ----------------
function loadConfig(configPath = `/etc/${serviceName}/config.yml`) {
  try {
    const file = fs.readFileSync(configPath, "utf8");
    const data = yaml.load(file) || {};

    return {
      wsConnectionUrl: 'ws://192.168.68.72:26313',
      wsToken: '4590C6C6E42961448642F5E619',
      agentId: data.agentId || '',
      clusterId: data.clusterId || '',
      interval: data.interval || 30,
    };
  } catch (err) {
    console.error("❌ Failed to load config:", err.message);
    process.exit(1);
  }
}

// ---------------- METRICS ----------------
function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return { total, free, used, usedPercent: Math.round((used / total) * 100) };
}

function getRedisMemory() {
  try {
    const output = execSync("redis-cli info memory | grep used_memory_human", {
      encoding: "utf-8",
    });
    return output.trim();
  } catch {
    return undefined;
  }
}

function getStorageUsage() {
  try {
    const output = execSync("df -h --output=source,size,used,avail,pcent,target", {
      encoding: "utf-8",
    });
    const lines = output.trim().split("\n").slice(1);
    return lines.map((line) => {
      const [filesystem, size, used, avail, usedPercent, mount] =
        line.trim().split(/\s+/);
      return { filesystem, size, used, avail, usedPercent, mount };
    });
  } catch {
    return [];
  }
}

function getCpuUsage() {
  const cores = os.cpus();
  return {
    cores: cores.length,
    loadAvg: os.loadavg(),
    usagePerCore: cores.map((core) => {
      const total = Object.values(core.times).reduce((acc, tv) => acc + tv, 0);
      return Math.round(((total - core.times.idle) / total) * 100);
    }),
  };
}

function getTopProcesses() {
  try {
    const output = execSync("ps -eo pid,%mem,comm --sort=-%mem | head -n 6", {
      encoding: "utf-8",
    });
    const lines = output.trim().split("\n").slice(1);
    return lines.map((line) => {
      const [pid, memPercent, ...commandParts] = line.trim().split(/\s+/);
      return {
        pid: parseInt(pid, 10),
        memPercent: parseFloat(memPercent),
        command: commandParts.join(" "),
      };
    });
  } catch {
    return [];
  }
}

function getNetworkUsage() {
  try {
    const output = fs.readFileSync("/proc/net/dev", "utf-8");
    const lines = output.split("\n").slice(2);
    return lines
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        const iface = parts[0].replace(":", "");
        const rxBytes = parseInt(parts[1], 10);
        const txBytes = parseInt(parts[9], 10);
        return { iface, rxBytes, txBytes };
      });
  } catch {
    return [];
  }
}

function collectMetrics() {
  return {
    memory: getMemoryUsage(),
    redisMemory: getRedisMemory(),
    storage: getStorageUsage(),
    cpu: getCpuUsage(),
    topProcesses: getTopProcesses(),
    network: getNetworkUsage(),
    uptime: os.uptime(),
  };
}

// ---------------- MAIN ----------------
function startAgent() {
  const config = loadConfig();

  function connect() {
    console.log("🔌 Trying to connect to o8s server...");

    const socket = new WebSocket(config.wsConnectionUrl, {
      headers: { 
        wsToken: config.wsToken,
        agentId: config.agentId,
        clusterId: config.clusterId
      },
    });

    let metricsInterval;

    socket.on("open", () => {
      console.log("✅ connected to o8s server");

      metricsInterval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          const metrics = collectMetrics();
          socket.send(JSON.stringify({ type: "metrics", data: metrics }));
        }
      }, config.interval * 1000);
    });

    socket.on("close", () => {
      console.log("⚠️ o8s server is unavailable, retrying...");
      clearInterval(metricsInterval);
      setTimeout(connect, 5000); // retry every 5s
    });

    socket.on("error", (err) => {
      console.error("❌ socket error:", err.message);
      clearInterval(metricsInterval);
      socket.close(); // triggers "close" → retry
    });
  }

  connect();
}

startAgent();