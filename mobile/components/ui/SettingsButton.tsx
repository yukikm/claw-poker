import { Pressable, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { hapticLight } from '../../lib/haptics';
import { colors, fontSize } from '../../lib/theme';

export function SettingsButton() {
  const router = useRouter();

  return (
    <Pressable
      style={styles.button}
      onPress={() => {
        hapticLight();
        router.push('/settings');
      }}
      accessibilityRole="button"
      accessibilityLabel="Open settings"
    >
      <Text style={styles.icon}>⚙</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: 8,
  },
  icon: {
    fontSize: fontSize.xl,
    color: colors.text.secondary,
  },
});
