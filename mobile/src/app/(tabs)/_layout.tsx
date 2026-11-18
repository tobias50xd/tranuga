import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { palette } from '../../components/ui';

export default function TabsLayout() {
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: palette.green,
    tabBarInactiveTintColor: palette.muted,
    tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
    tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
  }}>
    <Tabs.Screen name="index" options={{ title: 'Routes', tabBarIcon: ({ color, size }) => <Ionicons name="bus-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="plan" options={{ title: 'Plan', tabBarIcon: ({ color, size }) => <Ionicons name="navigate-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="networks" options={{ title: 'Networks', tabBarIcon: ({ color, size }) => <Ionicons name="layers-outline" color={color} size={size} /> }} />
  </Tabs>;
}
