// App.tsx
// Root of the Neriah mobile app.
//
// Navigation structure:
//   Unauthenticated → AuthStack (initial: RoleSelect)
//     RoleSelect (landing) → TeacherRegister → OTP
//     RoleSelect (landing) → StudentRegister → OTP
//     RoleSelect → "Sign in" → Phone → OTP   (existing users)
//
//   Authenticated, role=teacher → TeacherNavigator
//     MainTabs (Home | Mark | Analytics | Settings)
//     + ClassSetup modal
//     + ClassDetail push screen
//
//   Authenticated, role=student → StudentNavigator
//     StudentTabs (Home | Submit | Results | Settings)

import React from 'react';
import {
  ActivityIndicator, View, Modal, Text, TouchableOpacity,
  StyleSheet, LogBox,
} from 'react-native';

// Suppress Expo Go limitations that are not bugs in our code
LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications',
  'expo-notifications functionality is not fully supported',
  'Due to changes in Androids permission requirements',
  'Bottom Tab Navigator: lazy',
]);
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ModelProvider, useModel } from './src/context/ModelContext';
import PinSetupScreen from './src/screens/PinSetupScreen';
import PinLoginScreen from './src/screens/PinLoginScreen';
import { LanguageProvider, useLanguage } from './src/context/LanguageContext';
import { startNetworkListener } from './src/services/offlineQueue';
import { detectAndStoreCapability } from './src/services/deviceCapabilities';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import NetworkBanner from './src/components/NetworkBanner';
import { COLORS } from './src/constants/colors';
import { MODEL_DISPLAY_NAME, MODEL_SIZE_LABEL } from './src/services/modelManager';
import {
  AuthStackParamList,
  MainTabParamList,
  RootStackParamList,
  StudentTabParamList,
} from './src/types';

// ── Auth screens ──────────────────────────────────────────────────────────────
import PhoneScreen from './src/screens/PhoneScreen';
import OTPScreen from './src/screens/OTPScreen';
import RoleSelectScreen from './src/screens/RoleSelectScreen';
import TeacherRegisterScreen from './src/screens/TeacherRegisterScreen';
import StudentRegisterScreen from './src/screens/StudentRegisterScreen';

// ── Teacher screens ───────────────────────────────────────────────────────────
import HomeScreen from './src/screens/HomeScreen';
import MarkingScreen from './src/screens/MarkingScreen';
import AnalyticsScreen from './src/screens/AnalyticsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ClassSetupScreen from './src/screens/ClassSetupScreen';
import ClassDetailScreen from './src/screens/ClassDetailScreen';
import TeacherInboxScreen from './src/screens/TeacherInboxScreen';
import HomeworkDetailScreen from './src/screens/HomeworkDetailScreen';
import HomeworkListScreen from './src/screens/HomeworkListScreen';
import AddHomeworkScreen from './src/screens/AddHomeworkScreen';
import HomeworkCreatedScreen from './src/screens/HomeworkCreatedScreen';
import ReviewSchemeScreen from './src/screens/ReviewSchemeScreen';
import SetPinScreen from './src/screens/SetPinScreen';
import GradingResultsScreen from './src/screens/GradingResultsScreen';
import GradingDetailScreen from './src/screens/GradingDetailScreen';
import TeacherClassAnalyticsScreen from './src/screens/TeacherClassAnalyticsScreen';
import TeacherStudentAnalyticsScreen from './src/screens/TeacherStudentAnalyticsScreen';
import HomeworkAnalyticsScreen from './src/screens/HomeworkAnalyticsScreen';
import TeacherAssistantScreen from './src/screens/TeacherAssistantScreen';
import EditProfileScreen from './src/screens/EditProfileScreen';
import TermsOfServiceScreen from './src/screens/TermsOfServiceScreen';
import UserAgreementScreen from './src/screens/UserAgreementScreen';

// ── Student screens ───────────────────────────────────────────────────────────
import StudentHomeScreen from './src/screens/StudentHomeScreen';
import StudentSubmitScreen from './src/screens/StudentSubmitScreen';
import StudentResultsScreen from './src/screens/StudentResultsScreen';
import StudentTutorScreen from './src/screens/StudentTutorScreen';
import StudentSettingsScreen from './src/screens/StudentSettingsScreen';
import StudentCameraScreen from './src/screens/StudentCameraScreen';
import StudentPreviewScreen from './src/screens/StudentPreviewScreen';
import StudentConfirmScreen from './src/screens/StudentConfirmScreen';
import SubmissionSuccessScreen from './src/screens/SubmissionSuccessScreen';
import FeedbackScreen from './src/screens/FeedbackScreen';
import StudentAnalyticsScreen from './src/screens/StudentAnalyticsScreen';

// ── Navigators ────────────────────────────────────────────────────────────────

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const TeacherTab = createBottomTabNavigator<MainTabParamList>();
const TeacherStack = createNativeStackNavigator<RootStackParamList>();
const StudentTab = createBottomTabNavigator<StudentTabParamList>();
const StudentRootStack = createNativeStackNavigator<import('./src/types').StudentRootStackParamList>();
const AgreementStack = createNativeStackNavigator<RootStackParamList>();

// ── Agreement navigator — shown once until terms accepted ─────────────────────

function AgreementNavigator() {
  return (
    <AgreementStack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
      <AgreementStack.Screen name="UserAgreement" component={UserAgreementScreen} />
      <AgreementStack.Screen name="TermsOfService" component={TermsOfServiceScreen} />
    </AgreementStack.Navigator>
  );
}

// ── Auth navigator (shared by both roles) ─────────────────────────────────────

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="RoleSelect" component={RoleSelectScreen} />
      <AuthStack.Screen name="TeacherRegister" component={TeacherRegisterScreen} />
      <AuthStack.Screen name="StudentRegister" component={StudentRegisterScreen} />
      <AuthStack.Screen name="Phone" component={PhoneScreen} />
      <AuthStack.Screen name="OTP" component={OTPScreen} />
    </AuthStack.Navigator>
  );
}

// ── Teacher tab bar ───────────────────────────────────────────────────────────

function TeacherTabs() {
  const { t } = useLanguage();
  console.log('[TeacherTabs] render, my_classes =', t('my_classes'));
  return (
    <TeacherTab.Navigator
      screenOptions={({ route }) => ({
        lazy: true,
        headerShown: false,
        freezeOnBlur: true,
        tabBarActiveTintColor: COLORS.teal500,
        tabBarInactiveTintColor: COLORS.textLight,
        tabBarStyle: { borderTopColor: COLORS.border },
        tabBarIcon: ({ color, size }) => {
          const icons: Record<keyof MainTabParamList, keyof typeof Ionicons.glyphMap> = {
            Home: 'home-outline',
            Analytics: 'bar-chart-outline',
            Assistant: 'sparkles-outline',
            Settings: 'settings-outline',
          };
          return <Ionicons name={icons[route.name]} size={size} color={color} />;
        },
      })}
    >
      <TeacherTab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarLabel: t('my_classes') }}
      />
      <TeacherTab.Screen
        name="Analytics"
        component={AnalyticsScreen}
        options={{ tabBarLabel: t('analytics') }}
      />
      <TeacherTab.Screen
        name="Assistant"
        component={TeacherAssistantScreen}
        options={{ tabBarLabel: t('assistant') }}
      />
      <TeacherTab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarLabel: t('settings') }}
      />
    </TeacherTab.Navigator>
  );
}

// ── Teacher root (tabs + modal screens) ───────────────────────────────────────

function TeacherNavigator() {
  return (
    <TeacherStack.Navigator screenOptions={{ animation: 'none' }}>
      <TeacherStack.Screen name="Main" component={TeacherTabs} options={{ headerShown: false }} />
      <TeacherStack.Screen
        name="ClassSetup"
        component={ClassSetupScreen}
        options={{ title: 'New Class', presentation: 'modal' }}
      />
      <TeacherStack.Screen
        name="ClassDetail"
        component={ClassDetailScreen}
        options={({ route }: any) => ({ title: route.params?.class_name ?? 'Class' })}
      />
      <TeacherStack.Screen
        name="TeacherInbox"
        component={TeacherInboxScreen}
        options={{ title: 'Student Submissions', headerShown: false }}
      />
      <TeacherStack.Screen
        name="HomeworkDetail"
        component={HomeworkDetailScreen}
        options={{ headerShown: false }}
      />
      <TeacherStack.Screen
        name="AddHomework"
        component={AddHomeworkScreen}
        options={{ headerShown: false }}
      />
      <TeacherStack.Screen
        name="ReviewScheme"
        component={ReviewSchemeScreen}
        options={{ headerShown: false }}
      />
      <TeacherStack.Screen
        name="HomeworkCreated"
        component={HomeworkCreatedScreen}
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <TeacherStack.Screen
        name="SetPin"
        component={SetPinScreen}
        options={{ headerShown: false }}
      />
      <TeacherStack.Screen
        name="HomeworkList"
        component={HomeworkListScreen}
        options={{ headerShown: false }}
      />
      <TeacherStack.Screen
        name="GradingResults"
        component={GradingResultsScreen}
        options={{ headerShown: false }}
      />
      <TeacherStack.Screen
        name="GradingDetail"
        component={GradingDetailScreen}
        options={{ headerShown: false }}
      />
      <TeacherStack.Screen
        name="Mark"
        component={MarkingScreen}
        options={{ headerShown: false }}
      />
      <TeacherStack.Screen
        name="TeacherClassAnalytics"
        component={TeacherClassAnalyticsScreen}
        options={{ headerShown: false }}
      />
      <TeacherStack.Screen
        name="HomeworkAnalytics"
        component={HomeworkAnalyticsScreen}
        options={{ headerShown: false }}
      />
      <TeacherStack.Screen
        name="TeacherStudentAnalytics"
        component={TeacherStudentAnalyticsScreen}
        options={{ headerShown: false }}
      />
      <TeacherStack.Screen
        name="EditProfile"
        component={EditProfileScreen}
        options={{ headerShown: false }}
      />
      <TeacherStack.Screen
        name="TermsOfService"
        component={TermsOfServiceScreen}
        options={{ headerShown: false }}
      />
    </TeacherStack.Navigator>
  );
}

// ── Student tab bar ───────────────────────────────────────────────────────────

function StudentTabs() {
  const { t } = useLanguage();
  return (
    <StudentTab.Navigator
      screenOptions={({ route }) => ({
        lazy: true,
        freezeOnBlur: true,
        tabBarActiveTintColor: COLORS.teal500,
        tabBarInactiveTintColor: COLORS.textLight,
        tabBarStyle: { borderTopColor: COLORS.border },
        tabBarIcon: ({ color, size }) => {
          const icons: Partial<Record<keyof StudentTabParamList, keyof typeof Ionicons.glyphMap>> = {
            StudentHome: 'document-text-outline',
            StudentTutor: 'sparkles-outline',
            StudentResults: 'checkmark-circle-outline',
          };
          return <Ionicons name={icons[route.name] ?? 'ellipse-outline'} size={size} color={color} />;
        },
      })}
    >
      <StudentTab.Screen
        name="StudentHome"
        component={StudentHomeScreen}
        options={{ title: 'Homework', tabBarLabel: 'Homework', headerShown: false }}
      />
      <StudentTab.Screen
        name="StudentTutor"
        component={StudentTutorScreen}
        options={{ title: 'Tutor', tabBarLabel: 'Tutor', headerShown: false }}
      />
      <StudentTab.Screen
        name="StudentResults"
        component={StudentResultsScreen}
        options={{ title: 'My Results', tabBarLabel: 'Results', headerShown: false }}
      />
      <StudentTab.Screen
        name="StudentSubmit"
        component={StudentSubmitScreen}
        options={{ title: 'Submit', headerShown: false, tabBarButton: () => null }}
      />
      <StudentTab.Screen
        name="StudentSettings"
        component={StudentSettingsScreen}
        options={{ title: 'Settings', headerShown: false, tabBarButton: () => null }}
      />
    </StudentTab.Navigator>
  );
}

// ── Student root (tabs + submission flow screens) ─────────────────────────────

function StudentNavigator() {
  return (
    <StudentRootStack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
      <StudentRootStack.Screen name="StudentTabs" component={StudentTabs} />
      <StudentRootStack.Screen
        name="StudentCamera"
        component={StudentCameraScreen}
        options={{ headerShown: true, title: 'Capture Pages', headerBackTitleVisible: false }}
      />
      <StudentRootStack.Screen
        name="StudentPreview"
        component={StudentPreviewScreen}
        options={{ headerShown: true, title: 'Preview' }}
      />
      <StudentRootStack.Screen
        name="StudentConfirm"
        component={StudentConfirmScreen}
        options={{ headerShown: true, title: 'Submit' }}
      />
      <StudentRootStack.Screen
        name="SubmissionSuccess"
        component={SubmissionSuccessScreen}
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <StudentRootStack.Screen
        name="Feedback"
        component={FeedbackScreen}
        options={{ title: 'Feedback', headerBackTitle: 'Results' }}
      />
      <StudentRootStack.Screen
        name="StudentAnalytics"
        component={StudentAnalyticsScreen}
        options={{ title: 'My Analytics', headerBackTitle: 'Back' }}
      />
    </StudentRootStack.Navigator>
  );
}

// ── App shell — auth gate + role routing ──────────────────────────────────────

// ── Download prompt modal ─────────────────────────────────────────────────────

function DownloadPromptModal() {
  const { showPrompt, variant, acceptDownload, skipDownload } = useModel();
  if (!showPrompt || !variant) return null;

  return (
    <Modal visible animationType="fade" transparent>
      <View style={promptStyles.overlay}>
        <View style={promptStyles.card}>
          <Text style={promptStyles.title}>Download AI model</Text>
          <Text style={promptStyles.body}>
            Neriah can grade and assist offline with an on-device AI model.{'\n\n'}
            <Text style={promptStyles.name}>{MODEL_DISPLAY_NAME[variant]}</Text>
            {'\n'}
            <Text style={promptStyles.size}>{MODEL_SIZE_LABEL[variant]} — recommended on Wi-Fi</Text>
          </Text>

          <TouchableOpacity style={promptStyles.primaryBtn} onPress={acceptDownload}>
            <Text style={promptStyles.primaryBtnText}>Download now</Text>
          </TouchableOpacity>

          <TouchableOpacity style={promptStyles.secondaryBtn} onPress={skipDownload}>
            <Text style={promptStyles.secondaryBtnText}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const promptStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  card: {
    backgroundColor: COLORS.white, borderRadius: 20,
    padding: 28, width: '100%', maxWidth: 360,
  },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginBottom: 12 },
  body: { fontSize: 15, color: COLORS.textLight, lineHeight: 22, marginBottom: 24 },
  name: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  size: { fontSize: 13, color: COLORS.gray500 },
  primaryBtn: {
    backgroundColor: COLORS.teal500, borderRadius: 12,
    padding: 16, alignItems: 'center', marginBottom: 10,
  },
  primaryBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 16 },
  secondaryBtn: { padding: 12, alignItems: 'center' },
  secondaryBtnText: { color: COLORS.gray500, fontSize: 15 },
});

// ── App shell — auth gate + role routing ──────────────────────────────────────

function AppShell() {
  const { user, loading, hasPin, pinUnlocked, needsPinSetup, termsAccepted } = useAuth();
  const { initPrompt } = useModel();

  // Device capability detection — runs once on first launch only.
  // Then check if we should show the model download prompt.
  React.useEffect(() => {
    detectAndStoreCapability()
      .then(() => initPrompt())
      .catch(() => {});
  }, []);

  // Offline queue replay only needed for teachers (marking pipeline)
  React.useEffect(() => {
    if (user?.role === 'teacher') {
      const unsubscribe = startNetworkListener();
      return unsubscribe;
    }
  }, [user?.role]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={COLORS.teal500} />
      </View>
    );
  }

  let content: React.ReactElement;
  if (!user) {
    content = <AuthNavigator />;
  } else if (hasPin && !pinUnlocked) {
    // Cold start with PIN set — require PIN before anything else
    content = <PinLoginScreen />;
  } else if (!termsAccepted) {
    // First login — must accept terms before going further
    content = <AgreementNavigator />;
  } else if (needsPinSetup) {
    // Terms accepted, first OTP login — prompt user to set a PIN (or skip)
    content = <PinSetupScreen />;
  } else if (user.role === 'teacher') {
    content = <TeacherNavigator />;
  } else {
    content = <StudentNavigator />;
  }

  return (
    <NavigationContainer>
      <View style={{ flex: 1 }}>
        <NetworkBanner />
        <ErrorBoundary>
          {content}
        </ErrorBoundary>
      </View>
      {/* One-time model download prompt — shown after login only if device is capable */}
      {user && <DownloadPromptModal />}
    </NavigationContainer>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export default function App() {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <AuthProvider>
          <ModelProvider>
            <AppShell />
          </ModelProvider>
        </AuthProvider>
      </LanguageProvider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
