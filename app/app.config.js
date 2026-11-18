const { version } = require('./package.json');

module.exports = () => {
  const buildNumber = process.env.MOBILE_BUILD_NUMBER || '1';
  if (!/^[1-9]\d*$/.test(buildNumber) || !Number.isSafeInteger(Number(buildNumber))) {
    throw new Error('MOBILE_BUILD_NUMBER must be a positive integer.');
  }
  return {
    name: 'TranUGA',
    slug: 'tranuga',
    version,
    scheme: 'tranuga',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    web: { bundler: 'metro', output: 'single', favicon: './assets/icon.png' },
    ios: {
      bundleIdentifier: 'com.tranuga.app',
      buildNumber,
      supportsTablet: true,
      infoPlist: { ITSAppUsesNonExemptEncryption: false },
    },
    android: {
      package: 'com.tranuga.app',
      versionCode: Number(buildNumber),
      adaptiveIcon: { foregroundImage: './assets/adaptive-foreground.png', backgroundColor: '#b92535' },
    },
    plugins: [
      'expo-router',
      'expo-font',
      ['expo-location', { locationWhenInUsePermission: 'TranUGA uses your location when you show it on the map, set your trip start, or find nearby transit.' }],
      '@maplibre/maplibre-react-native',
    ],
  };
};
