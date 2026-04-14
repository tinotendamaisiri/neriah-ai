// src/screens/TeacherRegisterScreen.tsx
// Teacher registration — name, phone, and school picker.
// Calls POST /auth/register → OTPScreen → TeacherTabs.

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
  Modal,
  SectionList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { requestRegisterOtp, getSchools } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { School, AuthStackParamList } from '../types';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import PhoneInput from '../components/PhoneInput';

const E164_RE = /^\+[1-9]\d{9,14}$/;

type Nav = NativeStackNavigationProp<AuthStackParamList, 'TeacherRegister'>;

const TYPE_LABELS: Record<string, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  tertiary: 'Tertiary',
};

const TYPE_COLORS: Record<string, string> = {
  primary: COLORS.teal50,
  secondary: COLORS.amber50,
  tertiary: '#EDE9FE',
};

const TYPE_TEXT_COLORS: Record<string, string> = {
  primary: COLORS.teal700,
  secondary: COLORS.amber700,
  tertiary: '#5B21B6',
};

export default function TeacherRegisterScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useLanguage();

  const [title, setTitle] = useState('');
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const TITLES = ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr', 'Prof', 'Sir', 'Eng', 'Rev'];

  // School picker state
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolModalVisible, setSchoolModalVisible] = useState(false);
  const [schoolQuery, setSchoolQuery] = useState('');
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [selectedSchoolName, setSelectedSchoolName] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customSchool, setCustomSchool] = useState('');

  const fetchSchools = async () => {
    console.log('[SchoolPicker] Fetching schools from /api/schools');
    try {
      const r = await getSchools();
      console.log('[SchoolPicker] Response:', JSON.stringify(r).slice(0, 300));
      setSchools(Array.isArray(r) ? r : []);
    } catch (err) {
      console.log('[SchoolPicker] Fetch error:', err);
    }
  };

  useEffect(() => {
    fetchSchools();
  }, []);

  const openSchoolModal = () => {
    // Re-fetch if schools list is empty (e.g. mount fetch failed)
    if (schools.length === 0) {
      console.log('[SchoolPicker] schools empty on modal open — retrying fetch');
      fetchSchools();
    }
    console.log('[SchoolPicker] Opening modal, schools loaded:', schools.length);
    setSchoolModalVisible(true);
  };

  // Sections grouped by city, filtered by search query
  const sections = useMemo(() => {
    const q = schoolQuery.trim().toLowerCase();
    // Empty query → show all schools (q is falsy when "")
    const filtered = q
      ? schools.filter(s =>
          s.name.toLowerCase().includes(q) ||
          s.city.toLowerCase().includes(q) ||
          s.province.toLowerCase().includes(q),
        )
      : schools;
    console.log('[SchoolPicker] Filter query:', JSON.stringify(q), '| matched:', filtered.length, '/', schools.length);
    const cityMap: Record<string, School[]> = {};
    filtered.forEach(s => {
      if (!cityMap[s.city]) cityMap[s.city] = [];
      cityMap[s.city].push(s);
    });
    return Object.entries(cityMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, data]) => ({
        title,
        data: data.slice().sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [schools, schoolQuery]);

  const handleSelectSchool = (school: School) => {
    setSelectedSchoolId(school.id);
    setSelectedSchoolName(school.name);
    setShowCustomInput(false);
    setCustomSchool('');
    setSchoolModalVisible(false);
    setSchoolQuery('');
  };

  const handleChooseCustom = () => {
    setSelectedSchoolId('');
    setSelectedSchoolName('');
    setShowCustomInput(true);
    setSchoolModalVisible(false);
    setSchoolQuery('');
  };

  const handleRegister = async () => {
    const fn = firstName.trim();
    const sn = surname.trim();
    const ph = phone.trim();

    if (!fn || !sn) {
      Alert.alert(t('name_required'), t('name_required_msg'));
      return;
    }
    if (!ph || !E164_RE.test(ph)) {
      Alert.alert(t('invalid_number'), t('invalid_number_msg'));
      return;
    }
    const schoolId = showCustomInput ? undefined : selectedSchoolId;
    const schoolNameVal = showCustomInput ? customSchool.trim() : undefined;
    if (!schoolId && !schoolNameVal) {
      Alert.alert(t('school_required'), t('school_required_msg'));
      return;
    }

    setLoading(true);
    try {
      const payload = {
        phone: ph,
        first_name: fn,
        surname: sn,
        ...(title ? { title } : {}),
        ...(schoolId ? { school_id: schoolId } : { school_name: schoolNameVal }),
      };
      console.log('[Register] Sending:', JSON.stringify({
        first_name: fn, surname: sn, phone: ph,
        school: schoolId ? `id:${schoolId}` : `name:${schoolNameVal}`,
      }));
      const res = await requestRegisterOtp(payload);
      navigation.navigate('OTP', {
        phone: ph,
        verification_id: res.verification_id,
        ...(res.debug_otp ? { debug_otp: res.debug_otp } : {}),
      });
    } catch (err: any) {
      console.log('[Register] Error:', JSON.stringify({
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
      }));
      const status = err?.response?.status;
      const isAlreadyRegistered =
        status === 409 ||
        (err?.message ?? '').toLowerCase().includes('already registered');
      if (isAlreadyRegistered) {
        Alert.alert(
          'Account already exists',
          'An account with this phone number already exists. Would you like to sign in instead?',
          [
            { text: 'Sign in', onPress: () => navigation.navigate('Phone') },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
      } else if (status === 400) {
        Alert.alert(t('error'), t('fill_all_fields'));
      } else if (status === 429) {
        Alert.alert(t('error'), t('too_many_attempts'));
      } else {
        Alert.alert(t('error'), t('server_error_retry'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>{t('back')}</Text>
          </TouchableOpacity>

          <View style={styles.iconBadge}>
            <Ionicons name="clipboard-outline" size={36} color={COLORS.teal500} />
          </View>

          <Text style={styles.heading}>{t('create_teacher_account')}</Text>
          <Text style={styles.subheading}>{t('enter_details')}</Text>

          <View style={styles.form}>
            <Text style={styles.label}>Title <Text style={styles.labelOptional}>(optional)</Text></Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
              keyboardShouldPersistTaps="handled"
            >
              {TITLES.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.chip, title === t && styles.chipSelected]}
                  onPress={() => setTitle(prev => prev === t ? '' : t)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, title === t && styles.chipTextSelected]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>{t('first_name')}</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Tendai"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
            />

            <Text style={styles.label}>{t('surname_label')}</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Moyo"
              value={surname}
              onChangeText={setSurname}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
            />

            <Text style={styles.label}>{t('phone_number')}</Text>
            <PhoneInput
              onChangePhone={setPhone}
              disabled={loading}
            />

            <Text style={styles.label}>{t('school')}</Text>
            {showCustomInput ? (
              <View style={styles.customSchoolRow}>
                <TextInput
                  style={[styles.input, styles.customSchoolInput]}
                  placeholder={t('enter_school_name')}
                  value={customSchool}
                  onChangeText={setCustomSchool}
                  autoCapitalize="words"
                />
                <TouchableOpacity
                  style={styles.customSchoolBack}
                  onPress={() => { setShowCustomInput(false); setCustomSchool(''); }}
                >
                  <Text style={styles.customSchoolBackText}>{t('browse')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.schoolField, !selectedSchoolName && styles.schoolFieldEmpty]}
                onPress={openSchoolModal}
                disabled={loading}
              >
                <Text style={[styles.schoolFieldText, !selectedSchoolName && styles.schoolFieldPlaceholder]}>
                  {selectedSchoolName || t('select_school_placeholder')}
                </Text>
                <Text style={styles.schoolChevron}>▾</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleRegister}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? t('creating_account') : t('create_account')}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.altLink} onPress={() => navigation.navigate('Phone')}>
            <Text style={styles.altLinkText}>{t('already_account_sign_in')}</Text>
          </TouchableOpacity>

          <Text style={styles.legal}>{t('otp_legal_text')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* School picker modal */}
      <Modal
        visible={schoolModalVisible}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={() => { setSchoolModalVisible(false); setSchoolQuery(''); }}
      >
        <SafeAreaView style={styles.modal}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('select_school_modal')}</Text>
            <TouchableOpacity
              onPress={() => { setSchoolModalVisible(false); setSchoolQuery(''); }}
              hitSlop={{ top: 8, bottom: 8, left: 16, right: 8 }}
            >
              <Text style={styles.modalCancel}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder={t('search_school_placeholder')}
              placeholderTextColor={COLORS.gray500}
              value={schoolQuery}
              onChangeText={setSchoolQuery}
              autoCorrect={false}
              clearButtonMode="while-editing"
              autoFocus={Platform.OS === 'ios'}
            />
          </View>

          {/* Grouped school list */}
          <SectionList
            sections={sections}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="handled"
            renderSectionHeader={({ section: { title } }) => (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>{title}</Text>
              </View>
            )}
            renderItem={({ item }) => {
              const isSelected = item.id === selectedSchoolId;
              return (
                <TouchableOpacity
                  style={[styles.schoolRow, isSelected && styles.schoolRowSelected]}
                  onPress={() => handleSelectSchool(item)}
                  activeOpacity={0.7}
                >
                  <View style={styles.schoolRowLeft}>
                    <Text style={[styles.schoolName, isSelected && styles.schoolNameSelected]}>
                      {item.name}
                    </Text>
                  </View>
                  <View style={[
                    styles.typeBadge,
                    { backgroundColor: TYPE_COLORS[item.type] ?? COLORS.gray50 },
                  ]}>
                    <Text style={[
                      styles.typeBadgeText,
                      { color: TYPE_TEXT_COLORS[item.type] ?? COLORS.gray500 },
                    ]}>
                      {TYPE_LABELS[item.type] ?? item.type}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListFooterComponent={
              <TouchableOpacity style={styles.notListedRow} onPress={handleChooseCustom}>
                <Text style={styles.notListedText}>{t('my_school_not_listed')}</Text>
                <Text style={styles.notListedSub}>{t('enter_school_manually_sub')}</Text>
              </TouchableOpacity>
            }
            ListEmptyComponent={
              <Text style={styles.emptyText}>{t('no_match_schools')} "{schoolQuery}"</Text>
            }
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.white },
  container: { flexGrow: 1, padding: 24, paddingTop: 48 },
  back: { marginBottom: 24 },
  backText: { fontSize: 16, color: COLORS.gray500 },
  iconBadge: {
    width: 72, height: 72, borderRadius: 20, backgroundColor: COLORS.teal50,
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
  },
  heading: { fontSize: 26, fontWeight: 'bold', color: COLORS.text, marginBottom: 6 },
  subheading: { fontSize: 14, color: COLORS.gray500, marginBottom: 32 },
  form: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.gray900, marginTop: 8 },
  labelOptional: { fontWeight: '400', color: COLORS.gray500 },
  chipsRow: { flexDirection: 'row', gap: 8, paddingVertical: 6 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1.5, borderColor: COLORS.gray200, backgroundColor: COLORS.white,
  },
  chipSelected: { backgroundColor: COLORS.teal500, borderColor: COLORS.teal500 },
  chipText: { fontSize: 14, fontWeight: '600', color: COLORS.gray900 },
  chipTextSelected: { color: COLORS.white },
  input: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10,
    padding: 14, fontSize: 16, color: COLORS.text,
  },
  schoolField: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.white,
  },
  schoolFieldEmpty: {},
  schoolFieldText: { fontSize: 16, color: COLORS.text, flex: 1 },
  schoolFieldPlaceholder: { color: COLORS.gray500 },
  schoolChevron: { fontSize: 14, color: COLORS.gray500 },
  customSchoolRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  customSchoolInput: { flex: 1 },
  customSchoolBack: {
    paddingHorizontal: 14, paddingVertical: 14, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.teal500,
  },
  customSchoolBackText: { color: COLORS.teal500, fontWeight: '600', fontSize: 14 },
  button: {
    marginTop: 24, backgroundColor: COLORS.teal500, borderRadius: 10,
    padding: 16, alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: COLORS.teal300 },
  buttonText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  altLink: { marginTop: 24, alignItems: 'center' },
  altLinkText: { fontSize: 14, color: COLORS.teal500, fontWeight: '600' },
  legal: { marginTop: 16, textAlign: 'center', fontSize: 12, color: COLORS.textLight },

  // ── School picker modal ──────────────────────────────────────────────────────
  modal: { flex: 1, backgroundColor: COLORS.white },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  modalCancel: { fontSize: 16, color: COLORS.teal500, fontWeight: '600' },
  searchRow: {
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: COLORS.gray50, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  searchInput: {
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.gray200,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: COLORS.text,
  },
  sectionHeader: {
    backgroundColor: COLORS.gray50, paddingHorizontal: 20, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  sectionHeaderText: { fontSize: 12, fontWeight: '700', color: COLORS.gray500, textTransform: 'uppercase' },
  schoolRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12,
  },
  schoolRowSelected: { backgroundColor: COLORS.teal50 },
  schoolRowLeft: { flex: 1 },
  schoolName: { fontSize: 15, color: COLORS.text },
  schoolNameSelected: { color: COLORS.teal500, fontWeight: '600' },
  schoolCity: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },
  typeBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeText: { fontSize: 11, fontWeight: '700' },
  separator: { height: 1, backgroundColor: COLORS.border, marginLeft: 20 },
  notListedRow: {
    paddingHorizontal: 20, paddingVertical: 18,
    borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 8,
  },
  notListedText: { fontSize: 15, color: COLORS.teal500, fontWeight: '600' },
  notListedSub: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },
  emptyText: { textAlign: 'center', marginTop: 32, fontSize: 14, color: COLORS.gray500 },
});
