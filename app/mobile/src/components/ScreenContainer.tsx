// src/components/ScreenContainer.tsx
// Shared screen wrapper that solves two cross-platform issues at once:
//   1. Android keyboard covering inputs — KeyboardAvoidingView + Android
//      softwareKeyboardLayoutMode=resize in app.json means inputs lift above
//      the keyboard instead of being covered by it.
//   2. Status-bar overlap on Android — SafeAreaView + StatusBar translucent
//      false keeps custom headers below the time/battery icons.
//
// Usage:
//   <ScreenContainer>...</ScreenContainer>                    // scrolling (default)
//   <ScreenContainer scroll={false}>...</ScreenContainer>     // fixed layout
//
// Drop-in — replaces the outer SafeAreaView + KeyboardAvoidingView combo
// that most auth/form screens hand-roll today.

import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView,
  StyleSheet,
  ViewStyle,
  StatusBar,
} from 'react-native';

type Props = {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  keyboardVerticalOffset?: number;
};

export function ScreenContainer({
  children,
  scroll = true,
  style,
  keyboardVerticalOffset,
}: Props) {
  const Content = scroll ? ScrollView : React.Fragment;
  const contentProps = scroll
    ? {
        keyboardShouldPersistTaps: 'handled' as const,
        contentContainerStyle: { flexGrow: 1, paddingBottom: 40 },
        showsVerticalScrollIndicator: false,
      }
    : {};

  return (
    <SafeAreaView style={[styles.safe, style]}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" translucent={false} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardVerticalOffset ?? 0}
      >
        <Content {...contentProps}>{children}</Content>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
});
