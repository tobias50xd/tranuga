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
    userInterfaceStyle: 'light',
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
      ['expo-location', { locationWhenInUsePermission: 'TranUGA uses your location when you choose it as your trip start.' }],
      '@maplibre/maplibre-react-native',
    ],
  };
};
