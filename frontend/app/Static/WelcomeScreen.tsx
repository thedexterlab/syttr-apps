import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import React, { useMemo } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { rs, wp } from '../_utils/responsive';
import SafeScreen from '../_utils/SafeScreen';

import { Fonts } from '@/constants/theme';
import AppLogo from '../_utils/AppLogo';
type Props = {
  onSitterPress?: () => void;
  onClientPress?: () => void;
  onLoginPress?: () => void;
};

const palette = {
  primary: '#F27C9C',
  accent: '#F6BC63',
  accentDeep: '#E38C42',
  textPrimary: '#4F2A32',
  textSecondary: '#7C4A55',
  surface: '#FFF7F0',
  outline: 'rgba(242, 124, 156, 0.2)',
  shadow: 'rgba(242, 124, 156, 0.18)',
};

const WelcomeScreen: React.FC<Props> = ({
  onSitterPress = () => {},
  onClientPress = () => {},
  onLoginPress = () => {},
}) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const layout = useMemo(() => {
    const shortestSide = Math.min(width, height);
    const isCompact = height < 760 || shortestSide < 375;
    const isVeryCompact = height < 690 || shortestSide < 350;
    const horizontalPadding = wp(5);
    const maxContentWidth = width * (isVeryCompact ? 0.96 : 0.92);

    const buttonPadding = height * (isVeryCompact ? 0.018 : 0.022);
    const titleDarkSize = isVeryCompact ? 27 : isCompact ? 31 : 34;
    const titleBrightSize = isVeryCompact ? 30 : isCompact ? 34 : 38;
    const subheadSize = isVeryCompact ? 14 : isCompact ? 16 : 17;
    const stackGap = height * (isVeryCompact ? 0.014 : 0.02);
    const contentTopPadding = Math.max(insets.top + rs(5), rs(44));
    const contentBottomPadding = height * (isVeryCompact ? 0.05 : 0.07);
    const buttonsMarginTop = height * (isVeryCompact ? 0.005 : 0.012);
    const buttonsGap = height * (isVeryCompact ? 0.012 : 0.018);
    const ghostPadding = height * (isVeryCompact ? 0.014 : 0.018);
    const footerTop = height * (isVeryCompact ? 0.005 : 0);
    return {
      isCompact,
      isVeryCompact,
      horizontalPadding,
      maxContentWidth,
      buttonPadding,
      titleDarkSize,
      titleBrightSize,
      subheadSize,
      stackGap,
      contentTopPadding,
      contentBottomPadding,
      buttonsMarginTop,
      buttonsGap,
      ghostPadding,
      footerTop,
    };
  }, [height, insets.top, width]);

  return (
    <LinearGradient
      colors={['#FFFFFF', '#FFFFFF', '#FFFFFF']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <StatusBar style="dark" />

      <SafeScreen
        scroll
        edges={['top', 'left', 'right', 'bottom']}
        scrollProps={{ showsVerticalScrollIndicator: false }}
        contentContainerStyle={[
          styles.content,
          {
            minHeight: height,
            paddingHorizontal: layout.horizontalPadding,
            paddingTop: layout.contentTopPadding,
            paddingBottom: insets.bottom > 20 ? insets.bottom : layout.contentBottomPadding,
            justifyContent: 'flex-start',
          },
        ]}
      >
        <View style={[styles.stack, { maxWidth: layout.maxContentWidth, gap: layout.stackGap }]}>
          <View style={styles.welcomeLogoOffset}>
            <AppLogo />
          </View>

          <View style={styles.headlineBlock}>
            <Text style={[styles.headlineDark, { fontSize: layout.titleDarkSize }]}>Find the Best</Text>
            <Text style={[styles.headlineBright, { fontSize: layout.titleBrightSize }]}>BabySyttr</Text>
            <Text style={[styles.headlineDark, { fontSize: layout.titleDarkSize }]}>in Your Area!</Text>
          </View>

          <Text
            style={[
              styles.subhead,
              {
                maxWidth: '92%',
                fontSize: layout.subheadSize,
                lineHeight: layout.isVeryCompact ? 21 : layout.isCompact ? 24 : 26,
              },
            ]}
          >
            Safe, reliable, and trusted childcare professionals at your fingertips
          </Text>

          <View style={[styles.buttons, { marginTop: layout.buttonsMarginTop, gap: layout.buttonsGap }]}>
            <View style={styles.primaryButtonWrapper}>
              <LinearGradient
                colors={[palette.accent, palette.primary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryGradient}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Register as a babysitter"
                  style={({ pressed }) => [styles.primaryButton, { paddingVertical: layout.buttonPadding }, pressed && styles.pressed]}
                  onPress={onSitterPress}
                >
                  <Text style={[styles.primaryButtonText, { fontSize: layout.isVeryCompact ? 17 : 19 }]}>
                    I&apos;m a Syttr
                  </Text>
                </Pressable>
              </LinearGradient>
            </View>

            <Pressable
              accessibilityRole="none"
              style={styles.primaryButtonWrapper}
            >
              <LinearGradient
                colors={[palette.accent, palette.primary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryGradient}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Find a babysitter"
                  style={({ pressed }) => [styles.primaryButton, { paddingVertical: layout.buttonPadding }, pressed && styles.pressed]}
                  onPress={onClientPress}
                >
                  <Text style={[styles.primaryButtonText, { fontSize: layout.isVeryCompact ? 17 : 19 }]}>
                    Need a Syttr
                  </Text>
                </Pressable>
              </LinearGradient>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Log in to existing account"
              style={({ pressed }) => [
                styles.ghostButton,
                { paddingVertical: layout.ghostPadding },
                pressed && styles.pressed,
              ]}
              onPress={onLoginPress}
            >
              <Text style={[styles.ghostButtonText, { fontSize: layout.isVeryCompact ? 15 : 17 }]}>
                Already have an account?
              </Text>
            </Pressable>
          </View>

          <Text style={[styles.footerNote, { fontSize: layout.isVeryCompact ? 13 : 14, marginTop: layout.footerTop }]}>
            Join thousands of families and childcare professionals.
          </Text>
        </View>
      </SafeScreen>
    </LinearGradient>
  );
};

export default WelcomeScreen;

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 0,
  },
  stack: {
    width: '100%',
    alignItems: 'center',
    gap: 0,
  },
  welcomeLogoOffset: {
    marginTop: rs(10),
  },
  logoWrapper: {
    marginVertical: rs(18),
  },
  logoCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: rs(10),
    borderRadius: 999,
    ...Platform.select({
      web: {
        boxShadow: `0px 10px 24px ${palette.shadow}`,
      },
      default: {
        elevation: 12,
        shadowColor: palette.primary,
        shadowOffset: { width: rs(0), height: rs(10) },
        shadowOpacity: 0.35,
        shadowRadius: 24,
      },
    }),
  },
  logoInnerCircle: {
    backgroundColor: '#FFF8F3',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: palette.outline,
    borderRadius: 999,
  },
  logoImage: {
    width: '70%',
    height: '70%',
  },
  headlineBlock: {
    alignItems: 'center',
    gap: 2,
  },
  headlineDark: {
    fontSize: 34,
    fontWeight: '700',
    color: palette.textPrimary,
    fontFamily: Fonts.display,
  },
  headlineBright: {
    fontSize: 38,
    fontWeight: '800',
    color: palette.primary,
    fontFamily: Fonts.display,
  },
  subhead: {
    textAlign: 'center',
    color: palette.textSecondary,
    fontSize: 17,
    fontWeight: '500',
    lineHeight: 26,
    marginTop: 6,
    fontFamily: Fonts.display,
  },
  buttons: {
    width: '100%',
    marginTop: 10,
    gap: 14,
  },
  primaryButtonWrapper: {
    width: '100%',
  },
  primaryGradient: {
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: `0px 6px 12px ${palette.shadow}`,
      },
      default: {
        elevation: 6,
        shadowColor: palette.primary,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
    }),
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 19,
    fontWeight: '700',
    color: '#fff',
    fontFamily: Fonts.display,
  },
  secondaryButton: {
    width: '100%',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: palette.primary,
    backgroundColor: palette.surface,
    ...Platform.select({
      web: {
        boxShadow: `0px 6px 10px ${palette.shadow}`,
      },
      default: {
        elevation: 4,
        shadowColor: palette.shadow,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
      },
    }),
  },
  secondaryButtonText: {
    fontSize: 19,
    fontWeight: '700',
    color: palette.primary,
    fontFamily: Fonts.display,
  },
  ghostButton: {
    width: '100%',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(242, 124, 156, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(242, 124, 156, 0.35)',
  },
  ghostButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: palette.accentDeep,
    fontFamily: Fonts.display,
  },
  pressed: {
    opacity: 0.85,
  },
  footerNote: {
    textAlign: 'center',
    color: 'rgba(79, 42, 50, 0.7)',
    fontSize: 14,
    marginBottom: 6,
    fontFamily: Fonts.display,
  },
});


