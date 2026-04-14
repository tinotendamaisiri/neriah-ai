// src/screens/TeacherAssistantScreen.tsx
// AI Teaching Assistant — wired to POST /api/teacher/assistant.
// Curriculum/level-aware, AsyncStorage history, structured-output cards, export flow.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  AssistantActionType,
  AssistantChatMessage,
  AssistantResponse,
  listClasses,
  teacherAssistantChat,
  teacherAssistantExport,
} from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Class, RootStackParamList } from '../types';

// ── Neriah brand palette ───────────────────────────────────────────────────────
const AI = {
  bg:        '#FAFAFA',   // page background (same as rest of app)
  card:      '#FFFFFF',   // white cards and AI bubbles
  user:      '#0D7377',   // teal user message bubbles
  userText:  '#FFFFFF',   // white text on teal user bubbles
  border:    '#E8E8E8',   // light gray borders
  purple:    '#0D7377',   // teal (avatar, send button)
  purpleLt:  '#0D7377',   // teal accents
  text:      '#2C2C2A',   // dark gray text
  sub:       '#6B7280',   // medium gray subtext
  inputBg:   '#FFFFFF',   // white input background
  chip:      '#E8F4F4',   // light teal chip background
  chipText:  '#0D7377',   // teal chip text
  teal:      '#0D7377',   // Neriah teal
  tealDark:  '#0F766E',   // darker teal
  headerBg:  '#0D7377',   // teal header
  exportCard:'#F0FDFA',   // light teal structured card
  exportBdr: '#CCEDEC',   // light teal card border
} as const;

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ── Action type mapping ────────────────────────────────────────────────────────

const QUICK_ACTIONS: Array<{ label: string; action: AssistantActionType }> = [
  { label: 'Create Homework',            action: 'create_homework' },
  { label: 'Create a Quiz',              action: 'create_quiz' },
  { label: 'Prepare Notes',             action: 'prepare_notes' },
  { label: 'How is my class performing?', action: 'class_performance' },
  { label: 'Suggest teaching methods',  action: 'teaching_methods' },
  { label: 'Generate exam questions',   action: 'exam_questions' },
];

const EXPORTABLE_ACTIONS: ReadonlySet<AssistantActionType> = new Set([
  'create_homework',
  'create_quiz',
]);

// ── Curriculum / Level data ────────────────────────────────────────────────────

const CURRICULUMS = ['ZIMSEC', 'Cambridge', 'IB', 'National Curriculum'] as const;

const ALL_LEVELS = 'All Levels';

const CURRICULUM_LEVELS: Record<string, string[]> = {
  ZIMSEC: [
    ALL_LEVELS,
    'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7',
    'Form 1', 'Form 2', 'Form 3', 'Form 4',
    'Form 5 (A-Level)', 'Form 6 (A-Level)', 'College/University',
  ],
  Cambridge: [
    ALL_LEVELS,
    'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6',
    'Year 7', 'Year 8', 'Year 9 (Lower Secondary)',
    'IGCSE (Year 10)', 'IGCSE (Year 11)',
    'A-Level (Year 12)', 'A-Level (Year 13)',
  ],
  IB:  [ALL_LEVELS, 'Primary Years (PYP)', 'Middle Years (MYP)', 'Diploma Programme (DP)'],
  'National Curriculum': [ALL_LEVELS, 'KS1', 'KS2', 'KS3', 'GCSE', 'A-Level'],
};

const DEFAULT_LEVEL: Record<string, string> = {
  ZIMSEC:               'Form 3',
  Cambridge:            'IGCSE (Year 10)',
  IB:                   'Middle Years (MYP)',
  'National Curriculum': 'GCSE',
};

// ── History helpers ───────────────────────────────────────────────────────────

const historyKey = (userId: string) => `teacher_assistant_history_${userId}`;
const MAX_HISTORY = 10; // messages kept in AsyncStorage

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id:          string;
  role:        'user' | 'assistant';
  content:     string;
  actionType?: AssistantActionType;
  structured?: Record<string, unknown>;
  exportable?: boolean;
  timestamp:   number;
}

// ── Structured output card helpers ────────────────────────────────────────────

function cardIcon(action: AssistantActionType): string {
  switch (action) {
    case 'create_homework':  return 'document-text-outline';
    case 'create_quiz':      return 'checkbox-outline';
    case 'prepare_notes':    return 'book-outline';
    case 'exam_questions':   return 'ribbon-outline';
    case 'class_performance':return 'bar-chart-outline';
    default:                 return 'bulb-outline';
  }
}

function cardLabel(action: AssistantActionType): string {
  switch (action) {
    case 'create_homework':  return 'Homework';
    case 'create_quiz':      return 'Quiz';
    case 'prepare_notes':    return 'Lesson Notes';
    case 'exam_questions':   return 'Exam Questions';
    case 'class_performance':return 'Class Performance';
    default:                 return 'Content';
  }
}

function previewLines(structured: Record<string, unknown>, action: AssistantActionType): string {
  const questions = (structured.questions as unknown[]) ?? [];
  const sections  = (structured.sections  as unknown[]) ?? [];

  if (questions.length > 0) {
    const preview = questions.slice(0, 2).map((q: any, i) =>
      `${q.number ?? i + 1}. ${String(q.question ?? '').slice(0, 50)}${(q.question?.length ?? 0) > 50 ? '…' : ''}`
    );
    return preview.join('\n') + (questions.length > 2 ? `\n+${questions.length - 2} more` : '');
  }
  if (sections.length > 0) {
    const s = sections[0] as any;
    return `${s.heading ?? 'Section 1'}` + (sections.length > 1 ? ` • +${sections.length - 1} more` : '');
  }
  if (action === 'class_performance') {
    const s = structured as any;
    return `${s.summary?.slice(0, 80) ?? 'Class analysis ready'}`;
  }
  return String(structured.title ?? cardLabel(action));
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface ToastProps { message: string; visible: boolean }
function Toast({ message, visible }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(2400),
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, opacity]);
  if (!visible) return null;
  return (
    <Animated.View style={[s.toast, { opacity }]}>
      <Ionicons name="checkmark-circle" size={16} color={AI.tealDark} />
      <Text style={s.toastTxt}>{message}</Text>
    </Animated.View>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator() {
  const dots = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];
  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, { toValue: -4, duration: 280, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0,  duration: 280, useNativeDriver: true }),
          Animated.delay(500 - i * 150),
        ]),
      ),
    );
    anims.forEach(a => a.start());
    return () => anims.forEach(a => a.stop());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={s.rowLeft}>
      <View style={s.avatar}>
        <Ionicons name="sparkles" size={12} color={AI.userText} />
      </View>
      <View style={s.bubbleLeft}>
        <View style={s.typingRow}>
          {dots.map((dot, i) => (
            <Animated.View key={i} style={[s.dot, { transform: [{ translateY: dot }] }]} />
          ))}
        </View>
      </View>
    </View>
  );
}

// ── Class picker modal ────────────────────────────────────────────────────────

interface ClassPickerProps {
  visible:   boolean;
  classes:   Class[];
  onSelect:  (cls: Class) => void;
  onDismiss: () => void;
}
function ClassPicker({ visible, classes, onSelect, onDismiss }: ClassPickerProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={onDismiss}>
        <View style={s.modalSheet}>
          <Text style={s.modalTitle}>Export to which class?</Text>
          {classes.map(cls => (
            <TouchableOpacity
              key={cls.id}
              style={s.classRow}
              onPress={() => onSelect(cls)}
            >
              <Ionicons name="people-outline" size={18} color={AI.teal} style={{ marginRight: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={s.classRowName}>{cls.name}</Text>
                <Text style={s.classRowLevel}>{cls.education_level}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={AI.teal} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={s.cancelBtn} onPress={onDismiss}>
            <Text style={s.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function TeacherAssistantScreen() {
  const { user }  = useAuth();
  const navigation = useNavigation<Nav>();

  const [curriculum, setCurriculum]       = useState('ZIMSEC');
  const [level, setLevel]                 = useState('Form 3');
  const [showCurrDrop, setShowCurrDrop]   = useState(false);
  const [showLvlDrop, setShowLvlDrop]     = useState(false);
  const [messages, setMessages]           = useState<ChatMessage[]>([]);
  const [input, setInput]                 = useState('');
  const [typing, setTyping]               = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);

  // Export state
  const [classes, setClasses]             = useState<Class[]>([]);
  const [exportMsg, setExportMsg]         = useState<ChatMessage | null>(null);
  const [showClassPicker, setShowClassPicker] = useState(false);
  const [exporting, setExporting]         = useState(false);
  const [toastMsg, setToastMsg]           = useState('');
  const [toastVisible, setToastVisible]   = useState(false);

  const flatRef   = useRef<FlatList<ChatMessage>>(null);
  const userId    = user?.id ?? 'unknown';

  // ── Load history on mount ─────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(historyKey(userId)).then(raw => {
      if (!raw) return;
      try {
        const saved: ChatMessage[] = JSON.parse(raw);
        setMessages(saved);
      } catch {}
    });
  }, [userId]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 120);
    }
  }, [messages, typing]);

  // ── Load classes (for export picker) ─────────────────────────────────────
  useEffect(() => {
    listClasses().then(setClasses).catch(() => {});
  }, []);

  // ── Persist history ───────────────────────────────────────────────────────
  const persistHistory = useCallback((msgs: ChatMessage[]) => {
    AsyncStorage.setItem(historyKey(userId), JSON.stringify(msgs)).catch(() => {});
  }, [userId]);

  // ── Clear history ─────────────────────────────────────────────────────────
  const clearHistory = useCallback(() => {
    setMessages([]);
    setConversationId(undefined);
    AsyncStorage.removeItem(historyKey(userId)).catch(() => {});
  }, [userId]);

  // ── Close dropdowns ───────────────────────────────────────────────────────
  const closeDrops = () => { setShowCurrDrop(false); setShowLvlDrop(false); };

  // ── Show toast ────────────────────────────────────────────────────────────
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 3000);
  };

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (
    text: string,
    forcedActionType?: AssistantActionType,
    classId?: string,
  ) => {
    if (!text.trim() || typing) return;
    closeDrops();

    const userMsg: ChatMessage = {
      id: String(Date.now()),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };
    const updatedWithUser = [...messages, userMsg];
    setMessages(updatedWithUser);
    setInput('');
    setTyping(true);

    // Build chat_history for API (last MAX_HISTORY messages, assistant turns only)
    const apiHistory: AssistantChatMessage[] = updatedWithUser
      .slice(-MAX_HISTORY)
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const res: AssistantResponse = await teacherAssistantChat({
        message:          text.trim(),
        action_type:      forcedActionType,
        curriculum,
        level:            level === ALL_LEVELS ? undefined : level,
        class_id:         classId,
        chat_history:     apiHistory,
        conversation_id:  conversationId,
      });

      if (res.conversation_id && !conversationId) {
        setConversationId(res.conversation_id);
      }

      const aiMsg: ChatMessage = {
        id:          String(Date.now() + 1),
        role:        'assistant',
        content:     res.response ?? '',
        actionType:  res.action_type,
        structured:  res.structured,
        exportable:  res.exportable,
        timestamp:   Date.now(),
      };
      const updated = [...updatedWithUser, aiMsg];
      setMessages(updated);
      persistHistory(updated);
    } catch (err: any) {
      const aiMsg: ChatMessage = {
        id:        String(Date.now() + 1),
        role:      'assistant',
        content:   err?.message ?? 'Something went wrong. Please try again.',
        timestamp: Date.now(),
      };
      const updated = [...updatedWithUser, aiMsg];
      setMessages(updated);
      persistHistory(updated);
    } finally {
      setTyping(false);
    }
  }, [typing, messages, curriculum, level, conversationId, persistHistory]);

  // ── Export flow ───────────────────────────────────────────────────────────
  const handleExport = useCallback((msg: ChatMessage) => {
    if (classes.length === 0) {
      showToast('No classes found. Create a class first.');
      return;
    }
    if (classes.length === 1) {
      doExport(msg, classes[0]);
      return;
    }
    setExportMsg(msg);
    setShowClassPicker(true);
  }, [classes]); // eslint-disable-line react-hooks/exhaustive-deps

  const doExport = useCallback(async (msg: ChatMessage, cls: Class) => {
    if (!msg.structured || !msg.actionType) return;
    setShowClassPicker(false);
    setExporting(true);
    try {
      const contentType = msg.actionType === 'create_quiz' ? 'quiz' : 'homework';
      const result = await teacherAssistantExport({
        content_type: contentType,
        content:      msg.structured,
        class_id:     cls.id,
        title:        (msg.structured.title as string | undefined) ?? undefined,
      });
      showToast(`${contentType === 'quiz' ? 'Quiz' : 'Homework'} added to ${cls.name} as draft — review before opening`);
      setTimeout(() => {
        navigation.navigate('HomeworkCreated', {
          answer_key_id: result.answer_key_id,
          class_id:      cls.id,
          class_name:    cls.name,
        });
      }, 1200);
    } catch {
      showToast('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [navigation]);

  const levels = CURRICULUM_LEVELS[curriculum] ?? CURRICULUM_LEVELS.ZIMSEC;

  // ── Message renderer ──────────────────────────────────────────────────────
  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';

    return (
      <View style={isUser ? s.rowRight : s.rowLeft}>
        {!isUser && (
          <View style={s.avatar}>
            <Ionicons name="sparkles" size={12} color={AI.userText} />
          </View>
        )}
        <View style={{ maxWidth: '80%' }}>
          {/* Text bubble */}
          {!!item.content && (
            <View style={isUser ? s.bubbleRight : s.bubbleLeft}>
              <Text style={isUser ? s.msgTextUser : s.msgText}>{item.content}</Text>
            </View>
          )}

          {/* Structured output card */}
          {item.structured && item.actionType && (
            <View style={s.structuredCard}>
              {/* Card header */}
              <View style={s.cardHeader}>
                <Ionicons name={cardIcon(item.actionType) as any} size={16} color={AI.teal} />
                <Text style={s.cardType}>{cardLabel(item.actionType)}</Text>
                {item.structured.total_marks != null && (
                  <View style={s.marksBadge}>
                    <Text style={s.marksBadgeTxt}>
                      {String(item.structured.total_marks)} marks
                    </Text>
                  </View>
                )}
              </View>

              {/* Title */}
              {item.structured.title != null && (
                <Text style={s.cardTitle}>{String(item.structured.title)}</Text>
              )}

              {/* Preview of first 2 questions / first section */}
              <Text style={s.cardPreview}>
                {previewLines(item.structured, item.actionType)}
              </Text>

              {/* Export buttons */}
              {item.exportable && EXPORTABLE_ACTIONS.has(item.actionType) && (
                <View style={s.exportRow}>
                  <TouchableOpacity
                    style={s.exportBtn}
                    onPress={() => handleExport(item)}
                    disabled={exporting}
                  >
                    {exporting ? (
                      <ActivityIndicator size="small" color={AI.text} />
                    ) : (
                      <>
                        <Ionicons name="cloud-upload-outline" size={14} color={AI.text} />
                        <Text style={s.exportBtnTxt}>Export to Class</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.editBtn}
                    onPress={() => sendMessage(`Edit the ${cardLabel(item.actionType).toLowerCase()} — `, item.actionType)}
                  >
                    <Text style={s.editBtnTxt}>Edit first</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    );
  }, [exporting, handleExport, sendMessage]);

  return (
    <View style={s.screen}>
      <StatusBar barStyle="light-content" backgroundColor={AI.headerBg} />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Dropdown backdrop */}
          {(showCurrDrop || showLvlDrop) && (
            <TouchableOpacity
              style={StyleSheet.absoluteFillObject}
              onPress={closeDrops}
              activeOpacity={1}
            />
          )}

          {/* ── Header ── */}
          <View style={s.header}>
            <TouchableOpacity style={s.hBtn} onPress={closeDrops}>
              <Ionicons name="menu-outline" size={24} color={AI.userText} />
            </TouchableOpacity>
            <Text style={s.hTitle}>Neriah AI</Text>
            <TouchableOpacity style={s.hBtn} onPress={clearHistory}>
              <Ionicons name="create-outline" size={22} color={AI.userText} />
            </TouchableOpacity>
          </View>

          {/* ── Context pills ── */}
          <View style={s.pillRow}>
            {/* Curriculum */}
            <View>
              <TouchableOpacity
                style={s.pill}
                onPress={() => { setShowLvlDrop(false); setShowCurrDrop(v => !v); }}
              >
                <Text style={s.pillTxt}>{curriculum}</Text>
                <Ionicons name={showCurrDrop ? 'chevron-up' : 'chevron-down'} size={12} color={AI.teal} />
              </TouchableOpacity>
              {showCurrDrop && (
                <View style={[s.dropdown, { zIndex: 200 }]}>
                  {CURRICULUMS.map(c => (
                    <TouchableOpacity
                      key={c}
                      style={[s.dropItem, c === curriculum && s.dropActive]}
                      onPress={() => {
                        setCurriculum(c);
                        setLevel(DEFAULT_LEVEL[c] ?? CURRICULUM_LEVELS[c][0]);
                        setShowCurrDrop(false);
                      }}
                    >
                      <Text style={[s.dropTxt, c === curriculum && s.dropActiveTxt]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Level */}
            <View>
              <TouchableOpacity
                style={s.pill}
                onPress={() => { setShowCurrDrop(false); setShowLvlDrop(v => !v); }}
              >
                <Text style={s.pillTxt}>{level}</Text>
                <Ionicons name={showLvlDrop ? 'chevron-up' : 'chevron-down'} size={12} color={AI.teal} />
              </TouchableOpacity>
              {showLvlDrop && (
                <View style={[s.dropdown, { maxHeight: 220, zIndex: 200 }]}>
                  <ScrollView bounces={false}>
                    {levels.map(l => (
                      <TouchableOpacity
                        key={l}
                        style={[s.dropItem, l === level && s.dropActive]}
                        onPress={() => { setLevel(l); setShowLvlDrop(false); }}
                      >
                        <Text style={[s.dropTxt, l === level && s.dropActiveTxt]}>{l}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>

          {/* ── Chat or empty state ── */}
          {messages.length === 0 && !typing ? (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={s.emptyCont}
              keyboardShouldPersistTaps="handled"
            >
              <View style={s.emptyIcon}>
                <Ionicons name="sparkles" size={34} color={AI.teal} />
              </View>
              <Text style={s.emptyTitle}>Neriah AI</Text>
              <Text style={s.emptySub}>Your AI teaching assistant</Text>
              <View style={s.quickGrid}>
                {QUICK_ACTIONS.map(({ label, action }) => (
                  <TouchableOpacity
                    key={label}
                    style={s.quickPill}
                    onPress={() => sendMessage(label, action)}
                  >
                    <Ionicons name={cardIcon(action) as any} size={16} color={AI.teal} style={{ marginRight: 8 }} />
                    <Text style={s.quickTxt}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          ) : (
            <FlatList
              ref={flatRef}
              data={messages}
              keyExtractor={m => m.id}
              renderItem={renderMessage}
              contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              removeClippedSubviews
              ListFooterComponent={typing ? <TypingIndicator /> : null}
            />
          )}

          {/* ── Input bar ── */}
          <View style={s.inputArea}>
            <View style={s.inputRow}>
              <TouchableOpacity style={s.attachBtn}>
                <Ionicons name="attach-outline" size={20} color={AI.teal} />
              </TouchableOpacity>
              <TextInput
                style={s.input}
                value={input}
                onChangeText={setInput}
                placeholder="Message Neriah AI..."
                placeholderTextColor={AI.sub}
                multiline
                maxLength={2000}
              />
              <TouchableOpacity
                style={[s.sendBtn, (!input.trim() || typing) && s.sendDisabled]}
                onPress={() => {
                  // Detect action type from input keywords
                  const q = input.toLowerCase();
                  let action: AssistantActionType = 'chat';
                  if (q.includes('homework'))    action = 'create_homework';
                  else if (q.includes('quiz'))   action = 'create_quiz';
                  else if (q.includes('notes') || q.includes('prepare')) action = 'prepare_notes';
                  else if (q.includes('exam'))   action = 'exam_questions';
                  else if (q.includes('performing') || q.includes('performance')) action = 'class_performance';
                  else if (q.includes('teaching') || q.includes('method')) action = 'teaching_methods';
                  sendMessage(input, action);
                }}
                disabled={!input.trim() || typing}
              >
                <Ionicons name="arrow-up" size={18} color={AI.userText} />
              </TouchableOpacity>
            </View>
            <Text style={s.caption}>Neriah can make mistakes. Verify important info.</Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Class picker modal */}
      <ClassPicker
        visible={showClassPicker}
        classes={classes}
        onSelect={cls => {
          if (exportMsg) doExport(exportMsg, cls);
        }}
        onDismiss={() => setShowClassPicker(false)}
      />

      {/* Toast */}
      <Toast message={toastMsg} visible={toastVisible} />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AI.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: AI.headerBg,
  },
  hBtn:   { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 18, fontWeight: '700', color: AI.userText, letterSpacing: 0.3 },

  pillRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: AI.card, borderWidth: 1.5, borderColor: AI.teal,
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
  },
  pillTxt: { fontSize: 13, color: AI.teal, fontWeight: '600' },
  dropdown: {
    position: 'absolute', top: 42, left: 0,
    backgroundColor: AI.card, borderWidth: 1, borderColor: AI.border,
    borderRadius: 12, minWidth: 180, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 8,
  },
  dropItem:      { paddingHorizontal: 16, paddingVertical: 12 },
  dropActive:    { backgroundColor: '#E8F4F4' },
  dropTxt:       { fontSize: 14, color: AI.text },
  dropActiveTxt: { color: AI.teal, fontWeight: '600' },

  rowLeft:  { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14, gap: 8 },
  rowRight: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 14 },
  avatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: AI.teal, alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  bubbleLeft: {
    backgroundColor: AI.card, borderRadius: 18, borderBottomLeftRadius: 4,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: AI.border,
  },
  bubbleRight: {
    backgroundColor: AI.user, borderRadius: 18, borderBottomRightRadius: 4,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  msgText:     { fontSize: 14, color: AI.text,     lineHeight: 21 },
  msgTextUser: { fontSize: 14, color: AI.userText, lineHeight: 21 },

  // Structured card
  structuredCard: {
    backgroundColor: AI.exportCard, borderWidth: 1, borderColor: AI.exportBdr,
    borderRadius: 14, padding: 14, marginTop: 8,
  },
  cardHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  cardType:    { fontSize: 12, color: AI.teal, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 },
  marksBadge:  { backgroundColor: AI.card, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: AI.exportBdr },
  marksBadgeTxt: { fontSize: 11, color: AI.sub },
  cardTitle:   { fontSize: 14, fontWeight: '700', color: AI.text, marginBottom: 6 },
  cardPreview: { fontSize: 12, color: AI.sub, lineHeight: 18 },

  exportRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  exportBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: AI.teal, borderRadius: 10, paddingVertical: 10,
  },
  exportBtnTxt: { fontSize: 13, color: AI.userText, fontWeight: '600' },
  editBtn: {
    borderWidth: 1, borderColor: AI.border, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14,
  },
  editBtnTxt: { fontSize: 13, color: AI.sub },

  typingRow: { flexDirection: 'row', gap: 5, paddingHorizontal: 2, paddingVertical: 4 },
  dot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: AI.sub },

  emptyCont: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyIcon: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: '#E8F4F4', borderWidth: 1, borderColor: AI.teal,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: AI.text, marginBottom: 6 },
  emptySub:   { fontSize: 14, color: AI.sub, marginBottom: 32 },
  quickGrid:  { gap: 10, width: '100%' },
  quickPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: AI.card, borderWidth: 1.5, borderColor: AI.teal,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
  },
  quickTxt: { fontSize: 14, color: AI.teal, fontWeight: '500' },

  inputArea: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: AI.border,
    backgroundColor: AI.card,
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 4 : 12,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: AI.card, borderRadius: 26,
    borderWidth: 1, borderColor: AI.border,
    paddingHorizontal: 4, paddingVertical: 4,
  },
  attachBtn:   { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1, fontSize: 14, color: AI.text,
    paddingHorizontal: 4, paddingVertical: 8, maxHeight: 120,
  },
  sendBtn:      { width: 38, height: 38, borderRadius: 19, backgroundColor: AI.teal, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { backgroundColor: AI.border },
  caption:      { fontSize: 11, color: AI.sub, textAlign: 'center', marginTop: 6 },

  // Class picker modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: AI.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 32,
  },
  modalTitle:  { fontSize: 16, fontWeight: '700', color: AI.text, marginBottom: 16 },
  classRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: AI.border,
  },
  classRowName:  { fontSize: 14, fontWeight: '600', color: AI.text },
  classRowLevel: { fontSize: 12, color: AI.sub, marginTop: 2 },
  cancelBtn: { marginTop: 16, alignItems: 'center', paddingVertical: 14 },
  cancelTxt: { fontSize: 14, color: AI.sub },

  // Toast
  toast: {
    position: 'absolute', bottom: 90, left: 20, right: 20,
    backgroundColor: AI.card, borderWidth: 1, borderColor: AI.exportBdr,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    shadowColor: AI.teal, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6, elevation: 6,
  },
  toastTxt: { fontSize: 13, color: AI.text, flex: 1 },
});
