// App.tsx
// Root navigator for the Neriah mobile app.
// Sets up React Navigation with a bottom tab bar + stack navigators for each tab.

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import HomeScreen from './src/screens/HomeScreen';
import MarkingScreen from './src/screens/MarkingScreen';
import AnalyticsScreen from './src/screens/AnalyticsScreen';
import SettingsScreen from './src/screens/SettingsScreen';

// TODO: replace with icon library (e.g. @expo/vector-icons)
const Tab = createBottomTabNavigator();

export default function App() {
  // TODO: add auth gate — if no JWT in AsyncStorage, show login/onboarding flow
  // TODO: add global error boundary
  // TODO: set up offline queue listener (offlineQueue.ts) on app startup

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            // TODO: add tab bar icons and active/inactive colours
          }}
        >
          <Tab.Screen name="Home" component={HomeScreen} />
          <Tab.Screen name="Mark" component={MarkingScreen} />
          <Tab.Screen name="Analytics" component={AnalyticsScreen} />
          <Tab.Screen name="Settings" component={SettingsScreen} />
        </Tab.Navigator>
      </NavigationContainer>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
