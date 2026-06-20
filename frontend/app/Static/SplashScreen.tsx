import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { Fonts } from '@/constants/theme';
import { getLogoDimensions } from '@/constants/logo';
type Props = {
  onFinish?: () => void;
};

const palette = {
  primary: '#F27C9C',
  surface: '#FFF7F0',
};

const SplashScreen: React.FC<Props> = ({ onFinish }) => {
  const scale = useRef(new Animated.Value(0.95)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const { width, height } = useWindowDimensions();
  const { outerSize, outerRadius } = getLogoDimensions(width, {
    scale: 0.62,
    min: 170,
    max: 280,
    innerRatio: 1,
  });
  const { fallbackSize, horizontalPadding } = useMemo(() => {
    const compact = height < 740 || width < 360;
    return {
      fallbackSize: outerSize * (compact ? 0.8 : 0.9),
      horizontalPadding: width * 0.04,
    };
  }, [height, outerSize, width]);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    const pulse = Animated.sequence([
      Animated.timing(scale, {
        toValue: 1.05,
        duration: 500,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(scale, {
        toValue: 0.95,
        duration: 500,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]);
    const loop = Animated.loop(pulse);

    loop.start();

    const timer = setTimeout(() => {
      loop.stop();
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: Platform.OS !== 'web',
      }).start(() => onFinish?.());
    }, 2000);

    return () => {
      loop.stop();
      clearTimeout(timer);
    };
  }, [onFinish, opacity, scale]);

  return (
    <View style={styles.container}>
      <View style={[styles.center, { paddingHorizontal: horizontalPadding }]}>
        <Animated.View
          accessible
          accessibilityRole="image"
          accessibilityLabel="Syttr loading screen"
          style={{ transform: [{ scale }], opacity }}
        >
          {showFallback ? (
            <View
              style={[
                styles.fallback,
                { width: fallbackSize, height: fallbackSize },
              ]}
            >
              <Text style={styles.fallbackText}>Syttr</Text>
            </View>
          ) : (
            <View
              style={[
                styles.logoWrap,
                { width: outerSize, height: outerSize, borderRadius: outerRadius },
              ]}
            >
              <Image
                source={require('../../assets/AppIcon/AppIcon.png')}
                style={styles.logoImage}
                resizeMode="cover"
                onError={() => setShowFallback(true)}
              />
            </View>
          )}
        </Animated.View>
      </View>
    </View>
  );
};

export default SplashScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  logoWrap: {
    overflow: 'hidden',
    borderRadius: 999,
  },
  logoImage: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
  },
  fallbackText: {
    fontSize: 28,
    fontWeight: '800',
    color: palette.primary,
    fontFamily: Fonts.display,
  },
  updateText: {
    textAlign: 'center',
    color: '#6B4350',
    fontWeight: '600',
    fontFamily: Fonts.display,
  },
});
