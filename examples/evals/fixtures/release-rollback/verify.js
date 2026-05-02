const fs = require("node:fs");

if (!fs.existsSync("package.json")) {
  console.error("missing package.json after rollback");
  process.exit(1);
}

console.log("release rollback fixture verified");
