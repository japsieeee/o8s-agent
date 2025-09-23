#!/usr/bin/env node

const os = require("os");
const { execSync } = require("child_process");
const fs = require("fs");
const yaml = require("js-yaml");
const WebSocket = require("ws");

// ---------------- CONFIG ----------------
function loadConfig(configPath = "/etc/jp-monitoring-agent/config.yml") {
  try {
    const file = fs.readFileSync(configPath, "utf8");
    const data = yaml.load(file) || {};

    if (!data.apiKey) {
      throw new Error("Config missing required fields: apiKey, backendUrl");
    }

    return {
      apiKey: data.apiKey,
      backendUrl: "ws://localhost:26312",
      interval: data.interval || 10,
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

  const socket = new WebSocket(config.backendUrl, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });

  socket.on("open", () => {
    console.log("✅ Agent connected to backend");
    setInterval(() => {
      const metrics = collectMetrics();
      socket.send(JSON.stringify({ type: "metrics", data: metrics }));
    }, config.interval * 1000);
  });

  socket.on("close", () => console.log("⚠️ Connection closed"));
  socket.on("error", (err) => console.error("❌ Socket error:", err.message));
}

startAgent();
