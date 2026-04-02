const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Exclude the .local directory (Replit internal tooling) from Metro's file watcher.
// Stale subdirectories inside .local can crash Metro's FallbackWatcher if they
// disappear while being watched.
const localDir = path.resolve(__dirname, ".local");
config.resolver.blockList = new RegExp(
  `^${localDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`
);

module.exports = config;
