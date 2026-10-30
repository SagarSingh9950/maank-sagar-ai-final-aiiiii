const {
  getSystemInfo,
} = require("./tools/systemInfo.cjs");


console.log("\nCPU:");
console.log(
  getSystemInfo("cpu")
);


console.log("\nRAM:");
console.log(
  getSystemInfo("ram")
);


console.log("\nOperating System:");
console.log(
  getSystemInfo("operating system")
);


console.log("\nArchitecture:");
console.log(
  getSystemInfo("architecture")
);


console.log("\nHostname:");
console.log(
  getSystemInfo("hostname")
);


console.log("\nUptime:");
console.log(
  getSystemInfo("uptime")
);


console.log("\nNode:");
console.log(
  getSystemInfo("node version")
);


console.log("\nALL SYSTEM INFORMATION:");
console.log(
  getSystemInfo("all")
);