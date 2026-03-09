import { View, StyleSheet, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, borderRadius } from '../../lib/theme';

interface GlassCardProps {
  children: React.ReactNode;
  variant?: 'default' | 'cyan' | 'purple';
  style?: ViewStyle;
  padding?: number;
}

export function GlassCard({ children, variant = 'default', style, padding = 16 }: GlassCardProps) {
  const borderColor = {
    default: colors.border.default,
    cyan: colors.border.cyan,
    purple: colors.border.purple,
  }[variant];

  return (
    <View style={[styles.container, { borderColor }, style]}>
      <BlurView intensity={12} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.02)']}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.content, { padding }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: colors.bg.card,
  },
  content: {},
});
