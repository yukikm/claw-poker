import { View, Text, Switch, StyleSheet, ScrollView } from 'react-native';
import { Pressable } from 'react-native';
import Constants from 'expo-constants';
import { useSettingsStore } from '../stores/settingsStore';
import { hapticSelection } from '../lib/haptics';
import { colors, fontSize, spacing, borderRadius } from '../lib/theme';

const POLLING_OPTIONS = [
  { label: '3s (fast)', value: 3_000 },
  { label: '5s (default)', value: 5_000 },
  { label: '10s (battery saver)', value: 10_000 },
];

export default function SettingsScreen() {
  const {
    hapticsEnabled,
    pollingIntervalMs,
    setHapticsEnabled,
    setPollingIntervalMs,
  } = useSettingsStore();

  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Haptics */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>General</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Haptic Feedback</Text>
          <Switch
            value={hapticsEnabled}
            onValueChange={(val) => {
              setHapticsEnabled(val);
              if (val) hapticSelection();
            }}
            trackColor={{ false: colors.text.muted, true: colors.cyan.dark }}
            thumbColor={hapticsEnabled ? colors.cyan.DEFAULT : colors.text.secondary}
            accessibilityLabel="Toggle haptic feedback"
          />
        </View>
      </View>

      {/* Polling Interval */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Polling Interval</Text>
        <Text style={styles.hint}>How often to refresh game data. Lower values use more battery.</Text>
        <View style={styles.optionsRow}>
          {POLLING_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              style={[styles.optionBtn, pollingIntervalMs === opt.value && styles.optionBtnActive]}
              onPress={() => {
                hapticSelection();
                setPollingIntervalMs(opt.value);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Set polling interval to ${opt.label}`}
              accessibilityState={{ selected: pollingIntervalMs === opt.value }}
            >
              <Text style={[styles.optionText, pollingIntervalMs === opt.value && styles.optionTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>Changes take effect on next app restart.</Text>
      </View>

      {/* App Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Version</Text>
          <Text style={styles.value}>{appVersion}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>SDK</Text>
          <Text style={styles.value}>Expo {Constants.expoConfig?.sdkVersion ?? '55'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Network</Text>
          <Text style={styles.value}>Devnet</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  content: {
    padding: spacing.md,
    paddingBottom: 40,
  },
  section: {
    marginBottom: spacing.xl,
    backgroundColor: colors.bg.secondary,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
  },
  sectionTitle: {
    color: colors.text.primary,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  hint: {
    color: colors.text.muted,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  label: {
    color: colors.text.primary,
    fontSize: fontSize.md,
  },
  value: {
    color: colors.text.secondary,
    fontSize: fontSize.md,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  optionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: 'center',
  },
  optionBtnActive: {
    borderColor: colors.cyan.DEFAULT,
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
  },
  optionText: {
    color: colors.text.secondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  optionTextActive: {
    color: colors.cyan.DEFAULT,
    fontWeight: '700',
  },
});
