const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Shared transit logic lives beside the web entry point. Only imported modules
// are bundled, and the mobile dependencies stay in this package.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../src')];

module.exports = config;
