// src/screens/ClassManagementScreen.tsx
// Student class management — view enrolled classes, leave, join by school search.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert,
  ActivityIndicator, RefreshControl, Modal, TextInput, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import {
  getStudentClasses, leaveClass, joinClassByCode, getClassJoinInfo,
  getClassesBySchool,
} from '../services/api';
import { COLORS } from '../constants/colors';

type ClassItem = {
  class_id: string; name: string; subject: string;
  education_level: string; teacher_name: string; school_name: string;
};

type AvailableClass = {
  id: string; name: string; subject: string | null;
  education_level: string;
  teacher: { first_name: string; surname: string };
};

export default function ClassManagementScreen() {
  const navigation = useNavigation();
  const { user, updateUser } = useAuth();

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Join modal state
  const [joinModal, setJoinModal] = useState(false);
  const [school, setSchool] = useState('');
  const [availableClasses, setAvailableClasses] = useState<AvailableClass[]>([]);
  const [searchingClasses, setSearchingClasses] = useState(false);
  const [searchedSchool, setSearchedSchool] = useState('');
  const [joining, setJoining] = useState<string | null>(null);

  // Join code fallback
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [codeInfo, setCodeInfo] = useState<{ name: string } | null>(null);
  const [codeLookup, setCodeLookup] = useState(false);
  const [codeError, setCodeError] = useState('');
  const [codeJoining, setCodeJoining] = useState(false);

  // ── Load enrolled classes ───────────────────────────────────────────────────

  const load = useCallback(async (isRefresh = false) => {
    try {
      const res = await getStudentClasses();
      if (res.classes.length > 0) {
        setClasses(res.classes);
        setActiveId(res.active_class_id);
      } else if (user?.class_id) {
        const { getClassDetail } = await import('../services/api');
        const cls = await getClassDetail(user.class_id);
        setClasses([{
          class_id: user.class_id, name: cls.name || 'My Class',
          subject: cls.subject || '', education_level: cls.education_level || '',
          teacher_name: '', school_name: (cls as any).school_name || '',
        }]);
        setActiveId(user.class_id);
      }
    } catch {
      if (user?.class_id) {
        try {
          const { getClassDetail } = await import('../services/api');
          const cls = await getClassDetail(user.class_id);
          setClasses([{
            class_id: user.class_id, name: cls.name || 'My Class',
            subject: cls.subject || '', education_level: cls.education_level || '',
            teacher_name: '', school_name: (cls as any).school_name || '',
          }]);
          setActiveId(user.class_id);
        } catch { setClasses([]); }
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.class_id]);

  useEffect(() => { load(); }, []);

  // ── Pre-fill school from first enrolled class ──────────────────────────────

  const openJoinModal = () => {
    const userSchool = classes[0]?.school_name || (user as any)?.school_name || '';
    setSchool(userSchool);
    setAvailableClasses([]);
    setSearchedSchool('');
    setShowCodeInput(false);
    setJoinCode('');
    setCodeInfo(null);
    setCodeError('');
    setJoinModal(true);
    if (userSchool) searchBySchool(userSchool);
  };

  // ── Search classes by school ────────────────────────────────────────────────

  const searchBySchool = async (schoolName: string) => {
    if (!schoolName.trim()) return;
    setSearchingClasses(true);
    setSearchedSchool(schoolName);
    try {
      const data = await getClassesBySchool(schoolName);
      // Filter out classes student is already enrolled in
      const enrolledIds = new Set(classes.map(c => c.class_id));
      setAvailableClasses((data || []).filter((c: any) => !enrolledIds.has(c.id)));
    } catch {
      setAvailableClasses([]);
    } finally {
      setSearchingClasses(false);
    }
  };

  // ── Join a class by ID ──────────────────────────────────────────────────────

  const handleJoinById = async (cls: AvailableClass) => {
    const teacherName = `${cls.teacher.first_name} ${cls.teacher.surname}`.trim();
    Alert.alert(
      `Join ${cls.name}?`,
      `Teacher: ${teacherName}${searchedSchool ? `\nSchool: ${searchedSchool}` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Join',
          onPress: async () => {
            setJoining(cls.id);
            try {
              // The join-class endpoint accepts join_code — we need to pass the class
              // directly. Use the class's join_code if available, or add class_id support.
              const { default: client } = await import('../services/api').then(m => ({ default: (m as any).client }));
              const res = await (await import('../services/api')).joinClassByCode(cls.id);
              if (updateUser) updateUser({ ...user, class_id: res.class_id } as any);
              Alert.alert('Joined!', `Joined ${cls.name} successfully!`);
              setJoinModal(false);
              load(true);
            } catch (err: any) {
              // Fallback: try with the class ID directly via POST
              try {
                const apiModule = await import('../services/api');
                const resp = await (apiModule as any).client.post('/auth/student/join-class', { class_id: cls.id });
                if (updateUser) updateUser({ ...user, class_id: cls.id } as any);
                Alert.alert('Joined!', `Joined ${cls.name} successfully!`);
                setJoinModal(false);
                load(true);
              } catch (err2: any) {
                Alert.alert('Error', err2?.response?.data?.error ?? 'Could not join class.');
              }
            } finally {
              setJoining(null);
            }
          },
        },
      ],
    );
  };

  // ── Leave class ─────────────────────────────────────────────────────────────

  const handleLeave = (cls: ClassItem) => {
    Alert.alert(`Leave ${cls.name}?`, 'You will lose access to its assignments and results.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive',
        onPress: async () => {
          try {
            const res = await leaveClass(cls.class_id);
            if (res.active_class_id && updateUser) updateUser({ ...user, class_id: res.active_class_id } as any);
            load(true);
          } catch (err: any) { Alert.alert('Error', err?.message ?? 'Could not leave class.'); }
        },
      },
    ]);
  };

  // ── Join by code ────────────────────────────────────────────────────────────

  const handleCodeChange = async (text: string) => {
    const upper = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setJoinCode(upper); setCodeError(''); setCodeInfo(null);
    if (upper.length === 6) {
      setCodeLookup(true);
      try { const info = await getClassJoinInfo(upper); setCodeInfo({ name: info.name }); }
      catch { setCodeError('Class not found.'); }
      finally { setCodeLookup(false); }
    }
  };

  const handleJoinByCode = async () => {
    if (!joinCode || joinCode.length < 4) { setCodeError('Enter a valid code.'); return; }
    setCodeJoining(true);
    try {
      const res = await joinClassByCode(joinCode);
      if (updateUser) updateUser({ ...user, class_id: res.class_id } as any);
      Alert.alert('Joined!', res.message);
      setJoinModal(false);
      load(true);
    } catch (err: any) {
      setCodeError(err?.response?.data?.error ?? 'Could not join.');
    } finally { setCodeJoining(false); }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return <View style={s.centered}><ActivityIndicator size="large" color={COLORS.teal500} /></View>;
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>My Classes</Text>
        <View style={{ width: 34 }} />
      </View>

      <FlatList
        data={classes}
        keyExtractor={c => c.class_id}
        contentContainerStyle={classes.length === 0 ? s.emptyFlex : s.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={COLORS.teal500} />}
        ListEmptyComponent={() => (
          <View style={s.empty}>
            <Ionicons name="school-outline" size={48} color={COLORS.gray200} style={{ marginBottom: 14 }} />
            <Text style={s.emptyTitle}>No classes yet</Text>
            <Text style={s.emptyText}>Join a class to get started.</Text>
          </View>
        )}
        ListFooterComponent={() => (
          <View style={s.footer}>
            <TouchableOpacity style={s.joinBtn} onPress={openJoinModal}>
              <Ionicons name="add-circle-outline" size={18} color={COLORS.white} />
              <Text style={s.joinBtnText}>Join a Class</Text>
            </TouchableOpacity>
          </View>
        )}
        renderItem={({ item }) => {
          const isActive = item.class_id === activeId;
          return (
            <View style={[s.card, isActive && s.cardActive]}>
              <View style={s.cardLeft}>
                <View style={s.cardTitleRow}>
                  <Text style={s.cardName}>{item.name}</Text>
                  {isActive && <View style={s.activeBadge}><Text style={s.activeBadgeText}>Active</Text></View>}
                </View>
                {item.subject ? <Text style={s.cardSub}>{item.subject}</Text> : null}
                {item.teacher_name ? <Text style={s.cardMeta}>{item.teacher_name}</Text> : null}
                {item.school_name ? <Text style={s.cardMeta}>{item.school_name}</Text> : null}
              </View>
              <TouchableOpacity onPress={() => handleLeave(item)} style={s.leaveBtn}>
                <Text style={s.leaveBtnText}>Leave</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      {/* ── Join modal ── */}
      <Modal visible={joinModal} animationType="slide" transparent onRequestClose={() => setJoinModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={m.overlay}>
            <View style={[m.sheet, { maxHeight: '85%' }]}>
              <View style={m.header}>
                <Text style={m.title}>Join a Class</Text>
                <TouchableOpacity onPress={() => setJoinModal(false)}>
                  <Text style={m.close}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ paddingHorizontal: 20 }} contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
                {/* School search */}
                <Text style={m.label}>School</Text>
                <View style={m.searchRow}>
                  <TextInput
                    style={[m.input, { flex: 1 }]}
                    value={school}
                    onChangeText={setSchool}
                    placeholder="Type school name..."
                    autoCapitalize="words"
                    returnKeyType="search"
                    onSubmitEditing={() => searchBySchool(school)}
                  />
                  <TouchableOpacity
                    style={m.searchBtn}
                    onPress={() => searchBySchool(school)}
                    disabled={!school.trim()}
                  >
                    <Ionicons name="search" size={18} color={COLORS.white} />
                  </TouchableOpacity>
                </View>

                {/* Available classes */}
                {searchingClasses && <ActivityIndicator color={COLORS.teal500} style={{ marginTop: 16 }} />}

                {!searchingClasses && searchedSchool && availableClasses.length === 0 && (
                  <View style={m.emptySearch}>
                    <Text style={m.emptySearchTitle}>No classes found at {searchedSchool}</Text>
                    <Text style={m.emptySearchHint}>Try a different school name or ask your teacher.</Text>
                  </View>
                )}

                {availableClasses.map(cls => {
                  const teacherName = `${cls.teacher.first_name} ${cls.teacher.surname}`.trim();
                  return (
                    <View key={cls.id} style={m.classRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={m.className}>{cls.name}{cls.subject ? ` — ${cls.subject}` : ''}</Text>
                        <Text style={m.classMeta}>{teacherName} · {cls.education_level}</Text>
                      </View>
                      <TouchableOpacity
                        style={[m.joinRowBtn, joining === cls.id && { opacity: 0.5 }]}
                        onPress={() => handleJoinById(cls)}
                        disabled={joining === cls.id}
                      >
                        {joining === cls.id
                          ? <ActivityIndicator size="small" color={COLORS.white} />
                          : <Text style={m.joinRowBtnText}>Join</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  );
                })}

                {/* Join code fallback */}
                <TouchableOpacity onPress={() => setShowCodeInput(!showCodeInput)} style={{ marginTop: 20, alignItems: 'center' }}>
                  <Text style={{ color: COLORS.teal500, fontSize: 14, fontWeight: '600' }}>
                    {showCodeInput ? 'Hide code input' : 'Have a join code? →'}
                  </Text>
                </TouchableOpacity>

                {showCodeInput && (
                  <View style={{ marginTop: 12 }}>
                    <TextInput
                      style={[m.input, { fontSize: 20, fontWeight: '700', letterSpacing: 4, textAlign: 'center', borderColor: COLORS.teal500, borderWidth: 2 }]}
                      value={joinCode} onChangeText={handleCodeChange}
                      placeholder="AB12CD" autoCapitalize="characters" maxLength={6}
                    />
                    {codeLookup && <ActivityIndicator color={COLORS.teal500} style={{ marginTop: 10 }} />}
                    {codeError ? <Text style={{ color: COLORS.error, fontSize: 13, marginTop: 8, textAlign: 'center' }}>{codeError}</Text> : null}
                    {codeInfo && (
                      <TouchableOpacity style={[m.joinCodeBtn, codeJoining && { opacity: 0.5 }]} onPress={handleJoinByCode} disabled={codeJoining}>
                        {codeJoining ? <ActivityIndicator color={COLORS.white} /> : <Text style={m.joinCodeBtnText}>Join {codeInfo.name}</Text>}
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: COLORS.teal500, paddingHorizontal: 16, paddingTop: 56, paddingBottom: 18,
    flexDirection: 'row', alignItems: 'center',
  },
  backBtn: { padding: 6 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '800', color: COLORS.white, textAlign: 'center' },
  listContent: { padding: 16, paddingBottom: 40 },
  emptyFlex: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  emptyText: { fontSize: 14, color: COLORS.gray500, textAlign: 'center' },
  footer: { marginTop: 16, paddingHorizontal: 4 },
  joinBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.teal500, borderRadius: 12, paddingVertical: 14,
  },
  joinBtnText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  card: {
    backgroundColor: COLORS.white, borderRadius: 12, padding: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  cardActive: { borderColor: COLORS.teal500, borderWidth: 1.5 },
  cardLeft: { flex: 1 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  cardSub: { fontSize: 13, color: COLORS.gray500, marginTop: 2 },
  cardMeta: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  activeBadge: { backgroundColor: COLORS.teal50, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  activeBadgeText: { fontSize: 11, fontWeight: '700', color: COLORS.teal500 },
  leaveBtn: { borderWidth: 1, borderColor: '#fca5a5', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  leaveBtnText: { color: COLORS.error, fontSize: 13, fontWeight: '600' },
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  close: { fontSize: 22, color: COLORS.gray500, paddingHorizontal: 4 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.gray500, marginBottom: 8, marginTop: 16 },
  input: { borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10, padding: 12, fontSize: 15, color: COLORS.text },
  searchRow: { flexDirection: 'row', gap: 8 },
  searchBtn: { backgroundColor: COLORS.teal500, borderRadius: 10, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  emptySearch: { marginTop: 20, alignItems: 'center', padding: 16 },
  emptySearchTitle: { fontSize: 14, fontWeight: '600', color: COLORS.text, textAlign: 'center' },
  emptySearchHint: { fontSize: 13, color: COLORS.gray500, textAlign: 'center', marginTop: 4 },
  classRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.background,
  },
  className: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  classMeta: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },
  joinRowBtn: { backgroundColor: COLORS.teal500, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  joinRowBtnText: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  joinCodeBtn: { marginTop: 14, backgroundColor: COLORS.teal500, borderRadius: 12, padding: 14, alignItems: 'center' },
  joinCodeBtnText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
});
