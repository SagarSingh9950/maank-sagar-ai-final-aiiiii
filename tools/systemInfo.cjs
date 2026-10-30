const os = require("node:os");

function getSystemInfo(query = "all") {
  const normalizedQuery = query
    .toLowerCase()
    .trim();

  const cpu = os.cpus();

  const info = {
    username: os.userInfo().username,

    hostname: os.hostname(),

    platform: os.platform(),

    operatingSystem: getOperatingSystem(),

    osRelease: os.release(),

    architecture: os.arch(),

    cpu: cpu[0]?.model || "Unknown",

    cpuSpeedMHz: cpu[0]?.speed || 0,

    cpuCores: cpu.length,

    logicalProcessors: cpu.length,

    totalMemoryBytes: os.totalmem(),

    freeMemoryBytes: os.freemem(),

    usedMemoryBytes:
      os.totalmem() - os.freemem(),

    uptimeSeconds: os.uptime(),

    homeDirectory: os.homedir(),

    temporaryDirectory: os.tmpdir(),

    nodeVersion: process.version,
  };

  return selectInformation(info, normalizedQuery);
}


function getOperatingSystem() {
  switch (os.platform()) {
    case "win32":
      return "Windows";

    case "linux":
      return "Linux";

    case "darwin":
      return "macOS";

    default:
      return os.platform();
  }
}


function selectInformation(info, query) {
  if (
    query === "all" ||
    query === "system" ||
    query === "everything"
  ) {
    return formatAll(info);
  }

  if (
    query.includes("cpu") ||
    query.includes("processor")
  ) {
    if (
      query.includes("core")
    ) {
      return {
        cpuCores: info.cpuCores,
      };
    }

    if (
      query.includes("speed") ||
      query.includes("frequency")
    ) {
      return {
        cpuSpeedMHz: info.cpuSpeedMHz,
      };
    }

    return {
      cpu: info.cpu,
      cpuCores: info.cpuCores,
      logicalProcessors: info.logicalProcessors,
      cpuSpeedMHz: info.cpuSpeedMHz,
    };
  }

  if (
    query.includes("ram") ||
    query.includes("memory")
  ) {
    return {
      totalMemory: formatBytes(
        info.totalMemoryBytes
      ),

      freeMemory: formatBytes(
        info.freeMemoryBytes
      ),

      usedMemory: formatBytes(
        info.usedMemoryBytes
      ),
    };
  }

  if (
    query.includes("os") ||
    query.includes("operating system") ||
    query.includes("windows")
  ) {
    return {
      operatingSystem: info.operatingSystem,
      osRelease: info.osRelease,
      architecture: info.architecture,
    };
  }

  if (
    query.includes("architecture") ||
    query.includes("64 bit") ||
    query.includes("32 bit")
  ) {
    return {
      architecture: info.architecture,
    };
  }

  if (
    query.includes("hostname") ||
    query.includes("computer name") ||
    query.includes("pc name")
  ) {
    return {
      hostname: info.hostname,
    };
  }

  if (
    query.includes("username") ||
    query.includes("user name")
  ) {
    return {
      username: info.username,
    };
  }

  if (
    query.includes("uptime") ||
    query.includes("running time")
  ) {
    return {
      uptime: formatUptime(
        info.uptimeSeconds
      ),
    };
  }

  if (
    query.includes("node") ||
    query.includes("nodejs") ||
    query.includes("node.js")
  ) {
    return {
      nodeVersion: info.nodeVersion,
    };
  }

  if (
    query.includes("home") ||
    query.includes("home directory")
  ) {
    return {
      homeDirectory: info.homeDirectory,
    };
  }

  if (
    query.includes("temporary") ||
    query.includes("temp")
  ) {
    return {
      temporaryDirectory:
        info.temporaryDirectory,
    };
  }

  return {
    error:
      "I don't know which system information you requested.",
    availableInformation: [
      "cpu",
      "cpu cores",
      "cpu speed",
      "ram",
      "memory",
      "operating system",
      "architecture",
      "hostname",
      "username",
      "uptime",
      "node version",
      "home directory",
      "temporary directory",
      "all",
    ],
  };
}


function formatAll(info) {
  return {
    username: info.username,
    hostname: info.hostname,

    operatingSystem: info.operatingSystem,
    osRelease: info.osRelease,
    architecture: info.architecture,

    cpu: info.cpu,
    cpuSpeedMHz: info.cpuSpeedMHz,
    cpuCores: info.cpuCores,
    logicalProcessors: info.logicalProcessors,

    totalMemory:
      formatBytes(info.totalMemoryBytes),

    freeMemory:
      formatBytes(info.freeMemoryBytes),

    usedMemory:
      formatBytes(info.usedMemoryBytes),

    uptime:
      formatUptime(info.uptimeSeconds),

    homeDirectory: info.homeDirectory,

    temporaryDirectory:
      info.temporaryDirectory,

    nodeVersion: info.nodeVersion,
  };
}


function formatBytes(bytes) {
  const gigabytes =
    bytes / 1024 / 1024 / 1024;

  return `${gigabytes.toFixed(2)} GB`;
}


function formatUptime(seconds) {
  const days = Math.floor(
    seconds / 86400
  );

  seconds %= 86400;

  const hours = Math.floor(
    seconds / 3600
  );

  seconds %= 3600;

  const minutes = Math.floor(
    seconds / 60
  );

  return `${days}d ${hours}h ${minutes}m`;
}


module.exports = {
  getSystemInfo,
};