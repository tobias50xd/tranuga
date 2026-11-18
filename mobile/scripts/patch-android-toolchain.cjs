const fs = require('node:fs');
const path = require('node:path');

const packagePath = require.resolve('@react-native/gradle-plugin/package.json');
const settingsPath = path.join(path.dirname(packagePath), 'settings.gradle.kts');
const original = fs.readFileSync(settingsPath, 'utf8');
// RN 0.83's Gradle 9 wrapper cannot load Foojay 0.5.0. Backport RN #56210.
const oldPlugin = 'id("org.gradle.toolchains.foojay-resolver-convention").version("0.5.0")';
const updatedPlugin = 'id("org.gradle.toolchains.foojay-resolver-convention").version("1.0.0")';
if (original.includes(oldPlugin)) fs.writeFileSync(settingsPath, original.replace(oldPlugin, updatedPlugin));
