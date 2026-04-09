// src/screens/StudentRegisterScreen.tsx
// Student onboarding — 3-step flow:
//   Step 1 (details)       → enter name + phone → POST /auth/student/lookup
//   Step 2a (match_single) → confirm single match → POST /auth/student/activate → OTPScreen
//   Step 2b (match_multi)  → pick from list      → POST /auth/student/activate → OTPScreen
//   Step 2c (join_code)    → enter class code    → POST /auth/student/register  → OTPScreen

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PENDING_JOIN_CODE_KEY } from '../constants';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { studentLookup, studentActivate, studentRegister, getClassJoinInfo } from '../services/api';
import { AuthStackParamList, ClassJoinInfo, StudentMatch } from '../types';
import { COLORS } from '../constants/colors';
import PhoneInput from '../components/PhoneInput';

const E164_RE = /^\+[1-9]\d{9,14}$/;

type Nav = NativeStackNavigationProp<AuthStackParamList, 'StudentRegister'>;

type Step = 'details' | 'match_single' | 'match_multi' | 'join_code';

export default function StudentRegisterScreen() {
  const navigation = useNavigation<Nav>();

  // ── Step state ──────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('details');

  // ── Details form ────────────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [phone, setPhone] = useState('');

  // ── Match results ───────────────────────────────────────────────────────────
  const [matches, setMatches] = useState<StudentMatch[]>([]);

  // ── Join code ───────────────────────────────────────────────────────────────
  const [joinCode, setJoinCode] = useState('');
  const [joinInfo, setJoinInfo] = useState<ClassJoinInfo | null>(null);
  const [codeError, setCodeError] = useState('');
  const [codeValidating, setCodeValidating] = useState(false);
  const joinCodeRef = useRef<TextInput>(null);

  // ── Email (optional) ────────────────────────────────────────────────────────
  const [email, setEmail] = useState('');

  // ── Loading ─────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const goToOTP = (verification_id: string, debug_otp?: string) => {
    navigation.navigate('OTP', {
      phone,
      verification_id,
      ...(debug_otp ? { debug_otp } : {}),
    });
  };

  const activate = async (student_id: string) => {
    setLoading(true);
    try {
      const res = await studentActivate({ student_id, phone });
      goToOTP(res.verification_id, res.debug_otp);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error ?? 'Could not send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 1: Lookup ──────────────────────────────────────────────────────────
  const handleLookup = async () => {
    const fn = firstName.trim();
    const sn = surname.trim();
    const ph = phone.trim();

    if (!fn || !sn) {
      Alert.alert('Name required', 'Please enter your first name and surname.');
      return;
    }
    if (!ph || !E164_RE.test(ph)) {
      Alert.alert('Invalid number', 'Please enter a valid phone number.');
      return;
    }

    setLoading(true);
    try {
      const res = await studentLookup({ first_name: fn, surname: sn, phone: ph });
      const found = res.matches;

      if (found.length === 0) {
        setStep('join_code');
      } else if (found.length === 1) {
        setMatches(found);
        setStep('match_single');
      } else {
        setMatches(found);
        setStep('match_multi');
      }
    } catch {
      Alert.alert('Error', 'Could not search for your account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2c: Join code validation ───────────────────────────────────────────
  const handleCodeChange = async (text: string) => {
    const upper = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setJoinCode(upper);
    setCodeError('');
    setJoinInfo(null);

    if (upper.length === 6) {
      setCodeValidating(true);
      try {
        const info = await getClassJoinInfo(upper);
        setJoinInfo(info);
      } catch (err: any) {
        if (err.response?.status === 404) {
          setCodeError('Code not found. Check with your teacher and try again.');
        } else {
          setCodeError('Could not validate code. Please try again.');
        }
        setJoinCode('');
        setTimeout(() => joinCodeRef.current?.focus(), 100);
      } finally {
        setCodeValidating(false);
      }
    }
  };

  const handleJoin = async () => {
    if (!joinInfo) return;
    setLoading(true);
    try {
      const res = await studentRegister({
        first_name: firstName.trim(),
        surname: surname.trim(),
        phone: phone.trim(),
        class_join_code: joinCode,
        ...(email.trim() ? { email: email.trim().toLowerCase() } : {}),
      });
      // Store join_code so AuthContext can attach it to AuthUser after OTP verify
      await AsyncStorage.setItem(PENDING_JOIN_CODE_KEY, joinCode).catch(() => {});
      goToOTP(res.verification_id, res.debug_otp);
    } catch (err: any) {
      const msg: string = err.response?.data?.error ?? '';
      if (err.response?.status === 409) {
        Alert.alert(
          'Already registered',
          'This phone number already has an account.',
          [
            { text: 'OK', style: 'cancel' },
            { text: 'Sign in instead', onPress: () => navigation.navigate('Phone') },
          ],
        );
      } else if (msg.toLowerCase().includes('invalid class code')) {
        setCodeError('That code is no longer valid. Ask your teacher for a new one.');
        setJoinInfo(null);
        setJoinCode('');
      } else {
        Alert.alert('Error', 'Could not register. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Back handler per step ───────────────────────────────────────────────────
  const handleBack = () => {
    if (step === 'details') {
      navigation.goBack();
    } else if (step === 'match_single' || step === 'match_multi') {
      setStep('details');
    } else if (step === 'join_code') {
      // Go back to match step if we had matches, else details
      if (matches.length > 0) {
        setStep(matches.length === 1 ? 'match_single' : 'match_multi');
      } else {
        setStep('details');
      }
      setJoinCode('');
      setJoinInfo(null);
      setCodeError('');
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity style={styles.back} onPress={handleBack}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        {/* ── Step 1: Details ─────────────────────────────────────────────── */}
        {step === 'details' && (
          <>
            <Text style={styles.heading}>Join your class</Text>
            <Text style={styles.subheading}>
              Enter your details and we'll find your account.
            </Text>

            <View style={styles.form}>
              <Text style={styles.label}>First name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Tendai"
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
              />
              <Text style={styles.label}>Surname</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Moyo"
                value={surname}
                onChangeText={setSurname}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
              />
              <Text style={styles.label}>Phone number</Text>
              <PhoneInput
                onChangePhone={setPhone}
                disabled={loading}
              />
              <Text style={styles.label}>
                Email address{' '}
                <Text style={styles.labelOptional}>(optional — for email submissions)</Text>
              </Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. tendai@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />

              <TouchableOpacity
                style={[styles.button, styles.buttonStudent, loading && styles.buttonDisabled]}
                onPress={handleLookup}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color={COLORS.white} />
                  : <Text style={styles.buttonText}>Continue</Text>
                }
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.altLink}
              onPress={() => navigation.navigate('Phone')}
            >
              <Text style={styles.altLinkText}>Already have an account? Sign in</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Step 2a: Single match ────────────────────────────────────────── */}
        {step === 'match_single' && matches.length > 0 && (
          <>
            <Text style={styles.heading}>Are you this student?</Text>
            <Text style={styles.subheading}>
              We found a matching account. Is this you?
            </Text>

            <MatchCard match={matches[0]} />

            <TouchableOpacity
              style={[styles.button, styles.buttonStudent, loading && styles.buttonDisabled]}
              onPress={() => activate(matches[0].student.id)}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={COLORS.white} />
                : <Text style={styles.buttonText}>Yes, that's me</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setStep('join_code')}
            >
              <Text style={styles.secondaryButtonText}>No, that's not me</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Step 2b: Multiple matches ────────────────────────────────────── */}
        {step === 'match_multi' && (
          <>
            <Text style={styles.heading}>We found your name in multiple classes</Text>
            <Text style={styles.subheading}>Tap the class you belong to.</Text>

            {matches.map((m) => (
              <TouchableOpacity
                key={m.student.id}
                onPress={() => activate(m.student.id)}
                disabled={loading}
                activeOpacity={0.8}
              >
                <MatchCard match={m} />
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.altLink}
              onPress={() => setStep('join_code')}
            >
              <Text style={styles.altLinkText}>None of these are me →</Text>
            </TouchableOpacity>

            {loading && (
              <ActivityIndicator color={COLORS.amber300} style={{ marginTop: 16 }} />
            )}
          </>
        )}

        {/* ── Step 2c: Join code ───────────────────────────────────────────── */}
        {step === 'join_code' && (
          <>
            <Text style={styles.heading}>Enter your class code</Text>
            <Text style={styles.subheading}>
              Your teacher will give you this code.
            </Text>

            <TextInput
              ref={joinCodeRef}
              style={[
                styles.codeInput,
                codeError ? styles.codeInputError : undefined,
                joinInfo ? styles.codeInputValid : undefined,
              ]}
              value={joinCode}
              onChangeText={handleCodeChange}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              placeholder="A1B2C3"
              placeholderTextColor={COLORS.gray200}
              textAlign="center"
              editable={!codeValidating && !loading}
            />

            {codeValidating && (
              <ActivityIndicator color={COLORS.amber300} style={{ marginTop: 8 }} />
            )}

            {codeError ? (
              <Text style={styles.codeError}>{codeError}</Text>
            ) : null}

            {joinInfo && (
              <>
                <View style={styles.joinInfoCard}>
                  <Text style={styles.joinInfoClass}>
                    {joinInfo.name}{joinInfo.subject ? ` — ${joinInfo.subject}` : ''}
                  </Text>
                  <Text style={styles.joinInfoTeacher}>
                    Teacher: {joinInfo.teacher.first_name} {joinInfo.teacher.surname}
                  </Text>
                  {joinInfo.education_level && (
                    <Text style={styles.joinInfoLevel}>
                      Level: {joinInfo.education_level.replace(/_/g, ' ')}
                    </Text>
                  )}
                </View>

                <TouchableOpacity
                  style={[styles.button, styles.buttonStudent, loading && styles.buttonDisabled]}
                  onPress={handleJoin}
                  disabled={loading}
                >
                  {loading
                    ? <ActivityIndicator color={COLORS.white} />
                    : <Text style={styles.buttonText}>Join this class</Text>
                  }
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── MatchCard component ───────────────────────────────────────────────────────

function MatchCard({ match }: { match: StudentMatch }) {
  return (
    <View style={styles.matchCard}>
      <Text style={styles.matchName}>
        {match.student.first_name} {match.student.surname}
        {match.student.register_number ? ` (#${match.student.register_number})` : ''}
      </Text>
      <Text style={styles.matchClass}>
        {match.class.name}
        {match.class.subject ? ` — ${match.class.subject}` : ''}
      </Text>
      <Text style={styles.matchTeacher}>
        Teacher: {match.teacher.first_name} {match.teacher.surname}
      </Text>
      {match.school && (
        <Text style={styles.matchSchool}>{match.school}</Text>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.white },
  container: { flexGrow: 1, padding: 24, paddingTop: 48 },
  back: { marginBottom: 24 },
  backText: { fontSize: 16, color: COLORS.gray500 },
  heading: { fontSize: 24, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  subheading: { fontSize: 14, color: COLORS.gray500, marginBottom: 24, lineHeight: 20 },

  // Details form
  form: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.gray900, marginTop: 8 },
  labelOptional: { fontWeight: '400', color: COLORS.gray500 },
  input: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
    padding: 14, fontSize: 16, color: COLORS.text,
  },

  // Buttons
  button: {
    marginTop: 20, borderRadius: 10, padding: 16, alignItems: 'center',
  },
  buttonStudent: { backgroundColor: COLORS.amber300 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  secondaryButton: {
    marginTop: 12, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
  },
  secondaryButtonText: { fontSize: 15, color: COLORS.gray900, fontWeight: '500' },
  altLink: { marginTop: 24, alignItems: 'center' },
  altLinkText: { fontSize: 14, color: COLORS.amber300, fontWeight: '600' },

  // Match card
  matchCard: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 12,
    padding: 16, marginBottom: 12, backgroundColor: COLORS.background,
  },
  matchName: { fontSize: 17, fontWeight: 'bold', color: COLORS.text, marginBottom: 4 },
  matchClass: { fontSize: 14, color: COLORS.gray900, marginBottom: 2 },
  matchTeacher: { fontSize: 13, color: COLORS.gray500, marginBottom: 2 },
  matchSchool: { fontSize: 12, color: COLORS.textLight },

  // Join code
  codeInput: {
    fontSize: 32, fontWeight: 'bold', letterSpacing: 8,
    borderWidth: 2, borderColor: COLORS.gray200, borderRadius: 12,
    paddingVertical: 16, marginTop: 8, color: COLORS.text,
  },
  codeInputError: { borderColor: COLORS.error },
  codeInputValid: { borderColor: COLORS.teal500 },
  codeError: {
    marginTop: 8, fontSize: 13, color: COLORS.error, textAlign: 'center',
  },
  joinInfoCard: {
    marginTop: 16, borderWidth: 1, borderColor: COLORS.teal500, borderRadius: 12,
    padding: 16, backgroundColor: COLORS.teal50,
  },
  joinInfoClass: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, marginBottom: 4 },
  joinInfoTeacher: { fontSize: 14, color: COLORS.gray900, marginBottom: 2 },
  joinInfoLevel: { fontSize: 13, color: COLORS.gray500 },
});
