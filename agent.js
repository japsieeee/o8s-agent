#!/usr/bin/env node

const os = require("os");
const fs = require("fs/promises");
const { exec } = require("child_process");
const yaml = require("js-yaml");
const { io } = require("socket.io-client");
const util = require("util");
const { DateTime } = require("luxon");

const execAsync = util.promisify(exec);

const serviceName = "o8s-agent";

// ---------------- CONFIG ----------------
async function loadConfig(configPath = `/etc/${serviceName}/config.yml`) {
  try {
    const file = await fs.readFile(configPath, "utf8");
    const data = yaml.load(file) || {};

    return {
      wsConnectionUrl: "http://54.238.28.66:26313",
      wsToken: "4590C6C6E42961448642F5E619",
      agentId: data.agentId || "",
      clusterId: data.clusterId || "",
      interval: data.interval || 30, // seconds
      pm2EcosystemPath: data.pm2EcosystemPath || "",
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

async function getStorageUsage() {
  try {
    const { stdout } = await execAsync(
      "df -h --output=source,size,used,avail,pcent,target"
    );
    return stdout
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => {
        const [filesystem, size, used, avail, usedPercent, mount] = line
          .trim()
          .split(/\s+/);
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
      const total = Object.values(core.times).reduce((a, t) => a + t, 0);
      return Math.round(((total - core.times.idle) / total) * 100);
    }),
  };
}

async function getTopProcesses() {
  try {
    const { stdout } = await execAsync(
      "ps -eo pid,%mem,comm --sort=-%mem | head -n 6"
    );
    return stdout
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => {
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

async function getNetworkUsage() {
  try {
    const output = await fs.readFile("/proc/net/dev", "utf-8");
    return output
      .split("\n")
      .slice(2)
      .filter((l) => l.trim().length)
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return {
          iface: parts[0].replace(":", ""),
          rxBytes: parseInt(parts[1], 10),
          txBytes: parseInt(parts[9], 10),
        };
      });
  } catch {
    return [];
  }
}

// ✅ NEW: PM2 Metrics
async function getPm2Services() {
  try {
    const { stdout } = await execAsync("pm2 jlist");
    const services = JSON.parse(stdout);

    return services.map((proc) => ({
      name: proc.name,
      pid: proc.pid,
      status: proc.pm2_env?.status || "unknown",
      cpu: proc.monit?.cpu ?? null,
      memory: proc.monit?.memory ?? null,
      uptime: proc.pm2_env?.pm_uptime
        ? DateTime.fromMillis(proc.pm2_env.pm_uptime).toISO()
        : null,
      restartCount: proc.pm2_env?.restart_time ?? 0,
    }));
  } catch (err) {
    if (err.message.includes("pm2: not found") || err.code === 127) {
      return undefined;
    }
    console.warn("⚠️ Failed to fetch PM2 processes:", err.message);
    return undefined;
  }
}

// ✅ NEW: PM2 ACTIONS
async function handlePm2Action(action, serviceName, ecosystemPath) {
  const validActions = ["restart", "start", "stop", "rollback"];
  if (!validActions.includes(action)) {
    throw new Error(`Invalid PM2 action: ${action}`);
  }

  try {
    // Check if PM2 exists
    await execAsync("pm2 -v").catch(() => {
      throw new Error("PM2 not installed on this system");
    });

    let command;
    switch (action) {
      case "start":
        command = `pm2 start ${ecosystemPath} --only ${serviceName}`;
        break;
      case "restart":
        command = `pm2 restart ${serviceName}`;
        break;
      case "stop":
        command = `pm2 stop ${serviceName}`;
        break;
      case "rollback":
        // command = `pm2 delete ${serviceName} && pm2 resurrect`;
        break;
    }

    const { stdout } = await execAsync(command);
    return { success: true, output: stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------- COLLECT ----------------
async function collectMetrics(config) {
  return {
    agentId: config.agentId,
    clusterId: config.clusterId,
    dateTime: DateTime.utc().toFormat("yyyy-MM-dd HH:mm:ss"),
    memory: getMemoryUsage(),
    storage: await getStorageUsage(),
    cpu: getCpuUsage(),
    topProcesses: await getTopProcesses(),
    network: await getNetworkUsage(),
    uptime: os.uptime(),
    pm2Services: await getPm2Services(),
  };
}

// ---------------- MAIN ----------------
async function startAgent() {
  const config = await loadConfig();
  let socket;
  let metricsInterval;

  async function connect() {
    console.log("🔌 Attempting to connect to o8s server...");

    socket = io(config.wsConnectionUrl, {
      auth: {
        wsToken: config.wsToken,
        agentId: config.agentId,
        clusterId: config.clusterId,
      },
      transports: ["websocket"],
      reconnection: false,
    });

    socket.on("connect", async () => {
      console.log("✅ Connected to o8s server");

      if (metricsInterval) clearInterval(metricsInterval);

      try {
        const metrics = await collectMetrics(config);
        socket.emit("metrics", metrics);
        console.log("📤 Sent initial metrics immediately");
      } catch (err) {
        console.error("❌ Failed to send initial metrics:", err.message);
      }

      metricsInterval = setInterval(async () => {
        const metrics = await collectMetrics(config);
        socket.emit("metrics", metrics);
      }, config.interval * 1000);
    });

    // 🌀 PM2 ACTION HANDLER
    const pm2ActionEvent = `pm2-action:${config.clusterId}:${config.agentId}`;
    socket.on(pm2ActionEvent, async (payload) => {
      const { serviceName, action } = payload || {};
      console.log(`⚙️ Received PM2 action: ${action} on ${serviceName}`);

      const result = await handlePm2Action(
        action,
        serviceName,
        config.pm2EcosystemPath
      );

      socket.emit(`pm2-action-result`, {
        ...result,
        serviceName,
        action,
        agentId: config.agentId,
        clusterId: config.clusterId,
        timestamp: DateTime.utc().toISO(),
      });
    });

    // 🌀 REBOOT HANDLER
    const rebootEvent = `reboot:${config.clusterId}:${config.agentId}`;
    socket.on(rebootEvent, () => {
      exec("sudo reboot", (error, stdout, stderr) => {
        if (error) return console.error(`❌ Reboot error: ${error.message}`);
        if (stderr) return console.error(`❌ Reboot stderr: ${stderr}`);
        console.log(`✅ Reboot stdout: ${stdout}`);
      });
    });

    socket.on("disconnect", (reason) => {
      console.log(`⚠️ Disconnected from server: ${reason}`);
      if (metricsInterval) clearInterval(metricsInterval);
      retryConnect();
    });

    socket.on("connect_error", (err) => {
      console.error("❌ Connection error:", err.message);
      if (metricsInterval) clearInterval(metricsInterval);
      retryConnect();
    });
  }

  function retryConnect() {
    console.log(`🔄 Retrying connection in ${config.interval}s...`);
    setTimeout(connect, config.interval * 1000);
  }

  connect();
}

startAgent();
