import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useUI } from '../../components/ui';

export default function TabsLayout() {
  const { palette } = useUI();
  return <Tabs initialRouteName="routes" backBehavior="fullHistory" screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: palette.green,
    tabBarInactiveTintColor: palette.muted,
    tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
    tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
  }}>
    <Tabs.Screen name="routes" options={{ title: 'Routes', tabBarAccessibilityLabel: 'Routes', tabBarIcon: ({ color, size }) => <Ionicons name="bus-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="plan" options={{ title: 'Plan', tabBarAccessibilityLabel: 'Plan', tabBarIcon: ({ color, size }) => <Ionicons name="navigate-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="networks" options={{ title: 'Networks', tabBarAccessibilityLabel: 'Networks', tabBarIcon: ({ color, size }) => <Ionicons name="layers-outline" color={color} size={size} /> }} />
  </Tabs>;
}
