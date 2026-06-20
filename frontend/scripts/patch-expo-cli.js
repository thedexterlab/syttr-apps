const fs = require("node:fs");
const path = require("node:path");

const cliPath = path.join(__dirname, "..", "node_modules", "expo", "bin", "cli");
const markerStart = "// syttr-expo-node-guard:start";
const markerEnd = "// syttr-expo-node-guard:end";
const requireLine = "require('@expo/cli');";
const guardBlock = `${markerStart}
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);

if (nodeMajor >= 23 && !process.env.EXPO_NO_DEPENDENCY_VALIDATION) {
  process.env.EXPO_NO_DEPENDENCY_VALIDATION = '1';
  console.warn(
    \`[expo] Detected unsupported Node \${process.version}. Disabled dependency validation for this session. Use Node 22 for full Expo SDK 54 compatibility.\`
  );
}
${markerEnd}`;

if (!fs.existsSync(cliPath)) {
  process.exit(0);
}

const original = fs.readFileSync(cliPath, "utf8");

if (original.includes(markerStart) && original.includes(markerEnd)) {
  process.exit(0);
}

if (!original.includes(requireLine)) {
  console.error(`[patch-expo-cli] Could not find target line in ${cliPath}`);
  process.exit(1);
}

const patched = original.replace(requireLine, `${guardBlock}\n\n${requireLine}`);
fs.writeFileSync(cliPath, patched);
