import { View, Text, StyleSheet } from 'react-native';
import { colors, fontSize, borderRadius } from '../../lib/theme';

interface ActionBadgeProps {
  action: string | null;
}

function getActionColor(action: string): string {
  if (action.startsWith('Fold')) return colors.error;
  if (action.startsWith('AllIn')) return colors.warning;
  if (action.startsWith('Raise')) return colors.purple.DEFAULT;
  if (action.startsWith('Bet')) return colors.cyan.DEFAULT;
  if (action.startsWith('Call')) return colors.success;
  if (action === 'Check') return colors.text.secondary;
  return colors.text.muted;
}

export function ActionBadge({ action }: ActionBadgeProps) {
  if (!action) return null;

  const actionColor = getActionColor(action);

  return (
    <View style={[styles.badge, { borderColor: actionColor, backgroundColor: `${actionColor}20` }]}>
      <Text style={[styles.text, { color: actionColor }]}>{action}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
});
