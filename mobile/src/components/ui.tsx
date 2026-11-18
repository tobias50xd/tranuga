import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export const palette = {
  background: '#f5f6ef', surface: '#ffffff', ink: '#172822', muted: '#52645c',
  border: '#dbe2d8', green: '#235b46', softGreen: '#e4f0e6', red: '#a91e32',
  amber: '#80510e', softAmber: '#fbf0d9',
};
export type Icon = ComponentProps<typeof Ionicons>['name'];

export function Heading({ kicker, title, children }: { kicker?: string; title: string; children?: ReactNode }) {
  return <View style={styles.heading}>
    {kicker ? <Text style={styles.kicker}>{kicker.toUpperCase()}</Text> : null}
    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    {children}
  </View>;
}

export function Button({ label, onPress, icon, primary, disabled, busy }: {
  label: string; onPress: () => void; icon?: Icon; primary?: boolean; disabled?: boolean; busy?: boolean;
}) {
  const color = primary ? palette.surface : palette.green;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
    disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [styles.button, primary && styles.primary, (pressed || disabled) && styles.dim]}>
    {busy ? <ActivityIndicator color={color} /> : icon ? <Ionicons name={icon} size={18} color={color} /> : null}
    <Text style={[styles.buttonLabel, { color }]}>{label}</Text>
  </Pressable>;
}

export function Badge({ label, color }: { label: string; color: string }) {
  return <View style={[styles.badge, { backgroundColor: /^#[\da-f]{6}$/i.test(color) ? color : palette.green }]}>
    <Text numberOfLines={1} style={styles.badgeText}>{label}</Text>
  </View>;
}

export function Notice({ text, action }: { text: string; action?: { label: string; onPress: () => void } }) {
  return <View style={styles.notice}>
    <Ionicons name="information-circle-outline" color={palette.amber} size={21} />
    <View style={styles.grow}>
      <Text accessibilityLiveRegion="polite" style={styles.noticeText}>{text}</Text>
      {action ? <Button label={action.label} onPress={action.onPress} /> : null}
    </View>
  </View>;
}

export function Loading({ label }: { label: string }) {
  return <View style={styles.loading} accessibilityLiveRegion="polite">
    <ActivityIndicator color={palette.green} />
    <Text style={styles.muted}>{label}</Text>
  </View>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { padding: 20, gap: 16, paddingBottom: 32 },
  heading: { gap: 7, marginVertical: 6 },
  kicker: { color: palette.green, fontSize: 11, letterSpacing: 1.6, fontWeight: '800' },
  title: { color: palette.ink, fontSize: 32, fontWeight: '800', letterSpacing: -1.15 },
  sectionTitle: { color: palette.ink, fontSize: 20, fontWeight: '800', letterSpacing: -.4 },
  label: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  muted: { color: palette.muted, fontSize: 14, lineHeight: 20 },
  small: { color: palette.muted, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  card: { padding: 15, gap: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 16 },
  input: { minHeight: 48, paddingHorizontal: 14, color: palette.ink, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 12, fontSize: 16 },
  button: { minHeight: 44, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: palette.softGreen, alignSelf: 'flex-start' },
  primary: { backgroundColor: palette.green },
  dim: { opacity: .6 },
  buttonLabel: { fontSize: 14, fontWeight: '800', flexShrink: 1 },
  badge: { borderRadius: 11, minWidth: 45, height: 43, maxWidth: 90, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 15, fontWeight: '900', textShadowColor: '#0009', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 } },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 13, backgroundColor: palette.softAmber, borderRadius: 12 },
  noticeText: { color: palette.ink, fontSize: 14, lineHeight: 20 },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
});
