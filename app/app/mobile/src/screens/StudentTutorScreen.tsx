// src/screens/StudentTutorScreen.tsx
// Socratic AI tutor chat. Neriah guides students to understand homework — never gives answers.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { useAuth } from '../context/AuthContext';
import { tutorChat } from '../services/api';
import { COLORS } from '../constants/colors';
import { useNetworkStatus } from '../services/syncManager';
import {
  isNativeModuleAvailable,
  isModelAvailable,
  loadModel,
  generateResponse as liteRTGenerate,
  getLiteRTState,
  subscribeToLiteRT,
  buildTutorPrompt,
} from '../services/litert';
import { getDeviceCapabilities } from '../services/deviceCapabilities';

// ── Types ─────────────────────────────────────────────────────────────────────

type MsgRole = 'user' | 'assistant' | 'error';

interface TutorMessage {
  id: string;
  role: MsgRole;
  content: string;
  timestamp: string; // ISO — serializable for AsyncStorage
  imageUri?: string;
}

type DisplayItem = TutorMessage | { id: '__typing__'; role: 'typing' };

// ── AsyncStorage helpers ──────────────────────────────────────────────────────

const convKey = (userId: string) => `neriah_tutor_conv_${userId}`;

// Other screens can write this key to pre-fill the tutor with a question.
export const TUTOR_PENDING_MSG_KEY = 'neriah_tutor_pending_msg';

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingBubble() {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const makeLoop = (anim: Animated.Value) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: 380, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0.3, duration: 380, useNativeDriver: true }),
        ]),
      );
    const a1 = makeLoop(dot1);
    const a2 = makeLoop(dot2);
    const a3 = makeLoop(dot3);
    a1.start();
    const t2 = setTimeout(() => a2.start(), 155);
    const t3 = setTimeout(() => a3.start(), 310);
    return () => { a1.stop(); a2.stop(); a3.stop(); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  return (
    <View style={st.tutorRow}>
      <View style={st.avatar}><Text style={st.avatarLetter}>N</Text></View>
      <View style={[st.bubble, st.tutorBubble, st.typingBubble]}>
        <View style={st.dotsRow}>
          <Animated.View style={[st.dot, { opacity: dot1 }]} />
          <Animated.View style={[st.dot, { opacity: dot2 }]} />
          <Animated.View style={[st.dot, { opacity: dot3 }]} />
        </View>
      </View>
    </View>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────

const MessageBubble = React.memo(({ msg }: { msg: TutorMessage }) => {
  const isUser = msg.role === 'user';
  const isError = msg.role === 'error';

  const time = useMemo(() => {
    try {
      return new Date(msg.timestamp).toLocaleTimeString(undefined, {
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return ''; }
  }, [msg.timestamp]);

  if (isUser) {
    return (
      <View style={st.userRow}>
        <View style={st.userStack}>
          {msg.imageUri ? (
            <Image source={{ uri: msg.imageUri }} style={st.msgImage} resizeMode="cover" />
          ) : null}
          {msg.content ? (
            <View style={[st.bubble, st.userBubble]}>
              <Text style={st.userText}>{msg.content}</Text>
            </View>
          ) : null}
          <Text style={st.timestamp}>{time}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={st.tutorRow}>
      <View style={st.avatar}><Text style={st.avatarLetter}>N</Text></View>
      <View style={st.tutorStack}>
        <View style={[st.bubble, isError ? st.errorBubble : st.tutorBubble]}>
          <Text style={isError ? st.errorText : st.tutorText}>{msg.content}</Text>
        </View>
        <Text style={st.timestamp}>{time}</Text>
      </View>
    </View>
  );
});

// ── Welcome screen ─────────────────────────────────────────────────────────────

const CHIPS = [
  { label: 'Help me with maths', icon: undefined },
  { label: 'Explain this question', icon: 'camera-outline' as const },
  { label: "I'm stuck on my homework", icon: undefined },
];

function WelcomeView({ onChip }: { onChip: (text: string) => void }) {
  return (
    <View style={st.welcome}>
      <View style={st.welcomeAvatar}>
        <Text style={st.welcomeAvatarText}>N</Text>
      </View>
      <Text style={st.welcomeTitle}>Hi! I'm Neriah, your study companion.</Text>
      <Text style={st.welcomeBody}>
        Ask me about any homework question and I'll help you understand the concept.
      </Text>
      <Text style={st.welcomeNote}>
        I won't give you the answer — but I'll guide you to figure it out yourself!
      </Text>
      <View style={st.chipsRow}>
        {CHIPS.map(chip => (
          <TouchableOpacity key={chip.label} style={st.chip} onPress={() => onChip(chip.label)}>
            {chip.icon ? (
              <Ionicons name={chip.icon} size={13} color={COLORS.teal500} style={{ marginRight: 4 }} />
            ) : null}
            <Text style={st.chipText}>{chip.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function StudentTutorScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();

  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [pendingImageUri, setPendingImageUri] = useState<string | null>(null);
  const [pendingImageBase64, setPendingImageBase64] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // ── On-device AI state ────────────────────────────────────────────────────

  const [onDeviceReady, setOnDeviceReady] = useState(false);
  const [onDeviceLoading, setOnDeviceLoading] = useState(false);

  // Mirror LiteRT singleton state so we re-render when it changes
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const unsub = subscribeToLiteRT(() => {
      const s = getLiteRTState();
      setOnDeviceReady(s.loadedModel === 'e2b');
      setOnDeviceLoading(s.isLoading);
      forceUpdate(n => n + 1);
    });
    return unsub;
  }, []);

  // On mount: check device capability and model availability, then load E2B
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isNativeModuleAvailable()) return;
      const caps = await getDeviceCapabilities();
      if (!caps.canRunE2B || cancelled) return;
      const available = await isModelAvailable('e2b');
      if (!available || cancelled) return;
      try {
        setOnDeviceLoading(true);
        await loadModel('e2b');
        if (!cancelled) setOnDeviceReady(true);
      } catch {
        // Model failed to load — fall back to cloud silently
      } finally {
        if (!cancelled) setOnDeviceLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const storageKey = user ? convKey(user.id) : null;
  const { isOnline } = useNetworkStatus();

  // ── Load persisted conversation on mount ───────────────────────────────────

  useEffect(() => {
    if (!storageKey) return;
    AsyncStorage.getItem(storageKey).then(raw => {
      if (!raw) return;
      try {
        const stored = JSON.parse(raw) as { conversationId: string | null; messages: TutorMessage[] };
        if (stored.conversationId) setConversationId(stored.conversationId);
        if (Array.isArray(stored.messages)) setMessages(stored.messages);
      } catch { /* corrupt — ignore */ }
    }).catch(() => {});
  }, [storageKey]);

  // ── Read pending message from other screens ───────────────────────────────

  useEffect(() => {
    AsyncStorage.getItem(TUTOR_PENDING_MSG_KEY).then(async msg => {
      if (!msg) return;
      await AsyncStorage.removeItem(TUTOR_PENDING_MSG_KEY).catch(() => {});
      setInputText(msg);
    }).catch(() => {});
  }, []);

  // ── Persist to AsyncStorage after every change ────────────────────────────

  const persist = useCallback((msgs: TutorMessage[], convId: string | null) => {
    if (!storageKey) return;
    AsyncStorage.setItem(storageKey, JSON.stringify({ conversationId: convId, messages: msgs })).catch(() => {});
  }, [storageKey]);

  // ── FlatList data (inverted — newest at index 0 = visual bottom) ───────────

  const displayData = useMemo<DisplayItem[]>(() => {
    const reversed = [...messages].reverse();
    if (isTyping) return [{ id: '__typing__', role: 'typing' }, ...reversed];
    return reversed;
  }, [messages, isTyping]);

  const canSend = (inputText.trim().length > 0 || pendingImageUri !== null) && !sending;

  // ── Camera ─────────────────────────────────────────────────────────────────

  const handleCamera = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Camera access needed', 'Please allow camera access in Settings to photograph questions.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true, allowsEditing: false });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setPendingImageUri(asset.uri);
        setPendingImageBase64(asset.base64 ?? null);
      }
    } catch {
      Alert.alert('Error', 'Could not open camera.');
    }
  }, []);

  // ── Send ───────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? inputText).trim();
    if (!text && !pendingImageUri) return;
    if (sending) return;

    if (!isOnline && !onDeviceReady) {
      const offlineMsg: TutorMessage = {
        id: `offline_${Date.now()}`,
        role: 'error',
        content: 'Tutor unavailable offline. Connect to continue.',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, offlineMsg]);
      return;
    }

    const now = new Date().toISOString();
    const userMsg: TutorMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: now,
      imageUri: pendingImageUri ?? undefined,
    };
    const capturedBase64 = pendingImageBase64;
    const capturedConvId = conversationId;

    setMessages(prev => { const n = [...prev, userMsg]; persist(n, capturedConvId); return n; });
    setInputText('');
    setPendingImageUri(null);
    setPendingImageBase64(null);
    setSending(true);
    setIsTyping(true);

    try {
      // ── On-device path (E2B) ─────────────────────────────────────────────
      if (onDeviceReady) {
        const history = messages.slice(-6).map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
        const prompt = buildTutorPrompt(history, text || 'I have a question about this image.');
        const response = await liteRTGenerate(prompt);
        const botMsg: TutorMessage = {
          id: `b_${Date.now()}`,
          role: 'assistant',
          content: response.trim(),
          timestamp: new Date().toISOString(),
        };
        // On-device uses no server conversation ID — keep existing or generate local one
        const localConvId = capturedConvId ?? `local_${Date.now()}`;
        setConversationId(localConvId);
        setMessages(prev => { const n = [...prev, botMsg]; persist(n, localConvId); return n; });
        return;
      }

      // ── Cloud path ───────────────────────────────────────────────────────
      const res = await tutorChat(
        text || 'I have a question about this image.',
        capturedConvId ?? undefined,
        capturedBase64 ?? undefined,
      );

      const botMsg: TutorMessage = {
        id: `b_${Date.now()}`,
        role: 'assistant',
        content: res.response,
        timestamp: new Date().toISOString(),
      };
      const newConvId = res.conversation_id;
      setConversationId(newConvId);
      setMessages(prev => { const n = [...prev, botMsg]; persist(n, newConvId); return n; });
    } catch (err: any) {
      const status = err?.status;

      if (status === 403) {
        Alert.alert(
          'Tutor not available',
          'AI tutor is available for students at subscribed schools. Ask your teacher about Neriah.',
        );
        // Remove the optimistic user message since the call failed
        setMessages(prev => { const n = prev.filter(m => m.id !== userMsg.id); persist(n, capturedConvId); return n; });
        return;
      }

      const errorContent = status === 429
        ? (err?.message ?? "You've reached today's tutor limit. Keep studying — they reset at midnight!")
        : "Couldn't connect. Check your internet and try again.";

      const errMsg: TutorMessage = {
        id: `e_${Date.now()}`,
        role: 'error',
        content: errorContent,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => { const n = [...prev, errMsg]; persist(n, capturedConvId); return n; });
    } finally {
      setIsTyping(false);
      setSending(false);
    }
  }, [inputText, pendingImageUri, pendingImageBase64, conversationId, sending, persist]);

  // ── New conversation ───────────────────────────────────────────────────────

  const handleNewConversation = useCallback(() => {
    if (messages.length === 0) return; // nothing to clear
    Alert.alert(
      'New Conversation',
      'Start fresh? Your previous chat will be cleared.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start Fresh',
          style: 'destructive',
          onPress: () => {
            setMessages([]);
            setConversationId(null);
            if (storageKey) AsyncStorage.removeItem(storageKey).catch(() => {});
          },
        },
      ],
    );
  }, [messages.length, storageKey]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const canGoBack = navigation.canGoBack();

  return (
    <View style={st.root}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={st.header}>
        {canGoBack ? (
          <TouchableOpacity style={st.headerBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={COLORS.white} />
          </TouchableOpacity>
        ) : (
          <View style={st.headerBtn} />
        )}
        <View style={st.headerCenter}>
          <Text style={st.headerTitle}>Neriah Tutor</Text>
          <View style={st.headerSubRow}>
            {onDeviceLoading ? (
              <View style={[st.statusDot, { backgroundColor: COLORS.amber300 }]} />
            ) : (
              <View style={[st.statusDot, onDeviceReady
                ? { backgroundColor: COLORS.success }
                : { backgroundColor: '#60A5FA' }
              ]} />
            )}
            <Text style={st.headerSub}>
              {onDeviceLoading
                ? 'Loading on-device AI...'
                : onDeviceReady
                  ? 'On-device AI ready'
                  : 'Using cloud AI'}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={st.headerBtn} onPress={handleNewConversation}>
          <Ionicons name="add-circle-outline" size={22} color={messages.length > 0 ? COLORS.white : 'rgba(255,255,255,0.3)'} />
        </TouchableOpacity>
      </View>

      {/* ── Chat + input ───────────────────────────────────────────────────── */}
      <KeyboardAvoidingView
        style={st.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Messages or welcome */}
        {messages.length === 0 && !isTyping ? (
          <WelcomeView onChip={text => handleSend(text)} />
        ) : (
          <FlatList
            data={displayData}
            inverted
            keyExtractor={item => item.id}
            renderItem={({ item }) => {
              if (item.role === 'typing') return <TypingBubble />;
              return <MessageBubble msg={item as TutorMessage} />;
            }}
            contentContainerStyle={st.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Image preview */}
        {pendingImageUri ? (
          <View style={st.previewBar}>
            <Image source={{ uri: pendingImageUri }} style={st.previewThumb} resizeMode="cover" />
            <Text style={st.previewLabel}>Photo attached</Text>
            <TouchableOpacity
              onPress={() => { setPendingImageUri(null); setPendingImageBase64(null); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={20} color={COLORS.error} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Input bar */}
        <View style={st.inputBar}>
          <TouchableOpacity style={st.inputAction} onPress={handleCamera} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="camera-outline" size={24} color={COLORS.teal500} />
          </TouchableOpacity>

          <TextInput
            style={st.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask Neriah anything..."
            placeholderTextColor={COLORS.textLight}
            multiline
            maxLength={1000}
            returnKeyType="default"
            blurOnSubmit={false}
          />

          <TouchableOpacity
            style={[st.sendBtn, !canSend && st.sendBtnOff]}
            onPress={() => handleSend()}
            disabled={!canSend}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <Ionicons name="send" size={17} color={canSend ? COLORS.white : COLORS.textLight} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },

  // Header
  header: {
    backgroundColor: COLORS.teal500,
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBtn: { width: 40, alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: COLORS.white, fontSize: 17, fontWeight: '700' },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  headerSub: { color: COLORS.teal100, fontSize: 11 },

  // Avatar (small, beside tutor messages)
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: COLORS.teal500,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 8, marginTop: 2, flexShrink: 0,
  },
  avatarLetter: { color: COLORS.white, fontSize: 13, fontWeight: '700' },

  // List
  listContent: { paddingHorizontal: 12, paddingVertical: 12 },

  // Message rows
  userRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 },
  tutorRow: { flexDirection: 'row', justifyContent: 'flex-start', marginBottom: 10 },
  userStack: { alignItems: 'flex-end', maxWidth: '80%' },
  tutorStack: { maxWidth: '80%' },

  // Bubbles
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 3 },
  userBubble: { backgroundColor: COLORS.teal500, borderBottomRightRadius: 4 },
  userText: { color: COLORS.white, fontSize: 15, lineHeight: 22 },
  tutorBubble: { backgroundColor: COLORS.gray200, borderBottomLeftRadius: 4 },
  tutorText: { color: COLORS.text, fontSize: 15, lineHeight: 22 },
  errorBubble: { backgroundColor: '#FDECEA' },
  errorText: { color: COLORS.error, fontSize: 14, lineHeight: 20 },

  timestamp: { fontSize: 11, color: COLORS.textLight, marginHorizontal: 4, marginBottom: 2 },

  // Message image
  msgImage: { width: 200, height: 150, borderRadius: 12, marginBottom: 4 },

  // Typing indicator
  typingBubble: { paddingVertical: 14, paddingHorizontal: 16 },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: COLORS.teal500 },

  // Image preview bar
  previewBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: COLORS.white,
    borderTopWidth: 1, borderTopColor: COLORS.border,
    gap: 10,
  },
  previewThumb: { width: 48, height: 48, borderRadius: 8 },
  previewLabel: { flex: 1, fontSize: 13, color: COLORS.textLight },

  // Input bar
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 8, paddingVertical: 8,
    backgroundColor: COLORS.white,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  inputAction: { padding: 8, marginBottom: 2 },
  textInput: {
    flex: 1,
    minHeight: 40, maxHeight: 120,
    backgroundColor: COLORS.gray50,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 15, color: COLORS.text,
    marginHorizontal: 4,
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.teal500,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 1,
  },
  sendBtnOff: { backgroundColor: COLORS.gray200 },

  // Welcome
  welcome: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 28, paddingBottom: 40,
  },
  welcomeAvatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: COLORS.teal500,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 20,
    shadowColor: COLORS.teal500,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8,
    elevation: 4,
  },
  welcomeAvatarText: { color: COLORS.white, fontSize: 28, fontWeight: '800' },
  welcomeTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, textAlign: 'center', marginBottom: 10 },
  welcomeBody: { fontSize: 14, color: COLORS.textLight, textAlign: 'center', lineHeight: 20, marginBottom: 8 },
  welcomeNote: { fontSize: 13, color: COLORS.teal500, textAlign: 'center', fontStyle: 'italic', marginBottom: 24 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.teal50, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: COLORS.teal300,
  },
  chipText: { color: COLORS.teal500, fontSize: 13, fontWeight: '600' },
});
