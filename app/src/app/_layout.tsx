import 'react-native-url-polyfill/auto';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Loading, useUI } from '../components/ui';
import { TransitProvider, useTransit } from '../transit';

function Navigation() {
  const { ready, theme } = useTransit();
  const { palette } = useUI();
  if (!ready) return <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}><Loading label="Opening TranUGA…" /></SafeAreaView>;
  return <>
    <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.background } }} />
  </>;
}

export default function RootLayout() {
  return <TransitProvider>
    <Navigation />
  </TransitProvider>;
}
