import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Heading, palette, styles } from '../../components/ui';
import { networkKey, networks, useTransit } from '../../transit';

export default function NetworksScreen() {
  const { agency, selectNetwork } = useTransit();
  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={styles.content}>
      <Heading kicker="TranUGA" title="Transit networks" />
      <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
        {networks.map(network => {
          const selected = networkKey(agency) === networkKey(network);
          return <Pressable key={networkKey(network)} accessibilityRole="radio" accessibilityState={{ checked: selected }}
            onPress={() => selectNetwork(network)}
            style={[styles.card, styles.row, selected && { backgroundColor: palette.softGreen, borderColor: palette.green }]}>
            <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={palette.green} />
            <View style={styles.grow}>
              <Text style={styles.label}>{network.name}</Text>
              <Text style={styles.small}>{network.kind === 'uga' ? 'UGA, InfoPoint and Passio' : network.kind === 'passio' ? 'Passio' : 'InfoPoint'}</Text>
            </View>
          </Pressable>;
        })}
      </View>
    </ScrollView>
  </SafeAreaView>;
}
