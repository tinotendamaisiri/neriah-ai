// src/play/PlayNavigator.tsx
//
// Native stack rooted at PlayHome. Mounted from StudentResultsScreen so
// the bottom-nav slot (still wired as `name="StudentResults"` for
// deep-link compat) renders the full Play surface — the route name is
// kept, the file content swapped.
//
// Slide-from-right animation matches the rest of the student stack
// motion (StudentRootStack). Headers are off everywhere — each Play
// screen renders its own teal header band + BackButton.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { PlayStackParamList } from './types';

import PlayHomeScreen from './screens/PlayHomeScreen';
import PlayLibraryScreen from './screens/PlayLibraryScreen';
import PlayBuildScreen from './screens/PlayBuildScreen';
import PlayBuildProgressScreen from './screens/PlayBuildProgressScreen';
import PlayPreviewScreen from './screens/PlayPreviewScreen';
import PlayGameScreen from './screens/PlayGameScreen';
import PlaySessionEndScreen from './screens/PlaySessionEndScreen';
import PlayShareScreen from './screens/PlayShareScreen';

const Stack = createNativeStackNavigator<PlayStackParamList>();

export default function PlayNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <Stack.Screen name="PlayHome" component={PlayHomeScreen} />
      <Stack.Screen name="PlayLibrary" component={PlayLibraryScreen} />
      <Stack.Screen name="PlayBuild" component={PlayBuildScreen} />
      <Stack.Screen name="PlayBuildProgress" component={PlayBuildProgressScreen} />
      <Stack.Screen name="PlayPreview" component={PlayPreviewScreen} />
      <Stack.Screen name="PlayGame" component={PlayGameScreen} />
      <Stack.Screen name="PlaySessionEnd" component={PlaySessionEndScreen} />
      <Stack.Screen name="PlayShare" component={PlayShareScreen} />
    </Stack.Navigator>
  );
}
