const { spawn } = require("node:child_process");
const path = require("node:path");

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node ./scripts/run-expo.js <expo-args...>");
  process.exit(1);
}

const cliPath = path.join(path.dirname(require.resolve("expo/package.json")), "bin", "cli");
const env = {
  ...process.env,
  EXPO_NO_DEPENDENCY_VALIDATION: process.env.EXPO_NO_DEPENDENCY_VALIDATION || "1",
};

const child = spawn(process.execPath, [cliPath, ...args], {
  stdio: "inherit",
  env,
  windowsHide: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
