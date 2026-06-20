const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { resolve } = require("metro-resolver");

const config = getDefaultConfig(__dirname);
const keepAwakeShimPath = path.resolve(__dirname, "shims/expo-keep-awake.ts");

if (!config.resolver.assetExts.includes("cer")) {
  config.resolver.assetExts.push("cer");
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "expo-keep-awake") {
    return {
      filePath: keepAwakeShimPath,
      type: "sourceFile",
    };
  }

  return resolve(context, moduleName, platform);
};

module.exports = config;
