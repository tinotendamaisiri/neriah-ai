// src/screens/StudentTutorScreen.tsx
// AI Tutor chat screen for students.
// Socratic-method tutor — guides students toward answers, never gives them directly.
//
// Features:
//   - Chat bubbles: student right (teal), Neriah left (white)
//   - Animated 3-dot typing indicator
//   - Camera capture + image quality check + enhanceImage before send
//   - AsyncStorage persistence per student
//   - Local daily usage tracking (50/day)
//   - Greeting message on first open (with weak topics from analytics)

import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  ActivityIndicator,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../context/AuthContext';
import { sendTutorMessage, TutorChatMessage } from '../services/api';
import { checkImageQuality } from '../services/imageQuality';
import { enhanceImage } from '../services/imageEnhance';
import InAppCamera from '../components/InAppCamera';
import { COLORS } from '../constants/colors';
import * as FileSystem from 'expo-file-system/legacy';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUri?: string;
  timestamp: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DAILY_LIMIT = 50;
const storageKey = (studentId: string) => `tutor_chat_${studentId}`;
const usageKey   = (studentId: string) => {
  const date = new Date().toISOString().slice(0, 10);
  return `tutor_usage_${studentId}_${date}`;
};

// ── Typing indicator ───────────────────────────────────────────────────────────

function TypingIndicator() {
  const dots = [useRef(new Animated.Value(0)).current,
                useRef(new Animated.Value(0)).current,
                useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, { toValue: -6, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0,  duration: 300, useNativeDriver: true }),
          Animated.delay(600 - i * 150),
        ]),
      ),
    );
    anims.forEach(a => a.start());
    return () => anims.forEach(a => a.stop());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.bubbleLeft}>
      <View style={styles.typingWrap}>
        {dots.map((dot, i) => (
          <Animated.View
            key={i}
            style={[styles.typingDot, { transform: [{ translateY: dot }] }]}
          />
        ))}
      </View>
    </View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function StudentTutorScreen() {
  const { user } = useAuth();
  const studentId = user?.id ?? 'demo';

  const [messages,      setMessages]      = useState<ChatMessage[]>([]);
  const [inputText,     setInputText]     = useState('');
  const [sending,       setSending]       = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [pendingImage,  setPendingImage]  = useState<{ uri: string; base64: string } | null>(null);
  const [qualityWarnings, setQualityWarnings] = useState<string[]>([]);
  const [usageCount,    setUsageCount]    = useState(DAILY_LIMIT);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);

  const listRef = useRef<FlatList>(null);

  // ── Load persisted chat + usage ──────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(storageKey(studentId));
        if (stored) {
          const parsed: ChatMessage[] = JSON.parse(stored);
          setMessages(parsed);
        }
        const usageStr = await AsyncStorage.getItem(usageKey(studentId));
        const used = usageStr ? parseInt(usageStr, 10) : 0;
        setUsageCount(DAILY_LIMIT - used);
      } catch {
        // non-fatal
      }
    })();
  }, [studentId]);

  // ── Greeting on first open ───────────────────────────────────────────────────

  useEffect(() => {
    // Only send greeting when we confirm there are no persisted messages
    // (the load effect above runs first — but it's async, so we gate on a
    // sentinel value that can never appear in a real persisted chat)
  }, []);

  useEffect(() => {
    if (messages.length > 0) return; // already have history
    // Small delay to let the load effect finish
    const timer = setTimeout(() => {
      setMessages(prev => {
        if (prev.length > 0) return prev; // race: history loaded in the meantime
        sendGreeting();
        return prev;
      });
    }, 400);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendGreeting = async () => {
    setSending(true);
    try {
      const res = await sendTutorMessage({ message: '', is_greeting: true });
      const greetMsg: ChatMessage = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: res.response,
        timestamp: Date.now(),
      };
      setConversationId(res.conversation_id);
      setMessages([greetMsg]);
      await AsyncStorage.setItem(storageKey(studentId), JSON.stringify([greetMsg]));
    } catch {
      const fallback: ChatMessage = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: "Hi! I'm Neriah, your AI tutor. What would you like help with today?",
        timestamp: Date.now(),
      };
      setMessages([fallback]);
    } finally {
      setSending(false);
    }
  };

  // ── Persist messages to AsyncStorage ────────────────────────────────────────

  const persistMessages = useCallback(async (msgs: ChatMessage[]) => {
    try {
      await AsyncStorage.setItem(storageKey(studentId), JSON.stringify(msgs));
    } catch { /* non-fatal */ }
  }, [studentId]);

  // ── Increment local usage count ──────────────────────────────────────────────

  const incrementUsage = useCallback(async () => {
    const key = usageKey(studentId);
    const current = await AsyncStorage.getItem(key);
    const used = current ? parseInt(current, 10) + 1 : 1;
    await AsyncStorage.setItem(key, String(used));
    setUsageCount(DAILY_LIMIT - used);
  }, [studentId]);

  // ── Send a message ───────────────────────────────────────────────────────────

  const send = useCallback(async (overrideText?: string, imageBase64?: string, imageUri?: string) => {
    const text = (overrideText ?? inputText).trim();
    if (!text && !imageBase64) return;
    if (usageCount <= 0) return;

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
      imageUri,
      timestamp: Date.now(),
    };

    const history: TutorChatMessage[] = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInputText('');
    setPendingImage(null);
    setQualityWarnings([]);
    await persistMessages(nextMessages);

    setSending(true);
    try {
      const res = await sendTutorMessage({
        message: text,
        conversation_id: conversationId,
        image: imageBase64,
        history,
      });
      setConversationId(res.conversation_id);

      const aiMsg: ChatMessage = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: res.response,
        timestamp: Date.now(),
      };
      const withAi = [...nextMessages, aiMsg];
      setMessages(withAi);
      await persistMessages(withAi);
      await incrementUsage();

      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err: any) {
      const status = err?.response?.status ?? err?.status;
      const errText = status === 429
        ? "You've used all your messages for today. They reset at midnight!"
        : "Something went wrong. Please try again.";
      const errMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        role: 'assistant',
        content: errText,
        timestamp: Date.now(),
      };
      const withErr = [...nextMessages, errMsg];
      setMessages(withErr);
      await persistMessages(withErr);
    } finally {
      setSending(false);
    }
  }, [inputText, messages, conversationId, usageCount, persistMessages, incrementUsage]);

  // ── Camera capture ────────────────────────────────────────────────────────────

  const handleCapture = useCallback(async (base64: string, uri: string) => {
    setCameraVisible(false);
    // Enhance then quality-check
    const enhancedUri = await enhanceImage(uri);
    const quality = await checkImageQuality(enhancedUri);
    if (quality.warnings.length > 0) {
      // Read enhanced as base64 for sending
      let enhancedBase64 = base64;
      try {
        enhancedBase64 = await FileSystem.readAsStringAsync(enhancedUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } catch { /* use original */ }
      setPendingImage({ uri: enhancedUri, base64: enhancedBase64 });
      setQualityWarnings(quality.warnings);
    } else {
      // Good quality — read enhanced as base64 and attach
      let enhancedBase64 = base64;
      try {
        enhancedBase64 = await FileSystem.readAsStringAsync(enhancedUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } catch { /* use original */ }
      setPendingImage({ uri: enhancedUri, base64: enhancedBase64 });
    }
  }, []);

  // ── Render helpers ────────────────────────────────────────────────────────────

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
        {!isUser && (
          <View style={styles.avatar}>
            <Image source={require('../../assets/icon-transparent.png')} style={{ width: 17, height: 17, tintColor: 'white' }} resizeMode="contain" />
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAI]}>
          {item.imageUri && (
            <Image source={{ uri: item.imageUri }} style={styles.bubbleImage} />
          )}
          {item.content ? (
            <Text style={isUser ? styles.bubbleTextUser : styles.bubbleTextAI}>
              {item.content}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }, []);

  const usageColor = usageCount <= 0
    ? COLORS.error
    : usageCount < 10
      ? '#F5A623'
      : COLORS.gray500;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Neriah Tutor</Text>
          <View style={styles.onlineDot} />
        </View>
        <Text style={[styles.usageText, { color: usageColor }]}>
          {usageCount}/{DAILY_LIMIT} left today
        </Text>
      </View>

      {/* ── Quality warning banner ── */}
      {qualityWarnings.length > 0 && (
        <View style={styles.warningBanner}>
          <Ionicons name="warning-outline" size={16} color="#92400e" />
          <Text style={styles.warningText}>{qualityWarnings[0]}</Text>
          <View style={styles.warningActions}>
            <TouchableOpacity
              onPress={() => pendingImage && send(inputText, pendingImage.base64, pendingImage.uri)}
              style={styles.warnBtn}
            >
              <Text style={styles.warnBtnText}>Send Anyway</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setPendingImage(null); setQualityWarnings([]); }}
              style={[styles.warnBtn, styles.warnBtnSecondary]}
            >
              <Text style={[styles.warnBtnText, styles.warnBtnSecondaryText]}>Retake</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Message list ── */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListFooterComponent={sending ? <TypingIndicator /> : null}
        />

        {/* ── Pending image preview ── */}
        {pendingImage && qualityWarnings.length === 0 && (
          <View style={styles.imagePreviewRow}>
            <Image source={{ uri: pendingImage.uri }} style={styles.imagePreview} />
            <TouchableOpacity
              onPress={() => { setPendingImage(null); setQualityWarnings([]); }}
              style={styles.imageRemove}
            >
              <Ionicons name="close-circle" size={20} color={COLORS.gray500} />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Input bar ── */}
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={styles.cameraBtn}
            onPress={() => setCameraVisible(true)}
            disabled={sending || usageCount <= 0}
          >
            <Ionicons
              name="camera-outline"
              size={24}
              color={usageCount <= 0 ? COLORS.textLight : COLORS.teal500}
            />
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask Neriah..."
            placeholderTextColor={COLORS.textLight}
            multiline
            returnKeyType="send"
            blurOnSubmit={false}
            editable={!sending && usageCount > 0}
            onSubmitEditing={() => send(undefined, pendingImage?.base64, pendingImage?.uri)}
          />

          <TouchableOpacity
            style={[
              styles.sendBtn,
              (!inputText.trim() && !pendingImage || sending || usageCount <= 0)
                && styles.sendBtnDisabled,
            ]}
            onPress={() => send(undefined, pendingImage?.base64, pendingImage?.uri)}
            disabled={(!inputText.trim() && !pendingImage) || sending || usageCount <= 0}
          >
            {sending
              ? <ActivityIndicator size="small" color={COLORS.white} />
              : <Ionicons name="send" size={18} color={COLORS.white} />
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ── In-app camera ── */}
      <InAppCamera
        visible={cameraVisible}
        onCapture={handleCapture}
        onClose={() => setCameraVisible(false)}
        quality={0.85}
      />
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex:        { flex: 1 },
  container:   { flex: 1, backgroundColor: '#F8FAFA' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  onlineDot:   { width: 9, height: 9, borderRadius: 5, backgroundColor: '#22c55e' },
  usageText:   { fontSize: 12, fontWeight: '600' },

  // Quality warning
  warningBanner: {
    backgroundColor: '#fef3c7',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
    padding: 12,
    gap: 6,
  },
  warningText:   { fontSize: 13, color: '#92400e', flex: 1, flexWrap: 'wrap' },
  warningActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  warnBtn: {
    backgroundColor: COLORS.teal500,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  warnBtnText:          { color: COLORS.white, fontSize: 13, fontWeight: '600' },
  warnBtnSecondary:     { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border },
  warnBtnSecondaryText: { color: COLORS.text },

  // List
  listContent: { padding: 12, paddingBottom: 4, gap: 10 },

  // Row
  row:      { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowLeft:  { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },

  // Avatar
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: COLORS.teal500,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: COLORS.white, fontWeight: '800', fontSize: 13 },

  // Bubble
  bubble: {
    maxWidth: '78%', borderRadius: 16, padding: 12,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  bubbleUser:     { backgroundColor: COLORS.teal500, borderBottomRightRadius: 4 },
  bubbleAI:       { backgroundColor: COLORS.white, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: COLORS.border },
  bubbleLeft:     { alignSelf: 'flex-start', marginLeft: 38, maxWidth: '72%' },
  bubbleTextUser: { color: COLORS.white, fontSize: 15, lineHeight: 21 },
  bubbleTextAI:   { color: COLORS.text,  fontSize: 15, lineHeight: 21 },
  bubbleImage:    { width: 180, height: 140, borderRadius: 10, marginBottom: 8 },

  // Typing indicator
  typingWrap: { flexDirection: 'row', gap: 5, padding: 12, alignItems: 'center' },
  typingDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.textLight },

  // Image preview above input
  imagePreviewRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8,
  },
  imagePreview: { width: 56, height: 56, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border },
  imageRemove:  { marginLeft: 6, padding: 2 },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  cameraBtn: { padding: 6, justifyContent: 'center', alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 15,
    color: COLORS.text,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.teal500,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: COLORS.gray200 ?? '#E5E7EB' },
});
