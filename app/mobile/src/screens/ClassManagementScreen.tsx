// src/screens/ClassManagementScreen.tsx
// Student class management — view enrolled classes, leave, join new.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert,
  ActivityIndicator, RefreshControl, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import {
  getStudentClasses, leaveClass, joinClassByCode, getClassJoinInfo,
  getClassesBySchool, getSchools,
} from '../services/api';
import { COLORS } from '../constants/colors';

type ClassItem = {
  class_id: string; name: string; subject: string;
  education_level: string; teacher_name: string; school_name: string;
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
  const [joinCode, setJoinCode] = useState('');
  const [classInfo, setClassInfo] = useState<{ name: string; teacher_name?: string } | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    try {
      const res = await getStudentClasses();
      console.log('[ClassManagement] response:', JSON.stringify(res));
      if (res.classes.length > 0) {
        setClasses(res.classes);
        setActiveId(res.active_class_id);
      } else if (user?.class_id) {
        // Fallback: endpoint returned empty but user has class_id
        console.log('[ClassManagement] fallback: fetching class_id directly:', user.class_id);
        try {
          const { getClassDetail } = await import('../services/api');
          const cls = await getClassDetail(user.class_id);
          setClasses([{
            class_id: user.class_id,
            name: cls.name || 'My Class',
            subject: cls.subject || '',
            education_level: cls.education_level || '',
            teacher_name: '',
            school_name: (cls as any).school_name || '',
          }]);
          setActiveId(user.class_id);
        } catch { setClasses([]); }
      }
    } catch (err: any) {
      console.log('[ClassManagement] error:', err?.response?.data ?? err?.message);
      // Fallback on error: fetch the single class directly
      if (user?.class_id) {
        try {
          const { getClassDetail } = await import('../services/api');
          const cls = await getClassDetail(user.class_id);
          setClasses([{
            class_id: user.class_id,
            name: cls.name || 'My Class',
            subject: cls.subject || '',
            education_level: cls.education_level || '',
            teacher_name: '',
            school_name: (cls as any).school_name || '',
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

  const handleLeave = (cls: ClassItem) => {
    Alert.alert(
      `Leave ${cls.name}?`,
      'You will lose access to its assignments and results.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await leaveClass(cls.class_id);
              if (res.active_class_id && updateUser) {
                updateUser({ ...user, class_id: res.active_class_id } as any);
              }
              load(true);
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? 'Could not leave class.');
            }
          },
        },
      ],
    );
  };

  const handleCodeChange = async (text: string) => {
    const upper = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setJoinCode(upper);
    setJoinError('');
    setClassInfo(null);
    if (upper.length === 6) {
      setLookingUp(true);
      try {
        const info = await getClassJoinInfo(upper);
        setClassInfo({ name: info.name, teacher_name: info.teacher_name });
      } catch { setJoinError('Class not found.'); }
      finally { setLookingUp(false); }
    }
  };

  const handleJoin = async () => {
    if (!joinCode || joinCode.length < 4) { setJoinError('Enter a valid code.'); return; }
    setJoining(true);
    try {
      const res = await joinClassByCode(joinCode);
      if (updateUser) updateUser({ ...user, class_id: res.class_id } as any);
      Alert.alert('Joined!', res.message);
      setJoinModal(false); setJoinCode(''); setClassInfo(null);
      load(true);
    } catch (err: any) {
      setJoinError(err?.response?.data?.error ?? err?.message ?? 'Could not join.');
    } finally { setJoining(false); }
  };

  if (loading) {
    return <View style={s.centered}><ActivityIndicator size="large" color={COLORS.teal500} /></View>;
  }

  return (
    <View style={s.container}>
      {/* Header */}
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
            <Text style={s.emptyText}>Join a class using a code from your teacher.</Text>
          </View>
        )}
        ListFooterComponent={() => (
          <View style={s.footer}>
            <TouchableOpacity style={s.joinBtn} onPress={() => setJoinModal(true)}>
              <Ionicons name="add-circle-outline" size={18} color={COLORS.white} />
              <Text style={s.joinBtnText}>Join with Class Code</Text>
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
                  {isActive && (
                    <View style={s.activeBadge}><Text style={s.activeBadgeText}>Active</Text></View>
                  )}
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

      {/* Join modal */}
      <Modal visible={joinModal} animationType="slide" transparent onRequestClose={() => setJoinModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={m.overlay}>
            <View style={m.sheet}>
              <View style={m.header}>
                <Text style={m.title}>Join a Class</Text>
                <TouchableOpacity onPress={() => { setJoinModal(false); setJoinCode(''); setClassInfo(null); setJoinError(''); }}>
                  <Text style={m.close}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={m.body}>
                <Text style={m.label}>Enter the 6-character code from your teacher</Text>
                <TextInput
                  style={[m.input, { fontSize: 22, fontWeight: '700', letterSpacing: 4, textAlign: 'center', borderColor: COLORS.teal500, borderWidth: 2 }]}
                  value={joinCode} onChangeText={handleCodeChange}
                  placeholder="AB12CD" autoCapitalize="characters" maxLength={6} autoFocus
                />
                {lookingUp && <ActivityIndicator color={COLORS.teal500} style={{ marginTop: 12 }} />}
                {joinError ? <Text style={{ color: COLORS.error, fontSize: 13, marginTop: 10, textAlign: 'center' }}>{joinError}</Text> : null}
                {classInfo && (
                  <View style={{ marginTop: 14, backgroundColor: COLORS.teal50, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.teal100 }}>
                    <Text style={{ fontSize: 17, fontWeight: '700', color: COLORS.text }}>{classInfo.name}</Text>
                    {classInfo.teacher_name ? <Text style={{ fontSize: 13, color: COLORS.gray500, marginTop: 4 }}>{classInfo.teacher_name}</Text> : null}
                  </View>
                )}
                {classInfo && (
                  <TouchableOpacity style={[m.btn, joining && { opacity: 0.6 }]} onPress={handleJoin} disabled={joining}>
                    {joining ? <ActivityIndicator color={COLORS.white} /> : <Text style={m.btnText}>Join {classInfo.name}</Text>}
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: COLORS.teal500,
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 18,
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
  sheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  close: { fontSize: 22, color: COLORS.gray500, paddingHorizontal: 4 },
  body: { padding: 20 },
  label: { fontSize: 14, color: COLORS.gray500, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 10, padding: 14, fontSize: 16, color: COLORS.text },
  btn: { marginTop: 20, backgroundColor: COLORS.teal500, borderRadius: 12, padding: 16, alignItems: 'center' },
  btnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
});
