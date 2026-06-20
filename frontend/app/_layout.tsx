import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { bindPushNotificationLifecycle, syncPushRegistration } from '../lib/pushNotifications';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const appTheme = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  const lightBackgroundTheme = {
    ...appTheme,
      colors: {
        ...appTheme.colors,
        background: '#FFFFFF',
        card: '#FFFFFF',
      },
    };

  useEffect(() => {
    bindPushNotificationLifecycle();
    void syncPushRegistration(false).catch((error) => {
      const message = String((error as any)?.message || "").toLowerCase();
      if (message.includes("missing or invalid user_id")) {
        return;
      }
      console.warn("[push] Initial registration skipped", error);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider value={lightBackgroundTheme}>
        <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
          <Stack initialRouteName="index">
            <Stack.Screen name="index" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
          <StatusBar style="dark" backgroundColor="#FFFFFF" />
        </View>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

