const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Bundle the transit modules used by the shared screens from the repository's src directory.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../src')];

module.exports = config;
