// src/screens/ClassManagementScreen.tsx
// Student class management — view enrolled classes, leave, join by school autocomplete.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert,
  ActivityIndicator, RefreshControl, Modal, TextInput, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import {
  getStudentClasses, leaveClass, joinClassByCode,
  getClassesBySchool, searchSchools,
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

  // Join modal
  const [joinModal, setJoinModal] = useState(false);
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolSuggestions, setSchoolSuggestions] = useState<string[]>([]);
  const [selectedSchool, setSelectedSchool] = useState('');
  const [availableClasses, setAvailableClasses] = useState<AvailableClass[]>([]);
  const [searchingClasses, setSearchingClasses] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const schoolTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setClasses([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.class_id]);

  useEffect(() => { load(); }, []);

  // ── School autocomplete ────────────────────────────────────────────────────

  const [schoolSearching, setSchoolSearching] = useState(false);

  const onSchoolTextChange = (text: string) => {
    setSchoolQuery(text);
    setSelectedSchool('');
    setAvailableClasses([]);
    if (schoolTimerRef.current) clearTimeout(schoolTimerRef.current);
    if (text.trim().length < 2) { setSchoolSuggestions([]); return; }
    schoolTimerRef.current = setTimeout(async () => {
      setSchoolSearching(true);
      try {
        console.log('[ClassMgmt] searching schools for:', text.trim());
        let results = await searchSchools(text.trim());
        console.log('[ClassMgmt] school results:', results);
        // Fallback: if no API results but student's own school matches, show it
        if (results.length === 0 && user) {
          const userSchool = (user as any).school || (user as any).school_name || '';
          if (userSchool && text.trim().toLowerCase().split(' ').some((w: string) => userSchool.toLowerCase().includes(w))) {
            results = [userSchool];
          }
        }
        setSchoolSuggestions(results);
      } catch (err) {
        console.warn('[ClassMgmt] school search error:', err);
        setSchoolSuggestions([]);
      } finally { setSchoolSearching(false); }
    }, 300);
  };

  const onSchoolSelected = async (schoolName: string) => {
    setSchoolQuery(schoolName);
    setSelectedSchool(schoolName);
    setSchoolSuggestions([]);
    setSearchingClasses(true);
    try {
      const data = await getClassesBySchool(schoolName, '');
      console.log('[ClassMgmt] classes at', schoolName, ':', data?.length ?? 0);
      const enrolledIds = new Set(classes.map(c => c.class_id));
      const unenrolled = (data || []).filter((c: any) => !enrolledIds.has(c.id));
      const alreadyEnrolledCount = (data || []).length - unenrolled.length;
      setAvailableClasses(unenrolled);
      if (unenrolled.length === 0 && alreadyEnrolledCount > 0) {
        Alert.alert('Already enrolled', `You're already in all ${alreadyEnrolledCount} class${alreadyEnrolledCount > 1 ? 'es' : ''} at ${schoolName}.`);
      }
    } catch (err) {
      console.warn('[ClassMgmt] classes fetch error:', err);
      setAvailableClasses([]);
    } finally { setSearchingClasses(false); }
  };

  // ── Join ────────────────────────────────────────────────────────────────────

  const handleJoinById = async (cls: AvailableClass) => {
    const teacherName = `${cls.teacher.first_name} ${cls.teacher.surname}`.trim();
    Alert.alert(
      `Join ${cls.name}?`,
      `Teacher: ${teacherName}${selectedSchool ? `\nSchool: ${selectedSchool}` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Join',
          onPress: async () => {
            setJoining(cls.id);
            try {
              const res = await joinClassByCode(cls.id);
              if (updateUser) updateUser({ ...user, class_id: res.class_id } as any);
              Alert.alert('Joined!', `Joined ${cls.name} successfully!`);
              setJoinModal(false);
              load(true);
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? 'Could not join class.');
            } finally { setJoining(null); }
          },
        },
      ],
    );
  };

  // ── Leave ──────────────────────────────────────────────────────────────────

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

  const resetJoinModal = () => {
    setJoinModal(false); setSchoolQuery(''); setSelectedSchool('');
    setSchoolSuggestions([]); setAvailableClasses([]);
  };

  const openJoinModal = () => {
    const userSchool = classes[0]?.school_name || (user as any)?.school_name || '';
    setSchoolQuery(userSchool);
    setSelectedSchool('');
    setAvailableClasses([]);
    setSchoolSuggestions([]);
    setJoinModal(true);
    if (userSchool) onSchoolSelected(userSchool);
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

      {/* ── Join modal — school autocomplete ── */}
      <Modal visible={joinModal} animationType="slide" transparent onRequestClose={resetJoinModal}>
        <TouchableOpacity activeOpacity={1} onPress={resetJoinModal} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}
          keyboardVerticalOffset={0}
        >
            <View style={[m.sheet, { maxHeight: '80%' }]}>
              <View style={m.header}>
                <Text style={m.title}>Join a Class</Text>
                <TouchableOpacity onPress={resetJoinModal}>
                  <Text style={m.close}>✕</Text>
                </TouchableOpacity>
              </View>

              <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                <Text style={m.label}>School</Text>
                <TextInput
                  style={m.input}
                  value={schoolQuery}
                  onChangeText={onSchoolTextChange}
                  placeholder="Start typing school name…"
                  autoCapitalize="words"
                  autoFocus
                />

                {/* School suggestions — inline list, not absolute dropdown */}
                {schoolSuggestions.length > 0 && (
                  <ScrollView
                    style={{ maxHeight: 160, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, marginTop: 4, backgroundColor: COLORS.white }}
                    keyboardShouldPersistTaps="always"
                    nestedScrollEnabled
                  >
                    {schoolSuggestions.map(name => (
                      <TouchableOpacity key={name} onPress={() => onSchoolSelected(name)} style={m.dropdownItem}>
                        <Ionicons name="school-outline" size={16} color={COLORS.teal500} />
                        <Text style={m.dropdownText}>{name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                {schoolSearching && <ActivityIndicator color={COLORS.teal500} size="small" style={{ marginTop: 8 }} />}
                {!schoolSearching && schoolQuery.length >= 3 && schoolSuggestions.length === 0 && !selectedSchool && (
                  <Text style={m.hint}>No schools found for "{schoolQuery}". Try a shorter term.</Text>
                )}

                {searchingClasses && <ActivityIndicator color={COLORS.teal500} style={{ marginTop: 16 }} />}

                {selectedSchool && !searchingClasses && availableClasses.length === 0 && (
                  <View style={m.emptySearch}>
                    <Ionicons name="checkmark-circle" size={28} color={COLORS.teal500} style={{ marginBottom: 8 }} />
                    <Text style={m.emptySearchTitle}>No new classes available</Text>
                    <Text style={m.emptySearchHint}>You're already enrolled in all classes at {selectedSchool}, or the teacher hasn't created any yet.</Text>
                  </View>
                )}

                {availableClasses.length > 0 && (
                  <>
                    <Text style={[m.label, { marginTop: 16 }]}>{selectedSchool}</Text>
                    <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="always" nestedScrollEnabled>
                      {availableClasses.map(cls => {
                        const teacherName = `${cls.teacher.first_name} ${cls.teacher.surname}`.trim();
                        return (
                          <View key={cls.id} style={m.classRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={m.className}>{cls.name}{cls.subject ? ` — ${cls.subject}` : ''}</Text>
                              <Text style={m.classMeta}>{teacherName}</Text>
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
                    </ScrollView>
                  </>
                )}
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
  label: { fontSize: 13, fontWeight: '700', color: COLORS.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 16 },
  input: { borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10, padding: 12, fontSize: 15, color: COLORS.text },
  dropdown: {
    position: 'absolute', top: 50, left: 0, right: 0,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 8, elevation: 5, zIndex: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8,
  },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: COLORS.background },
  dropdownText: { fontSize: 14, color: COLORS.text },
  hint: { color: COLORS.gray500, fontSize: 12, marginTop: 6 },
  emptySearch: { marginTop: 20, alignItems: 'center', padding: 16 },
  emptySearchTitle: { fontSize: 14, fontWeight: '600', color: COLORS.text, textAlign: 'center' },
  emptySearchHint: { fontSize: 13, color: COLORS.gray500, textAlign: 'center', marginTop: 4 },
  classRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.background },
  className: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  classMeta: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },
  joinRowBtn: { backgroundColor: COLORS.teal500, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  joinRowBtnText: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
});
