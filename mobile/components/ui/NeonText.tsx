import { Text, type TextStyle, StyleSheet } from 'react-native';
import { colors } from '../../lib/theme';

interface NeonTextProps {
  children: React.ReactNode;
  color?: 'cyan' | 'purple' | 'white';
  size?: number;
  style?: TextStyle;
  bold?: boolean;
}

export function NeonText({ children, color = 'cyan', size = 16, style, bold = false }: NeonTextProps) {
  const textColor = {
    cyan: colors.cyan.DEFAULT,
    purple: colors.purple.DEFAULT,
    white: colors.text.primary,
  }[color];

  return (
    <Text
      style={[
        styles.text,
        {
          color: textColor,
          fontSize: size,
          fontWeight: bold ? '700' : '400',
          textShadowColor: textColor,
          textShadowRadius: 8,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    textShadowOffset: { width: 0, height: 0 },
  },
});
