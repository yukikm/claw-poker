import { View, StyleSheet, type ViewStyle } from 'react-native';
import { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, borderRadius } from '../../lib/theme';

interface LoadingSkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  style?: ViewStyle;
}

export function LoadingSkeleton({ width = '100%', height = 20, style }: LoadingSkeletonProps) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 800 }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { width, height },
        animatedStyle,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: colors.bg.secondary,
    borderRadius: borderRadius.sm,
  },
});
