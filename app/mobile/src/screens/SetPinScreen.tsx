// src/screens/SetPinScreen.tsx
// 4-digit PIN setup — enter then confirm, then POST /api/auth/pin/set.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { setPin as apiSetPin } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../constants/colors';
import { ScreenContainer } from '../components/ScreenContainer';

export default function SetPinScreen() {
  const navigation = useNavigation<any>();
  const { markPinSet } = useAuth();
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const enterRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => enterRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  const handleEnterChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 4);
    setPin(digits);
    if (digits.length === 4) {
      setStep('confirm');
      setTimeout(() => confirmRef.current?.focus(), 100);
    }
  };

  const handleConfirmChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 4);
    setConfirmPin(digits);
  };

  const handleSubmit = async () => {
    if (confirmPin !== pin) {
      Alert.alert('PINs do not match', 'The two PINs are different. Please try again.');
      setPin('');
      setConfirmPin('');
      setStep('enter');
      setTimeout(() => enterRef.current?.focus(), 100);
      return;
    }
    setLoading(true);
    try {
      await apiSetPin(pin);
      await markPinSet();
      Alert.alert('PIN saved', 'Your app lock PIN has been set.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not save PIN. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const PinDots = ({ value }: { value: string }) => (
    <View style={styles.dotsRow}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={[styles.dot, value.length > i && styles.dotFilled]} />
      ))}
    </View>
  );

  const currentValue = step === 'enter' ? pin : confirmPin;

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.container}>
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Set PIN</Text>
        <Text style={styles.subheading}>
          {step === 'enter'
            ? 'Choose a 4-digit PIN to lock the app.'
            : 'Enter your PIN again to confirm.'}
        </Text>

        <TouchableOpacity
          activeOpacity={1}
          onPress={() => {
            if (step === 'enter') enterRef.current?.focus();
            else confirmRef.current?.focus();
          }}
        >
          <PinDots value={currentValue} />
        </TouchableOpacity>

        <Text style={styles.tapHint}>Tap above then use your keypad</Text>

        {/* Hidden inputs to capture digits */}
        <TextInput
          ref={enterRef}
          style={styles.hiddenInput}
          value={pin}
          onChangeText={handleEnterChange}
          keyboardType="number-pad"
          maxLength={4}
          secureTextEntry
        />
        <TextInput
          ref={confirmRef}
          style={styles.hiddenInput}
          value={confirmPin}
          onChangeText={handleConfirmChange}
          keyboardType="number-pad"
          maxLength={4}
          secureTextEntry
        />

        {step === 'confirm' && confirmPin.length === 4 && (
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={COLORS.white} />
              : <Text style={styles.buttonText}>Save PIN</Text>
            }
          </TouchableOpacity>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.white },
  container: { flex: 1, padding: 24, paddingTop: 60, alignItems: 'center' },
  back: { alignSelf: 'flex-start', marginBottom: 32 },
  backText: { fontSize: 16, color: COLORS.gray500 },
  heading: { fontSize: 26, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  subheading: { fontSize: 15, color: COLORS.gray500, textAlign: 'center', marginBottom: 40 },
  dotsRow: { flexDirection: 'row', gap: 20, marginBottom: 12 },
  dot: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: COLORS.teal500, backgroundColor: 'transparent',
  },
  dotFilled: { backgroundColor: COLORS.teal500 },
  tapHint: { fontSize: 13, color: COLORS.textLight, marginBottom: 32 },
  hiddenInput: { position: 'absolute', width: 0, height: 0, opacity: 0 },
  button: {
    marginTop: 16, backgroundColor: COLORS.teal500, borderRadius: 10,
    padding: 16, width: '100%', alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: COLORS.teal300 },
  buttonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
});
