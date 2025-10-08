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
      pm2ScriptsRootDir: data.pm2ScriptsRootDir || "",
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

async function getPm2Services(config) {
  try {
    // 1️⃣ Load ecosystem config
    const ecosystemPath = path.resolve(config.pm2EcosystemPath);
    if (!fs.existsSync(ecosystemPath)) {
      throw new Error(`Ecosystem config not found at: ${ecosystemPath}`);
    }

    // Read the raw text of the file (keep comments, vars, everything)
    const configFileRaw = fs.readFileSync(ecosystemPath, "utf8");

    // Try to dynamically import it for structured app info
    let apps = [];
    try {
      const ecosystemModule = await import(pathToFileURL(ecosystemPath).href);
      const configFile =
        ecosystemModule.default || ecosystemModule || {};
      apps = configFile.apps || [];
    } catch (parseErr) {
      console.warn("⚠️ Failed to import config file, returning raw content only:", parseErr.message);
    }

    // 2️⃣ Get PM2 running services
    let running = [];
    try {
      const { stdout } = await execAsync("pm2 jlist");
      running = JSON.parse(stdout);
    } catch (pm2err) {
      if (pm2err.message.includes("pm2: not found") || pm2err.code === 127) {
        console.warn("⚠️ PM2 not found on system — showing config only.");
      } else {
        console.warn("⚠️ Failed to fetch PM2 processes:", pm2err.message);
      }
    }

    // 3️⃣ Merge: Ecosystem apps + PM2 running data
    const services = apps.map((app) => {
      const match = running.find((proc) => proc.name === app.name);
      return {
        name: app.name,
        pid: match?.pid ?? null,
        status: match?.pm2_env?.status || "stopped",
        cpu: match?.monit?.cpu ?? null,
        memory: match?.monit?.memory ?? null,
        uptime: match?.pm2_env?.pm_uptime
          ? DateTime.fromMillis(match.pm2_env.pm_uptime).toISO()
          : null,
        restartCount: match?.pm2_env?.restart_time ?? 0,
      };
    });

    // ✅ Return both structured and full raw file
    return {
      services,
      configFile: JSON.stringify(configFileRaw), // escaped raw file text
    };
  } catch (err) {
    console.error("💥 Error in getPm2Services:", err.message);
    return undefined;
  }
}

async function handlePm2Action(
  action,
  serviceName,
  ecosystemConfig,
  ecosystemPath,
  pm2ScriptsRootDir
) {
  try {
    await execAsync("pm2 -v").catch(() => {
      throw new Error("PM2 not installed on this system");
    });

    let command;
    switch (action) {
      case "save-config": {
        if (!ecosystemConfig || !ecosystemPath) {
          throw new Error("Missing ecosystem config content or file path");
        }

        // Write the new config to disk
        await fs.writeFile(ecosystemPath, ecosystemConfig, "utf-8");

        // Optional sanity check: read back and confirm
        const verifyContent = await fs.readFile(ecosystemPath, "utf-8");
        if (!verifyContent.includes("module.exports")) {
          throw new Error("Ecosystem config may be invalid or incomplete");
        }

        return {
          success: true,
          message: `✅ Ecosystem config updated successfully at ${ecosystemPath}`,
        };
      }

      case "start":
        command = `pm2 start ${ecosystemPath} --only ${serviceName}`;
        break;
      case "restart":
        command = `pm2 restart ${serviceName}`;
        break;
      case "stop":
        command = `pm2 stop ${serviceName}`;
        break;
      case "deploy":
        command = `cd ${pm2ScriptsRootDir} && bash ${serviceName}-deploy.sh`;
        break;
      case "rollback":
        command = `cd ${pm2ScriptsRootDir} && bash ${serviceName}-rollback.sh`;
        break;
      default:
        // nothing here
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
    pm2Services: await getPm2Services(config),
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
    console.log("PM2 action event: ", pm2ActionEvent);
    socket.on(pm2ActionEvent, async (payload) => {
      const { serviceName, action, ecosystemConfig } = payload || {};

      const result = await handlePm2Action(
        action,
        serviceName,
        ecosystemConfig,
        config.pm2EcosystemPath,
        config.pm2ScriptsRootDir
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
