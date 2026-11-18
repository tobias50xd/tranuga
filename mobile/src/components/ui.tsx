import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

export const palette = {
  background: '#f5f6ef', surface: '#ffffff', ink: '#172822', muted: '#52645c',
  border: '#dbe2d8', green: '#235b46', softGreen: '#e4f0e6', red: '#a91e32',
  amber: '#80510e', softAmber: '#fbf0d9',
};
export type Icon = ComponentProps<typeof Ionicons>['name'];
const routeBusWidth = 46;

export function Heading({ kicker, title, children }: { kicker?: string; title: string; children?: ReactNode }) {
  return <View style={styles.heading}>
    {kicker ? <Text style={styles.kicker}>{kicker.toUpperCase()}</Text> : null}
    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    {children}
  </View>;
}

function RouteButtonBus() {
  const phase = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let listening = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      changed = true;
      setReduceMotion(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (listening && !changed) setReduceMotion(value);
    }).catch(() => {});
    return () => { listening = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (reduceMotion || width === 0) return;
    const drive = Animated.loop(Animated.timing(phase, {
      toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true, isInteraction: false,
    }));
    drive.start();
    return () => { drive.stop(); phase.setValue(0); };
  }, [phase, reduceMotion, width]);

  const busPosition = reduceMotion ? (width - routeBusWidth) / 2 : phase.interpolate({
    inputRange: [0, 1], outputRange: [-routeBusWidth - 12, width + 12],
  });
  return <View style={styles.routeMotion} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <View style={styles.routeRoad}>
      {Array.from({ length: Math.ceil(width / 20) }, (_, index) => <View key={index} style={styles.routeRoadDash} />)}
    </View>
    {width > 0 ? <Animated.View style={[styles.routeBus, { transform: [{ translateX: busPosition }] }]}>
      <View style={styles.routeBusBody}>
        <View style={styles.routeBusWindows}>
          {[0, 1, 2, 3].map(index => <View key={index} style={[styles.routeBusWindow, index === 3 && styles.routeBusWindshield]} />)}
        </View>
        <View style={styles.routeBusStripe} />
      </View>
      <View style={[styles.routeBusWheel, { left: 6 }]} />
      <View style={[styles.routeBusWheel, { right: 6 }]} />
      <View style={styles.routeBusHeadlight} />
    </Animated.View> : null}
  </View>;
}

export function Button({ label, onPress, icon, primary, disabled, busy, routeLoading }: {
  label: string; onPress: () => void; icon?: Icon; primary?: boolean; disabled?: boolean; busy?: boolean; routeLoading?: boolean;
}) {
  const color = primary ? palette.surface : palette.green;
  const showBus = busy && routeLoading;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
    disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [styles.button, primary && styles.primary, routeLoading && styles.routeButton,
      showBus && styles.routeBusy, (pressed || disabled) && styles.dim]}>
    {showBus ? <RouteButtonBus /> : busy ? <ActivityIndicator color={color} /> : icon ? <Ionicons name={icon} size={18} color={color} /> : null}
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
  routeButton: { alignSelf: 'stretch', minHeight: 66, overflow: 'hidden' },
  routeBusy: { backgroundColor: '#193f36', paddingTop: 10, paddingBottom: 32 },
  routeMotion: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  routeRoad: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 24, paddingLeft: 6, paddingBottom: 5,
    backgroundColor: '#092c2670', flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  routeRoadDash: { width: 8, height: 2, borderRadius: 1, backgroundColor: '#ffe5b857' },
  routeBus: { position: 'absolute', left: 0, bottom: 8, width: routeBusWidth, height: 22 },
  routeBusBody: { position: 'absolute', left: 0, right: 0, top: 2, bottom: 4, backgroundColor: '#fff1c8',
    borderTopLeftRadius: 4, borderTopRightRadius: 8, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, overflow: 'hidden' },
  routeBusWindows: { flexDirection: 'row', gap: 2, height: 6, marginTop: 3, marginHorizontal: 4 },
  routeBusWindow: { flex: 1, borderRadius: 1, backgroundColor: '#364b58' },
  routeBusWindshield: { flex: 1.3, borderTopRightRadius: 3 },
  routeBusStripe: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, backgroundColor: '#f3a249',
    borderBottomColor: '#ac542c', borderBottomWidth: 2 },
  routeBusWheel: { position: 'absolute', bottom: 1, width: 8, height: 8, borderRadius: 4, borderWidth: 2,
    borderColor: '#212936', backgroundColor: '#b1bec6' },
  routeBusHeadlight: { position: 'absolute', right: -3, bottom: 8, borderRadius: 2, width: 5, height: 3, backgroundColor: '#fff6ba' },
  dim: { opacity: .6 },
  buttonLabel: { fontSize: 14, fontWeight: '800', flexShrink: 1 },
  badge: { borderRadius: 11, minWidth: 45, height: 43, maxWidth: 90, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 15, fontWeight: '900', textShadowColor: '#0009', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 } },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 13, backgroundColor: palette.softAmber, borderRadius: 12 },
  noticeText: { color: palette.ink, fontSize: 14, lineHeight: 20 },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
});
