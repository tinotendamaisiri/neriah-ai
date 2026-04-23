// src/screens/PinSetupScreen.tsx
// Shown after first OTP login (no PIN set yet).
// Rendered directly by AppShell — does not use navigation hooks.

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setPin } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../constants/colors';

// Written here (and only here) so login() in AuthContext knows not to show this
// prompt again, even after logout, JWT rotation, or reinstall.
const PIN_PROMPT_KEY = 'neriah_pin_prompt_shown';

const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

export default function PinSetupScreen() {
  const { markPinSet, skipPinSetup } = useAuth();
  const [pin, setLocalPin] = useState('');
  const [loading, setLoading] = useState(false);

  const handleKey = (key: string) => {
    if (loading) return;
    if (key === '⌫') {
      setLocalPin(p => p.slice(0, -1));
    } else if (key !== '' && pin.length < 4) {
      setLocalPin(p => p + key);
    }
  };

  const handleSetPin = async () => {
    if (pin.length !== 4 || loading) return;
    setLoading(true);
    try {
      await setPin(pin);
      // Mark the prompt as shown BEFORE updating AuthContext so login() won't
      // show it again even if we write to SecureStore after a crash.
      await AsyncStorage.setItem(PIN_PROMPT_KEY, 'true').catch(() => {});
      await markPinSet(); // sets hasPin=true, clears needsPinSetup → AppShell transitions
    } catch (err: any) {
      Alert.alert('Could not save PIN', err.message ?? 'Please try again.');
      setLoading(false);
    }
  };

  const handleSkip = () => {
    // Mark as shown so this prompt never appears again (user can still set PIN in Settings).
    AsyncStorage.setItem(PIN_PROMPT_KEY, 'true').catch(() => {});
    skipPinSetup(); // clears needsPinSetup → AppShell transitions
  };

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.container}>
        <View style={styles.top}>
          <Text style={styles.heading}>Secure your account</Text>
          <Text style={styles.subheading}>
            Create a 4-digit PIN for quick access
          </Text>

          {/* 4 circles */}
          <View style={styles.dotsRow}>
            {[0, 1, 2, 3].map(i => (
              <View
                key={i}
                style={[styles.dot, pin.length > i && styles.dotFilled]}
              />
            ))}
          </View>
        </View>

        {/* Numeric keypad */}
        <View style={styles.keypad}>
          {KEYS.map((key, idx) => (
            <TouchableOpacity
              key={idx}
              style={[styles.key, key === '' && styles.keyHidden]}
              onPress={() => handleKey(key)}
              disabled={key === '' || loading}
              activeOpacity={0.6}
            >
              <Text style={[styles.keyText, key === '⌫' && styles.keyDelete]}>
                {key}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Set PIN button */}
        <TouchableOpacity
          style={[styles.button, (pin.length < 4 || loading) && styles.buttonDisabled]}
          onPress={handleSetPin}
          disabled={pin.length < 4 || loading}
        >
          {loading
            ? <ActivityIndicator color={COLORS.white} />
            : <Text style={styles.buttonText}>Set PIN</Text>
          }
        </TouchableOpacity>

        {/* Skip link */}
        {!loading && (
          <TouchableOpacity style={styles.skipLink} onPress={handleSkip}>
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  top: { alignItems: 'center', width: '100%' },
  heading: {
    fontSize: 26,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  subheading: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 40,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 20,
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.teal500,
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: COLORS.teal500,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 280,
    justifyContent: 'center',
    gap: 12,
  },
  key: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.gray200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyHidden: {
    backgroundColor: 'transparent',
  },
  keyText: {
    fontSize: 24,
    fontWeight: '500',
    color: COLORS.text,
  },
  keyDelete: {
    fontSize: 20,
    color: COLORS.gray500,
  },
  button: {
    backgroundColor: COLORS.teal500,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: COLORS.teal100,
  },
  buttonText: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 16,
  },
  skipLink: {
    padding: 8,
  },
  skipText: {
    fontSize: 14,
    color: COLORS.textLight,
    textDecorationLine: 'underline',
  },
});
