// src/screens/StudentRegisterScreen.tsx
// Student registration — 4-step wizard:
//   Step 1 (phone)      → enter phone number
//   Step 2 (school)     → search & pick school from list
//   Step 3 (class_list) → pick class from the selected school
//   Step 4 (name)       → enter first name + surname → POST /auth/student/register → OTPScreen

import React, { useEffect, useMemo, useState } from 'react';
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
  Modal,
  SectionList,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { studentRegister, getSchools, getClassesBySchool } from '../services/api';
import { AuthStackParamList, School } from '../types';
import { COLORS } from '../constants/colors';
import PhoneInput, { isValidE164 } from '../components/PhoneInput';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'StudentRegister'>;

type Step = 'phone' | 'school' | 'class_list' | 'name';

interface ClassOption {
  id: string;
  name: string;
  education_level: string;
  subject?: string;
  teacher: { first_name: string; surname: string };
}

const LEVEL_LABELS: Record<string, string> = {
  grade_1: 'Grade 1', grade_2: 'Grade 2', grade_3: 'Grade 3',
  grade_4: 'Grade 4', grade_5: 'Grade 5', grade_6: 'Grade 6', grade_7: 'Grade 7',
  form_1: 'Form 1', form_2: 'Form 2', form_3: 'Form 3', form_4: 'Form 4',
  form_5: 'Form 5 (A-Level)', form_6: 'Form 6 (A-Level)',
  tertiary: 'College / University',
};

const TYPE_COLORS: Record<string, string> = {
  primary: COLORS.teal50,
  secondary: COLORS.amber50,
  tertiary: '#EDE9FE',
  college: '#EDE9FE',
};
const TYPE_TEXT_COLORS: Record<string, string> = {
  primary: COLORS.teal700,
  secondary: COLORS.amber700,
  tertiary: '#5B21B6',
  college: '#5B21B6',
};

export default function StudentRegisterScreen() {
  const navigation = useNavigation<Nav>();

  const [step, setStep] = useState<Step>('phone');

  // Step 1
  const [phone, setPhone] = useState('');

  // Step 2 — school picker
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(false);
  const [schoolQuery, setSchoolQuery] = useState('');
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [selectedSchoolName, setSelectedSchoolName] = useState('');
  const [schoolModalVisible, setSchoolModalVisible] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customSchool, setCustomSchool] = useState('');

  // Step 3 — class list
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedClassName, setSelectedClassName] = useState('');

  // Step 4 — name
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');

  const [loading, setLoading] = useState(false);

  // ── Load schools on mount ───────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setSchoolsLoading(true);
      try {
        const r = await getSchools();
        setSchools(Array.isArray(r) ? r : []);
      } catch {
        // silently fail — user can still use custom school
      } finally {
        setSchoolsLoading(false);
      }
    };
    load();
  }, []);

  // ── School picker sections ──────────────────────────────────────────────────
  const schoolSections = useMemo(() => {
    const q = schoolQuery.trim().toLowerCase();
    const filtered = q
      ? schools.filter(
          (s) => s.name.toLowerCase().includes(q) || s.city?.toLowerCase().includes(q),
        )
      : schools;
    const byCity: Record<string, School[]> = {};
    filtered.forEach((s) => {
      const city = s.city || 'Other';
      if (!byCity[city]) byCity[city] = [];
      byCity[city].push(s);
    });
    return Object.entries(byCity)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([city, data]) => ({ title: city, data }));
  }, [schools, schoolQuery]);

  const handleSelectSchool = async (school: School) => {
    setSelectedSchoolId(school.id);
    setSelectedSchoolName(school.name);
    setSchoolModalVisible(false);
    setShowCustomInput(false);
    setSchoolQuery('');
    setStep('class_list');
    await loadClassesForSchool(school.id);
  };

  const handleCustomSchoolConfirm = async () => {
    const name = customSchool.trim();
    if (!name) {
      Alert.alert('School name required', 'Please enter your school name.');
      return;
    }
    setSelectedSchoolId('');
    setSelectedSchoolName(name);
    setSchoolModalVisible(false);
    setShowCustomInput(false);
    setSchoolQuery('');
    setStep('class_list');
    // Custom school: no class list from server, skip to name entry
    setClasses([]);
  };

  // ── Load classes for selected school ───────────────────────────────────────
  const loadClassesForSchool = async (school_id: string) => {
    if (!school_id) {
      console.log('[StudentRegister] loadClassesForSchool: no school_id, skipping');
      setClasses([]);
      return;
    }
    console.log('[StudentRegister] loadClassesForSchool: fetching classes for school_id=', school_id);
    setClassesLoading(true);
    try {
      const result = await getClassesBySchool(school_id);
      console.log('[StudentRegister] loadClassesForSchool: got', result.length, 'classes', JSON.stringify(result));
      setClasses(result);
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const msg = err?.message ?? err?.response?.data?.error ?? 'unknown error';
      console.warn('[StudentRegister] loadClassesForSchool failed: status=', status, 'msg=', msg);
      setClasses([]);
    } finally {
      setClassesLoading(false);
    }
  };

  const handleSelectClass = (cls: ClassOption) => {
    setSelectedClassId(cls.id);
    setSelectedClassName(cls.name);
    setStep('name');
  };

  // ── Final registration ──────────────────────────────────────────────────────
  const handleRegister = async () => {
    const fn = firstName.trim();
    const sn = surname.trim();

    if (!fn || !sn) {
      Alert.alert('Name required', 'Please enter your first name and surname.');
      return;
    }
    if (!selectedClassId) {
      Alert.alert('Class required', 'Please select your class.');
      return;
    }

    setLoading(true);
    try {
      const res = await studentRegister({
        first_name: fn,
        surname: sn,
        phone: phone.trim(),
        class_id: selectedClassId,
      });
      navigation.navigate('OTP', {
        phone: phone.trim(),
        verification_id: res.verification_id,
        ...(res.debug_otp ? { debug_otp: res.debug_otp } : {}),
        ...(res.channel   ? { channel:   res.channel   } : {}),
      });
    } catch (err: any) {
      const msg: string = err.message ?? err.response?.data?.error ?? '';
      if (err.status === 409 || err.response?.status === 409) {
        Alert.alert(
          'Already registered',
          'This phone number already has an account.',
          [
            { text: 'OK', style: 'cancel' },
            { text: 'Sign in instead', onPress: () => navigation.navigate('Phone') },
          ],
        );
      } else {
        Alert.alert('Error', msg || 'Could not register. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Back handler ────────────────────────────────────────────────────────────
  const handleBack = () => {
    if (step === 'phone') {
      navigation.goBack();
    } else if (step === 'school') {
      setStep('phone');
    } else if (step === 'class_list') {
      setStep('school');
      setSelectedClassId('');
      setSelectedClassName('');
    } else if (step === 'name') {
      // If there were classes to pick from, go back to class list; else go to school
      if (classes.length > 0 || classesLoading) {
        setStep('class_list');
      } else {
        setStep('school');
      }
    }
  };

  const stepNumber = step === 'phone' ? 1 : step === 'school' ? 2 : step === 'class_list' ? 3 : 4;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        {/* Back */}
        <TouchableOpacity style={styles.back} onPress={handleBack}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        {/* Step indicator */}
        <View style={styles.stepRow}>
          {[1, 2, 3, 4].map((n) => (
            <View key={n} style={[styles.stepDot, n <= stepNumber && styles.stepDotActive]} />
          ))}
        </View>

        {/* ── Step 1: Phone ─────────────────────────────────────────────────── */}
        {step === 'phone' && (
          <>
            <Text style={styles.heading}>Join your class</Text>
            <Text style={styles.subheading}>Enter your phone number to get started.</Text>

            <View style={styles.form}>
              <Text style={styles.label}>Phone number</Text>
              <PhoneInput onChangePhone={setPhone} disabled={false} />

              <TouchableOpacity
                style={[styles.button, !isValidE164(phone) && styles.buttonDisabled]}
                onPress={() => { setStep('school'); }}
                disabled={!isValidE164(phone)}
              >
                <Text style={styles.buttonText}>Continue</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.altLink} onPress={() => navigation.navigate('Phone')}>
              <Text style={styles.altLinkText}>Already have an account? Sign in</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Step 2: School ────────────────────────────────────────────────── */}
        {step === 'school' && (
          <>
            <Text style={styles.heading}>Select your school</Text>
            <Text style={styles.subheading}>Search for your school or enter it manually.</Text>

            {selectedSchoolName && !schoolModalVisible ? (
              <TouchableOpacity style={styles.selectedCard} onPress={() => setSchoolModalVisible(true)}>
                <Text style={styles.selectedCardLabel}>School</Text>
                <Text style={styles.selectedCardValue}>{selectedSchoolName}</Text>
                <Text style={styles.selectedCardChange}>Change</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => {
                  if (schools.length === 0 && !schoolsLoading) {
                    getSchools().then(setSchools).catch(() => {});
                  }
                  setSchoolModalVisible(true);
                }}
              >
                {schoolsLoading
                  ? <ActivityIndicator color={COLORS.teal500} />
                  : <Text style={styles.pickerButtonText}>Search schools…</Text>
                }
              </TouchableOpacity>
            )}

            {selectedSchoolName && (
              <TouchableOpacity
                style={styles.button}
                onPress={() => {
                  setStep('class_list');
                  if (selectedSchoolId && classes.length === 0 && !classesLoading) {
                    loadClassesForSchool(selectedSchoolId);
                  }
                }}
              >
                <Text style={styles.buttonText}>Continue</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* ── Step 3: Class list ────────────────────────────────────────────── */}
        {step === 'class_list' && (
          <>
            <Text style={styles.heading}>Select your class</Text>
            <Text style={styles.subheading}>
              {selectedSchoolName ? `Classes at ${selectedSchoolName}` : 'Tap your class to continue.'}
            </Text>

            {classesLoading ? (
              <ActivityIndicator color={COLORS.teal500} style={{ marginTop: 32 }} />
            ) : classes.length === 0 ? (
              <>
                <Text style={styles.emptyText}>
                  No classes found for this school yet.{'\n'}Your teacher needs to set up their class first.
                </Text>
                <TouchableOpacity
                  style={[styles.button, { marginTop: 24 }]}
                  onPress={() => {
                    setSelectedClassId('');
                    setSelectedClassName('');
                    setStep('name');
                  }}
                >
                  <Text style={styles.buttonText}>Continue anyway</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {classes.map((cls) => (
                  <TouchableOpacity
                    key={cls.id}
                    style={[
                      styles.classCard,
                      selectedClassId === cls.id && styles.classCardSelected,
                    ]}
                    onPress={() => handleSelectClass(cls)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.className}>{cls.name}</Text>
                    {cls.subject && (
                      <Text style={styles.classSubject}>{cls.subject}</Text>
                    )}
                    <Text style={styles.classTeacher}>
                      {cls.teacher.first_name} {cls.teacher.surname}
                      {cls.education_level ? `  ·  ${LEVEL_LABELS[cls.education_level] ?? cls.education_level}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </>
        )}

        {/* ── Step 4: Name ──────────────────────────────────────────────────── */}
        {step === 'name' && (
          <>
            <Text style={styles.heading}>Your name</Text>
            <Text style={styles.subheading}>
              {selectedClassName
                ? `Joining ${selectedClassName} at ${selectedSchoolName}`
                : `Joining ${selectedSchoolName}`}
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
                returnKeyType="done"
                onSubmitEditing={handleRegister}
              />

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleRegister}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color={COLORS.white} />
                  : <Text style={styles.buttonText}>Join class</Text>
                }
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>

      {/* ── School picker modal ──────────────────────────────────────────────── */}
      <Modal visible={schoolModalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select school</Text>
            <TouchableOpacity onPress={() => { setSchoolModalVisible(false); setSchoolQuery(''); }}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or city…"
            value={schoolQuery}
            onChangeText={setSchoolQuery}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />

          {showCustomInput ? (
            <View style={styles.customInputContainer}>
              <Text style={styles.label}>School name</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your school name"
                value={customSchool}
                onChangeText={setCustomSchool}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleCustomSchoolConfirm}
              />
              <TouchableOpacity style={styles.button} onPress={handleCustomSchoolConfirm}>
                <Text style={styles.buttonText}>Confirm</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, { marginTop: 8 }]}
                onPress={() => setShowCustomInput(false)}
              >
                <Text style={styles.secondaryButtonText}>Back to list</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <SectionList
                sections={schoolSections}
                keyExtractor={(item) => item.id}
                renderSectionHeader={({ section }) => (
                  <Text style={styles.sectionHeader}>{section.title}</Text>
                )}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.schoolItem} onPress={() => handleSelectSchool(item)}>
                    <View style={styles.schoolItemLeft}>
                      <Text style={styles.schoolName}>{item.name}</Text>
                      <Text style={styles.schoolCity}>{item.city}</Text>
                    </View>
                    <View
                      style={[
                        styles.schoolTypeBadge,
                        { backgroundColor: TYPE_COLORS[item.type] ?? COLORS.teal50 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.schoolTypeText,
                          { color: TYPE_TEXT_COLORS[item.type] ?? COLORS.teal700 },
                        ]}
                      >
                        {item.type}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>No schools match your search.</Text>
                }
                contentContainerStyle={{ paddingBottom: 100 }}
              />

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={styles.customSchoolButton}
                  onPress={() => { setShowCustomInput(true); setSchoolQuery(''); }}
                >
                  <Text style={styles.customSchoolButtonText}>My school isn't listed →</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </SafeAreaView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.white },
  container: { flexGrow: 1, padding: 24, paddingTop: 48 },

  back: { marginBottom: 16 },
  backText: { fontSize: 16, color: COLORS.gray500 },

  stepRow: { flexDirection: 'row', gap: 6, marginBottom: 24 },
  stepDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: COLORS.gray200,
  },
  stepDotActive: { backgroundColor: COLORS.amber300 },

  heading: { fontSize: 24, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  subheading: { fontSize: 14, color: COLORS.gray500, marginBottom: 24, lineHeight: 20 },

  form: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.gray900, marginTop: 8 },
  input: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
    padding: 14, fontSize: 16, color: COLORS.text,
  },

  button: {
    marginTop: 20, borderRadius: 10, padding: 16, alignItems: 'center',
    backgroundColor: COLORS.amber300,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },

  secondaryButton: {
    marginTop: 12, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
  },
  secondaryButtonText: { fontSize: 15, color: COLORS.gray900, fontWeight: '500' },

  altLink: { marginTop: 24, alignItems: 'center' },
  altLinkText: { fontSize: 14, color: COLORS.amber300, fontWeight: '600' },

  // School picker button
  pickerButton: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
    padding: 16, alignItems: 'center', backgroundColor: COLORS.background,
  },
  pickerButtonText: { fontSize: 16, color: COLORS.gray500 },

  selectedCard: {
    borderWidth: 1, borderColor: COLORS.teal500, borderRadius: 10,
    padding: 14, backgroundColor: COLORS.teal50,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  selectedCardLabel: { fontSize: 12, color: COLORS.teal700, fontWeight: '600', flex: 0 },
  selectedCardValue: { fontSize: 15, color: COLORS.text, fontWeight: '600', flex: 1 },
  selectedCardChange: { fontSize: 13, color: COLORS.teal700, fontWeight: '600' },

  // Class cards
  classCard: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 12,
    padding: 16, marginBottom: 10, backgroundColor: COLORS.background,
  },
  classCardSelected: {
    borderColor: COLORS.amber300, backgroundColor: COLORS.amber50,
  },
  className: { fontSize: 17, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  classSubject: { fontSize: 14, color: COLORS.teal700, marginBottom: 2 },
  classTeacher: { fontSize: 13, color: COLORS.gray500 },

  emptyText: {
    textAlign: 'center', color: COLORS.gray500, fontSize: 14,
    marginTop: 32, lineHeight: 22, paddingHorizontal: 16,
  },

  // Modal
  modalContainer: { flex: 1, backgroundColor: COLORS.white },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  modalClose: { fontSize: 16, color: COLORS.amber300, fontWeight: '600' },

  searchInput: {
    margin: 16, borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
    padding: 12, fontSize: 16, color: COLORS.text,
  },

  sectionHeader: {
    fontSize: 12, fontWeight: '700', color: COLORS.gray500, textTransform: 'uppercase',
    letterSpacing: 0.5, paddingHorizontal: 20, paddingVertical: 6,
    backgroundColor: COLORS.background,
  },
  schoolItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  schoolItemLeft: { flex: 1, marginRight: 12 },
  schoolName: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: 2 },
  schoolCity: { fontSize: 13, color: COLORS.gray500 },
  schoolTypeBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  schoolTypeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },

  modalFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 20, backgroundColor: COLORS.white,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  customSchoolButton: { alignItems: 'center', padding: 12 },
  customSchoolButtonText: { fontSize: 14, color: COLORS.amber300, fontWeight: '600' },

  customInputContainer: { padding: 20, gap: 4 },
});
