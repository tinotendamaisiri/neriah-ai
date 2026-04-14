// src/screens/TeacherAssistantScreen.tsx
// AI Teaching Assistant chat screen for teachers.
// Dark-themed, curriculum/level-aware context pickers.
// AI calls not yet wired — mock responses only.

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
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

// ── Dark palette (AI screen only — intentionally separate from COLORS) ─────────
const AI = {
  bg:         '#1A1A2E',
  card:       '#16213E',
  user:       '#1E3A5F',
  border:     '#2A2A4A',
  purple:     '#7C3AED',
  purpleLt:   '#A78BFA',
  text:       '#E8E8F0',
  sub:        '#8888AA',
  inputBg:    '#16213E',
  chip:       '#2A2A4A',
  chipText:   '#A78BFA',
} as const;

// ── Types ──────────────────────────────────────────────────────────────────────

interface RichCard {
  title:   string;
  preview: string;
}

interface ChatMessage {
  id:        string;
  role:      'user' | 'assistant';
  content:   string;
  card?:     RichCard;
  chips?:    string[];
  timestamp: number;
}

// ── Curriculum / Level data ────────────────────────────────────────────────────

const CURRICULUMS = ['ZIMSEC', 'Cambridge', 'IB', 'National Curriculum'] as const;

const CURRICULUM_LEVELS: Record<string, string[]> = {
  ZIMSEC: [
    'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7',
    'Form 1', 'Form 2', 'Form 3', 'Form 4',
    'Form 5 (A-Level)', 'Form 6 (A-Level)', 'College/University',
  ],
  Cambridge: [
    'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6',
    'Year 7', 'Year 8', 'Year 9 (Lower Secondary)',
    'IGCSE (Year 10)', 'IGCSE (Year 11)',
    'A-Level (Year 12)', 'A-Level (Year 13)',
  ],
  IB: [
    'Primary Years (PYP)', 'Middle Years (MYP)', 'Diploma Programme (DP)',
  ],
  'National Curriculum': ['KS1', 'KS2', 'KS3', 'GCSE', 'A-Level'],
};

const DEFAULT_LEVEL: Record<string, string> = {
  ZIMSEC:              'Form 3',
  Cambridge:           'IGCSE (Year 10)',
  IB:                  'Middle Years (MYP)',
  'National Curriculum': 'GCSE',
};

// ── Mock responses ─────────────────────────────────────────────────────────────

function getMockResponse(
  input: string,
  curriculum: string,
  level: string,
): { text: string; card?: RichCard; chips?: string[] } {
  const q = input.toLowerCase();

  if (q.includes('homework')) {
    return {
      text: `Here's a ${level} homework set for ${curriculum}:`,
      card: {
        title: `Homework: ${input.replace(/create|homework/gi, '').trim() || 'Mathematics'}`,
        preview: '8 questions • Mixed difficulty • Est. 45 min',
      },
      chips: ['Add more questions', 'Change difficulty', 'Share with class'],
    };
  }
  if (q.includes('quiz')) {
    return {
      text: 'Quiz ready! Review before sharing with your class:',
      card: {
        title: `Quiz: ${input.replace(/create|a|quiz/gi, '').trim() || 'Chapter Review'}`,
        preview: '10 questions • Multiple choice • 20 min',
      },
      chips: ['Make it harder', 'Add time limit', 'Preview quiz'],
    };
  }
  if (q.includes('notes') || q.includes('prepare')) {
    return {
      text: `Lesson notes prepared for ${level}:`,
      card: {
        title: `Notes: ${input.replace(/prepare|notes/gi, '').trim() || 'Topic Summary'}`,
        preview: '3 sections • Key concepts, examples, practice',
      },
      chips: ['Add diagrams', 'Simplify language', 'Print version'],
    };
  }
  if (q.includes('exam') || (q.includes('generate') && q.includes('question'))) {
    return {
      text: `Generated ${level} exam questions aligned to ${curriculum}:`,
      card: {
        title: 'Exam Questions',
        preview: '12 questions • Structured + essay sections',
      },
      chips: ['More questions', 'Mark scheme', 'Adjust difficulty'],
    };
  }
  if (q.includes('performing') || q.includes('analytics') || q.includes('class perform')) {
    return {
      text: 'Your class is performing well overall.\n\n• Average score: 74% (↑ from 68% last week)\n• Top performer: Tendai Moyo — 92%\n• 3 students below 50% need support\n• Weakest topic: Quadratic Equations',
      chips: ['Show weak areas', 'Individual reports', 'Compare to last week'],
    };
  }
  if (q.includes('teaching') || q.includes('method')) {
    return {
      text: `Evidence-based strategies for ${level} (${curriculum}):\n\n• Socratic questioning to build critical thinking\n• Peer learning pairs for struggling students\n• 5-minute entry quizzes to activate prior knowledge\n• Visual concept maps for abstract topics`,
      chips: ['More ideas', 'Subject-specific tips', 'Differentiation strategies'],
    };
  }
  return {
    text: `Hello! I'm Neriah AI, your teaching assistant for ${level} (${curriculum}).\n\nI can help you create homework, quizzes, exam questions, lesson notes, and analyse your class performance.\n\nWhat would you like to work on?`,
    chips: ['Create Homework', 'Check class performance', 'Suggest teaching methods'],
  };
}

// ── Typing indicator ───────────────────────────────────────────────────────────

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
        <Ionicons name="sparkles" size={12} color={AI.purpleLt} />
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

// ── Main screen ────────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  'Create Homework',
  'Create a Quiz',
  'Prepare Notes',
  'How is my class performing?',
  'Suggest teaching methods',
  'Generate exam questions',
];

export default function TeacherAssistantScreen() {
  const [curriculum, setCurriculum]     = useState('ZIMSEC');
  const [level, setLevel]               = useState('Form 3');
  const [showCurrDrop, setShowCurrDrop] = useState(false);
  const [showLvlDrop, setShowLvlDrop]   = useState(false);
  const [messages, setMessages]         = useState<ChatMessage[]>([]);
  const [input, setInput]               = useState('');
  const [typing, setTyping]             = useState(false);
  const flatRef = useRef<FlatList<ChatMessage>>(null);

  const closeDrops = () => { setShowCurrDrop(false); setShowLvlDrop(false); };

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  const sendMessage = (text: string) => {
    if (!text.trim() || typing) return;
    closeDrops();
    const userMsg: ChatMessage = {
      id: String(Date.now()),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setTyping(true);
    const delay = 900 + Math.random() * 500;
    setTimeout(() => {
      const r = getMockResponse(text, curriculum, level);
      setMessages(prev => [...prev, {
        id: String(Date.now() + 1),
        role: 'assistant',
        content: r.text,
        card: r.card,
        chips: r.chips,
        timestamp: Date.now(),
      }]);
      setTyping(false);
    }, delay);
  };

  const levels = CURRICULUM_LEVELS[curriculum] ?? CURRICULUM_LEVELS.ZIMSEC;

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={isUser ? s.rowRight : s.rowLeft}>
        {!isUser && (
          <View style={s.avatar}>
            <Ionicons name="sparkles" size={12} color={AI.purpleLt} />
          </View>
        )}
        <View style={{ maxWidth: '78%' }}>
          <View style={isUser ? s.bubbleRight : s.bubbleLeft}>
            <Text style={s.msgText}>{item.content}</Text>
          </View>
          {item.card && (
            <TouchableOpacity style={s.richCard} activeOpacity={0.75}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{item.card.title}</Text>
                <Text style={s.cardPreview}>{item.card.preview}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={AI.sub} />
            </TouchableOpacity>
          )}
          {!!item.chips?.length && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: 6 }}
              contentContainerStyle={{ gap: 8 }}
            >
              {item.chips.map(chip => (
                <TouchableOpacity key={chip} style={s.chip} onPress={() => sendMessage(chip)}>
                  <Text style={s.chipTxt}>{chip}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={s.screen}>
      <StatusBar barStyle="light-content" backgroundColor={AI.bg} />
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
            <TouchableOpacity style={s.hBtn}>
              <Ionicons name="menu-outline" size={24} color={AI.text} />
            </TouchableOpacity>
            <Text style={s.hTitle}>Neriah AI</Text>
            <TouchableOpacity style={s.hBtn} onPress={() => setMessages([])}>
              <Ionicons name="create-outline" size={22} color={AI.text} />
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
                <Ionicons
                  name={showCurrDrop ? 'chevron-up' : 'chevron-down'}
                  size={12} color={AI.sub}
                />
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
                <Ionicons
                  name={showLvlDrop ? 'chevron-up' : 'chevron-down'}
                  size={12} color={AI.sub}
                />
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
                <Ionicons name="sparkles" size={34} color={AI.purple} />
              </View>
              <Text style={s.emptyTitle}>Neriah AI</Text>
              <Text style={s.emptySub}>Your AI teaching assistant</Text>
              <View style={s.quickGrid}>
                {QUICK_ACTIONS.map(action => (
                  <TouchableOpacity
                    key={action}
                    style={s.quickPill}
                    onPress={() => sendMessage(action)}
                  >
                    <Text style={s.quickTxt}>{action}</Text>
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
              ListFooterComponent={typing ? <TypingIndicator /> : null}
            />
          )}

          {/* ── Input bar ── */}
          <View style={s.inputArea}>
            <View style={s.inputRow}>
              <TouchableOpacity style={s.attachBtn}>
                <Ionicons name="attach-outline" size={20} color={AI.sub} />
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
                onPress={() => sendMessage(input)}
                disabled={!input.trim() || typing}
              >
                <Ionicons name="arrow-up" size={18} color={AI.text} />
              </TouchableOpacity>
            </View>
            <Text style={s.caption}>Neriah can make mistakes. Verify important info.</Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AI.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AI.border,
  },
  hBtn:   { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 18, fontWeight: '700', color: AI.text, letterSpacing: 0.3 },

  pillRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: AI.card, borderWidth: 1, borderColor: AI.border,
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
  },
  pillTxt: { fontSize: 13, color: AI.text, fontWeight: '500' },
  dropdown: {
    position: 'absolute', top: 42, left: 0,
    backgroundColor: AI.card, borderWidth: 1, borderColor: AI.border,
    borderRadius: 12, minWidth: 180, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5, shadowRadius: 10, elevation: 12,
  },
  dropItem:      { paddingHorizontal: 16, paddingVertical: 12 },
  dropActive:    { backgroundColor: AI.border },
  dropTxt:       { fontSize: 14, color: AI.text },
  dropActiveTxt: { color: AI.purpleLt, fontWeight: '600' },

  rowLeft:  { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14, gap: 8 },
  rowRight: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 14 },
  avatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: AI.purple, alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  bubbleLeft: {
    backgroundColor: AI.card, borderRadius: 18, borderBottomLeftRadius: 4,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  bubbleRight: {
    backgroundColor: AI.user, borderRadius: 18, borderBottomRightRadius: 4,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  msgText: { fontSize: 14, color: AI.text, lineHeight: 21 },

  richCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: AI.border, borderRadius: 12,
    padding: 12, marginTop: 8, gap: 8,
  },
  cardTitle:   { fontSize: 13, fontWeight: '700', color: AI.text, marginBottom: 2 },
  cardPreview: { fontSize: 12, color: AI.sub },

  chip:    { backgroundColor: AI.chip, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipTxt: { fontSize: 12, color: AI.chipText, fontWeight: '500' },

  typingRow: { flexDirection: 'row', gap: 5, paddingHorizontal: 2, paddingVertical: 4 },
  dot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: AI.sub },

  emptyCont:  { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyIcon: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: AI.card, borderWidth: 1, borderColor: AI.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: AI.text, marginBottom: 6 },
  emptySub:   { fontSize: 14, color: AI.sub, marginBottom: 32 },
  quickGrid:  { gap: 10, width: '100%' },
  quickPill: {
    backgroundColor: AI.card, borderWidth: 1, borderColor: AI.border,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
  },
  quickTxt: { fontSize: 14, color: AI.text },

  inputArea: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: AI.border,
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 4 : 12,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: AI.inputBg, borderRadius: 26,
    borderWidth: 1, borderColor: AI.border,
    paddingHorizontal: 4, paddingVertical: 4,
  },
  attachBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1, fontSize: 14, color: AI.text,
    paddingHorizontal: 4, paddingVertical: 8, maxHeight: 120,
  },
  sendBtn:     { width: 38, height: 38, borderRadius: 19, backgroundColor: AI.purple, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { backgroundColor: AI.border },
  caption: { fontSize: 11, color: AI.sub, textAlign: 'center', marginTop: 6 },
});
