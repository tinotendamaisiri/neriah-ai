'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import {
  Camera, ImageIcon, File, FileText, Pencil, Paperclip, ArrowUp,
  Home, BarChart2, Settings, Upload, Download,
  GraduationCap, Briefcase, ClipboardList,
  HelpCircle, Star, Inbox,
  Bot, Hand, X, AlertTriangle, XCircle, MailX,
  Users, BookOpen, Sparkles, Cloud, Zap,
  MessageCircle, MessageSquare, ChevronLeft, Menu, Plus, Trash2, Eye, Check,
} from 'lucide-react';

import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, LineChart, Line, CartesianGrid,
} from 'recharts';

// ── Brand ─────────────────────────────────────────────────────────────────────
const C = {
  teal:         '#0D7377',
  tealMd:       '#0D9488',
  tealDk:       '#0F766E',
  tealDk2:      '#085041',
  teal50:       '#E1F5EE',
  teal100:      '#9FE1CB',
  tealLt:       '#F0FDFA',
  teal300:      '#3AAFA9',
  primaryLight: '#E8F4F4',
  amber:        '#F5A623',
  amber50:      '#FFF3E0',
  amber100:     '#FAC775',
  amber200:     '#FDE68A',
  amber400:     '#F59E0B',
  amber500:     '#D4880B',
  amber700:     '#854F0B',
  amberLt:      '#FFFBEB',
  amberFaint:   '#FEF3C7',
  amberText:    '#92400E',
  amber900:     '#78350F',
  green:        '#16A34A',
  green50:      '#E6F4EA',
  green400:     '#22C55E',
  greenLt:      '#F0FDF4',
  green100:     '#E8F5E9',
  green700:     '#388E3C',
  yellow400:    '#EAB308',
  red:          '#E74C3C',
  red200:       '#FCA5A5',
  red500:       '#EF4444',
  red700:       '#B91C1C',
  red800:       '#991B1B',
  red900:       '#7F1D1D',
  redLt:        '#FEF2F2',
  g50:          '#FAFAFA',
  g100:         '#F3F4F6',
  g200:         '#E8E8E8',
  g400:         '#9CA3AF',
  g500:         '#6B6B6B',
  g700:         '#374151',
  g900:         '#2C2C2A',
  text:         '#2C2C2A',
  white:        '#FFFFFF',
  black:        '#000000',
  darkBg:       '#111827',
  nearWhite:    '#F9FAFB',
  blue400:      '#60A5FA',
  waGreen:      '#25D366',
  bg:           '#FAFAFA',
  border:       '#E8E8E8',
  pendingBg:    '#FEF3E2',
  gradedBg:     '#DCFCE7',
  greenDk:      '#166534',
  grayTxt:      '#6B7280',
  // ── AI Assistant dark theme ─────────────────────────────────────────────────
  aiDark:       '#1A1A2E',
  aiCard:       '#16213E',
  aiUser:       '#1E3A5F',
  aiBorder:     '#2A2A4A',
  aiPurple:     '#7C3AED',
  aiPurpleLt:   '#A78BFA',
  aiText:       '#E8E8F0',
  aiSub:        '#8888AA',
  aiChip:       '#2A2A4A',
};

// ── COLORS alias (canonical names for tests + new code) ───────────────────────
const COLORS = {
  primary:      C.teal,
  primaryLight: C.primaryLight,
  amber:        C.amber,
  amberLight:   C.amber50,
  gray900:      C.g900,
  gray500:      C.g500,
  gray200:      C.g200,
  gray50:       C.g50,
  success:      '#27AE60',
  error:        C.red,
  white:        C.white,
};

// ── Typography scale (mirrors mobile FONT constants) ──────────────────────────
const FONT = {
  xs:   '12px',
  sm:   '14px',
  base: '16px',
  lg:   '18px',
  xl:   '20px',
  xxl:  '24px',
  xxxl: '32px',
};

// ── BackButton — replaces all plain-text ← back navigation ───────────────────
function BackButton({ label = 'Back', onClick, light = false }: {
  label?: string; onClick?: () => void; light?: boolean;
}) {
  const [hov, setHov] = useState(false);
  const iconColor = light ? C.white : C.teal;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        background: light ? 'rgba(255,255,255,0.15)' : (hov ? C.primaryLight : 'transparent'),
        border: 'none', cursor: 'pointer', padding: 8, borderRadius: 8,
        fontFamily: 'inherit', color: iconColor, transition: 'background 0.12s',
      }}
    >
      <ChevronLeft size={20} color={iconColor} />
      <span style={{ fontSize: FONT.sm, fontWeight: 600, color: iconColor }}>{label}</span>
    </button>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────────
type BadgeStatus = 'Pending' | 'Graded' | 'Closed' | 'Open' | 'Active';
const STATUS_COLORS: Record<BadgeStatus, { bg: string; color: string }> = {
  Pending: { bg: C.pendingBg,    color: C.amberText },
  Graded:  { bg: C.gradedBg,     color: C.greenDk },
  Closed:  { bg: C.g100,         color: C.grayTxt },
  Open:    { bg: C.primaryLight,  color: C.teal },
  Active:  { bg: C.primaryLight,  color: C.teal },
};
function StatusBadge({ status }: { status: BadgeStatus }) {
  const col = STATUS_COLORS[status] ?? { bg: C.g100, color: C.g500 };
  return (
    <span style={{
      background: col.bg, color: col.color,
      fontSize: 12, fontWeight: 600,
      borderRadius: 9999, paddingInline: 10, paddingBlock: 4,
      whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center',
    }}>
      {status}
    </span>
  );
}

// ── DemoInput — input with teal focus border ──────────────────────────────────
function DemoInput(props: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  const [focused, setFocused] = React.useState(false);
  const { error, style, onFocus, onBlur, ...rest } = props;
  return (
    <input
      {...rest}
      onFocus={e => { setFocused(true); onFocus?.(e); }}
      onBlur={e => { setFocused(false); onBlur?.(e); }}
      style={{
        border: `2px solid ${error ? C.red : focused ? C.teal : C.g200}`,
        borderRadius: 12, padding: '12px 14px',
        fontSize: 14, color: C.text, outline: 'none', width: '100%',
        boxSizing: 'border-box', fontFamily: 'inherit', background: C.white,
        boxShadow: focused ? `0 0 0 3px ${error ? 'rgba(239,68,68,0.12)' : 'rgba(13,115,119,0.10)'}` : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        ...style,
      }}
    />
  );
}

// ── Spinner & Skeleton ────────────────────────────────────────────────────────
/** Teal spinning ring. Uses a <style> tag for @keyframes (no CSS module needed). */
function Spinner({ size = 20, color = C.teal }: { size?: number; color?: string }) {
  return (
    <>
      <style>{`@keyframes neriah-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        border: `2.5px solid ${color}33`,
        borderTopColor: color,
        animation: 'neriah-spin 0.72s linear infinite',
        display: 'inline-block', flexShrink: 0,
      }} />
    </>
  );
}

/** Single skeleton row for list loading states. */
function SkeletonRow({ width = '100%', height = 56 }: { width?: string | number; height?: number }) {
  return (
    <>
      <style>{`@keyframes neriah-shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }`}</style>
      <div style={{
        width, height, borderRadius: 10, marginBottom: 8,
        background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
        backgroundSize: '200% 100%',
        animation: 'neriah-shimmer 1.4s infinite',
      }} />
    </>
  );
}

// ── Demo API ──────────────────────────────────────────────────────────────────
export const DEMO_API = 'https://us-central1-neriah-ai-492302.cloudfunctions.net/neriah-demo/api';

export async function demoFetch(path: string, opts: RequestInit = {}, token?: string | null) {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    Object.assign(headers, opts.headers ?? {});
    const res = await fetch(`${DEMO_API}${path}`, { ...opts, headers });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
type TScreen = 'welcome' | 'phone' | 'otp' | 'register' | 'classes' | 'class-setup' | 'class-join-code' | 'class-detail' | 'add-homework' | 'review-scheme' | 'homework-created' | 'homework-list' | 'homework-detail' | 'grade-all' | 't-settings' | 'edit-profile' | 'grading-detail' | 'grading-results' | 'inbox' | 'analytics' | 'student-analytics' | 'homework-analytics' | 't-assistant';

// ── DemoClass ─────────────────────────────────────────────────────────────────
interface DemoClass {
  id:              string;
  name:            string;
  subject:         string;
  education_level: string;
  description:     string;
  join_code:       string;
  student_count:   number;
  homework_count:  number;
  created_at:      string;
}

// ── ReviewQuestion type (mirrors mobile ReviewQuestion) ───────────────────────
interface ReviewQuestion {
  question_number: number;
  question_text:   string;
  answer:          string;   // "answer" OR "correct_answer" from backend — normalised below
  marks:           number;
  marking_notes?:  string | null;
}

// Normalise a raw API question object into ReviewQuestion (handles both field name variants)
function normaliseQ(q: any, i: number): ReviewQuestion {
  return {
    question_number: q.question_number ?? q.number ?? i + 1,
    question_text:   q.question_text   ?? q.text   ?? '',
    answer:          q.answer          ?? q.correct_answer ?? '',
    marks:           Number(q.marks    ?? q.max_marks      ?? 1),
    marking_notes:   q.marking_notes   ?? null,
  };
}

// Fallback questions shown when the API is unreachable (e.g. no auth token in demo)
const DEMO_QUESTIONS: ReviewQuestion[] = [
  { question_number: 1, question_text: 'Solve for x:  2x + 5 = 11',                                                    answer: 'x = 3',  marks: 2, marking_notes: null },
  { question_number: 2, question_text: 'Calculate 15% of 200.',                                                         answer: '30',     marks: 2, marking_notes: null },
  { question_number: 3, question_text: 'Find the area of a rectangle with length 8 cm and width 5 cm.',                 answer: '40 cm²', marks: 2, marking_notes: 'Accept 40 sq cm or 40 cm squared' },
  { question_number: 4, question_text: 'Simplify: 3(2x + 4) − 2(x − 1)',                                               answer: '4x + 14', marks: 2, marking_notes: null },
  { question_number: 5, question_text: 'A bag has 3 red and 7 blue marbles. What is the probability of picking red?',   answer: '3/10',   marks: 2, marking_notes: 'Also accept 0.3 or 30%' },
];

// ── HomeworkInfo + StudentGrade ───────────────────────────────────────────────
interface HomeworkInfo {
  id:               string;
  title:            string;
  subject:          string;
  education_level:  string;
  question_count:   number;
  total_marks:      number;
  answer_key_id:    string;
  submission_count: number;
  is_open:          boolean;
}

interface StudentGrade {
  student_id:   string;
  student_name: string;
  score:        number;
  max_score:    number;
  percentage:   number;
  verdicts: Array<{
    question_number: number;
    verdict:         'correct' | 'incorrect' | 'partial';
    awarded:         number;
    max:             number;
  }>;
}

interface DemoVerdict {
  question_number: number;
  verdict:         'correct' | 'incorrect' | 'partial';
  awarded:         number;
  max:             number;
  student_answer?: string;
  correct_answer?: string;
  question_text?:  string;
  feedback?:       string;
}

interface DemoSubmissionDetail {
  submissionId: string;
  studentName:  string;
  submittedAt:  string;
  grade:        StudentGrade;
  verdicts:     DemoVerdict[];
}

interface DemoAnalyticsStudent {
  student_id:       string;
  name:             string;
  latest_score:     number;
  average_score:    number;
  submission_count: number;
  trend:            'up' | 'down' | 'stable';
}

interface DemoClassAnalytics {
  class_id:         string;
  class_name:       string;
  subject:          string;
  class_average:    number;
  highest_score:    number;
  lowest_score:     number;
  submitted:        number;
  total_students:   number;
  submission_rate:  string;
  students:         DemoAnalyticsStudent[];
}

interface DemoScoreTrendEntry {
  homework_title: string;
  score_pct:      number;
}

interface DemoStudentAnalytics {
  student_id:    string;
  name:          string;
  class_average: number;
  average_score: number;
  score_trend:   DemoScoreTrendEntry[];
  weak_topics:   string[];
}

const DEMO_CLASS_ANALYTICS: DemoClassAnalytics = {
  class_id: 'demo-class-1', class_name: 'Form 2A', subject: 'Mathematics',
  class_average: 57, highest_score: 70, lowest_score: 40,
  submitted: 3, total_students: 3, submission_rate: '3 of 3 students submitted',
  students: [
    { student_id: 'demo-student-1', name: 'Tendai Moyo',    latest_score: 70, average_score: 70, submission_count: 1, trend: 'stable' },
    { student_id: 'demo-student-2', name: 'Chipo Dube',     latest_score: 60, average_score: 60, submission_count: 1, trend: 'up'     },
    { student_id: 'demo-student-3', name: 'Takudzwa Ncube', latest_score: 40, average_score: 40, submission_count: 1, trend: 'down'   },
  ],
};

const DEMO_STUDENT_ANALYTICS: Record<string, DemoStudentAnalytics> = {
  'demo-student-1': {
    student_id: 'demo-student-1', name: 'Tendai Moyo',
    class_average: 57, average_score: 69,
    score_trend: [
      { homework_title: 'Ch.3 Quiz', score_pct: 65 },
      { homework_title: 'Ch.4 Test', score_pct: 72 },
      { homework_title: 'Ch.5 Test', score_pct: 70 },
    ],
    weak_topics: ['Probability', 'Area formulas'],
  },
  'demo-student-2': {
    student_id: 'demo-student-2', name: 'Chipo Dube',
    class_average: 57, average_score: 55,
    score_trend: [
      { homework_title: 'Ch.3 Quiz', score_pct: 50 },
      { homework_title: 'Ch.4 Test', score_pct: 55 },
      { homework_title: 'Ch.5 Test', score_pct: 60 },
    ],
    weak_topics: ['Area and perimeter', 'Percentages'],
  },
  'demo-student-3': {
    student_id: 'demo-student-3', name: 'Takudzwa Ncube',
    class_average: 57, average_score: 48,
    score_trend: [
      { homework_title: 'Ch.3 Quiz', score_pct: 55 },
      { homework_title: 'Ch.4 Test', score_pct: 48 },
      { homework_title: 'Ch.5 Test', score_pct: 40 },
    ],
    weak_topics: ['Algebra', 'Probability', 'Percentages'],
  },
};

const DEMO_HOMEWORK: HomeworkInfo = {
  id:               'demo-hw-1',
  title:            'Chapter 5 Maths Test',
  subject:          'Mathematics',
  education_level:  'Form 2',
  question_count:   5,
  total_marks:      10,
  answer_key_id:    'demo-key',
  submission_count: 2,
  is_open:          true,
};

const DEMO_GRADES: StudentGrade[] = [
  {
    student_id: 's1', student_name: 'Tendai Moyo',
    score: 7, max_score: 10, percentage: 70,
    verdicts: [
      { question_number: 1, verdict: 'correct',   awarded: 2, max: 2 },
      { question_number: 2, verdict: 'correct',   awarded: 2, max: 2 },
      { question_number: 3, verdict: 'partial',   awarded: 1, max: 2 },
      { question_number: 4, verdict: 'correct',   awarded: 2, max: 2 },
      { question_number: 5, verdict: 'incorrect', awarded: 0, max: 2 },
    ],
  },
  {
    student_id: 's2', student_name: 'Chipo Dube',
    score: 6, max_score: 10, percentage: 60,
    verdicts: [
      { question_number: 1, verdict: 'correct',   awarded: 2, max: 2 },
      { question_number: 2, verdict: 'partial',   awarded: 1, max: 2 },
      { question_number: 3, verdict: 'incorrect', awarded: 0, max: 2 },
      { question_number: 4, verdict: 'correct',   awarded: 2, max: 2 },
      { question_number: 5, verdict: 'partial',   awarded: 1, max: 2 },
    ],
  },
  {
    student_id: 's3', student_name: 'Takudzwa Ncube',
    score: 4, max_score: 10, percentage: 40,
    verdicts: [
      { question_number: 1, verdict: 'correct',   awarded: 2, max: 2 },
      { question_number: 2, verdict: 'incorrect', awarded: 0, max: 2 },
      { question_number: 3, verdict: 'partial',   awarded: 1, max: 2 },
      { question_number: 4, verdict: 'incorrect', awarded: 0, max: 2 },
      { question_number: 5, verdict: 'partial',   awarded: 1, max: 2 },
    ],
  },
];

// Chipo Dube's demo grade (6/10, 60%) — used on the student phone feedback screen
const DEMO_STUDENT_GRADE = (() => DEMO_GRADES[1])();

function normaliseGrade(g: any, i: number): StudentGrade {
  const score     = Number(g.score      ?? g.total_score ?? 0);
  const max_score = Number(g.max_score  ?? g.total_marks ?? 10);
  return {
    student_id:   g.student_id   ?? `s${i}`,
    student_name: g.student_name ?? g.name ?? `Student ${i + 1}`,
    score,
    max_score,
    percentage: max_score > 0 ? Math.round((score / max_score) * 100) : 0,
    verdicts: Array.isArray(g.verdicts) ? g.verdicts.map((v: any) => ({
      question_number: Number(v.question_number ?? v.q_num  ?? 0),
      verdict:         (v.verdict ?? v.result    ?? 'incorrect') as 'correct' | 'incorrect' | 'partial',
      awarded:         Number(v.awarded          ?? v.marks_awarded ?? 0),
      max:             Number(v.max              ?? v.max_marks     ?? v.marks ?? 0),
    })) : [],
  };
}

// Safety-net JSON cleaner — handles code fences and pre-parsed objects
function cleanJson(raw: unknown): { questions?: unknown[]; total_marks?: number; answer_key_id?: string; [key: string]: unknown } {
  if (raw !== null && typeof raw === 'object') return raw as ReturnType<typeof cleanJson>;
  if (typeof raw !== 'string') return { questions: [], total_marks: 0 };
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { questions: [], total_marks: 0 };
  }
}

function scoreColor(pct: number): string {
  if (pct >= 70) return C.green;
  if (pct >= 50) return C.amber500;
  return C.red;
}
function scoreBg(pct: number): string {
  if (pct >= 70) return C.greenLt;
  if (pct >= 50) return C.amber50;
  return C.redLt;
}

// Student phone screen type
type SStudentScreen = 's-welcome' | 's-phone' | 's-otp' | 's-teacher' | 's-register' | 's-home' | 's-submit' | 's-capture' | 's-success' | 's-results' | 's-feedback' | 's-tutor' | 's-settings' | 's-classes';

interface TutorMessage {
  id:             string;
  role:           'user' | 'ai';
  content:        string;
  imageBase64?:   string;
  imageMimeType?: string;
  ts:             number;
}

// Socratic fallback responses shown when the API is unreachable in the demo
const DEMO_TUTOR_RESPONSES = [
  "Great question! Before I answer, what do you already know about this topic?",
  "You're thinking about it the right way. What operation do you think we should apply first?",
  "Interesting! Let's break it down. What would happen if we tried the simplest case first?",
  "Almost there — look at your working again. Do you notice anything that might need adjusting?",
  "Good effort! Think about which rule applies here. Can you name it?",
  "Let me ask you this: what would the answer look like if the numbers were much simpler?",
  "You've got the right idea. Now apply it step by step and tell me what you get.",
];

// ── Subject list ──────────────────────────────────────────────────────────────
const COMMON_SUBJECTS = [
  'Mathematics', 'English Language', 'English Literature', 'Science',
  'Physics', 'Chemistry', 'Biology', 'Geography', 'History',
  'Religious Studies', 'Agriculture', 'Commerce', 'Accounts', 'Economics',
  'Computer Science', 'Art', 'Music', 'Physical Education',
  'Shona', 'Ndebele', 'French', 'Food and Nutrition',
  'Fashion and Fabrics', 'Technical Graphics', 'Building Studies',
];

// ── Shared: scrollbar-hiding CSS ──────────────────────────────────────────────
const SCROLLBAR_HIDE_CSS = `
.neriah-screen::-webkit-scrollbar { display: none; }
.neriah-screen { scrollbar-width: none; -ms-overflow-style: none; }
`;

// ── Shared: screen scroll wrapper ─────────────────────────────────────────────
function Screen({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="neriah-screen" style={{
      flex: 1,
      overflowY: 'auto',
      overflowX: 'hidden',
      scrollBehavior: 'smooth',
      background: C.white,
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}>
      <style>{SCROLLBAR_HIDE_CSS}</style>
      {children}
    </div>
  );
}

// ── In-app camera modal (browser MediaDevices API) ────────────────────────────
// Used instead of <input capture="environment"> so the camera stays inside the app.
// Returns base64 JPEG via onCapture. Falls back to an error message if permission denied.

interface WebCameraModalProps {
  open: boolean;
  onCapture: (base64: string, mimeType: string) => void;
  onClose: () => void;
}

// ── Canvas quality analysis (mirrors mobile imageQuality.ts heuristics) ──────
// Samples a 64×64 greyscale thumbnail from the canvas to compute mean brightness
// and contrast (std-dev). Also checks aspect ratio against document expectations.
function analyseCanvasQuality(
  canvas: HTMLCanvasElement,
): { warnings: string[] } {
  const warnings: string[] = [];
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return { warnings };

    // Sample a 64×64 region from the centre of the captured frame
    const SAMPLE = 64;
    const sx = Math.max(0, (canvas.width  - SAMPLE) / 2);
    const sy = Math.max(0, (canvas.height - SAMPLE) / 2);
    const sw = Math.min(SAMPLE, canvas.width);
    const sh = Math.min(SAMPLE, canvas.height);
    const imageData = ctx.getImageData(sx, sy, sw, sh);
    const data = imageData.data; // RGBA flat array

    // Convert to greyscale values
    const greys: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      // Luma: 0.299R + 0.587G + 0.114B
      greys.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }

    const mean = greys.reduce((a, b) => a + b, 0) / greys.length;
    const variance = greys.reduce((a, b) => a + (b - mean) ** 2, 0) / greys.length;
    const stdDev = Math.sqrt(variance);

    // Brightness check — below ~45/255 is likely underexposed
    if (mean < 45) {
      warnings.push('Image may be too dark. Move to better lighting and retake.');
    }

    // Contrast check — std-dev below ~18 suggests flat / low-contrast image
    if (stdDev < 18) {
      warnings.push('Image contrast is low — text may not be readable. Ensure good lighting.');
    }

    // Aspect ratio check — very square images suggest the page is not fully visible
    const ratio = canvas.width / canvas.height;
    if (ratio > 0.92 && ratio < 1.08) {
      warnings.push('Image looks square — make sure the full page is visible.');
    }
    if (ratio > 2.0 || ratio < 0.35) {
      warnings.push('The page looks tilted or cut off. Straighten and retake.');
    }
  } catch {
    // Non-fatal
  }
  return { warnings };
}

// ── Canvas auto-enhancement (mirrors mobile imageEnhance.ts) ─────────────────
// Applies a mild auto-levels stretch (clips darkest and brightest 1%) and caps
// the longest side at 2048px. Returns a new data-URL at 0.85 JPEG quality.
function enhanceCanvas(src: HTMLCanvasElement): string {
  try {
    const ctx = src.getContext('2d');
    if (!ctx) return src.toDataURL('image/jpeg', 0.85);

    // Resize if needed (max 2048px on longest side)
    const MAX = 2048;
    let w = src.width;
    let h = src.height;
    if (Math.max(w, h) > MAX) {
      if (w >= h) { h = Math.round((h / w) * MAX); w = MAX; }
      else        { w = Math.round((w / h) * MAX); h = MAX; }
    }

    const out = document.createElement('canvas');
    out.width  = w;
    out.height = h;
    const octx = out.getContext('2d')!;
    octx.drawImage(src, 0, 0, w, h);

    // Auto-levels: collect grey histogram on a 64×64 sample, then stretch
    const sample = octx.getImageData(0, 0, Math.min(64, w), Math.min(64, h));
    const greys: number[] = [];
    for (let i = 0; i < sample.data.length; i += 4) {
      greys.push(0.299 * sample.data[i] + 0.587 * sample.data[i + 1] + 0.114 * sample.data[i + 2]);
    }
    greys.sort((a, b) => a - b);
    const lo = greys[Math.floor(greys.length * 0.01)] ?? 0;
    const hi = greys[Math.floor(greys.length * 0.99)] ?? 255;
    const range = hi - lo || 1;

    // Apply stretch to full image via pixel manipulation on a small sample area is
    // expensive; instead use a CSS-filter-equivalent via canvas globalCompositeOperation.
    // Stretch = scale brightness by 255/range then subtract lo.
    // We apply it via a multiply + lighten pass using compositing.
    const scale = 255 / range;
    const shift  = -lo * scale;

    // Draw with brightness/contrast using filter (supported in all modern browsers)
    // contrast(scale) brightens the range; the shift is approximated.
    const contrastPct  = Math.min(Math.round(scale * 100), 250);
    const brightnessPct = Math.round(100 + (shift / 255) * 100);
    octx.filter = `contrast(${contrastPct}%) brightness(${brightnessPct}%)`;
    octx.drawImage(out, 0, 0);
    octx.filter = 'none';

    return out.toDataURL('image/jpeg', 0.85);
  } catch {
    return src.toDataURL('image/jpeg', 0.85);
  }
}

// ── Shared: load any image data-URL into a canvas, run quality + enhance ──────
// Used by gallery file pickers in both teacher and student web components.
// Mirrors the mobile processPickedImage() pipeline.
function analyseAndEnhanceWebImage(
  dataUrl: string,
): Promise<{ base64: string; warnings: string[]; enhanced: boolean }> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ base64: dataUrl.split(',')[1], warnings: [], enhanced: false });
        return;
      }
      ctx.drawImage(img, 0, 0);

      // Quality analysis
      const { warnings } = analyseCanvasQuality(canvas);

      // Additional dimension check (mirrors mobile MIN_SHORT_SIDE_PX = 600)
      if (img.naturalWidth < 400 || img.naturalHeight < 400) {
        warnings.push('Resolution is low — text may not be readable. Try a clearer image.');
      }

      // Enhancement: auto-levels + resize
      const enhancedDataUrl = enhanceCanvas(canvas);
      resolve({ base64: enhancedDataUrl.split(',')[1], warnings, enhanced: true });
    };
    img.onerror = () => {
      resolve({ base64: dataUrl.split(',')[1], warnings: [], enhanced: false });
    };
    img.src = dataUrl;
  });
}

function WebCameraModal({ open, onCapture, onClose }: WebCameraModalProps) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);

  interface WebPreview { dataUrl: string; warnings: string[] }
  const [preview, setPreview]   = useState<WebPreview | null>(null);
  const [error, setError]       = useState<string>('');
  const [started, setStarted]   = useState(false);
  const [processing, setProcessing] = useState(false);

  // ── Stream lifecycle ────────────────────────────────────────────────────────

  const startStream = useCallback((onDone?: () => void) => {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setStarted(true);
        onDone?.();
      })
      .catch(() => {
        setError('Camera access denied. Please allow camera access in your browser settings or use Gallery/PDF instead.');
      });
  }, []);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setError('');
    setStarted(false);
    setProcessing(false);
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setStarted(true);
      })
      .catch(() => {
        if (!cancelled) setError('Camera access denied. Please allow camera access in your browser settings or use Gallery/PDF instead.');
      });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open && streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setStarted(false);
    }
  }, [open]);

  // ── Capture → enhance → quality check ────────────────────────────────────────

  const handleCapture = () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    setProcessing(true);

    // Snapshot from live feed
    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setProcessing(false); return; }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Stop live feed while processing/previewing
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setStarted(false);

    // Quality analysis on raw capture
    const { warnings } = analyseCanvasQuality(canvas);

    // Enhancement: auto-levels + resize — runs synchronously on canvas
    const enhancedDataUrl = enhanceCanvas(canvas);

    setPreview({ dataUrl: enhancedDataUrl, warnings });
    setProcessing(false);
  };

  const handleUsePhoto = () => {
    if (!preview) return;
    const base64 = preview.dataUrl.split(',')[1];
    onCapture(base64, 'image/jpeg');
    setPreview(null);
  };

  const handleRetake = () => {
    setPreview(null);
    setError('');
    startStream();
  };

  const handleClose = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setPreview(null);
    setError('');
    setStarted(false);
    setProcessing(false);
    onClose();
  };

  if (!open) return null;

  const hasWarnings = (preview?.warnings.length ?? 0) > 0;

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.88)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const boxStyle: React.CSSProperties = {
    background: C.darkBg,
    borderRadius: 16,
    width: '100%', maxWidth: 480,
    margin: '0 16px',
    overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
  };

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div style={boxStyle}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${C.g700}` }}>
          <span style={{ color: C.nearWhite, fontWeight: 700, fontSize: 15 }}>Take Photo</span>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g400, padding: 4, display: 'flex', alignItems: 'center' }}><X size={18} /></button>
        </div>

        {/* Quality warning banner — shown on preview when issues detected */}
        {preview && hasWarnings && (
          <div style={{ background: C.amber900, padding: '10px 16px' }}>
            <div style={{ color: C.amberFaint, fontWeight: 700, fontSize: 12, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
              <AlertTriangle size={13} />
              <span>Image may be unclear — Gemma may struggle to read it. Retake for better results.</span>
            </div>
            {preview.warnings.map((w, i) => (
              <div key={i} style={{ color: C.amber200, fontSize: 11, lineHeight: 1.5 }}>· {w}</div>
            ))}
          </div>
        )}

        {/* Body */}
        <div style={{ position: 'relative', background: C.black, minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {error ? (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', color: C.red500 }}><XCircle size={36} /></div>
              <div style={{ color: C.nearWhite, fontSize: 14, lineHeight: 1.6, maxWidth: 320 }}>{error}</div>
            </div>
          ) : processing ? (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <div style={{ color: C.g400, fontSize: 13 }}>Enhancing photo…</div>
            </div>
          ) : preview ? (
            // Enhanced preview
            <img src={preview.dataUrl} alt="Captured" style={{ width: '100%', maxHeight: 360, objectFit: 'contain', display: 'block' }} />
          ) : (
            // Live viewfinder + document frame overlay
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                style={{ width: '100%', maxHeight: 360, display: 'block', objectFit: 'cover' }}
              />
              {started && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <div style={{ width: '78%', height: '82%', position: 'relative' }}>
                    {/* Teal corner brackets — same pattern as mobile frame overlay */}
                    {(['tl','tr','bl','br'] as const).map(pos => (
                      <div key={pos} style={{
                        position: 'absolute',
                        width: 22, height: 22,
                        top:    pos.startsWith('t') ? 0 : 'auto',
                        bottom: pos.startsWith('b') ? 0 : 'auto',
                        left:   pos.endsWith('l')   ? 0 : 'auto',
                        right:  pos.endsWith('r')   ? 0 : 'auto',
                        borderTop:    pos.startsWith('t') ? `3px solid ${C.teal300}` : 'none',
                        borderBottom: pos.startsWith('b') ? `3px solid ${C.teal300}` : 'none',
                        borderLeft:   pos.endsWith('l')   ? `3px solid ${C.teal300}` : 'none',
                        borderRight:  pos.endsWith('r')   ? `3px solid ${C.teal300}` : 'none',
                        borderRadius: pos === 'tl' ? '4px 0 0 0' : pos === 'tr' ? '0 4px 0 0' : pos === 'bl' ? '0 0 0 4px' : '0 0 4px 0',
                      }} />
                    ))}
                    <div style={{ position: 'absolute', bottom: -24, left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,0.75)', fontSize: 11 }}>
                      Align the page within the frame
                    </div>
                  </div>
                </div>
              )}
              {!started && !error && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ color: C.g400, fontSize: 13 }}>Starting camera…</div>
                </div>
              )}
            </>
          )}
          {/* Hidden canvas used for snapshot + quality analysis */}
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>

        {/* Actions */}
        <div style={{ padding: '16px 18px', display: 'flex', gap: 10 }}>
          {preview ? (
            <>
              <button onClick={handleRetake} style={{ flex: 1, padding: '12px 0', border: `2px solid ${C.teal300}`, borderRadius: 10, background: 'transparent', color: C.teal300, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                Retake
              </button>
              <button
                onClick={handleUsePhoto}
                style={{ flex: 1, padding: '12px 0', border: 'none', borderRadius: 10, background: hasWarnings ? C.amber : C.teal, color: C.white, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.15s' }}
              >
                {hasWarnings ? 'Use Anyway' : 'Use Photo'}
              </button>
            </>
          ) : error ? (
            <button onClick={handleClose} style={{ flex: 1, padding: '12px 0', border: 'none', borderRadius: 10, background: C.teal, color: C.white, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
              Close
            </button>
          ) : (
            <>
              <button onClick={handleClose} style={{ flex: 1, padding: '12px 0', border: `1px solid ${C.g700}`, borderRadius: 10, background: 'transparent', color: C.g400, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={handleCapture} disabled={!started || processing} style={{ flex: 2, padding: '12px 0', border: 'none', borderRadius: 10, background: (started && !processing) ? C.teal : C.g700, color: C.white, fontWeight: 700, fontSize: 14, cursor: (started && !processing) ? 'pointer' : 'not-allowed', fontFamily: 'inherit', transition: 'background 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Camera size={16} /><span>Capture</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Country list for phone input ──────────────────────────────────────────────
const PHONE_EXAMPLES: Record<string, string> = {
  '+263': '77 123 4567', '+27': '82 123 4567', '+260': '97 123 4567',
  '+265': '991 23 4567', '+254': '712 345 678', '+255': '712 345 678',
  '+256': '712 345 678', '+233': '24 123 4567', '+234': '801 234 5678',
  '+267': '71 234 567', '+258': '82 123 4567', '+264': '81 123 4567',
  '+251': '91 123 4567', '+1': '(555) 123-4567', '+44': '7700 900123',
  '+91': '98765 43210',
};
function getPhoneExample(dialCode: string): string { return PHONE_EXAMPLES[dialCode] ?? 'e.g. 712 345 678'; }
interface PhoneCountry { flag: string; name: string; dialCode: string; code: string; digits?: number; }
const PHONE_COUNTRIES: PhoneCountry[] = [
  { flag: '🇿🇼', name: 'Zimbabwe',       dialCode: '+263', code: 'ZW', digits: 9 },
  { flag: '🇿🇦', name: 'South Africa',   dialCode: '+27',  code: 'ZA', digits: 9 },
  { flag: '🇿🇲', name: 'Zambia',         dialCode: '+260', code: 'ZM', digits: 9 },
  { flag: '🇲🇼', name: 'Malawi',         dialCode: '+265', code: 'MW', digits: 9 },
  { flag: '🇹🇿', name: 'Tanzania',       dialCode: '+255', code: 'TZ', digits: 9 },
  { flag: '🇰🇪', name: 'Kenya',          dialCode: '+254', code: 'KE', digits: 9 },
  { flag: '🇺🇬', name: 'Uganda',         dialCode: '+256', code: 'UG', digits: 9 },
  { flag: '🇬🇭', name: 'Ghana',          dialCode: '+233', code: 'GH', digits: 9 },
  { flag: '🇳🇬', name: 'Nigeria',        dialCode: '+234', code: 'NG', digits: 10 },
  { flag: '🇧🇼', name: 'Botswana',       dialCode: '+267', code: 'BW', digits: 8 },
  { flag: '🇳🇦', name: 'Namibia',        dialCode: '+264', code: 'NA', digits: 9 },
  { flag: '🇲🇿', name: 'Mozambique',     dialCode: '+258', code: 'MZ', digits: 9 },
  { flag: '🇷🇼', name: 'Rwanda',         dialCode: '+250', code: 'RW', digits: 9 },
  { flag: '🇪🇹', name: 'Ethiopia',       dialCode: '+251', code: 'ET', digits: 9 },
  { flag: '🇸🇳', name: 'Senegal',        dialCode: '+221', code: 'SN', digits: 9 },
  { flag: '🇨🇮', name: "Côte d'Ivoire",  dialCode: '+225', code: 'CI', digits: 10 },
  { flag: '🇨🇩', name: 'DRC',            dialCode: '+243', code: 'CD', digits: 9 },
  { flag: '🇦🇴', name: 'Angola',         dialCode: '+244', code: 'AO', digits: 9 },
  { flag: '🇹🇳', name: 'Tunisia',        dialCode: '+216', code: 'TN', digits: 8 },
  { flag: '🇪🇬', name: 'Egypt',          dialCode: '+20',  code: 'EG', digits: 10 },
  { flag: '🇲🇦', name: 'Morocco',        dialCode: '+212', code: 'MA', digits: 9 },
  { flag: '🇩🇿', name: 'Algeria',        dialCode: '+213', code: 'DZ', digits: 9 },
  { flag: '🇺🇸', name: 'United States',  dialCode: '+1',   code: 'US', digits: 10 },
  { flag: '🇬🇧', name: 'United Kingdom', dialCode: '+44',  code: 'GB', digits: 10 },
  { flag: '🇮🇳', name: 'India',          dialCode: '+91',  code: 'IN', digits: 10 },
  { flag: '🇨🇳', name: 'China',          dialCode: '+86',  code: 'CN', digits: 11 },
  { flag: '🇦🇺', name: 'Australia',      dialCode: '+61',  code: 'AU', digits: 9 },
  { flag: '🇨🇦', name: 'Canada',         dialCode: '+1',   code: 'CA', digits: 10 },
];

// Timezone → ISO country code for the most common African/common timezones
const TZ_TO_CODE: Record<string, string> = {
  'Africa/Harare': 'ZW', 'Africa/Johannesburg': 'ZA', 'Africa/Lusaka': 'ZM',
  'Africa/Blantyre': 'MW', 'Africa/Dar_es_Salaam': 'TZ', 'Africa/Nairobi': 'KE',
  'Africa/Kampala': 'UG', 'Africa/Accra': 'GH', 'Africa/Lagos': 'NG',
  'Africa/Gaborone': 'BW', 'Africa/Windhoek': 'NA', 'Africa/Maputo': 'MZ',
  'Africa/Kigali': 'RW', 'Africa/Addis_Ababa': 'ET', 'Africa/Dakar': 'SN',
  'Africa/Abidjan': 'CI', 'Africa/Kinshasa': 'CD', 'Africa/Luanda': 'AO',
  'Africa/Tunis': 'TN', 'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA',
  'Africa/Algiers': 'DZ',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
  'America/Los_Angeles': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA',
  'Europe/London': 'GB', 'Asia/Kolkata': 'IN', 'Asia/Shanghai': 'CN',
  'Australia/Sydney': 'AU',
};

// ── Shared: phone number input row ─────────────────────────────────────────────
function PhoneInputRow({ value, onChange, compact = false }: { value: string; onChange: (digits: string, dialCode: string) => void; compact?: boolean }) {
  const [country, setCountry] = useState<PhoneCountry>(PHONE_COUNTRIES[0]); // Zimbabwe default
  const [open, setOpen]       = useState(false);
  const [search, setSearch]   = useState('');
  const numInputRef           = useRef<HTMLInputElement>(null);
  const containerRef          = useRef<HTMLDivElement>(null);

  // Auto-detect country on mount: sessionStorage cache → IP → browser language → timezone → ZW
  useEffect(() => {
    // 1. Check sessionStorage cache first
    try {
      const cached = sessionStorage.getItem('detected_country');
      if (cached) {
        const { code } = JSON.parse(cached) as { code: string };
        const match = PHONE_COUNTRIES.find(c => c.code === code);
        if (match) { setCountry(match); return; }
      }
    } catch { /* ignore */ }

    // 2. IP geolocation (primary — most reliable)
    (async () => {
      try {
        const res = await fetch('https://ipapi.co/json/');
        if (res.ok) {
          const { country_code } = await res.json() as { country_code?: string };
          if (country_code) {
            const match = PHONE_COUNTRIES.find(c => c.code === country_code);
            if (match) {
              setCountry(match);
              try { sessionStorage.setItem('detected_country', JSON.stringify({ code: country_code })); } catch { /* ignore */ }
              return;
            }
          }
        }
      } catch { /* ignore — fall through */ }

      // 3. Browser language fallback (e.g. "en-ZW" → "ZW")
      try {
        const lang = navigator.language || '';
        const cc = lang.split('-')[1]?.toUpperCase();
        if (cc) {
          const match = PHONE_COUNTRIES.find(c => c.code === cc);
          if (match) {
            setCountry(match);
            try { sessionStorage.setItem('detected_country', JSON.stringify({ code: cc })); } catch { /* ignore */ }
            return;
          }
        }
      } catch { /* ignore */ }

      // 4. Timezone fallback (e.g. "Africa/Harare" → "ZW")
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const cc = TZ_TO_CODE[tz];
        if (cc) {
          const match = PHONE_COUNTRIES.find(c => c.code === cc);
          if (match) {
            setCountry(match);
            try { sessionStorage.setItem('detected_country', JSON.stringify({ code: cc })); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore — Zimbabwe default stays */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false); setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = search
    ? PHONE_COUNTRIES.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) || c.dialCode.includes(search)
      )
    : PHONE_COUNTRIES;

  const handleSelect = (c: PhoneCountry) => {
    setCountry(c); setOpen(false); setSearch('');
    onChange(value, c.dialCode);
    setTimeout(() => numInputRef.current?.focus(), 50);
  };

  return (
    <div ref={containerRef} style={{ display: 'flex', gap: 0, position: 'relative' }}>
      {/* Country selector button */}
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setSearch(''); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          border: `1px solid ${C.g200}`, borderRight: 'none',
          borderRadius: '10px 0 0 10px', paddingInline: 10, paddingBlock: 14,
          background: C.g50, minWidth: 88, whiteSpace: 'nowrap',
          cursor: 'pointer', fontFamily: 'inherit', outline: 'none',
          ...(compact ? { height: 40, boxSizing: 'border-box' as const } : {}),
        }}
      >
        <span style={{ fontSize: 16 }}>{country.flag}</span>
        <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{country.dialCode}</span>
        <span style={{ fontSize: 11, color: C.g500 }}>▾</span>
      </button>

      {/* Phone number input */}
      <input
        ref={numInputRef}
        type="tel"
        inputMode="numeric"
        value={value}
        onChange={e => { const d = e.target.value.replace(/\D/g, '').replace(/^0/, ''); if (d.length <= (country.digits ?? 9)) onChange(e.target.value.replace(/\D/g, ''), country.dialCode); }}
        maxLength={(country.digits ?? 9) + 1}
        placeholder={getPhoneExample(country.dialCode)}
        style={{
          flex: 1, border: `1px solid ${C.g200}`, borderRadius: '0 10px 10px 0',
          padding: '14px 12px', fontSize: 15, color: C.text, outline: 'none',
          fontFamily: 'inherit',
          ...(compact ? { height: 40, boxSizing: 'border-box' as const } : {}),
        }}
      />

      {/* Country dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: C.white, border: `1px solid ${C.g200}`, borderRadius: 10,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 200, overflow: 'hidden',
        }}>
          {/* Search input */}
          <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.g100}` }}>
            <input
              autoFocus
              type="text"
              placeholder="Search country..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box',
                border: `1px solid ${C.g200}`, borderRadius: 7,
                padding: '7px 10px', fontSize: 13, outline: 'none',
                fontFamily: 'inherit', color: C.text,
              }}
            />
          </div>
          {/* Country list */}
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '14px 12px', fontSize: 13, color: C.g400, textAlign: 'center' }}>
                No country found
              </div>
            ) : filtered.map(c => (
              <button
                key={c.name}
                type="button"
                onMouseDown={() => handleSelect(c)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  width: '100%', padding: '9px 12px', border: 'none',
                  background: c.name === country.name ? C.tealLt : 'none',
                  cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 16 }}>{c.flag}</span>
                <span style={{ fontSize: 13, color: C.text, flex: 1 }}>{c.name}</span>
                <span style={{ fontSize: 12, color: C.g500, fontWeight: 600 }}>{c.dialCode}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Welcome / Role Select
// ──────────────────────────────────────────────────────────────────────────────
function WelcomeScreen({ onTeacher, onStudent, highlight }: { onTeacher: () => void; onStudent?: () => void; highlight?: 'teacher' | 'student' }) {
  return (
    <Screen style={{ justifyContent: 'flex-start', padding: '0 20px 32px' }}>
      <style>{`
        @keyframes pulse-teal {
          0%, 100% { box-shadow: 0 4px 14px rgba(13,115,119,0.30), 0 0 0 4px rgba(13,115,119,0.2); }
          50%       { box-shadow: 0 4px 14px rgba(13,115,119,0.30), 0 0 0 8px rgba(13,115,119,0.1); }
        }
        @keyframes pulse-amber {
          0%, 100% { box-shadow: 0 4px 14px rgba(245,166,35,0.30), 0 0 0 4px rgba(245,166,35,0.2); }
          50%       { box-shadow: 0 4px 14px rgba(245,166,35,0.30), 0 0 0 8px rgba(245,166,35,0.1); }
        }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 28, marginBottom: 0 }}>
        <Image src="/images/icon-transparent.png" alt="Neriah" width={80} height={80} style={{ marginBottom: 12, objectFit: 'contain' }} />
        <div style={{ fontSize: 22, fontWeight: 800, color: C.text, textAlign: 'center' }}>
          Welcome to Neriah
        </div>
      </div>

      {/* Role cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
        {/* Teacher */}
        <button
          onClick={onTeacher}
          style={{
            background: C.teal, border: highlight === 'teacher' ? `3px solid ${C.teal}` : 'none',
            borderRadius: 16, padding: '16px 16px',
            cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 6, minHeight: 100, justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(13,115,119,0.30)', transition: 'opacity 0.15s',
            animation: highlight === 'teacher' ? 'pulse-teal 2s ease-in-out infinite' : undefined,
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.92')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          <Briefcase size={34} color={C.white} />
          <span style={{ fontSize: 16, fontWeight: 800, color: C.white }}>I&apos;m a Teacher</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 1.4 }}>
            Mark exercise books with AI
          </span>
        </button>

        {/* Student */}
        <button
          onClick={onStudent}
          style={{
            background: C.amber, border: highlight === 'student' ? `3px solid ${C.amber}` : 'none',
            borderRadius: 16, padding: '16px 16px',
            cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 6, minHeight: 100, justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(245,166,35,0.30)', transition: 'opacity 0.15s',
            animation: highlight === 'student' ? 'pulse-amber 2s ease-in-out infinite' : undefined,
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.92')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          <GraduationCap size={34} color={C.white} />
          <span style={{ fontSize: 16, fontWeight: 800, color: C.white }}>I&apos;m a Student</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 1.4 }}>
            Submit work and get feedback
          </span>
        </button>
      </div>

    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Phone (Login)
// ──────────────────────────────────────────────────────────────────────────────
function PhoneScreen({
  onContinue, onRegister,
}: { onContinue: (phone: string, channel: 'whatsapp' | 'sms') => void; onRegister: () => void }) {
  const [number, setNumber]   = useState('');
  const [dialCode, setDialCode] = useState('+263');
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    const phone = dialCode + number;
    console.log('[Web OTP] Submitting phone:', phone);
    console.log('[Web OTP] Calling:', `${DEMO_API}/demo/auth/send-otp`);
    setLoading(true);
    const res = await demoFetch('/demo/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
    setLoading(false);
    console.log('[Web OTP] Response:', res ? JSON.stringify(res) : 'null (fetch failed or non-2xx)');
    const channel: 'whatsapp' | 'sms' = res?.channel ?? 'sms';
    onContinue(phone, channel);
  };

  return (
    <Screen style={{ justifyContent: 'flex-start', padding: '32px 20px 20px' }}>
      {/* Branding */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 10 }}>
        <Image src="/images/icon-transparent.png" alt="Neriah" width={72} height={72} style={{ marginBottom: 10, objectFit: 'contain' }} />
        <div style={{ fontSize: 20, fontWeight: 800, color: C.g900 }}>Neriah</div>
        <div style={{ fontSize: 12, color: C.g500, marginTop: 4, textAlign: 'center', lineHeight: 1.4 }}>
          AI homework marking for African schools
        </div>
      </div>

      {/* Form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.g900, marginTop: 8 }}>Phone number</div>
        <PhoneInputRow value={number} onChange={(digits, dc) => { setNumber(digits); setDialCode(dc); }} />

        <button
          onClick={handleContinue}
          disabled={number.length < 7 || loading}
          style={{
            marginTop: 14, background: (number.length >= 7 && !loading) ? C.teal : C.teal100,
            border: 'none', borderRadius: 10, padding: '12px 16px',
            cursor: (number.length >= 7 && !loading) ? 'pointer' : 'not-allowed',
            color: C.white, fontWeight: 700, fontSize: 15, fontFamily: 'inherit', transition: 'background 0.15s',
          }}
        >
          {loading ? 'Sending code…' : 'Continue'}
        </button>
      </div>

      <div style={{ marginTop: 14, textAlign: 'center', fontSize: 12, color: C.g500, lineHeight: 1.5 }}>
        By continuing you agree to Neriah's terms of service.{'\n'}Standard SMS rates may apply.
      </div>

      <button
        onClick={onRegister}
        style={{ marginTop: 6, background: 'none', border: 'none', cursor: 'pointer', color: C.teal, fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}
      >
        New user? Register here
      </button>
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: OTP
// ──────────────────────────────────────────────────────────────────────────────
function maskWebPhone(phone: string): string {
  // "+263771234567" → "+263 •••• •••• 67"
  // Keep first 4 chars (country code), mask middle, show last 2
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return phone;
  const last2 = digits.slice(-2);
  const cc = phone.startsWith('+') ? phone.slice(0, 4) : phone.slice(0, 3);
  return `${cc} •••• •••• ${last2}`;
}

const OTP_SHAKE_CSS = `
@keyframes otp-shake {
  0%, 100% { transform: translateX(0); }
  20%  { transform: translateX(-7px); }
  40%  { transform: translateX(7px); }
  60%  { transform: translateX(-4px); }
  80%  { transform: translateX(4px); }
}
.otp-shake { animation: otp-shake 0.5s ease-in-out; }
`;

function OTPScreen({
  phone, channel, onVerify, onBack,
}: {
  phone:    string;
  channel:  'whatsapp' | 'sms';
  onVerify: () => void;
  onBack:   () => void;
}) {
  const [digits, setDigits]   = useState<string[]>(Array(6).fill(''));
  const [cooldown, setCooldown] = useState(60);
  const [error, setError]     = useState('');
  const [shake, setShake]     = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>(Array(6).fill(null));

  // auto-focus first box on mount
  useEffect(() => { setTimeout(() => inputRefs.current[0]?.focus(), 300); }, []);

  // countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 550);
  };

  const handleVerify = async () => {
    const code = digits.join('');
    if (code.length !== 6) return;
    setLoading(true);
    setError('');
    const res = await demoFetch('/demo/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    setLoading(false);
    // Demo accepts any 6-digit code. If backend is unreachable (res===null), still proceed.
    if (res?.success || res === null) {
      onVerify();
    } else {
      triggerShake();
      setError('Incorrect code — try again');
      setDigits(Array(6).fill(''));
      setTimeout(() => inputRefs.current[0]?.focus(), 50);
    }
  };

  const handleResend = async () => {
    const res = await demoFetch('/demo/auth/resend-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, channel }),
    });
    if (res) {
      setCooldown(60);
      setError('');
      setDigits(Array(6).fill(''));
      inputRefs.current[0]?.focus();
    }
  };

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setError('');
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
    // auto-verify on last digit
    if (digit && index === 5) {
      const code = [...next].join('');
      if (code.length === 6) setTimeout(handleVerify, 80);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') handleVerify();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const next = Array(6).fill('');
    text.split('').forEach((c, i) => { next[i] = c; });
    setDigits(next);
    const focusIdx = Math.min(text.length, 5);
    inputRefs.current[focusIdx]?.focus();
    if (text.length === 6) setTimeout(handleVerify, 80);
  };

  const displayChannel = channel || 'sms';
  const isWa      = displayChannel === 'whatsapp';
  const iconColor = isWa ? C.waGreen : C.teal;
  const masked    = maskWebPhone(phone);
  const allFilled = digits.every(d => d !== '');

  const formatCd = (s: number) => `0:${String(s).padStart(2, '0')}`;

  return (
    <Screen style={{ padding: 16, paddingTop: 20 }}>
      <style>{OTP_SHAKE_CSS}</style>

      <div style={{ marginBottom: 16 }}>
        <BackButton label="Back" onClick={onBack} />
      </div>

      {/* Channel badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {isWa
          ? <MessageCircle size={22} color={C.waGreen} />
          : <MessageSquare size={22} color={C.teal} />}
        <span style={{ fontSize: 14, fontWeight: 700, color: iconColor }}>
          {isWa ? 'Check your WhatsApp' : 'Check your messages'}
        </span>
      </div>

      <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 4 }}>Enter your code</div>
      <div style={{ fontSize: 13, color: C.g500, lineHeight: 1.5, marginBottom: 18 }}>
        {isWa ? 'We sent a code to your WhatsApp' : 'We sent a code to your phone'}{' '}
        <span style={{ color: C.text, fontWeight: 600 }}>{masked}</span>
      </div>

      {/* 6-box OTP input */}
      <div
        className={shake ? 'otp-shake' : ''}
        onPaste={handlePaste}
        style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 16 }}
      >
        {digits.map((d, i) => (
          <input
            key={i}
            ref={el => { inputRefs.current[i] = el; }}
            type="tel"
            inputMode="numeric"
            maxLength={2}
            value={d}
            onChange={e => handleDigitChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            style={{
              width: 44, height: 56, borderRadius: 10, fontSize: 24, fontWeight: 800,
              textAlign: 'center', fontFamily: 'monospace',
              border: `2px solid ${error ? C.red : d ? iconColor : C.g200}`,
              outline: 'none', color: C.text,
              background: error ? C.redLt : d ? (isWa ? C.greenLt : C.tealLt) : C.white,
              transition: 'border-color 0.12s, background 0.12s',
              boxSizing: 'border-box',
            }}
          />
        ))}
      </div>

      {/* Error message */}
      {error && (
        <div style={{ color: C.red, fontSize: 13, textAlign: 'center', marginBottom: 10, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {/* Verify button */}
      <button
        onClick={handleVerify}
        disabled={!allFilled || loading}
        style={{
          background: (allFilled && !loading) ? C.teal : C.teal100,
          border: 'none', borderRadius: 10, padding: '12px 16px',
          cursor: (allFilled && !loading) ? 'pointer' : 'not-allowed',
          color: C.white, fontWeight: 700, fontSize: 15, fontFamily: 'inherit', marginBottom: 10,
          width: '100%', transition: 'background 0.15s',
        }}
      >
        {loading ? 'Verifying…' : 'Verify'}
      </button>

      {/* Resend with countdown */}
      <button
        disabled={cooldown > 0 || loading}
        onClick={handleResend}
        style={{
          background: 'none', border: 'none',
          cursor: (cooldown > 0 || loading) ? 'not-allowed' : 'pointer',
          color: (cooldown > 0 || loading) ? C.g400 : C.teal,
          fontWeight: 600, fontSize: 13, fontFamily: 'inherit', padding: 4,
          width: '100%', textAlign: 'center',
        }}
      >
        {cooldown > 0 ? `Resend code in ${formatCd(cooldown)}` : 'Resend code'}
      </button>
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Teacher Register
// ──────────────────────────────────────────────────────────────────────────────
const TITLES = ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr', 'Prof', 'Sir'];

const ZW_SCHOOLS = [
  'Harare High School', 'Prince Edward School', 'St Georges College',
  'Allan Wilson High School', 'Goromonzi High School', 'Churchill High School',
  'Borrowdale College', 'St Johns College', 'Chisipite Senior School',
  'Dominican Convent High School', 'Arundel School', 'Gateway High School',
  'Hellenic Academy', 'Hillside Teachers College', 'Morgan High School',
  'Mutare Boys High School', 'Mutare Girls High School', 'Bulawayo High School',
  'Milton High School', 'Townsend High School', 'Gifford High School',
  'Petra High School', 'Marist Brothers Dete', 'Regina Mundi High School',
  'St Ignatius College', 'Peterhouse Boys School', 'Falcon College',
  'Eagle School', 'Guinea Fowl School', 'Whitestone School',
];

function SchoolPickerInline({
  value,
  onChange,
  placeholder = 'Search for your school…',
}: {
  value: string;
  onChange: (school: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery]     = useState(value);
  const [open, setOpen]       = useState(false);
  const [cursor, setCursor]   = useState(-1);
  const inputRef  = useRef<HTMLInputElement>(null);
  const listRef   = useRef<HTMLDivElement>(null);

  // Keep query in sync when parent resets value
  useEffect(() => { setQuery(value); }, [value]);

  const filtered = ZW_SCHOOLS.filter(s =>
    s.toLowerCase().includes(query.toLowerCase())
  );
  const noMatch = query.trim().length > 0 && filtered.length === 0;

  const select = (name: string) => {
    onChange(name);
    setQuery(name);
    setOpen(false);
    setCursor(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) { setOpen(true); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cursor >= 0 && filtered[cursor]) {
        select(filtered[cursor]);
      } else if (query.trim()) {
        // Custom school entry
        select(query.trim());
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const handleBlur = () => {
    // Delay so mousedown on a list item fires before blur hides the list
    setTimeout(() => {
      setOpen(false);
      // If typed value doesn't exactly match a school, treat it as custom entry
      if (query.trim()) onChange(query.trim());
    }, 160);
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (cursor >= 0 && listRef.current) {
      const item = listRef.current.children[cursor] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [cursor]);

  return (
    <div style={{ position: 'relative' }}>
      {/* Search input */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        border: `1px solid ${open ? C.teal : C.g200}`, borderRadius: 10,
        padding: '0 12px', background: C.white,
        transition: 'border-color 0.12s',
        height: 40, boxSizing: 'border-box' as const,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.g400} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); setCursor(-1); onChange(''); }}
          onFocus={() => setOpen(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1, border: 'none', outline: 'none', padding: 0,
            fontSize: 13, color: C.text, background: 'transparent', fontFamily: 'inherit',
          }}
        />
        {query && (
          <button
            onMouseDown={e => { e.preventDefault(); setQuery(''); onChange(''); inputRef.current?.focus(); setOpen(true); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: C.g400, lineHeight: 1 }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Inline dropdown */}
      {open && (
        <div
          ref={listRef}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: C.white, border: `1px solid ${C.g200}`, borderRadius: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,0.10)', zIndex: 100,
            maxHeight: 220, overflowY: 'auto',
          }}
        >
          {noMatch ? (
            <div
              onMouseDown={() => select(query.trim())}
              style={{
                padding: '12px 14px', fontSize: 14, color: C.teal,
                cursor: 'pointer', fontWeight: 600, lineHeight: 1.4,
              }}
            >
              School not found — tap to add "{query.trim()}"
            </div>
          ) : (
            filtered.map((school, i) => (
              <div
                key={school}
                onMouseDown={() => select(school)}
                style={{
                  padding: '11px 14px', fontSize: 14,
                  color: school === value ? C.teal : C.text,
                  background: i === cursor ? C.teal50 : school === value ? C.tealLt : C.white,
                  fontWeight: school === value ? 600 : 400,
                  cursor: 'pointer', borderBottom: i < filtered.length - 1 ? `1px solid ${C.g100}` : 'none',
                  transition: 'background 0.08s',
                }}
                onMouseEnter={() => setCursor(i)}
              >
                {school}
                {school === value && (
                  <span style={{ marginLeft: 8, fontSize: 12, color: C.teal }}>✓</span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function RegisterScreen({ onSignIn, onContinue }: { onSignIn: () => void; onContinue: (phone: string, channel: 'whatsapp' | 'sms') => void }) {
  const [title, setTitle]         = useState('');
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname]     = useState('');
  const [number, setNumber]       = useState('');
  const [dialCode, setDialCode]   = useState('+263');
  const [school, setSchool]       = useState('');
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);

  const inputStyle: React.CSSProperties = {
    height: 40, boxSizing: 'border-box',
    border: `1px solid ${C.g200}`, borderRadius: 10, padding: '0 12px',
    fontSize: 13, color: C.text, outline: 'none', width: '100%',
    fontFamily: 'inherit', background: C.white,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 600, color: C.g900, marginBottom: 3, display: 'block',
  };

  const handleCreate = async () => {
    setError('');
    if (!firstName.trim()) { setError('First name is required'); return; }
    if (!surname.trim())   { setError('Surname is required'); return; }
    if (!school.trim())    { setError('School is required'); return; }

    const phone = dialCode + number;
    setLoading(true);

    await demoFetch('/demo/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        first_name: firstName.trim(),
        surname:    surname.trim(),
        phone,
        school:     school.trim(),
      }),
    });

    // After registration, get the OTP channel and navigate
    const otpRes = await demoFetch('/demo/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
    setLoading(false);
    const channel: 'whatsapp' | 'sms' = otpRes?.channel ?? 'sms';
    onContinue(phone, channel);
  };

  return (
    <Screen style={{ padding: '8px 16px 4px', overflowY: 'hidden' }}>
      {/* Back button */}
      <div style={{ marginBottom: 4 }}>
        <BackButton label="Back" onClick={onSignIn} />
      </div>

      {/* Icon badge — 72×72, light teal rounded square, borderRadius 16, teal clipboard 36px */}
      <div style={{
        width: 72, height: 72, borderRadius: 16, background: C.primaryLight,
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6,
      }}>
        <ClipboardList size={36} color={C.teal} />
      </div>

      <div style={{ fontSize: 20, fontWeight: 700, color: C.g900, marginTop: 9, marginBottom: 0 }}>Create teacher account</div>
      <div style={{ fontSize: 13, color: C.g500, marginTop: 3, marginBottom: 0 }}>Enter your details to get started.</div>

      {/* Title pills */}
      <label style={{ ...labelStyle, marginTop: 8 }}>
        Title <span style={{ fontWeight: 400, color: C.g500 }}>(optional)</span>
      </label>
      <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
        {TITLES.map(t => (
          <button
            key={t}
            onClick={() => setTitle(prev => prev === t ? '' : t)}
            style={{
              flexShrink: 0,
              padding: '6px 12px',
              borderRadius: 999,
              border: `1px solid ${title === t ? C.teal : C.g200}`,
              background: C.white,
              color: title === t ? C.teal : C.g900,
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.12s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* First name */}
      <label style={{ ...labelStyle, marginTop: 6 }}>First name</label>
      <input
        type="text"
        placeholder="e.g. Tendai"
        value={firstName}
        onChange={e => setFirstName(e.target.value)}
        style={inputStyle}
      />

      {/* Surname */}
      <label style={{ ...labelStyle, marginTop: 6 }}>Surname</label>
      <input
        type="text"
        placeholder="e.g. Moyo"
        value={surname}
        onChange={e => setSurname(e.target.value)}
        style={inputStyle}
      />

      {/* Phone */}
      <label style={{ ...labelStyle, marginTop: 6 }}>Phone number</label>
      <PhoneInputRow value={number} onChange={(digits, dc) => { setNumber(digits); setDialCode(dc); }} compact />

      {/* School — searchable picker */}
      <label style={{ ...labelStyle, marginTop: 6 }}>School</label>
      <SchoolPickerInline value={school} onChange={setSchool} placeholder="Select your school" />

      {/* Error */}
      {error && (
        <div style={{ color: C.red, fontSize: 12, marginTop: 4, fontWeight: 600 }}>{error}</div>
      )}

      {/* Create account button — full width, always visible */}
      <button
        onClick={handleCreate}
        disabled={loading}
        style={{
          marginTop: 12, height: 44, boxSizing: 'border-box',
          background: loading ? C.teal100 : C.teal,
          border: 'none', borderRadius: 12,
          cursor: loading ? 'not-allowed' : 'pointer',
          color: C.white, fontWeight: 700, fontSize: 15, fontFamily: 'inherit',
          width: '100%', transition: 'background 0.15s',
        }}
      >
        {loading ? 'Creating account…' : 'Create account'}
      </button>

      {/* Sign in link — centered */}
      <button
        onClick={onSignIn}
        style={{
          marginTop: 6, background: 'none', border: 'none', cursor: 'pointer',
          color: C.teal, fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
          padding: '2px 0', width: '100%', textAlign: 'center',
        }}
      >
        Already have an account? <span style={{ textDecoration: 'underline' }}>Sign in</span>
      </button>

      <div style={{ marginTop: 4, textAlign: 'center', fontSize: 11, color: C.g500, lineHeight: 1.4 }}>
        A 6-digit verification code will be sent to your phone.
      </div>
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Add Homework
// ──────────────────────────────────────────────────────────────────────────────

interface QPFile { name: string; mimeType: string; label: string; base64: string }

function AddHomeworkScreen({
  onBack, onSuccess, demoToken,
}: { onBack: () => void; onSuccess: (data: { answer_key_id: string; questions: ReviewQuestion[] }) => void; demoToken: string | null }) {
  const [title, setTitle]       = useState('');
  const [subject, setSubject]   = useState('');
  const [showSubjects, setShowSubjects] = useState(false);
  const [subjectSearch, setSubjectSearch] = useState('');
  const [qpFile, setQpFile]     = useState<QPFile | null>(null);
  const [qpText, setQpText]     = useState('');
  const [textMode, setTextMode] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [generateError, setGenerateError] = useState(false);

  // Due date — default tomorrow at the same time
  const [dueDate, setDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    // datetime-local expects "YYYY-MM-DDTHH:MM"
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [teacherTotalMarks, setTeacherTotalMarks] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [qpQualityWarnings, setQpQualityWarnings] = useState<string[]>([]);
  const [qpEnhanced, setQpEnhanced] = useState(false);
  const [qpWarningDismissed, setQpWarningDismissed] = useState(false);

  // Hidden file inputs (gallery, pdf, word — NOT camera)
  const galleryRef = useRef<HTMLInputElement>(null);
  const pdfRef     = useRef<HTMLInputElement>(null);
  const wordRef    = useRef<HTMLInputElement>(null);

  // Animated loading dots
  const [dots, setDots] = useState('');
  useEffect(() => {
    if (!loading) { setDots(''); return; }
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 450);
    return () => clearInterval(t);
  }, [loading]);

  // ── FileReader helper ───────────────────────────────────────────────────────
  function readFile(file: File, label: string) {
    const mimeType = file.type || 'application/octet-stream';
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      // Reset quality state
      setQpQualityWarnings([]);
      setQpEnhanced(false);
      setQpWarningDismissed(false);

      if (mimeType.startsWith('image/')) {
        // Run quality analysis + enhancement for images
        try {
          const result = await analyseAndEnhanceWebImage(dataUrl);
          setQpFile({ name: file.name, mimeType, label, base64: result.base64 });
          setQpEnhanced(result.enhanced);
          if (result.warnings.length > 0) {
            setQpQualityWarnings(result.warnings);
          }
        } catch {
          // Fallback: use raw base64
          setQpFile({ name: file.name, mimeType, label, base64: dataUrl.split(',')[1] });
        }
      } else {
        // PDF / Word — no quality check
        setQpFile({ name: file.name, mimeType, label, base64: dataUrl.split(',')[1] });
      }
      setQpText('');
      setTextMode(false);
      setError('');
    };
    reader.onerror = () => setError('Could not read file. Please try again.');
    reader.readAsDataURL(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>, labelPrefix: string) {
    const file = e.target.files?.[0];
    if (!file) return;
    readFile(file, `${labelPrefix} ${file.name}`);
    e.target.value = '';
  }

  // ── Text mode ───────────────────────────────────────────────────────────────
  function handleTextDone() {
    const t = textDraft.trim();
    if (t) { setQpText(t); setQpFile(null); setError(''); }
    setTextMode(false);
  }

  function clearQP() { setQpFile(null); setQpText(''); setTextMode(false); setTextDraft(''); setQpQualityWarnings([]); setQpEnhanced(false); setQpWarningDismissed(false); }

  // ── Create & Generate ───────────────────────────────────────────────────────
  async function handleCreate() {
    setError('');
    setGenerateError(false);
    if (!title.trim()) { setError('Please enter a homework title.'); return; }
    if (!subject.trim()) { setError('Please select a subject.'); return; }
    if (!qpFile && !qpText) { setError('Please upload the homework paper.'); return; }

    // Router: web is always cloud — mirrors routeRequest() in mobile router.ts
    // If this were mobile: resolveRoute('scheme') → 'cloud' | 'on-device' | 'unavailable'
    const _route: 'cloud' = 'cloud';
    console.log('[router] scheme request →', _route);

    setLoading(true);
    try {
      const body: Record<string, string | number> = {
        class_id:        'demo',
        title:           title.trim(),
        subject:         subject.trim(),
        education_level: 'Form 2',
        status:          'draft',
        input_type:      'question_paper',
        due_date:        dueDate ? new Date(dueDate).toISOString() : '',
      };
      const totalMarksNum = teacherTotalMarks.trim() ? parseInt(teacherTotalMarks.trim(), 10) : 0;
      if (totalMarksNum > 0) body.teacher_total_marks = totalMarksNum;
      if (qpFile) {
        body.file_data  = qpFile.base64;
        body.media_type = qpFile.mimeType;
      } else {
        body.text = qpText;
      }

      const rawRes = await demoFetch('/homework/generate-scheme', {
        method: 'POST',
        body: JSON.stringify(body),
      }, demoToken);

      // Apply client-side JSON cleaning in case the API returned raw text or fenced JSON
      const res = rawRes ? cleanJson(rawRes) : null;
      const rawQuestions = Array.isArray(res?.questions) ? res!.questions as any[] : [];
      const questions: ReviewQuestion[] = rawQuestions.length > 0
        ? rawQuestions.map((q: any, i: number) => normaliseQ(q, i))
        : [];

      if (questions.length === 0) {
        // API returned no questions — show the specific error UI instead of falling back to demo data
        setGenerateError(true);
        setLoading(false);
        return;
      }

      const answer_key_id: string = (res?.answer_key_id as string) ?? 'demo-key';
      onSuccess({ answer_key_id, questions });
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Subject filter ──────────────────────────────────────────────────────────
  const filteredSubjects = subjectSearch.trim()
    ? COMMON_SUBJECTS.filter(s => s.toLowerCase().includes(subjectSearch.toLowerCase()))
    : COMMON_SUBJECTS;
  const isExact = COMMON_SUBJECTS.some(s => s.toLowerCase() === subjectSearch.toLowerCase());

  const inputStyle: React.CSSProperties = {
    border: `1px solid ${C.g200}`, borderRadius: 12, padding: '12px 14px',
    fontSize: 14, color: C.text, outline: 'none', width: '100%',
    boxSizing: 'border-box', fontFamily: 'inherit', background: C.white,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, color: C.g900, marginTop: 14, marginBottom: 5,
    display: 'block', letterSpacing: '0.02em',
  };

  const hasQP = !!(qpFile || qpText);

  return (
    <Screen style={{ background: C.white }}>
      {/* Header */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <BackButton onClick={onBack} label="" />
        <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Add Homework</span>
      </div>
      <div style={{ flex: 1, padding: '12px 16px', paddingBottom: 20, overflowY: 'auto' }}>

        <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 2 }}>Add Homework</div>
        <div style={{ fontSize: 12, color: C.g500, marginBottom: 12, lineHeight: 1.5 }}>
          Upload the homework paper and Neriah will generate the marking scheme for you.
        </div>

        {/* Title */}
        <label style={labelStyle}>Title</label>
        <input
          type="text"
          placeholder="e.g. Chapter 5 Revision Test"
          value={title}
          onChange={e => setTitle(e.target.value)}
          style={inputStyle}
        />

        {/* Subject picker */}
        <label style={labelStyle}>Subject</label>
        <button
          onClick={() => { setShowSubjects(v => !v); setSubjectSearch(''); }}
          style={{
            width: '100%', border: `1px solid ${C.g200}`, borderRadius: 10, padding: '11px 13px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: C.white, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            boxSizing: 'border-box',
          }}
        >
          <span style={{ fontSize: 14, color: subject ? C.text : C.g500 }}>
            {subject || 'Select or type a subject'}
          </span>
          <span style={{ fontSize: 12, color: C.g500, transition: 'transform 0.15s', display: 'inline-block', transform: showSubjects ? 'rotate(180deg)' : 'none' }}>▾</span>
        </button>

        {/* Subject dropdown */}
        {showSubjects && (
          <div style={{
            border: `1px solid ${C.g200}`, borderRadius: 10, background: C.white,
            marginTop: 4, overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}>
            <input
              type="text"
              placeholder="Search subjects…"
              autoFocus
              value={subjectSearch}
              onChange={e => setSubjectSearch(e.target.value)}
              style={{
                width: '100%', border: 'none', borderBottom: `1px solid ${C.g200}`,
                padding: '10px 13px', fontSize: 13, outline: 'none',
                fontFamily: 'inherit', boxSizing: 'border-box', color: C.text,
              }}
            />
            <div style={{ maxHeight: 160, overflowY: 'auto' }}>
              {filteredSubjects.map(s => (
                <button
                  key={s}
                  onClick={() => { setSubject(s); setShowSubjects(false); setSubjectSearch(''); }}
                  style={{
                    width: '100%', background: s === subject ? C.teal50 : 'none', border: 'none',
                    borderBottom: `1px solid ${C.g200}`, padding: '10px 13px', textAlign: 'left',
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                    color: s === subject ? C.teal : C.text, fontWeight: s === subject ? 600 : 400,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                >
                  <span>{s}</span>
                  {s === subject && <span style={{ color: C.teal, fontSize: 12 }}>✓</span>}
                </button>
              ))}
              {subjectSearch.trim() && !isExact && (
                <button
                  onClick={() => { setSubject(subjectSearch.trim()); setShowSubjects(false); setSubjectSearch(''); }}
                  style={{
                    width: '100%', background: C.teal50, border: 'none', padding: '10px 13px',
                    textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: C.teal,
                  }}
                >
                  Use "<strong>{subjectSearch.trim()}</strong>"
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Due Date + Total Marks row ──────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
          <div style={{ flex: 3 }}>
            <label style={labelStyle}>Due Date</label>
            <input
              type="datetime-local"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              min={(() => {
                const d = new Date();
                const pad = (n: number) => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
              })()}
              style={{ ...inputStyle, cursor: 'pointer' }}
            />
          </div>
          <div style={{ flex: 2 }}>
            <label style={labelStyle}>Total Marks</label>
            <input
              type="number"
              placeholder="e.g. 20"
              value={teacherTotalMarks}
              onChange={e => setTeacherTotalMarks(e.target.value)}
              min="1"
              style={inputStyle}
            />
          </div>
        </div>

        {/* ── HOMEWORK PAPER section ────────────────────────────────────────── */}
        <div style={{
          marginTop: 14, marginBottom: 4,
          fontSize: 11, fontWeight: 800, color: C.g500,
          letterSpacing: '0.07em', textTransform: 'uppercase',
        }}>
          Homework Paper <span style={{ color: C.red }}>required</span>
        </div>
        <div style={{ fontSize: 12, color: C.g500, marginBottom: 10, lineHeight: 1.5 }}>
          Upload the question paper. Neriah will read it and auto-generate the marking scheme.
        </div>

        {/* Upload buttons row */}
        {!textMode && (
          <div style={{ display: 'flex', gap: 5 }}>
            {[
              { icon: <Camera size={18} color={C.teal} />, label: 'Camera',  onClick: () => setCameraOpen(true) },
              { icon: <ImageIcon size={18} color={C.teal} />, label: 'Gallery', onClick: () => galleryRef.current?.click() },
              { icon: <File size={18} color={C.teal} />, label: 'PDF',     onClick: () => pdfRef.current?.click() },
              { icon: <FileText size={18} color={C.teal} />, label: 'Word',    onClick: () => wordRef.current?.click() },
              { icon: <Pencil size={18} color={C.teal} />, label: 'Text',    onClick: () => { setTextDraft(qpText); setTextMode(true); } },
            ].map(btn => (
              <button
                key={btn.label}
                onClick={btn.onClick}
                style={{
                  flex: 1, border: `1px solid ${C.g200}`, borderRadius: 10,
                  padding: '8px 4px', background: C.white, cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  fontFamily: 'inherit', transition: 'border-color 0.12s, background 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.background = C.teal50; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.g200; e.currentTarget.style.background = C.white; }}
              >
                <span>{btn.icon}</span>
                <span style={{ fontSize: 11, color: C.g700, fontWeight: 600 }}>{btn.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Text input mode */}
        {textMode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              autoFocus
              placeholder={"1. Solve for x: 2x + 5 = 13\n2. State Newton's first law of motion\n..."}
              value={textDraft}
              onChange={e => setTextDraft(e.target.value)}
              style={{
                border: `1px solid ${C.teal}`, borderRadius: 10, padding: '10px 12px',
                fontSize: 13, color: C.text, outline: 'none', fontFamily: 'inherit',
                resize: 'none', height: 100, lineHeight: 1.5,
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleTextDone}
                style={{
                  flex: 1, background: C.teal, border: 'none', borderRadius: 8, padding: '9px 0',
                  color: C.white, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Done
              </button>
              <button
                onClick={() => setTextMode(false)}
                style={{
                  flex: 1, background: 'none', border: `1px solid ${C.g200}`, borderRadius: 8,
                  padding: '9px 0', color: C.g500, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* File preview row */}
        {hasQP && !textMode && (
          <>
            <div style={{
              marginTop: 8, display: 'flex', alignItems: 'center', gap: 8,
              background: C.teal50, border: `1px solid ${C.teal100}`, borderRadius: 10,
              padding: '9px 12px',
            }}>
              <span style={{ color: C.teal, fontWeight: 700, fontSize: 13 }}>✓</span>
              <span style={{ flex: 1, fontSize: 12, color: C.teal, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {qpFile ? qpFile.label : `${qpText.length} chars of text`}
              </span>
              {qpEnhanced && (
                <span style={{
                  fontSize: 11, fontWeight: 700, color: C.teal, background: C.teal100,
                  borderRadius: 6, padding: '2px 6px', whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  ✓ Enhanced
                </span>
              )}
              <button
                onClick={clearQP}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g500, fontSize: 14, padding: '0 2px', fontFamily: 'inherit' }}
              >
                ✕
              </button>
            </div>

            {/* Quality warning block */}
            {qpQualityWarnings.length > 0 && !qpWarningDismissed && (
              <div style={{
                marginTop: 8, background: C.amberLt, border: `1px solid ${C.amber200}`,
                borderRadius: 10, padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                  <span style={{ flexShrink: 0 }}><AlertTriangle size={15} color={C.amberText} /></span>
                  <div style={{ fontSize: 12, color: C.amberText, lineHeight: 1.5 }}>
                    <strong style={{ display: 'block', marginBottom: 2 }}>Image may be unclear</strong>
                    Gemma may struggle to read it. Retake for better results, or use as-is.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => { clearQP(); galleryRef.current?.click(); }}
                    style={{
                      flex: 1, background: 'none', border: '1.5px solid #F59E0B', borderRadius: 8,
                      padding: '8px 0', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      color: C.amberText, fontFamily: 'inherit',
                    }}
                  >
                    Replace Image
                  </button>
                  <button
                    onClick={() => setQpWarningDismissed(true)}
                    style={{
                      flex: 1, background: C.amber400, border: 'none', borderRadius: 8,
                      padding: '8px 0', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      color: C.white, fontFamily: 'inherit',
                    }}
                  >
                    Use Anyway
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Error */}
        {error && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.red, fontWeight: 600 }}>{error}</div>
        )}

        {/* Generate error — Gemma couldn't read the file */}
        {generateError && (
          <div style={{
            marginTop: 16, background: C.redLt, border: `1px solid ${C.red200}`,
            borderRadius: 12, padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
              <span style={{ flexShrink: 0 }}><AlertTriangle size={18} color={C.red700} /></span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.red700, marginBottom: 4 }}>
                  Gemma could not read this file
                </div>
                <div style={{ fontSize: 12, color: C.red900, lineHeight: 1.5 }}>
                  Try uploading a clearer image or paste the question text instead.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setGenerateError(false); handleCreate(); }}
                style={{
                  flex: 1, background: C.red, border: 'none', borderRadius: 8,
                  padding: '10px 0', cursor: 'pointer', color: C.white,
                  fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
                }}
              >
                ↻ Retry
              </button>
              <button
                onClick={() => { setGenerateError(false); onSuccess({ answer_key_id: 'demo-key', questions: [] }); }}
                style={{
                  flex: 1, background: C.white, border: `1.5px solid ${C.g200}`, borderRadius: 8,
                  padding: '10px 0', cursor: 'pointer', color: C.g700,
                  fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
                }}
              >
                Type manually
              </button>
            </div>
          </div>
        )}

        {/* Create & Generate button */}
        {!generateError && (
          <button
            onClick={handleCreate}
            disabled={loading}
            style={{
              marginTop: 14, width: '100%', background: loading ? C.teal100 : C.teal,
              border: 'none', borderRadius: 10, padding: '12px 0',
              cursor: loading ? 'not-allowed' : 'pointer', color: C.white,
              fontWeight: 700, fontSize: 15, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxSizing: 'border-box', transition: 'background 0.15s',
            }}
          >
            {loading ? (
              <>
                <Sparkles size={16} />
                <span>Generating marking scheme{dots}</span>
              </>
            ) : (
              <span>Create &amp; Generate Answers</span>
            )}
          </button>
        )}
      </div>

      {/* Hidden file inputs (gallery, pdf, word) */}
      <input ref={galleryRef} type="file" accept="image/*"                       style={{ display: 'none' }} onChange={e => handleFileInput(e, 'Gallery')} />
      <input ref={pdfRef}     type="file" accept=".pdf,application/pdf"          style={{ display: 'none' }} onChange={e => handleFileInput(e, 'PDF')} />
      <input ref={wordRef}    type="file" accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display: 'none' }} onChange={e => handleFileInput(e, 'Word')} />

      {/* In-app camera modal */}
      <WebCameraModal
        open={cameraOpen}
        onCapture={(base64, mimeType) => {
          // WebCameraModal already runs quality+enhancement — mark as enhanced, no extra warnings
          setQpFile({ name: `photo_${Date.now()}.jpg`, mimeType, label: 'Camera photo', base64 });
          setQpQualityWarnings([]);
          setQpEnhanced(true);
          setQpWarningDismissed(false);
          setQpText('');
          setTextMode(false);
          setError('');
          setCameraOpen(false);
        }}
        onClose={() => setCameraOpen(false)}
      />
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Review Marking Scheme
// ──────────────────────────────────────────────────────────────────────────────
function ReviewSchemeScreen({
  answerKeyId,
  initialQuestions,
  onBack,
  onConfirm,
  demoToken,
}: {
  answerKeyId: string;
  initialQuestions: ReviewQuestion[];
  onBack: () => void;
  onConfirm: () => void;
  demoToken: string | null;
}) {
  const [questions, setQuestions] = useState<ReviewQuestion[]>(initialQuestions);
  const [saving, setSaving]       = useState(false);
  const [regen, setRegen]         = useState(false);
  const [error, setError]         = useState('');

  console.log('[HomeworkDetail] questions:', JSON.stringify(questions));

  const totalMarks = questions.reduce((s, q) => s + (q.marks || 0), 0);

  function updateQ(idx: number, patch: Partial<ReviewQuestion>) {
    setQuestions(qs => qs.map((q, i) => i === idx ? { ...q, ...patch } : q));
  }

  function deleteQ(idx: number) {
    setQuestions(qs => qs.filter((_, i) => i !== idx));
  }

  function addQ() {
    setQuestions(qs => [
      ...qs,
      { question_number: qs.length + 1, question_text: '', answer: '', marks: 1, marking_notes: null },
    ]);
  }

  async function handleConfirm() {
    setError('');
    setSaving(true);
    try {
      await demoFetch(`/answer-keys/${answerKeyId}`, {
        method: 'PUT',
        body: JSON.stringify({
          questions: questions.map(q => ({
            question_number: q.question_number,
            question_text:   q.question_text,
            correct_answer:  q.answer,
            marks:           q.marks,
            marking_notes:   q.marking_notes ?? '',
          })),
          status: 'confirmed',
        }),
      }, demoToken);
    } catch {
      // proceed anyway — demo may not have real auth
    } finally {
      setSaving(false);
    }
    onConfirm();
  }

  async function handleRegenerate() {
    setRegen(true);
    await new Promise(r => setTimeout(r, 1800));
    setQuestions(DEMO_QUESTIONS.map(q => ({ ...q })));
    setRegen(false);
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: C.g500, marginBottom: 3,
    display: 'block', letterSpacing: '0.03em',
  };
  const taStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', border: `1px solid ${C.g200}`,
    borderRadius: 8, padding: '8px 10px', fontSize: 13, color: C.text,
    fontFamily: 'inherit', outline: 'none', resize: 'none', lineHeight: 1.5,
    background: C.white,
  };

  return (
    <Screen style={{ background: C.bg }}>
      <div style={{ flex: 1, padding: '18px 16px', paddingBottom: 24 }}>
        <div style={{ marginBottom: 14 }}><BackButton label="Back" onClick={onBack} /></div>

        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 4 }}>Review Marking Scheme</div>
        <div style={{ fontSize: 12, color: C.g500, marginBottom: 16, lineHeight: 1.5 }}>
          Check each answer. Edit anything that looks wrong, then confirm.
        </div>

        {/* Empty-state notice — shown when Gemma returned no questions */}
        {initialQuestions.length === 0 && questions.length === 0 && (
          <div style={{
            background: C.amber50, border: `1px solid ${C.amber100}`,
            borderRadius: 10, padding: '12px 14px', marginBottom: 14,
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <span style={{ flexShrink: 0 }}><Pencil size={16} color={C.amber700} /></span>
            <div style={{ fontSize: 12, color: C.amber700, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>No questions detected. </span>
              Use the form below to add questions manually, then confirm when ready.
            </div>
          </div>
        )}

        {/* Summary row */}
        <div style={{
          display: 'flex', gap: 10, marginBottom: 14,
          background: C.teal50, borderRadius: 10, padding: '10px 13px',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.teal }}>
            {questions.length} question{questions.length !== 1 ? 's' : ''}
          </span>
          <span style={{ width: 1, height: 14, background: C.teal100 }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: C.teal }}>
            {totalMarks} marks total
          </span>
        </div>

        {/* Question cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {questions.map((q, idx) => (
            <div key={idx} style={{
              background: C.white, borderRadius: 12, padding: '12px 13px',
              border: `1px solid ${C.border}`,
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            }}>
              {/* Card header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8, background: C.teal,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800, color: C.white, flexShrink: 0,
                }}>
                  {q.question_number}
                </div>
                <button
                  onClick={() => deleteQ(idx)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: C.g400, fontSize: 14, padding: '2px 4px', fontFamily: 'inherit',
                  }}
                  title="Remove question"
                >
                  ✕
                </button>
              </div>

              {/* Question text */}
              <label style={labelStyle}>Question</label>
              <textarea
                rows={2}
                value={q.question_text}
                onChange={e => updateQ(idx, { question_text: e.target.value })}
                style={taStyle}
              />

              {/* Correct answer */}
              <label style={{ ...labelStyle, marginTop: 8 }}>Correct Answer</label>
              <textarea
                rows={2}
                value={q.answer}
                onChange={e => updateQ(idx, { answer: e.target.value })}
                style={{ ...taStyle, borderColor: C.teal100, background: C.tealLt }}
              />

              {/* Marks + notes row */}
              <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 72 }}>
                  <label style={labelStyle}>Marks</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={q.marks}
                    onChange={e => updateQ(idx, { marks: Math.max(1, Number(e.target.value)) })}
                    style={{
                      border: `1px solid ${C.g200}`, borderRadius: 8, padding: '7px 10px',
                      fontSize: 14, fontWeight: 700, color: C.teal, width: '100%',
                      boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
                      textAlign: 'center', background: C.white,
                    }}
                  />
                </div>
                {q.marking_notes !== undefined && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <label style={labelStyle}>Marking Notes <span style={{ fontWeight: 400 }}>(optional)</span></label>
                    <textarea
                      rows={2}
                      value={q.marking_notes ?? ''}
                      onChange={e => updateQ(idx, { marking_notes: e.target.value || null })}
                      placeholder="e.g. Accept equivalent forms"
                      style={{ ...taStyle, fontSize: 12, color: C.g500 }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Add question */}
        <button
          onClick={addQ}
          style={{
            marginTop: 10, width: '100%', border: `1.5px dashed ${C.teal300}`,
            borderRadius: 10, padding: '11px 0', background: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            fontFamily: 'inherit',
          }}
        >
          <span style={{ fontSize: 16, color: C.teal }}>+</span>
          <span style={{ fontSize: 13, color: C.teal, fontWeight: 600 }}>Add Question</span>
        </button>

        {error && <div style={{ marginTop: 10, fontSize: 12, color: C.red, fontWeight: 600 }}>{error}</div>}

        {/* Confirm & Save */}
        <button
          onClick={handleConfirm}
          disabled={saving}
          style={{
            marginTop: 16, width: '100%', background: saving ? C.teal100 : C.teal,
            border: 'none', borderRadius: 10, padding: '14px 0',
            cursor: saving ? 'not-allowed' : 'pointer', color: C.white,
            fontWeight: 700, fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box',
            transition: 'background 0.15s',
          }}
        >
          {saving ? 'Saving…' : 'Confirm & Save'}
        </button>

        {/* Regenerate */}
        <button
          onClick={handleRegenerate}
          disabled={regen || saving}
          style={{
            marginTop: 10, width: '100%', background: 'none',
            border: `1.5px solid ${C.teal}`, borderRadius: 10, padding: '12px 0',
            cursor: regen || saving ? 'not-allowed' : 'pointer', color: C.teal,
            fontWeight: 700, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
            transition: 'opacity 0.15s', opacity: regen ? 0.6 : 1,
          }}
        >
          {regen ? <><Sparkles size={13} /> Regenerating…</> : '↻ Regenerate'}
        </button>
      </div>
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Homework Created
// ──────────────────────────────────────────────────────────────────────────────
function HomeworkCreatedScreen({
  answerKeyId,
  onDone,
  demoToken,
}: {
  answerKeyId: string;
  onDone: () => void;
  demoToken: string | null;
}) {
  const [opening, setOpening] = useState(false);

  async function handleOpen() {
    setOpening(true);
    try {
      await demoFetch(`/answer-keys/${answerKeyId}`, {
        method: 'PUT',
        body: JSON.stringify({ open_for_submission: true }),
      }, demoToken);
    } catch {
      // proceed
    } finally {
      setOpening(false);
    }
    onDone();
  }

  return (
    <Screen style={{ justifyContent: 'center', padding: 28, alignItems: 'center' }}>
      {/* Checkmark */}
      <div style={{
        width: 80, height: 80, borderRadius: 40,
        background: C.green50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 22,
      }}>
        <svg width={40} height={40} viewBox="0 0 40 40" fill="none">
          <path d="M8 21l8 8L32 12" stroke={C.green} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 10, textAlign: 'center' }}>
        Homework Created!
      </div>
      <div style={{ fontSize: 14, color: C.g500, lineHeight: 1.6, textAlign: 'center', marginBottom: 30, maxWidth: 260 }}>
        The marking scheme is saved. Open it for submissions so students can start submitting their work.
      </div>

      <button
        onClick={handleOpen}
        disabled={opening}
        style={{
          width: '100%', background: opening ? C.teal100 : C.teal,
          border: 'none', borderRadius: 10, padding: '14px 0',
          cursor: opening ? 'not-allowed' : 'pointer', color: C.white,
          fontWeight: 700, fontSize: 15, fontFamily: 'inherit',
          boxSizing: 'border-box', transition: 'background 0.15s',
        }}
      >
        {opening ? 'Opening…' : 'Open for Submissions'}
      </button>

      <button
        onClick={onDone}
        style={{
          marginTop: 14, background: 'none', border: 'none', cursor: 'pointer',
          color: C.g500, fontWeight: 600, fontSize: 14, fontFamily: 'inherit', padding: 4,
        }}
      >
        I'll do this later
      </button>
    </Screen>
  );
}

// ── Education level options (matches mobile ClassSetupScreen) ─────────────────
const EDUCATION_LEVELS = [
  'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7',
  'Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5', 'Form 6',
  'A-Level', 'College', 'University',
];

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Class Setup
// ──────────────────────────────────────────────────────────────────────────────
function ClassSetupScreen({ onBack, onCreate }: { onBack: () => void; onCreate: (cls: DemoClass) => void }) {
  const [name,            setName]           = useState('');
  const [subject,         setSubject]        = useState('');
  const [educationLevel,  setEducationLevel] = useState('');
  const [description,     setDescription]    = useState('');
  const [saving,          setSaving]         = useState(false);
  const [error,           setError]          = useState('');

  // ── Bulk student import state ─────────────────────────────────────────────
  type ExtractedStudent = { first_name: string; surname: string; include: boolean };
  const [bulkCameraOpen,    setBulkCameraOpen]    = useState(false);
  const [bulkExtracting,    setBulkExtracting]    = useState(false);
  const [extractedStudents, setExtractedStudents] = useState<ExtractedStudent[]>([]);
  const [confirmOpen,       setConfirmOpen]       = useState(false);
  const [confirmedStudents, setConfirmedStudents] = useState<{ first_name: string; surname: string }[]>([]);
  const bulkFileRef = useRef<HTMLInputElement>(null);
  const [addStudentOpen,    setAddStudentOpen]    = useState(false);
  const [manualFirst,       setManualFirst]       = useState('');
  const [manualSurname,     setManualSurname]     = useState('');

  async function _runExtraction(base64: string, mediaType: 'image' | 'pdf') {
    setBulkExtracting(true);
    try {
      const res = await demoFetch('/demo/teacher/assistant', {
        method: 'POST',
        body: JSON.stringify({ action_type: 'extract_students', file_data: base64, media_type: mediaType }),
      });
      const students = ((res as { students?: { first_name: string; surname: string }[] })?.students ?? []);
      if (students.length > 0) {
        setExtractedStudents(students.map(s => ({ ...s, include: true })));
        setConfirmOpen(true);
      }
    } catch { /* ignore */ } finally {
      setBulkExtracting(false);
    }
  }

  function handleBulkCameraCapture(base64: string, _mimeType: string) {
    setBulkCameraOpen(false);
    _runExtraction(base64, 'image');
  }

  function handleBulkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const mediaType: 'image' | 'pdf' = file.type.includes('pdf') ? 'pdf' : 'image';
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64  = dataUrl.split(',')[1];
      _runExtraction(base64, mediaType);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function toggleStudent(i: number) {
    setExtractedStudents(prev => prev.map((s, idx) => idx === i ? { ...s, include: !s.include } : s));
  }

  function handleConfirmStudents() {
    const confirmed = extractedStudents.filter(s => s.include).map(s => ({ first_name: s.first_name, surname: s.surname }));
    setConfirmedStudents(confirmed);
    setConfirmOpen(false);
  }

  async function handleCreate() {
    if (!name.trim())           { setError('Class name is required.');      return; }
    if (!educationLevel.trim()) { setError('Education level is required.'); return; }
    setError('');
    setSaving(true);
    try {
      const res = await demoFetch('/demo/classes', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          subject: subject.trim(),
          education_level: educationLevel,
          description: description.trim(),
          teacher_id: 'demo-teacher-1',
        }),
      });
      const cls: DemoClass = res
        ? (res as DemoClass)
        : {
            id:              `local-${Date.now()}`,
            name:            name.trim(),
            subject:         subject.trim(),
            education_level: educationLevel,
            description:     description.trim(),
            join_code:       Math.random().toString(36).slice(2, 8).toUpperCase(),
            student_count:   0,
            homework_count:  0,
            created_at:      new Date().toISOString(),
          };

      // Batch-create confirmed students
      if (confirmedStudents.length > 0) {
        await demoFetch('/demo/students/batch', {
          method: 'POST',
          body: JSON.stringify({ class_id: cls.id, students: confirmedStudents }),
        });
        cls.student_count = confirmedStudents.length;
      }

      onCreate(cls);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '11px 13px', fontSize: 15, borderRadius: 10,
    border: `1.5px solid ${C.border}`, background: C.white, color: C.text,
    fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 600, color: C.g700, marginBottom: 6, display: 'block',
  };

  return (
    <Screen style={{ background: C.white }}>
      {/* Header */}
      <div style={{
        background: C.white, borderBottom: `1px solid ${C.border}`,
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <BackButton onClick={onBack} label="" />
        <span style={{ fontSize: 17, fontWeight: 700, color: C.text, flex: 1, textAlign: 'center' }}>New Class</span>
        <div style={{ width: 36 }} />
      </div>

      {/* Form */}
      <div style={{ flex: 1, padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>

        {/* Class Name */}
        <div>
          <label style={labelStyle}>CLASS NAME <span style={{ color: C.red }}>*</span></label>
          <input
            style={inputStyle}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. 3B Mathematics"
            maxLength={60}
          />
        </div>

        {/* Curriculum pills */}
        <div>
          <label style={labelStyle}>CURRICULUM</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['ZIMSEC', 'Cambridge'].map(c => (
              <button key={c}
                style={{
                  padding: '8px 16px', borderRadius: 999, border: `1.5px solid ${C.teal}`,
                  background: c === 'ZIMSEC' ? C.teal : C.white, color: c === 'ZIMSEC' ? C.white : C.teal,
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Education Level */}
        <div>
          <label style={labelStyle}>EDUCATION LEVEL <span style={{ color: C.red }}>*</span></label>
          <select
            style={{ ...inputStyle, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer' }}
            value={educationLevel}
            onChange={e => setEducationLevel(e.target.value)}
          >
            <option value="">Select education level</option>
            {EDUCATION_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>

        {/* Confirmed students list */}
        {confirmedStudents.length > 0 && (
          <div style={{ background: C.teal50, border: `1px solid ${C.teal100}`, borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.teal, marginBottom: 6 }}>
              {confirmedStudents.length} student{confirmedStudents.length !== 1 ? 's' : ''} added
            </div>
            {confirmedStudents.slice(0, 5).map((s, i) => (
              <div key={i} style={{ fontSize: 12, color: C.teal, paddingBlock: 2 }}>• {s.first_name} {s.surname}</div>
            ))}
            {confirmedStudents.length > 5 && (
              <div style={{ fontSize: 12, color: C.teal, paddingBlock: 2 }}>+ {confirmedStudents.length - 5} more…</div>
            )}
          </div>
        )}

        {/* Add students link */}
        <button
          onClick={() => setAddStudentOpen(v => !v)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', color: C.teal,
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit', textAlign: 'left',
            padding: 0, display: 'flex', alignItems: 'center', gap: 4,
          }}>
          <Plus size={14} color={C.teal} />
          Add students to this class
        </button>

        {/* Student add panel */}
        {addStudentOpen && (
          <div style={{ background: C.g50, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Manual entry */}
            <div style={{ fontSize: 12, fontWeight: 700, color: C.g700, marginBottom: 2 }}>Type student name</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...inputStyle, flex: 1, padding: '9px 11px', fontSize: 13 }}
                placeholder="First name"
                value={manualFirst}
                onChange={e => setManualFirst(e.target.value)}
              />
              <input
                style={{ ...inputStyle, flex: 1, padding: '9px 11px', fontSize: 13 }}
                placeholder="Surname"
                value={manualSurname}
                onChange={e => setManualSurname(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                if (!manualFirst.trim() && !manualSurname.trim()) return;
                setConfirmedStudents(prev => [...prev, { first_name: manualFirst.trim(), surname: manualSurname.trim() }]);
                setManualFirst('');
                setManualSurname('');
              }}
              style={{
                background: C.teal, border: 'none', borderRadius: 8, padding: '8px 0',
                color: C.white, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Add Student
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.g400 }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <span style={{ fontSize: 11, fontWeight: 600 }}>OR IMPORT</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>

            {/* Import buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => { setAddStudentOpen(false); setBulkCameraOpen(true); }}
                style={{
                  flex: 1, background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 8,
                  padding: '9px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: C.text,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                }}
              >
                <Camera size={16} color={C.teal} />
                Photo
              </button>
              <button
                type="button"
                onClick={() => { setAddStudentOpen(false); bulkFileRef.current?.click(); }}
                style={{
                  flex: 1, background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 8,
                  padding: '9px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: C.text,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                }}
              >
                <FileText size={16} color={C.teal} />
                PDF / Image
              </button>
            </div>

            {bulkExtracting && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.teal, fontSize: 13 }}>
                <Spinner />
                Extracting student names…
              </div>
            )}
          </div>
        )}

        {/* Hidden file input for bulk register import */}
        <input
          ref={bulkFileRef}
          type="file"
          accept="image/*,application/pdf"
          style={{ display: 'none' }}
          onChange={handleBulkFile}
        />

        {error && (
          <div style={{ background: C.redLt, border: `1px solid ${C.red200}`, borderRadius: 8, padding: '10px 12px', fontSize: 13, color: C.red700 }}>
            {error}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={saving}
          style={{
            marginTop: 'auto', width: '100%', background: saving ? C.teal100 : C.teal,
            border: 'none', borderRadius: 10, padding: '14px 0',
            cursor: saving ? 'not-allowed' : 'pointer', color: C.white,
            fontWeight: 700, fontSize: 15, fontFamily: 'inherit',
          }}
        >
          {saving ? 'Creating…' : 'Create Class'}
        </button>
      </div>

      {/* ── WebCameraModal for bulk import ─────────────────────────────────── */}
      <WebCameraModal
        open={bulkCameraOpen}
        onCapture={handleBulkCameraCapture}
        onClose={() => setBulkCameraOpen(false)}
      />

      {/* ── Student confirmation modal ──────────────────────────────────────── */}
      {confirmOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: C.white, borderRadius: '16px 16px 0 0',
            width: '100%', maxWidth: 420, maxHeight: '70vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
          }}>
            {/* Modal header */}
            <div style={{ padding: '16px 16px 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
                {extractedStudents.length} Students Found
              </div>
              <div style={{ fontSize: 12, color: C.g500, marginTop: 2 }}>
                Uncheck any students to exclude them
              </div>
            </div>

            {/* Student list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              {extractedStudents.map((s, i) => (
                <label
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 16px', cursor: 'pointer',
                    borderBottom: i < extractedStudents.length - 1 ? `1px solid ${C.g100}` : 'none',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={s.include}
                    onChange={() => toggleStudent(i)}
                    style={{ width: 16, height: 16, accentColor: C.teal, flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 14, color: s.include ? C.text : C.g400, flex: 1 }}>
                    {s.first_name} {s.surname}
                  </span>
                </label>
              ))}
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                style={{
                  flex: 1, padding: '12px 0', background: 'none',
                  border: `1.5px solid ${C.border}`, borderRadius: 10,
                  fontSize: 14, fontWeight: 600, color: C.g700,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Skip
              </button>
              <button
                type="button"
                onClick={handleConfirmStudents}
                style={{
                  flex: 2, padding: '12px 0', background: C.teal,
                  border: 'none', borderRadius: 10,
                  fontSize: 14, fontWeight: 700, color: C.white,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Add {extractedStudents.filter(s => s.include).length} Students
              </button>
            </div>
          </div>
        </div>
      )}
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Class Join Code
// ──────────────────────────────────────────────────────────────────────────────
function ClassJoinCodeScreen({ cls, onDone }: { cls: DemoClass; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(cls.join_code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Screen style={{ background: C.bg }}>
      {/* Header */}
      <div style={{
        background: C.white, borderBottom: `1px solid ${C.border}`,
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Class Created!</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Success badge */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 64, height: 64, borderRadius: 32, background: C.teal50, marginBottom: 12,
          }}>
            <span style={{ fontSize: 30 }}>🎉</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{cls.name}</div>
          {cls.subject && (
            <div style={{ fontSize: 13, color: C.g500, marginTop: 4 }}>{cls.subject} · {cls.education_level}</div>
          )}
        </div>

        {/* Join code card */}
        <div style={{
          background: C.white, borderRadius: 14,
          boxShadow: '0 2px 10px rgba(13,115,119,0.10)',
          border: `1.5px solid ${C.teal100}`,
          padding: '20px 16px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.g500, marginBottom: 10 }}>
            Share this code with your students
          </div>
          <div style={{
            fontSize: 36, fontWeight: 900, letterSpacing: 6,
            color: C.teal, fontFamily: 'monospace', marginBottom: 16,
          }}>
            {cls.join_code}
          </div>
          <button
            onClick={handleCopy}
            style={{
              background: copied ? C.greenLt : C.teal50,
              border: `1.5px solid ${copied ? C.green : C.teal}`,
              borderRadius: 10, padding: '9px 20px',
              fontSize: 14, fontWeight: 700,
              color: copied ? C.green : C.teal,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}
          >
            {copied ? '✓ Copied!' : '⧉ Copy Code'}
          </button>
        </div>

        {/* Info */}
        <div style={{
          background: C.amberLt, border: `1px solid ${C.amber100}`,
          borderRadius: 10, padding: '12px 14px', fontSize: 13, color: C.amber700, lineHeight: 1.5,
        }}>
          Students enter this code in the Neriah app to join your class and receive homework assignments.
        </div>
      </div>

      {/* Done button */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, background: C.white, flexShrink: 0 }}>
        <button
          onClick={onDone}
          style={{
            width: '100%', background: C.teal, color: C.white, border: 'none', borderRadius: 12,
            padding: '14px 0', fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Done
        </button>
      </div>
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Teacher AI Assistant
// ──────────────────────────────────────────────────────────────────────────────

const AI_CURRICULUMS = ['ZIMSEC', 'Cambridge', 'IB', 'National Curriculum'] as const;

const AI_CURRICULUM_LEVELS: Record<string, string[]> = {
  ZIMSEC: ['All Levels','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Form 1','Form 2','Form 3','Form 4','Form 5 (A-Level)','Form 6 (A-Level)','College/University'],
  Cambridge: ['All Levels','Year 1','Year 2','Year 3','Year 4','Year 5','Year 6','Year 7','Year 8','Year 9','IGCSE (Year 10)','IGCSE (Year 11)','A-Level (Year 12)','A-Level (Year 13)'],
  IB: ['All Levels','Primary Years (PYP)','Middle Years (MYP)','Diploma Programme (DP)'],
  'National Curriculum': ['All Levels','KS1','KS2','KS3','GCSE','A-Level'],
};

const AI_DEFAULT_LEVEL: Record<string, string> = {
  ZIMSEC: 'Form 3', Cambridge: 'IGCSE (Year 10)', IB: 'Middle Years (MYP)', 'National Curriculum': 'GCSE',
};

type AIActionType = 'chat' | 'create_homework' | 'create_quiz' | 'prepare_notes' | 'class_performance' | 'teaching_methods' | 'exam_questions';

interface AIChatMsg {
  id: string; role: 'user' | 'assistant'; content: string;
  card?: { title: string; preview: string }; chips?: string[];
  structured?: Record<string, unknown>; exportable?: boolean; actionType?: AIActionType;
}

const AI_EXPORTABLE: Set<AIActionType> = new Set(['create_homework', 'create_quiz']);

const AI_QUICK_ACTIONS: Array<{ label: string; action: AIActionType }> = [
  { label: 'Create Homework',              action: 'create_homework'  },
  { label: 'Create a Quiz',               action: 'create_quiz'      },
  { label: 'Prepare Notes',               action: 'prepare_notes'    },
  { label: 'How is my class performing?', action: 'class_performance'},
  { label: 'Suggest teaching methods',    action: 'teaching_methods' },
  { label: 'Generate exam questions',     action: 'exam_questions'   },
];

function _actionLabel(action: AIActionType): string {
  return ({ create_homework:'Homework', create_quiz:'Quiz', prepare_notes:'Notes',
    class_performance:'Performance', teaching_methods:'Teaching Methods', exam_questions:'Exam Questions', chat:'Chat' })[action] ?? action;
}

function _actionIcon(action: AIActionType): string {
  return ({ create_homework:'📝', create_quiz:'❓', prepare_notes:'📚',
    class_performance:'📊', teaching_methods:'💡', exam_questions:'🎓', chat:'💬' })[action] ?? '✨';
}

function _previewLines(structured: Record<string, unknown>, action: AIActionType): string {
  const qs = structured.questions as Array<{ question?: string; text?: string }> | undefined;
  if (!qs?.length) return String(structured.summary ?? structured.overview ?? '');
  const q1 = String(qs[0]?.question ?? qs[0]?.text ?? '');
  const q2 = qs[1] ? String(qs[1]?.question ?? qs[1]?.text ?? '') : '';
  const extra = qs.length > 2 ? ` +${qs.length - 2} more` : '';
  return [q1, q2].filter(Boolean).join('\n') + extra;
}

function _detectAction(text: string): AIActionType {
  const q = text.toLowerCase();
  if (q.includes('homework')) return 'create_homework';
  if (q.includes('quiz'))     return 'create_quiz';
  if (q.includes('notes') || q.includes('prepare')) return 'prepare_notes';
  if (q.includes('performing') || q.includes('analytics') || q.includes('performance')) return 'class_performance';
  if (q.includes('teaching') || q.includes('method')) return 'teaching_methods';
  if (q.includes('exam') || (q.includes('generate') && q.includes('question'))) return 'exam_questions';
  return 'chat';
}

// ── Web chat history helpers ──────────────────────────────────────────────────
const WEB_CHAT_KEY     = 'neriah_teacher_sessions';
const WEB_MAX_SESSIONS = 50;
const WEB_MAX_DISPLAY  = 20;

interface WebChatSession {
  chat_id:     string;
  created_at:  string;   // ISO 8601
  updated_at:  string;   // ISO 8601
  preview:     string;   // first user message, max 60 chars
  action_type?: string;
  messages:    AIChatMsg[];
}

function webMakeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function webRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hrs   = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24)  return `${hrs}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7)  return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

function loadWebChatHistory(): WebChatSession[] {
  try {
    const raw = sessionStorage.getItem(WEB_CHAT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveWebChatHistory(sessions: WebChatSession[]): void {
  try { sessionStorage.setItem(WEB_CHAT_KEY, JSON.stringify(sessions)); } catch {}
}

function upsertWebChatSession(sessions: WebChatSession[], session: WebChatSession): WebChatSession[] {
  const filtered = sessions.filter(s => s.chat_id !== session.chat_id);
  const next = [session, ...filtered]; // newest first
  return next.length > WEB_MAX_SESSIONS ? next.slice(0, WEB_MAX_SESSIONS) : next;
}

function TeacherAIAssistantWebScreen({ onBack }: { onBack: () => void }) {
  const [curriculum, setCurriculum] = useState('ZIMSEC');
  const [level, setLevel]           = useState('All Levels');
  const [showCurrDrop, setShowCurrDrop] = useState(false);
  const [showLvlDrop, setShowLvlDrop]   = useState(false);
  const [messages, setMessages]     = useState<AIChatMsg[]>([]);
  const [input, setInput]           = useState('');
  const [typing, setTyping]         = useState(false);
  const [exporting, setExporting]   = useState<string | null>(null); // msg id being exported
  const [toast, setToast]           = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [attachment, setAttachment] = useState<{ data: string; type: 'image' | 'pdf' | 'word'; name: string; previewUrl?: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const wordInputRef = useRef<HTMLInputElement>(null);

  // ── Drawer state ────────────────────────────────────────────────────────────
  const [showDrawer, setShowDrawer]       = useState(false);
  const [chatHistory, setChatHistory]     = useState<WebChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const webSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, typing]);

  // ── On mount: restore most-recent session ─────────────────────────────────
  useEffect(() => {
    const sessions = loadWebChatHistory();
    if (sessions.length > 0) {
      setChatHistory(sessions);
      setMessages(sessions[0].messages);   // most-recently updated is first
      setCurrentChatId(sessions[0].chat_id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // ── Drawer helpers ───────────────────────────────────────────────────────────
  const openDrawer = () => {
    setChatHistory(loadWebChatHistory());
    setShowDrawer(true);
  };

  const closeDrawer = () => setShowDrawer(false);

  // Debounced (500 ms) session save
  const saveCurrentToHistory = (msgs: AIChatMsg[], chatId: string, actionType?: string) => {
    if (msgs.length === 0 || !chatId) return;
    if (webSaveTimerRef.current) clearTimeout(webSaveTimerRef.current);
    webSaveTimerRef.current = setTimeout(() => {
      const now = new Date().toISOString();
      const preview = (msgs.find(m => m.role === 'user')?.content ?? 'Chat').slice(0, 60);
      const sessions = loadWebChatHistory();
      const existing = sessions.find(s => s.chat_id === chatId);
      const session: WebChatSession = {
        chat_id:     chatId,
        created_at:  existing ? existing.created_at : now,
        updated_at:  now,
        preview,
        action_type: actionType ?? existing?.action_type,
        messages:    msgs,
      };
      const updated = upsertWebChatSession(sessions, session);
      saveWebChatHistory(updated);
      setChatHistory(updated);
    }, 500);
  };

  const startNewChat = () => {
    // Flush current session immediately (bypass debounce)
    if (messages.length > 0 && currentChatId) {
      if (webSaveTimerRef.current) clearTimeout(webSaveTimerRef.current);
      const now = new Date().toISOString();
      const preview = (messages.find(m => m.role === 'user')?.content ?? 'Chat').slice(0, 60);
      const sessions = loadWebChatHistory();
      const existing = sessions.find(s => s.chat_id === currentChatId);
      const session: WebChatSession = {
        chat_id:     currentChatId,
        created_at:  existing ? existing.created_at : now,
        updated_at:  now,
        preview,
        action_type: existing?.action_type,
        messages,
      };
      const updated = upsertWebChatSession(sessions, session);
      saveWebChatHistory(updated);
      setChatHistory(updated);
    }
    setMessages([]);
    setCurrentChatId(null);   // next send() will create a fresh session
    closeDrawer();
  };

  const loadChatSession = (session: WebChatSession) => {
    setMessages(session.messages);
    setCurrentChatId(session.chat_id);
    closeDrawer();
    setTimeout(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, 80);
  };

  const deleteChatSession = (chatId: string) => {
    const sessions = loadWebChatHistory().filter(s => s.chat_id !== chatId);
    saveWebChatHistory(sessions);
    setChatHistory(sessions);
    if (chatId === currentChatId) {
      setMessages([]);
      setCurrentChatId(null);
    }
  };

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res((reader.result as string).split(',')[1] ?? '');
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'pdf' | 'word') => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const data = await readFileAsBase64(file);
      const previewUrl = type === 'image' ? URL.createObjectURL(file) : undefined;
      setAttachment({ data, type, name: file.name, previewUrl });
    } catch {
      showToast('Could not read the file. Try a different one.');
    }
    setShowAttachMenu(false);
  };

  const send = async (text: string, forcedAction?: AIActionType) => {
    if ((!text.trim() && !attachment) || typing) return;
    setShowCurrDrop(false); setShowLvlDrop(false);
    const action: AIActionType = forcedAction ?? _detectAction(text);
    const snap = attachment;
    setAttachment(null);
    const displayText = text.trim() || (snap ? `[${snap.name}]` : '');

    // Create a new session ID on first message if none active
    const activeChatId = currentChatId ?? webMakeId();
    if (!currentChatId) setCurrentChatId(activeChatId);

    const userMsg: AIChatMsg = { id: webMakeId(), role: 'user', content: displayText };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setTyping(true);
    try {
      const bodyObj: Record<string, unknown> = {
        message: text.trim() || '(See attached file)',
        action_type: action,
        curriculum,
        level: level === 'All Levels' ? '' : level,
      };
      if (snap) { bodyObj.file_data = snap.data; bodyObj.media_type = snap.type; }
      const res = await fetch(`${DEMO_API}/demo/teacher/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj),
      });
      const data = res.ok ? await res.json() : null;
      if (data && !data.error) {
        const isStructured = data.structured && data.questions;
        const exportable = AI_EXPORTABLE.has(action) && isStructured;
        const totalMarks = data.total_marks ?? (data.questions as Array<{marks:number}>|undefined)?.reduce((s,q)=>s+(q.marks||0),0) ?? 0;
        const card = isStructured
          ? { title: `${_actionIcon(action)} ${data.title ?? _actionLabel(action)}`,
              preview: `${(data.questions as unknown[]).length} questions • ${totalMarks} marks` }
          : undefined;
        const chips = !isStructured ? ['Create Homework','Create a Quiz','Check class performance'] : undefined;
        setMessages(prev => {
          const next = [...prev, {
            id: webMakeId(), role: 'assistant' as const,
            content: data.message ?? data.summary ?? data.overview ?? '',
            card, chips, structured: isStructured ? data : undefined,
            exportable, actionType: action,
          }];
          saveCurrentToHistory(next, activeChatId, action);
          return next;
        });
      } else {
        setMessages(prev => [...prev, {
          id: String(Date.now()+1), role: 'assistant',
          content: "I'm having trouble connecting right now. Please try again in a moment.",
          chips: ['Create Homework','Create a Quiz','Suggest teaching methods'],
        }]);
      }
    } catch {
      setMessages(prev => [...prev, {
        id: String(Date.now()+1), role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again in a moment.",
        chips: ['Create Homework','Create a Quiz','Suggest teaching methods'],
      }]);
    } finally {
      setTyping(false);
    }
  };

  const handleExport = async (msg: AIChatMsg) => {
    if (!msg.structured || !msg.actionType || exporting) return;
    setExporting(msg.id);
    try {
      const contentType = msg.actionType === 'create_quiz' ? 'quiz' : 'homework';
      const res = await fetch(`${DEMO_API}/demo/teacher/assistant/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_type: contentType,
          content: msg.structured,
          title: (msg.structured.title as string) ?? _actionLabel(msg.actionType),
          class_id: 'demo-class',
        }),
      });
      if (res.ok) {
        showToast(`${contentType === 'quiz' ? 'Quiz' : 'Homework'} saved as draft`);
      } else {
        showToast('Export failed — try again');
      }
    } catch {
      showToast('Export failed — try again');
    } finally {
      setExporting(null);
    }
  };

  const levels = AI_CURRICULUM_LEVELS[curriculum] ?? AI_CURRICULUM_LEVELS.ZIMSEC;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', background: C.g50, position: 'relative' }}
      onClick={() => { setShowCurrDrop(false); setShowLvlDrop(false); setShowAttachMenu(false); }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', background: C.teal }}>
        <button onClick={(e) => { e.stopPropagation(); openDrawer(); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.white, padding: 4, display: 'flex' }}>
          <Menu size={22} />
        </button>
        <span style={{ fontSize: 16, fontWeight: 700, color: C.white, letterSpacing: 0.3 }}>Neriah AI</span>
        <button onClick={(e) => { e.stopPropagation(); startNewChat(); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.white, padding: 4, display: 'flex' }}>
          <Pencil size={18} />
        </button>
      </div>

      {/* Context pills — centered */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 14px', justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
        {/* Curriculum */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => { setShowLvlDrop(false); setShowCurrDrop(v => !v); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.white,
              border: `1.5px solid ${C.teal}`, borderRadius: 20, padding: '6px 12px',
              color: C.teal, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {curriculum} <span style={{ color: C.teal, fontSize: 11 }}>{showCurrDrop ? '▲' : '▼'}</span>
          </button>
          {showCurrDrop && (
            <div style={{ position: 'absolute', top: 36, left: 0, zIndex: 100, minWidth: 160,
              background: C.white, border: `1px solid ${C.g200}`, borderRadius: 10,
              overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
              {AI_CURRICULUMS.map(c => (
                <button key={c} onClick={() => { setCurriculum(c); setLevel(AI_DEFAULT_LEVEL[c] ?? AI_CURRICULUM_LEVELS[c][0]); setShowCurrDrop(false); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
                    background: c === curriculum ? C.primaryLight : 'none', border: 'none', cursor: 'pointer',
                    color: c === curriculum ? C.teal : C.text, fontSize: 13,
                    fontWeight: c === curriculum ? 600 : 400, fontFamily: 'inherit' }}>
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Level */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => { setShowCurrDrop(false); setShowLvlDrop(v => !v); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.white,
              border: `1.5px solid ${C.teal}`, borderRadius: 20, padding: '6px 12px',
              color: C.teal, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {level} <span style={{ color: C.teal, fontSize: 11 }}>{showLvlDrop ? '▲' : '▼'}</span>
          </button>
          {showLvlDrop && (
            <div style={{ position: 'absolute', top: 36, left: 0, zIndex: 100, minWidth: 180,
              maxHeight: 200, overflowY: 'auto', background: C.white,
              border: `1px solid ${C.g200}`, borderRadius: 10,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
              {levels.map(l => (
                <button key={l} onClick={() => { setLevel(l); setShowLvlDrop(false); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px',
                    background: l === level ? C.primaryLight : 'none', border: 'none', cursor: 'pointer',
                    color: l === level ? C.teal : C.text, fontSize: 12,
                    fontWeight: l === level ? 600 : 400, fontFamily: 'inherit' }}>
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chat area / empty state */}
      {messages.length === 0 && !typing ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {/* Hero: centers icon + title + subtitle in remaining space */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '20px 20px 12px', gap: 8 }}>
            <div style={{ width: 80, height: 80, borderRadius: '50%', background: C.primaryLight,
              border: `2px solid ${C.teal}`, display: 'flex', alignItems: 'center',
              justifyContent: 'center', marginBottom: 8 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/icon-transparent.png" style={{ width: 48, height: 48, filter: 'invert(29%) sepia(69%) saturate(456%) hue-rotate(147deg) brightness(90%) contrast(91%)' }} alt="Neriah" />
            </div>
            <span style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Neriah AI</span>
            <span style={{ fontSize: 13, color: C.g500 }}>Your AI teaching assistant</span>
          </div>
          {/* Quick actions: pinned at bottom of scroll area, adjacent to input bar */}
          <div style={{ padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
            {AI_QUICK_ACTIONS.map(a => (
              <button key={a.label} onClick={() => send(a.label, a.action)}
                style={{ background: C.white, border: `1px solid ${C.g200}`,
                  borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 13,
                  fontWeight: 600, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: C.teal }}>✦</span>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map(msg => (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 6 }}>
              {/* Bubble row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8,
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', maxWidth: '85%' }}>
                {msg.role === 'assistant' && (
                  <div style={{ width: 26, height: 26, borderRadius: 13, background: C.teal,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                    <img src="/neriah-logo.png" style={{ width: 15, height: 15, filter: 'brightness(0) invert(1)' }} alt="Neriah" />
                  </div>
                )}
                <div style={{ background: msg.role === 'user' ? C.teal : C.white,
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  padding: '10px 13px',
                  border: msg.role === 'assistant' ? `1px solid ${C.g200}` : 'none' }}>
                  <span style={{ fontSize: 13, color: msg.role === 'user' ? C.white : C.text, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {msg.content}
                  </span>
                </div>
              </div>
              {/* Rich card */}
              {msg.card && (
                <div style={{ marginLeft: msg.role === 'assistant' ? 34 : 0,
                  background: C.tealLt, borderRadius: 10, padding: '10px 12px',
                  maxWidth: '85%', border: `1px solid ${C.teal50}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: msg.exportable ? 10 : 0 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.teal, marginBottom: 2 }}>
                        {msg.card.title}
                      </div>
                      <div style={{ fontSize: 11, color: C.g500 }}>{msg.card.preview}</div>
                    </div>
                    <ChevronLeft size={14} color={C.g500} style={{ transform: 'rotate(180deg)' }} />
                  </div>
                  {msg.structured && msg.actionType && (
                    <div style={{ fontSize: 11, color: C.g500, marginBottom: msg.exportable ? 10 : 0,
                      whiteSpace: 'pre-line', lineHeight: 1.5 }}>
                      {_previewLines(msg.structured, msg.actionType)}
                    </div>
                  )}
                  {msg.exportable && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleExport(msg)} disabled={exporting === msg.id}
                        style={{ flex: 1, padding: '7px 0', borderRadius: 8,
                          background: exporting === msg.id ? C.g200 : C.teal,
                          border: 'none', color: C.white, fontSize: 12, fontWeight: 600,
                          cursor: exporting === msg.id ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                        {exporting === msg.id ? 'Saving…' : 'Export to Class'}
                      </button>
                      <button onClick={() => send(`Edit the ${_actionLabel(msg.actionType!)} — make the questions harder`, msg.actionType)}
                        style={{ flex: 1, padding: '7px 0', borderRadius: 8,
                          background: 'none', border: `1px solid ${C.g200}`,
                          color: C.text, fontSize: 12, fontWeight: 600,
                          cursor: 'pointer', fontFamily: 'inherit' }}>
                        Edit first
                      </button>
                    </div>
                  )}
                </div>
              )}
              {/* Chips */}
              {!!msg.chips?.length && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6,
                  marginLeft: msg.role === 'assistant' ? 34 : 0 }}>
                  {msg.chips.map(chip => (
                    <button key={chip} onClick={() => send(chip)}
                      style={{ background: C.primaryLight, border: 'none', borderRadius: 14,
                        padding: '5px 11px', color: C.teal, fontSize: 11,
                        fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {chip}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {typing && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: 13, background: C.teal,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <img src="/neriah-logo.png" style={{ width: 15, height: 15, filter: 'brightness(0) invert(1)' }} alt="Neriah" />
              </div>
              <div style={{ background: C.white, border: `1px solid ${C.g200}`, borderRadius: '16px 16px 16px 4px', padding: '10px 14px', display: 'flex', gap: 4, alignItems: 'center' }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: 3, background: C.g400,
                    animation: 'aiPulse 1.2s ease-in-out infinite',
                    animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hidden file inputs */}
      <input ref={imgInputRef}  type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleFileInput(e, 'image')} />
      <input ref={pdfInputRef}  type="file" accept="application/pdf" style={{ display: 'none' }} onChange={e => handleFileInput(e, 'pdf')} />
      <input ref={wordInputRef} type="file" accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display: 'none' }} onChange={e => handleFileInput(e, 'word')} />

      {/* In-app camera modal */}
      <WebCameraModal
        open={cameraOpen}
        onCapture={(base64) => {
          const previewUrl = `data:image/jpeg;base64,${base64}`;
          setAttachment({ data: base64, type: 'image', name: `photo_${Date.now()}.jpg`, previewUrl });
          setCameraOpen(false);
        }}
        onClose={() => setCameraOpen(false)}
      />

      {/* Input bar — flush to bottom, no extra padding below the send row */}
      <div style={{ borderTop: `1px solid ${C.g200}`, padding: '6px 12px 4px', background: C.white, position: 'relative' }}
        onClick={e => { e.stopPropagation(); setShowAttachMenu(false); }}>
        <p style={{ margin: '0 0 6px', fontSize: 11, color: C.g500, textAlign: 'center' }}>
          Neriah can make mistakes. Verify important info.
        </p>
        {/* Attachment preview chip */}
        {attachment && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6,
            background: C.primaryLight, borderRadius: 8, padding: '5px 8px',
            marginBottom: 6 }}>
            {attachment.type === 'image' && attachment.previewUrl ? (
              <img src={attachment.previewUrl} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
            ) : attachment.type === 'pdf' ? (
              <FileText size={16} color={C.teal} style={{ flexShrink: 0 }} />
            ) : (
              <File size={16} color={C.teal} style={{ flexShrink: 0 }} />
            )}
            <span style={{ flex: 1, fontSize: 12, color: C.teal, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {attachment.name}
            </span>
            <button onClick={() => setAttachment(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, display: 'flex', alignItems: 'center' }}>
              <X size={14} color={C.g500} />
            </button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8,
          background: C.g50, borderRadius: 24, border: `1px solid ${C.g200}`,
          padding: '4px 6px 4px 4px' }}>
          {/* Paperclip button */}
          <div style={{ position: 'relative' }}>
            <button onClick={e => { e.stopPropagation(); setShowAttachMenu(v => !v); }}
              style={{ width: 34, height: 34, borderRadius: 17, flexShrink: 0,
                background: 'none', border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Paperclip size={18} color={attachment ? C.teal : C.g500} />
            </button>
            {showAttachMenu && (
              <div style={{ position: 'absolute', bottom: 42, left: 0, zIndex: 50,
                background: C.white, border: `1px solid ${C.g200}`, borderRadius: 12,
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 172, overflow: 'hidden' }}
                onClick={e => e.stopPropagation()}>
                {[
                  { icon: <Camera    size={18} color={C.teal} />, label: 'Camera',        onClick: () => { setShowAttachMenu(false); setCameraOpen(true); } },
                  { icon: <ImageIcon size={18} color={C.teal} />, label: 'Gallery',       onClick: () => imgInputRef.current?.click() },
                  { icon: <FileText  size={18} color={C.teal} />, label: 'PDF Document',  onClick: () => pdfInputRef.current?.click() },
                  { icon: <File      size={18} color={C.teal} />, label: 'Word Document', onClick: () => wordInputRef.current?.click() },
                ].map(opt => (
                  <button key={opt.label} onClick={() => { opt.onClick(); setShowAttachMenu(false); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                      padding: '12px 14px', background: 'none', border: 'none',
                      cursor: 'pointer', fontSize: 13, color: C.text, fontFamily: 'inherit' }}
                    onMouseEnter={e => (e.currentTarget.style.background = C.primaryLight)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Message Neriah AI..."
            rows={1}
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', resize: 'none',
              color: C.text, fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5,
              paddingTop: 6, paddingBottom: 6, maxHeight: 100 }}
          />
          <button onClick={() => send(input)} disabled={(!input.trim() && !attachment) || typing}
            style={{ width: 34, height: 34, borderRadius: 17, flexShrink: 0,
              background: (input.trim() || attachment) && !typing ? C.teal : C.g200,
              border: 'none', cursor: (input.trim() || attachment) && !typing ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s' }}>
            <ArrowUp size={16} color={C.white} />
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: C.teal, color: C.white, borderRadius: 20, padding: '8px 18px',
          fontSize: 13, fontWeight: 600, pointerEvents: 'none', whiteSpace: 'nowrap',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)', zIndex: 200 }}>
          ✓ {toast}
        </div>
      )}

      {/* ── Chat History Drawer ── */}
      {showDrawer && (
        <>
          {/* Backdrop */}
          <div
            onClick={closeDrawer}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 40 }}
          />
          {/* Slide-in panel */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: 0,
            width: '80%', background: C.white, zIndex: 50,
            display: 'flex', flexDirection: 'column',
            boxShadow: '4px 0 20px rgba(0,0,0,0.18)',
            animation: 'slideInDrawer 0.25s ease-out',
          }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px', borderBottom: `1px solid ${C.g200}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/icon-transparent.png"
                  style={{ width: 26, height: 26, filter: 'invert(29%) sepia(69%) saturate(456%) hue-rotate(147deg) brightness(90%) contrast(91%)' }}
                  alt="Neriah" />
                <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Neriah AI</span>
              </div>
              <button onClick={closeDrawer}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', color: C.g500 }}>
                <X size={20} />
              </button>
            </div>

            {/* New Chat button */}
            <div style={{ padding: '14px 16px 8px' }}>
              <button onClick={startNewChat}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  background: C.teal, border: 'none', borderRadius: 10,
                  padding: '10px 14px', color: C.white, fontSize: 14,
                  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                <Plus size={18} color={C.white} />
                New Chat
              </button>
            </div>

            {/* Recent Chats label */}
            <div style={{ padding: '8px 16px 4px', fontSize: 11, fontWeight: 700,
              color: C.g400, letterSpacing: '0.08em' }}>
              RECENT CHATS
            </div>

            {/* Chat list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {chatHistory.slice(0, WEB_MAX_DISPLAY).length === 0 ? (
                <div style={{ padding: '24px 16px', fontSize: 13, color: C.g400, textAlign: 'center' }}>
                  No recent chats
                </div>
              ) : (
                chatHistory.slice(0, WEB_MAX_DISPLAY).map(session => (
                  <div key={session.chat_id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8,
                      padding: '12px 16px', cursor: 'pointer',
                      borderBottom: `1px solid ${C.g100}`,
                      background: session.chat_id === currentChatId ? C.primaryLight : 'none',
                      transition: 'background 0.12s' }}
                    onClick={() => loadChatSession(session)}
                    onMouseEnter={e => { if (session.chat_id !== currentChatId) (e.currentTarget as HTMLDivElement).style.background = C.g50; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = session.chat_id === currentChatId ? C.primaryLight : 'none'; }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: C.text,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {session.preview}
                      </div>
                      <div style={{ fontSize: 11, color: C.g400, marginTop: 2 }}>
                        {webRelativeTime(session.updated_at)}
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); deleteChatSession(session.chat_id); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                        padding: 4, display: 'flex', opacity: 0.5, flexShrink: 0 }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
                    >
                      <Trash2 size={14} color={C.g500} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes aiPulse {
          0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
          40% { transform: scale(1.2); opacity: 1; }
        }
        @keyframes slideInDrawer {
          from { transform: translateX(-100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: My Classes
// ──────────────────────────────────────────────────────────────────────────────
function ClassesScreen({ onAddHomework, onOpenHomework, onHomeworkList, onSettings, onAnalytics, onAssistant, onNewClass, onClassDetail, onInbox }: { onAddHomework: () => void; onOpenHomework: () => void; onHomeworkList: () => void; onSettings: () => void; onAnalytics: () => void; onAssistant: () => void; onNewClass: () => void; onClassDetail?: () => void; onInbox?: () => void }) {
  const [fabOpen, setFabOpen] = useState(false);

  // Demo homework items for Form 2A — 3 items so the "+ 1 more" link is exercised
  const demoHomeworks = [
    { id: 'hw1', title: 'Chapter 5 Maths Test',  created: '12 Apr 2026', submissions: 2, badge: 'ready'  },
    { id: 'hw2', title: 'Chapter 6 Algebra Quiz', created: '10 Apr 2026', submissions: 0, badge: 'amber'  },
    { id: 'hw3', title: 'Chapter 7 Geometry',     created: '8 Apr 2026',  submissions: 1, badge: 'ready'  },
  ];
  const previewHomeworks = demoHomeworks.slice(0, 2);
  const hiddenCount = demoHomeworks.length - previewHomeworks.length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg, position: 'relative' }}>
      {/* Header */}
      <div style={{
        background: C.white, paddingInline: 18, paddingTop: 12, paddingBottom: 10,
        borderBottom: `1px solid ${C.border}`, flexShrink: 0,
        display: 'flex', alignItems: 'center',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: C.g500 }}>Hello, Mr Maisiri</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginTop: 2 }}>My Classes</div>
        </div>
        <div onClick={onSettings} style={{ width: 38, height: 38, borderRadius: 19, background: C.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative', flexShrink: 0 }}>
          <span style={{ color: C.white, fontSize: 16, fontWeight: 700 }}>M</span>
          <div style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5, background: C.green400, border: `2px solid ${C.white}` }} />
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, paddingBottom: 72 }}>
        {/* Class group */}
        <div style={{ marginBottom: 18 }}>
          {/* Class card */}
          <div style={{
            background: C.white, borderRadius: 12, marginBottom: 0,
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: C.text }}>Form 2A</div>
                <div style={{ fontSize: 12, color: C.g500, marginTop: 2 }}>Form 2</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div onClick={onClassDetail} style={{ textAlign: 'center', minWidth: 40, cursor: 'pointer' }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: C.teal }}>5</div>
                  <div style={{ fontSize: 11, color: C.teal, textDecoration: 'underline' }}>students</div>
                </div>
                <div style={{ width: 1, height: 28, background: C.border }} />
                <button
                  onClick={onHomeworkList}
                  style={{ textAlign: 'center', minWidth: 40, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                >
                  <div style={{ fontSize: 17, fontWeight: 800, color: C.teal }}>{demoHomeworks.length}</div>
                  <div style={{ fontSize: 11, color: C.g500, textDecoration: 'underline' }}>homework</div>
                </button>
              </div>
            </div>
          </div>

          {/* Homework under this class — max 2 previewed */}
          <div style={{ marginTop: 4, marginLeft: 12, borderLeft: `2px solid ${C.teal100}`, paddingLeft: 10 }}>
            {previewHomeworks.length === 0 && (
              <div style={{ padding: '14px 8px', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}><FileText size={20} color={C.g400} /></div>
                <div style={{ fontSize: 13, color: C.g500 }}>No homework yet</div>
              </div>
            )}
            {previewHomeworks.map(hw => (
              <button
                key={hw.id}
                onClick={onOpenHomework}
                style={{
                  width: '100%', background: hw.badge === 'amber' ? C.amber50 : C.white,
                  borderRadius: 10, marginBottom: 6, padding: '9px 10px',
                  display: 'flex', alignItems: 'center', gap: 8, border: 'none', cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)', fontFamily: 'inherit', textAlign: 'left',
                  transition: 'box-shadow 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(13,115,119,0.14)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)')}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{hw.title}</div>
                  <div style={{ fontSize: 11, color: C.g500, marginTop: 2 }}>Created {hw.created}</div>
                  <div style={{ fontSize: 11, color: C.teal, marginTop: 3, fontWeight: 600 }}>{hw.submissions} submissions</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {hw.badge === 'amber' ? (
                    <div style={{
                      background: C.amber200, borderRadius: 8, paddingInline: 7, paddingBlock: 5,
                      fontSize: 11, color: C.amber500, fontWeight: 700, textAlign: 'center', lineHeight: 1.3,
                    }}>Add{'\n'}Scheme</div>
                  ) : (
                    <div style={{
                      background: C.teal50, borderRadius: 8, paddingInline: 7, paddingBlock: 5,
                      fontSize: 11, color: C.teal, fontWeight: 700, textAlign: 'center', lineHeight: 1.3,
                    }}>Ready to{'\n'}Grade</div>
                  )}
                  <span style={{ fontSize: 18, color: C.g400 }}>›</span>
                </div>
              </button>
            ))}

            {/* "+ X more" link — only when there are hidden homeworks */}
            {hiddenCount > 0 && (
              <button
                onClick={onHomeworkList}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', paddingBlock: 6, paddingInline: 4, fontFamily: 'inherit',
                }}
              >
                <span style={{ fontSize: 13, color: C.teal, fontWeight: 600 }}>+ {hiddenCount} more</span>
              </button>
            )}

            {/* Add homework button */}
            <button
              onClick={onAddHomework}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', display: 'flex',
                alignItems: 'center', gap: 6, paddingBlock: 8, paddingInline: 4, fontFamily: 'inherit',
              }}
            >
              <span style={{ fontSize: 15, color: C.teal }}>⊕</span>
              <span style={{ fontSize: 13, color: C.teal, fontWeight: 600 }}>Add Homework</span>
            </button>
          </div>
        </div>

        {/* Empty state — no classes */}
        {([] as any[]).length === 0 && false && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><BookOpen size={28} color={C.g400} /></div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.g700, marginBottom: 4 }}>No classes yet</div>
            <div style={{ fontSize: 12, color: C.g500 }}>Tap + to create your first class</div>
          </div>
        )}

        {/* Empty-state second class hint */}
        <button
          style={{
            width: '100%', border: `1.5px dashed ${C.teal300}`, borderRadius: 12,
            padding: '18px 16px', background: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit',
          }}
          onClick={onNewClass}
        >
          <span style={{ fontSize: 18, color: C.teal }}>+</span>
          <span style={{ fontSize: 14, color: C.teal, fontWeight: 600 }}>New Class</span>
        </button>
      </div>

      {/* Speed-dial overlay */}
      {fabOpen && (
        <div
          onClick={() => setFabOpen(false)}
          style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.22)', zIndex: 10 }}
        />
      )}

      {/* Mini FABs */}
      {fabOpen && (
        <div style={{ position: 'absolute', bottom: 78, right: 16, zIndex: 11, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => { setFabOpen(false); onNewClass(); }}>
            <div style={{ background: C.g900, color: C.white, fontSize: 12, fontWeight: 600, paddingInline: 9, paddingBlock: 5, borderRadius: 7, cursor: 'pointer' }}>New Class</div>
            <div style={{
              width: 40, height: 40, borderRadius: 20, background: C.teal, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 3px 8px rgba(13,115,119,0.4)',
            }}>
              <Users size={16} color={C.white} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => { setFabOpen(false); onAddHomework(); }}>
            <div style={{ background: C.g900, color: C.white, fontSize: 12, fontWeight: 600, paddingInline: 9, paddingBlock: 5, borderRadius: 7, cursor: 'pointer' }}>Add Homework</div>
            <div style={{
              width: 40, height: 40, borderRadius: 20, background: C.teal, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 3px 8px rgba(13,115,119,0.4)',
            }}>
              <BookOpen size={16} color={C.white} />
            </div>
          </div>
        </div>
      )}

      {/* Main FAB */}
      <button
        onClick={() => setFabOpen(v => !v)}
        style={{
          position: 'absolute', bottom: 64, right: 16, zIndex: 11,
          width: 52, height: 52, borderRadius: 26,
          background: fabOpen ? C.tealDk2 : C.teal, border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(13,115,119,0.45)', transition: 'background 0.15s',
          color: C.white, fontFamily: 'inherit',
        }}
      >
        {fabOpen ? <X size={22} /> : <span style={{ fontSize: 26, lineHeight: 1 }}>+</span>}
      </button>

      {/* Bottom tab bar */}
      <div style={{
        height: 50, background: C.white, borderTop: `1px solid ${C.border}`,
        display: 'flex', flexShrink: 0,
      }}>
        {[
          { icon: <Home size={16} />, label: 'Classes',   active: true,  onClick: undefined as (() => void) | undefined },
          { icon: <Sparkles size={16} />, label: 'Assistant', active: false, onClick: onAssistant },
          { icon: <BarChart2 size={16} />, label: 'Analytics', active: false, onClick: onAnalytics },
        ].map(tab => (
          <div
            key={tab.label}
            onClick={tab.onClick}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 2, cursor: 'pointer',
            }}
          >
            <span style={{ color: tab.active ? C.teal : C.g500 }}>{tab.icon}</span>
            <span style={{
              fontSize: 11, fontWeight: tab.active ? 600 : 400,
              color: tab.active ? C.teal : C.g500,
              borderBottom: tab.active ? `2px solid ${C.teal}` : '2px solid transparent',
              paddingBottom: 1,
            }}>
              {tab.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Homework List (all homeworks for a class)
// ──────────────────────────────────────────────────────────────────────────────

type HomeworkListItem = {
  id: string;
  title: string;
  subject: string;
  education_level: string;
  due_date?: string | null;
  created_at: string;
  submission_count: number;
  graded_count: number;
  pending_count: number;
  status: 'graded' | 'pending';
  ai_generated: boolean;
};

function HomeworkListWebScreen({ onBack, onOpenHomework, demoToken }: {
  onBack: () => void;
  onOpenHomework: () => void;
  demoToken: string | null;
}) {
  const [homeworks, setHomeworks] = React.useState<HomeworkListItem[]>([]);
  const [loading, setLoading]     = React.useState(true);
  const [tab, setTab]             = React.useState<'all' | 'graded' | 'pending'>('all');

  React.useEffect(() => {
    demoFetch('/demo/homeworks?class_id=demo-class-1', {}, demoToken)
      .then(data => {
        if (data && Array.isArray(data.homeworks)) {
          setHomeworks(data.homeworks);
        } else {
          // Fallback to demo data if endpoint not yet deployed
          setHomeworks([
            { id: 'demo-homework-1', title: 'Maths Chapter 5 Test', subject: 'Mathematics', education_level: 'Form 2', due_date: null, created_at: '2026-04-12T07:00:00Z', submission_count: 2, graded_count: 2, pending_count: 0, status: 'graded', ai_generated: true },
            { id: 'hw2', title: 'Chapter 6 Algebra Quiz', subject: 'Mathematics', education_level: 'Form 2', due_date: '2026-04-25T23:59:00Z', created_at: '2026-04-10T07:00:00Z', submission_count: 0, graded_count: 0, pending_count: 0, status: 'pending', ai_generated: false },
            { id: 'hw3', title: 'Chapter 7 Geometry', subject: 'Mathematics', education_level: 'Form 2', due_date: '2026-04-18T23:59:00Z', created_at: '2026-04-08T07:00:00Z', submission_count: 1, graded_count: 0, pending_count: 1, status: 'pending', ai_generated: true },
          ]);
        }
        setLoading(false);
      })
      .catch(() => {
        // Fallback to demo data if endpoint not yet deployed
        setHomeworks([
          { id: 'demo-homework-1', title: 'Maths Chapter 5 Test', subject: 'Mathematics', education_level: 'Form 2', due_date: null, created_at: '2026-04-12T07:00:00Z', submission_count: 2, graded_count: 2, pending_count: 0, status: 'graded', ai_generated: true },
          { id: 'hw2', title: 'Chapter 6 Algebra Quiz', subject: 'Mathematics', education_level: 'Form 2', due_date: '2026-04-25T23:59:00Z', created_at: '2026-04-10T07:00:00Z', submission_count: 0, graded_count: 0, pending_count: 0, status: 'pending', ai_generated: false },
          { id: 'hw3', title: 'Chapter 7 Geometry', subject: 'Mathematics', education_level: 'Form 2', due_date: '2026-04-18T23:59:00Z', created_at: '2026-04-08T07:00:00Z', submission_count: 1, graded_count: 0, pending_count: 1, status: 'pending', ai_generated: true },
        ]);
        setLoading(false);
      });
  }, [demoToken]);

  const graded  = homeworks.filter(h => h.status === 'graded');
  const pending = homeworks.filter(h => h.status === 'pending');
  const visible = tab === 'graded' ? graded : tab === 'pending' ? pending : homeworks;

  function fmtDue(iso: string | null | undefined): { label: string; overdue: boolean } {
    if (!iso) return { label: '', overdue: false };
    try {
      const d = new Date(iso);
      const overdue = d < new Date();
      return {
        label: overdue ? 'Overdue' : `Due ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        overdue,
      };
    } catch { return { label: '', overdue: false }; }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg }}>
      {/* Header */}
      <div style={{
        background: C.white, paddingInline: 14, paddingTop: 14, paddingBottom: 12,
        borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: C.teal, display: 'flex', alignItems: 'center' }}><ChevronLeft size={20} color={C.teal} /></button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>Form 2A — Homework</div>
          <div style={{ fontSize: 11, color: C.g500, marginTop: 1 }}>All assignments</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 32px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', paddingTop: 48, color: C.g500 }}>Loading…</div>
        ) : (
          <>
            {/* Count cards */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              {[
                { label: 'Graded', count: graded.length, bg: C.gradedBg, color: C.green },
                { label: 'Pending', count: pending.length, bg: C.amberFaint, color: C.amber500 },
              ].map(card => (
                <div key={card.label} style={{
                  flex: 1, borderRadius: 10, padding: '14px 12px', background: card.bg, textAlign: 'center',
                }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: card.color }}>{card.count}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: card.color, marginTop: 2 }}>{card.label}</div>
                </div>
              ))}
            </div>

            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {(['all', 'graded', 'pending'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  paddingInline: 14, paddingBlock: 6, borderRadius: 20, border: 'none',
                  background: tab === t ? C.teal : C.g200, cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: 600,
                  color: tab === t ? C.white : C.g500,
                }}>
                  {t === 'all' ? `All (${homeworks.length})` : t === 'graded' ? `Graded (${graded.length})` : `Pending (${pending.length})`}
                </button>
              ))}
            </div>

            {/* List */}
            {visible.length === 0 ? (
              <div style={{ textAlign: 'center', paddingTop: 40 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.g700, marginBottom: 4 }}>
                  {tab === 'graded' ? 'No graded homework yet' : tab === 'pending' ? 'All homework graded!' : 'No homework assigned yet'}
                </div>
                <div style={{ fontSize: 12, color: C.g500 }}>
                  {tab === 'pending' ? 'Great work — nothing pending.' : 'Tap Add Homework to get started.'}
                </div>
              </div>
            ) : visible.map(hw => {
              const due = fmtDue(hw.due_date);
              return (
                <button key={hw.id} onClick={onOpenHomework} style={{
                  width: '100%', background: C.white, borderRadius: 10, marginBottom: 8, padding: '12px 14px',
                  display: 'flex', alignItems: 'flex-start', gap: 10, border: 'none', cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)', fontFamily: 'inherit', textAlign: 'left', position: 'relative',
                  transition: 'box-shadow 0.12s',
                }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(13,115,119,0.14)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)')}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 5 }}>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.text }}>{hw.title}</span>
                      <span style={{
                        borderRadius: 6, paddingInline: 7, paddingBlock: 2,
                        background: hw.status === 'graded' ? C.gradedBg : C.amberFaint,
                        fontSize: 11, fontWeight: 700,
                        color: hw.status === 'graded' ? C.green : C.amber500, flexShrink: 0,
                      }}>
                        {hw.status === 'graded' ? 'Graded' : 'Pending'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 4 }}>
                      {hw.subject && <span style={{ fontSize: 11, color: C.teal, fontWeight: 600, background: C.teal50, borderRadius: 4, paddingInline: 5, paddingBlock: 1 }}>{hw.subject}</span>}
                      {hw.education_level && <span style={{ fontSize: 11, color: C.teal, fontWeight: 600, background: C.teal50, borderRadius: 4, paddingInline: 5, paddingBlock: 1 }}>{hw.education_level}</span>}
                    </div>
                    {due.label && (
                      <div style={{ fontSize: 11, color: due.overdue ? C.red : C.g500, fontWeight: due.overdue ? 600 : 400, marginBottom: 3 }}>{due.label}</div>
                    )}
                    <div style={{ display: 'flex', gap: 10 }}>
                      {hw.submission_count > 0 && <span style={{ fontSize: 11, color: C.teal, fontWeight: 600 }}>{hw.submission_count} submitted</span>}
                      {hw.graded_count > 0 && <span style={{ fontSize: 11, color: C.g500 }}>{hw.graded_count} graded{hw.pending_count > 0 ? ` · ${hw.pending_count} pending` : ''}</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: 18, color: C.g400, alignSelf: 'center' }}>›</span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Homework Detail
// ──────────────────────────────────────────────────────────────────────────────

/** Format an ISO date string as "Apr 13, 2026". */
function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

/** Due date countdown: returns { label, color } */
function dueDateStatus(dueDateIso: string | undefined | null): { label: string; color: string } | null {
  if (!dueDateIso) return null;
  try {
    const now  = Date.now();
    const due  = new Date(dueDateIso).getTime();
    const diff = due - now;
    if (diff < 0) return { label: 'Closed', color: C.g400 };
    const hours = Math.floor(diff / 3_600_000);
    if (hours < 24) return { label: `Due in ${hours}h`, color: C.red };
    const days = Math.floor(diff / 86_400_000);
    return { label: `Due in ${days}d`, color: C.amber };
  } catch { return null; }
}

function HomeworkDetailScreen({
  hw, isOpen, onToggleOpen, onBack, onGradeAll, onViewSubmission, demoToken, gradingComplete,
}: {
  hw: HomeworkInfo;
  isOpen: boolean;
  onToggleOpen: (next: boolean) => void;
  onBack: () => void;
  onGradeAll: () => void;
  onViewSubmission: (sub: DemoSubmissionDetail) => void;
  demoToken: string | null;
  gradingComplete: boolean;
}) {
  const [toggling, setToggling] = useState(false);
  const [regen, setRegen]       = useState(false);
  const [hwToast, setHwToast]   = useState('');
  const [subTab, setSubTab]     = useState<'pending' | 'graded'>('pending');

  // Inline question editing
  const [editingQIdx, setEditingQIdx]   = useState<number | null>(null);
  const [qDraftText, setQDraftText]     = useState('');
  const [qDraftAnswer, setQDraftAnswer] = useState('');
  const [qDraftMarks, setQDraftMarks]   = useState('');
  const [savingQ, setSavingQ]           = useState(false);
  const [questions, setQuestions]       = useState<ReviewQuestion[]>(DEMO_QUESTIONS);

  // Extra metadata fetched from /demo/homework/{id}
  const [hwMeta, setHwMeta] = useState<{
    ai_generated: boolean; created_at: string | null; due_date: string | null;
  }>({ ai_generated: true, created_at: '2026-04-13T07:00:00Z', due_date: '2026-04-20T23:59:00Z' });

  useEffect(() => {
    demoFetch(`/demo/homework/${hw.id}`, {}, demoToken).then(res => {
      if (!res) return;
      setHwMeta({
        ai_generated: res.ai_generated ?? true,
        created_at:   res.created_at   ?? null,
        due_date:     res.due_date      ?? null,
      });
      if (Array.isArray(res.questions) && res.questions.length > 0) {
        setQuestions(res.questions.map(normaliseQ));
      }
    });
  }, [hw.id]);

  async function handleToggle() {
    setToggling(true);
    const next = !isOpen;
    try {
      await demoFetch(`/demo/homework/${hw.id}/toggle-submissions`, {
        method: 'PATCH',
        body: JSON.stringify({ open: next }),
      }, demoToken);
    } catch { /* proceed */ }
    onToggleOpen(next);
    setToggling(false);
  }

  async function handleSaveQuestion(idx: number) {
    setSavingQ(true);
    const updated = questions.map((q, i) =>
      i !== idx ? q : {
        ...q,
        question_text: qDraftText,
        answer: qDraftAnswer,
        marks: Math.max(1, Number(qDraftMarks) || 1),
      },
    );
    try {
      await demoFetch(`/demo/homework/${hw.id}/questions`, {
        method: 'PATCH',
        body: JSON.stringify({
          questions: updated.map(q => ({
            question_number: q.question_number,
            question_text:   q.question_text,
            answer:          q.answer,
            marks:           q.marks,
            marking_notes:   q.marking_notes ?? null,
          })),
        }),
      }, demoToken);
    } catch { /* proceed — demo may lack auth */ }
    setQuestions(updated);
    setEditingQIdx(null);
    setSavingQ(false);
  }

  // Question text + correct answer lookup (mirrors backend _DEMO_QUESTIONS)
  const Q_META: Record<number, { question_text: string; correct_answer: string }> = {
    1: { question_text: 'Solve for x: 2x + 5 = 11',                             correct_answer: 'x = 3'   },
    2: { question_text: 'What is 15% of 200?',                                   correct_answer: '30'      },
    3: { question_text: 'Area of rectangle 8cm × 5cm',                           correct_answer: '40 cm²'  },
    4: { question_text: 'Simplify 3(2x+4) − 2(x−1)',                             correct_answer: '4x + 14' },
    5: { question_text: 'Probability of drawing red (3 red, 7 blue marbles)',     correct_answer: '3/10'    },
  };

  // Submissions — demo list sorted earliest first.
  // approved: true = graded, false = awaiting grade.
  // First 2 pre-approved so the screen shows real Graded/Pending split on load.
  const DEMO_SUBMISSIONS: Array<{
    name: string; submittedAt: string; grade: StudentGrade;
    submissionId: string; verdicts: DemoVerdict[]; approved: boolean;
  }> = [
    {
      name: 'Tendai Moyo', submittedAt: '2026-04-13T08:00:00Z',
      grade: DEMO_GRADES[0], submissionId: 'sub-s1', approved: true,
      verdicts: [
        { question_number: 1, verdict: 'correct'   as const, awarded: 2, max: 2, student_answer: '2x = 11−5, 2x = 6, x = 3',   feedback: 'Full working shown — correct', ...Q_META[1] },
        { question_number: 2, verdict: 'correct'   as const, awarded: 2, max: 2, student_answer: '15/100 × 200 = 30',           feedback: 'Correct method and answer',    ...Q_META[2] },
        { question_number: 3, verdict: 'partial'   as const, awarded: 1, max: 2, student_answer: '8 + 5 = 13',                  feedback: 'Used perimeter instead of area formula', ...Q_META[3] },
        { question_number: 4, verdict: 'correct'   as const, awarded: 2, max: 2, student_answer: '6x+12−2x+2 = 4x+14',         feedback: 'Correct expansion',            ...Q_META[4] },
        { question_number: 5, verdict: 'incorrect' as const, awarded: 0, max: 2, student_answer: '3 out of 7',                  feedback: 'Wrong total — should be 10 marbles', ...Q_META[5] },
      ],
    },
    {
      name: 'Chipo Dube', submittedAt: '2026-04-13T08:14:00Z',
      grade: DEMO_GRADES[1], submissionId: 'sub-s2', approved: false,
      verdicts: [
        { question_number: 1, verdict: 'correct'   as const, awarded: 2, max: 2, student_answer: 'x = 3',             feedback: 'Correct', ...Q_META[1] },
        { question_number: 2, verdict: 'partial'   as const, awarded: 1, max: 2, student_answer: '0.15 × 200 = 30',   feedback: 'Method mark awarded; accuracy mark lost on write-up', ...Q_META[2] },
        { question_number: 3, verdict: 'incorrect' as const, awarded: 0, max: 2, student_answer: '8 + 5 = 13',        feedback: 'Added instead of multiplying', ...Q_META[3] },
        { question_number: 4, verdict: 'correct'   as const, awarded: 2, max: 2, student_answer: '4x + 14',           feedback: 'Correct', ...Q_META[4] },
        { question_number: 5, verdict: 'partial'   as const, awarded: 1, max: 2, student_answer: '3 to 10',           feedback: 'Ratio stated correctly; fractional form not given', ...Q_META[5] },
      ],
    },
    {
      name: 'Takudzwa Ncube', submittedAt: '2026-04-13T09:01:00Z',
      grade: DEMO_GRADES[2], submissionId: 'sub-s3', approved: false,
      verdicts: [
        { question_number: 1, verdict: 'correct'   as const, awarded: 2, max: 2, student_answer: 'x = 3',    feedback: 'Correct', ...Q_META[1] },
        { question_number: 2, verdict: 'incorrect' as const, awarded: 0, max: 2, student_answer: '0.15%',    feedback: 'Incorrect — percentage symbol misapplied', ...Q_META[2] },
        { question_number: 3, verdict: 'partial'   as const, awarded: 1, max: 2, student_answer: '8 × 5 = 45', feedback: 'Correct formula, arithmetic error', ...Q_META[3] },
        { question_number: 4, verdict: 'incorrect' as const, awarded: 0, max: 2, student_answer: '4x + 10',  feedback: 'Sign error in expansion of −2(x−1)', ...Q_META[4] },
        { question_number: 5, verdict: 'partial'   as const, awarded: 1, max: 2, student_answer: '0.3',      feedback: 'Equivalent decimal accepted for partial credit', ...Q_META[5] },
      ],
    },
  ].sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  const dueSt   = dueDateStatus(hwMeta.due_date);
  const badgeBase: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, paddingInline: 9, paddingBlock: 4,
    borderRadius: 20, display: 'inline-block',
  };

  return (
    <Screen style={{ background: C.bg }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 16px', paddingBottom: 24 }}>

        <div style={{ marginBottom: 14 }}><BackButton label="Back" onClick={onBack} /></div>

        {/* Header card — title + info rows */}
        <div style={{ background: C.white, borderRadius: 14, padding: '14px 16px', marginBottom: 12, border: `1px solid ${C.border}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text, marginBottom: 10, lineHeight: 1.3 }}>{hw.title}</div>
          {/* Education level + subject badges */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ ...badgeBase, background: C.teal50, color: C.teal }}>{hw.education_level}</span>
            <span style={{ ...badgeBase, background: C.g100, color: C.g700 }}>{hw.subject}</span>
          </div>
          {/* Info rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[
              { label: 'Created',       value: fmtDate(hwMeta.created_at) },
              { label: 'Questions',     value: String(hw.question_count) },
              { label: 'Total marks',   value: String(hw.total_marks) },
              { label: 'AI generated',  value: hwMeta.ai_generated ? 'Yes' : 'No' },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: C.g500 }}>{row.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{row.value}</span>
              </div>
            ))}
            {dueSt && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: C.g500 }}>Due date</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: dueSt.color }}>{dueSt.label}</span>
              </div>
            )}
          </div>
        </div>

        {/* MARKING SCHEME section */}
        <div style={{
          background: C.white, borderRadius: 12, border: `1px solid ${C.border}`,
          overflow: 'hidden', marginBottom: 12,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: C.g700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Marking Scheme</span>
            <button
              disabled={regen}
              onClick={async () => {
                setRegen(true);
                await new Promise(r => setTimeout(r, 1500));
                setRegen(false);
                setHwToast('Scheme regenerated');
                setTimeout(() => setHwToast(''), 3000);
              }}
              style={{
                background: 'none', border: `1px solid ${regen ? C.g200 : C.teal}`, borderRadius: 20,
                padding: '4px 10px', cursor: regen ? 'not-allowed' : 'pointer',
                color: regen ? C.g400 : C.teal, fontSize: 12,
                fontWeight: 700, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              <Sparkles size={11} /> {regen ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
          {questions.map((q, idx) =>
            editingQIdx === idx ? (
              /* Inline edit form */
              <div key={q.question_number} style={{ padding: '12px 16px', background: C.tealLt, borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.teal, marginBottom: 8 }}>Q{q.question_number}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.g500, marginBottom: 3 }}>Question</div>
                <textarea
                  rows={2}
                  value={qDraftText}
                  onChange={e => setQDraftText(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.g200}`, borderRadius: 7, padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', resize: 'none', outline: 'none', marginBottom: 8 }}
                />
                <div style={{ fontSize: 11, fontWeight: 600, color: C.g500, marginBottom: 3 }}>Correct Answer</div>
                <textarea
                  rows={2}
                  value={qDraftAnswer}
                  onChange={e => setQDraftAnswer(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', border: `1.5px solid ${C.teal100}`, borderRadius: 7, padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', resize: 'none', outline: 'none', background: C.white, marginBottom: 8 }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.g500, marginBottom: 3 }}>Marks</div>
                    <input
                      type="number"
                      min={1}
                      value={qDraftMarks}
                      onChange={e => setQDraftMarks(e.target.value)}
                      style={{ width: 64, border: `1px solid ${C.g200}`, borderRadius: 7, padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', outline: 'none', textAlign: 'center' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => handleSaveQuestion(idx)}
                    disabled={savingQ}
                    style={{ flex: 1, background: savingQ ? C.teal100 : C.teal, border: 'none', borderRadius: 8, padding: '9px 0', cursor: savingQ ? 'not-allowed' : 'pointer', color: C.white, fontWeight: 700, fontSize: 13, fontFamily: 'inherit' }}
                  >
                    {savingQ ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditingQIdx(null)}
                    disabled={savingQ}
                    style={{ flex: 1, background: C.white, border: `1px solid ${C.g200}`, borderRadius: 8, padding: '9px 0', cursor: 'pointer', color: C.g700, fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* Display row — tappable, shows question_text truncated */
              <button
                key={q.question_number}
                onClick={() => {
                  setEditingQIdx(idx);
                  setQDraftText(q.question_text ?? '');
                  setQDraftAnswer(q.answer ?? '');
                  setQDraftMarks(String(q.marks ?? 1));
                }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 16px', background: 'none', border: 'none',
                  borderBottom: idx < questions.length - 1 ? `1px solid ${C.g100}` : 'none',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: C.teal, minWidth: 24 }}>Q{q.question_number}</span>
                <span style={{ flex: 1, fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {q.question_text || q.answer}
                </span>
                <span style={{ fontSize: 11, color: C.g500, whiteSpace: 'nowrap', marginRight: 4 }}>{(q.marks != null && q.marks > 0) ? `${q.marks} mk` : '—'}</span>
                <span style={{ fontSize: 15, color: C.g500 }}>›</span>
              </button>
            ),
          )}
        </div>

        {/* SUBMISSIONS section */}
        {(() => {
          // Per-submission graded status: approved in data OR all graded after Grade All
          const subsWithStatus = DEMO_SUBMISSIONS.map(sub => ({
            ...sub,
            isGraded: gradingComplete || sub.approved,
          }));
          const gradedSubs  = subsWithStatus.filter(s => s.isGraded);
          const pendingSubs = subsWithStatus.filter(s => !s.isGraded);
          const visibleSubs = subTab === 'graded' ? gradedSubs : pendingSubs;

          return (
            <div style={{
              background: C.white, borderRadius: 12, border: `1px solid ${C.border}`,
              overflow: 'hidden', marginBottom: 12,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              {/* Section header: SUBMISSIONS + open/closed toggle */}
              <div style={{
                padding: '11px 16px', borderBottom: `1px solid ${C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: C.g700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Submissions ({DEMO_SUBMISSIONS.length})
                </span>
                {/* Open / Closed toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: isOpen ? C.teal : C.g500, fontWeight: 600 }}>
                    {isOpen ? 'Open' : 'Closed'}
                  </span>
                  <button
                    onClick={handleToggle}
                    disabled={toggling}
                    aria-label={isOpen ? 'Close submissions' : 'Open submissions'}
                    style={{
                      flexShrink: 0, width: 40, height: 22, borderRadius: 11,
                      background: isOpen ? C.teal : C.g200, border: 'none',
                      cursor: toggling ? 'not-allowed' : 'pointer',
                      position: 'relative', transition: 'background 0.2s', padding: 0,
                    }}
                  >
                    <div style={{
                      position: 'absolute', top: 3,
                      left: isOpen ? 21 : 3,
                      width: 16, height: 16, borderRadius: 8,
                      background: C.white, transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                    }} />
                  </button>
                </div>
              </div>

              {/* Count cards: Graded + Pending */}
              <div style={{ display: 'flex', gap: 10, padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
                <div style={{
                  flex: 1, background: C.gradedBg, borderRadius: 10, padding: '9px 12px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.greenDk }}>{gradedSubs.length}</div>
                  <div style={{ fontSize: 11, color: C.greenDk, fontWeight: 600 }}>Graded</div>
                </div>
                <div style={{
                  flex: 1, background: C.pendingBg, borderRadius: 10, padding: '9px 12px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.amberText }}>{pendingSubs.length}</div>
                  <div style={{ fontSize: 11, color: C.amberText, fontWeight: 600 }}>Pending</div>
                </div>
              </div>

              {/* Grade All button — shown when pending > 0 and answer key confirmed */}
              {hw.answer_key_id && questions.length > 0 && pendingSubs.length > 0 && (
                <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
                  <button
                    onClick={onGradeAll}
                    style={{
                      width: '100%', background: C.teal, border: 'none', borderRadius: 9, padding: '11px 0',
                      cursor: 'pointer', color: C.white, fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      boxShadow: '0 3px 10px rgba(13,115,119,0.25)', transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                  >
                    <Sparkles size={13} /> Grade All with AI ({pendingSubs.length})
                  </button>
                </div>
              )}

              {/* Pill tabs: Pending / Graded */}
              {DEMO_SUBMISSIONS.length > 0 && (
                <div style={{ display: 'flex', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
                  {(['pending', 'graded'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setSubTab(t)}
                      style={{
                        flex: 1, padding: '7px 0', borderRadius: 20, border: 'none',
                        background: subTab === t ? C.teal : C.g100,
                        color: subTab === t ? C.white : C.g500,
                        fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                        transition: 'background 0.15s, color 0.15s',
                      }}
                    >
                      {t === 'pending' ? `Pending (${pendingSubs.length})` : `Graded (${gradedSubs.length})`}
                    </button>
                  ))}
                </div>
              )}

              {/* Submission rows for active tab */}
              {DEMO_SUBMISSIONS.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: C.g500, fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}><Inbox size={24} color={C.g400} /></div>
                  No submissions yet
                </div>
              ) : visibleSubs.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: C.g500, fontSize: 13 }}>
                  {subTab === 'pending'
                    ? '✓ All submissions graded'
                    : 'No graded submissions yet'}
                </div>
              ) : (
                visibleSubs.map((sub, i) => {
                  const grade = sub.grade;
                  return (
                    <button
                      key={sub.submissionId}
                      onClick={sub.isGraded ? () => onViewSubmission({
                        submissionId: sub.submissionId,
                        studentName:  sub.name,
                        submittedAt:  sub.submittedAt,
                        grade:        sub.grade,
                        verdicts:     sub.verdicts,
                      }) : undefined}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', padding: '10px 16px', gap: 10,
                        borderBottom: i < visibleSubs.length - 1 ? `1px solid ${C.g100}` : 'none',
                        background: 'none', border: 'none', textAlign: 'left', fontFamily: 'inherit',
                        cursor: sub.isGraded ? 'pointer' : 'default',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => { if (sub.isGraded) e.currentTarget.style.background = C.g50; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                    >
                      <div style={{
                        width: 32, height: 32, borderRadius: 16, background: C.teal50,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, color: C.teal, flexShrink: 0,
                      }}>
                        {sub.name.charAt(0)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{sub.name}</div>
                        <div style={{ fontSize: 11, color: C.g500, marginTop: 1 }}>
                          {new Date(sub.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {sub.isGraded ? ' · Graded' : ' · Awaiting grade'}
                        </div>
                      </div>
                      {sub.isGraded ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{
                            background: scoreBg(grade.percentage), color: scoreColor(grade.percentage),
                            fontSize: 11, fontWeight: 700, paddingInline: 8, paddingBlock: 4, borderRadius: 6,
                            whiteSpace: 'nowrap',
                          }}>
                            {grade.score} / {grade.max_score}
                          </div>
                          <span style={{ fontSize: 14, color: C.g400 }}>›</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{
                            background: C.amber50, color: C.amber700,
                            fontSize: 11, fontWeight: 700, paddingInline: 7, paddingBlock: 4, borderRadius: 6,
                          }}>
                            Pending
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); onGradeAll(); }}
                            style={{
                              background: C.teal, border: 'none', borderRadius: 7,
                              paddingInline: 9, paddingBlock: 4, cursor: 'pointer',
                              color: C.white, fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                            }}
                          >
                            Grade
                          </button>
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          );
        })()}
      </div>
      {hwToast && <Toast message={hwToast} onDone={() => setHwToast('')} />}
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Grade All
// ──────────────────────────────────────────────────────────────────────────────
type GradePhase = 'loading' | 'revealing' | 'done';

function GradeAllScreen({
  hw, onBack, demoToken, onGradingDone,
}: {
  hw: HomeworkInfo;
  onBack: () => void;
  demoToken: string | null;
  onGradingDone?: () => void;
}) {
  const [phase, setPhase]         = useState<GradePhase>('loading');
  const [allGrades, setAllGrades] = useState<StudentGrade[]>([]);
  const [revealed, setRevealed]   = useState(0);
  const [dots, setDots]           = useState('');

  // Animated dots during loading
  useEffect(() => {
    if (phase !== 'loading') { setDots(''); return; }
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 420);
    return () => clearInterval(t);
  }, [phase]);

  // On mount: call API, then start revealing
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await demoFetch(`/homework/${hw.id}/grade-all`, {
        method: 'POST',
        body: JSON.stringify({ answer_key_id: hw.answer_key_id }),
      }, demoToken);

      if (cancelled) return;

      const grades: StudentGrade[] = (res?.results && Array.isArray(res.results) && res.results.length > 0)
        ? (res.results as any[]).map((g: any, i: number) => normaliseGrade(g, i))
        : DEMO_GRADES;

      setAllGrades(grades);
      setPhase('revealing');
    })();
    return () => { cancelled = true; };
  }, []);

  // Reveal one result every 700ms once in revealing phase
  useEffect(() => {
    if (phase !== 'revealing') return;
    if (revealed >= allGrades.length) { setPhase('done'); return; }
    const t = setTimeout(() => setRevealed(r => r + 1), 700);
    return () => clearTimeout(t);
  }, [phase, revealed, allGrades.length]);

  // Notify parent when all results are shown
  useEffect(() => {
    if (phase === 'done') onGradingDone?.();
  }, [phase]);

  const visibleGrades = allGrades.slice(0, revealed);
  const avgPct = allGrades.length > 0
    ? Math.round(allGrades.reduce((s, g) => s + g.percentage, 0) / allGrades.length)
    : 0;
  const passCount = allGrades.filter(g => g.percentage >= 50).length;

  const verdictIcon = (v: 'correct' | 'incorrect' | 'partial') =>
    v === 'correct' ? '✓' : v === 'partial' ? '½' : '✗';
  const verdictBg = (v: 'correct' | 'incorrect' | 'partial') =>
    v === 'correct' ? C.greenLt : v === 'partial' ? C.amber50 : C.redLt;
  const verdictColor = (v: 'correct' | 'incorrect' | 'partial') =>
    v === 'correct' ? C.green : v === 'partial' ? C.amber500 : C.red;

  return (
    <Screen style={{ background: C.bg }}>
      <div style={{ flex: 1, padding: '18px 16px', paddingBottom: 24 }}>

        <div style={{ marginBottom: 14 }}><BackButton label="Back" onClick={onBack} /></div>

        <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 2 }}>Grade All</div>
        <div style={{ fontSize: 12, color: C.g500, marginBottom: 16 }}>{hw.title} · {hw.subject}</div>

        {/* Loading state */}
        {phase === 'loading' && (
          <div style={{
            background: C.white, border: `1px solid ${C.border}`, borderRadius: 14,
            padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: 26, background: C.teal50,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Sparkles size={24} color={C.teal} /></div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Grading with Gemma 4{dots}</div>
            <div style={{ fontSize: 12, color: C.g500, textAlign: 'center', lineHeight: 1.5 }}>
              Reading student answers and comparing to the marking scheme
            </div>
            <div style={{ width: '100%', height: 4, borderRadius: 2, background: C.g100, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2, background: C.teal,
                width: '60%', animation: 'none',
                transition: 'width 1.2s ease',
              }} />
            </div>
          </div>
        )}

        {/* Revealing / done: student result cards */}
        {(phase === 'revealing' || phase === 'done') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Progress label while revealing */}
            {phase === 'revealing' && (
              <div style={{ fontSize: 12, color: C.teal, fontWeight: 600, marginBottom: 4 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Sparkles size={12} color={C.teal} /> Grading student {revealed} of {allGrades.length}…</span>
              </div>
            )}

            {visibleGrades.map((g, idx) => (
              <div
                key={g.student_id}
                style={{
                  background: C.white, borderRadius: 13, border: `1px solid ${C.border}`,
                  padding: '13px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                  opacity: 1, transform: 'translateY(0)',
                  transition: 'opacity 0.3s, transform 0.3s',
                }}
              >
                {/* Student name + score */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: 17, background: scoreBg(g.percentage),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800, color: scoreColor(g.percentage), flexShrink: 0,
                    }}>
                      {g.student_name.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{g.student_name}</div>
                      <div style={{ fontSize: 11, color: C.g500, marginTop: 1 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.percentage >= 70 ? C.green400 : g.percentage >= 50 ? C.yellow400 : C.red500, display: 'inline-block' }} />
                          {g.percentage >= 70 ? 'Pass' : g.percentage >= 50 ? 'Borderline' : 'Needs support'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div style={{
                    background: scoreBg(g.percentage), borderRadius: 10, padding: '6px 10px',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: scoreColor(g.percentage), lineHeight: 1 }}>
                      {g.score} / {g.max_score}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: scoreColor(g.percentage), marginTop: 2 }}>
                      {g.percentage}%
                    </div>
                  </div>
                </div>

                {/* Score bar */}
                <div style={{ height: 4, borderRadius: 2, background: C.g100, overflow: 'hidden', marginBottom: 10 }}>
                  <div style={{
                    height: '100%', borderRadius: 2, background: scoreColor(g.percentage),
                    width: `${g.percentage}%`, transition: 'width 0.6s ease',
                  }} />
                </div>

                {/* Per-question verdict chips */}
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {g.verdicts.map(v => (
                    <div
                      key={v.question_number}
                      title={`Q${v.question_number}: ${v.verdict} (${v.awarded}/${v.max})`}
                      style={{
                        background: verdictBg(v.verdict), borderRadius: 7,
                        paddingInline: 7, paddingBlock: 4,
                        display: 'flex', alignItems: 'center', gap: 3,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 700, color: verdictColor(v.verdict) }}>
                        Q{v.question_number}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: verdictColor(v.verdict) }}>
                        {verdictIcon(v.verdict)}
                      </span>
                      <span style={{ fontSize: 11, color: verdictColor(v.verdict), fontWeight: 600 }}>
                        {v.awarded}/{v.max}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Next-student loading shimmer */}
            {phase === 'revealing' && revealed < allGrades.length && (
              <div style={{
                background: C.white, borderRadius: 13, border: `1px dashed ${C.teal100}`,
                padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ width: 34, height: 34, borderRadius: 17, background: C.teal50 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ height: 12, borderRadius: 6, background: C.g100, width: '55%' }} />
                  <div style={{ height: 10, borderRadius: 5, background: C.g100, width: '35%' }} />
                </div>
                <div style={{ width: 46, height: 40, borderRadius: 10, background: C.g100 }} />
              </div>
            )}

            {/* Summary panel once done */}
            {phase === 'done' && allGrades.length > 0 && (
              <div style={{
                background: C.teal, borderRadius: 14, padding: '14px 16px', marginTop: 4,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.8)' }}>Class average</div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: C.white, lineHeight: 1.1 }}>{avgPct}%</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.8)' }}>Passed</div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: C.white, lineHeight: 1.1 }}>
                    {passCount}/{allGrades.length}
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// STUDENT SCREENS
// ──────────────────────────────────────────────────────────────────────────────

// ── S1: Register / Join Class ─────────────────────────────────────────────────
function StudentRegisterScreen({ onJoined }: { onJoined: (name: string) => void }) {
  const [firstName, setFirstName]       = useState('Chipo');
  const [surname, setSurname]           = useState('Dube');
  const [manualClassName, setManualClassName] = useState('');
  const [joinCode, setJoinCode]         = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');

  async function handleJoin() {
    if (!firstName.trim() || !surname.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!manualClassName.trim() && !joinCode.trim()) {
      setError('Enter your class name or join code.');
      return;
    }
    setLoading(true);
    setError('');
    if (joinCode.trim()) {
      try {
        await demoFetch('/demo/auth/student/lookup', {
          method: 'POST',
          body: JSON.stringify({ join_code: joinCode.trim().toUpperCase() }),
        });
      } catch (err: any) {
        const msg: string = err?.error ?? err?.message ?? '';
        if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('no class')) {
          setLoading(false);
          setError('Join code not found. Check the code and try again.');
          return;
        }
        // Offline / unknown — still proceed
      }
    }
    setLoading(false);
    onJoined(`${firstName.trim()} ${surname.trim()}`);
  }

  const inp: React.CSSProperties = {
    border: `1px solid ${C.g200}`, borderRadius: 10, padding: '10px 12px',
    fontSize: 14, color: C.text, outline: 'none', width: '100%',
    boxSizing: 'border-box', fontFamily: 'inherit', background: C.white,
  };
  const lbl: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, color: C.g900, marginTop: 12, marginBottom: 4, display: 'block',
  };

  return (
    <Screen style={{ padding: '20px 18px' }}>
      <div style={{ width: 52, height: 52, borderRadius: 16, background: C.amber50, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <GraduationCap size={24} color={C.amber} />
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 2 }}>Join a Class</div>
      <div style={{ fontSize: 12, color: C.g500, marginBottom: 16, lineHeight: 1.5 }}>
        Fill in your details below to get started.
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={lbl}>First Name</label>
          <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Chipo" style={inp} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Surname</label>
          <input type="text" value={surname} onChange={e => setSurname(e.target.value)} placeholder="Dube" style={inp} />
        </div>
      </div>

      {/* Add class manually — always visible */}
      <div style={{
        marginTop: 16, padding: '14px 14px 10px', borderRadius: 12,
        border: `1px solid ${C.amber}`, background: C.amber50,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Add class manually</div>

        <label style={{ ...lbl, marginTop: 0 }}>Class name</label>
        <input
          type="text"
          value={manualClassName}
          onChange={e => setManualClassName(e.target.value)}
          placeholder="e.g. Form 2A"
          style={inp}
        />

        <label style={lbl}>Join code (optional)</label>
        <input
          type="text"
          value={joinCode}
          onChange={e => setJoinCode(e.target.value.toUpperCase())}
          maxLength={10}
          placeholder="e.g. NR2A01"
          style={{ ...inp, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}
        />
      </div>

      {error && <div style={{ marginTop: 8, fontSize: 12, color: C.red, fontWeight: 600 }}>{error}</div>}

      <button
        onClick={handleJoin}
        disabled={loading}
        style={{
          marginTop: 16, width: '100%', background: loading ? C.amber100 : C.amber,
          border: 'none', borderRadius: 10, padding: '14px 0',
          cursor: loading ? 'not-allowed' : 'pointer', color: C.white,
          fontWeight: 700, fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box', transition: 'background 0.15s',
        }}
      >
        {loading ? 'Joining…' : 'Join Class →'}
      </button>

      <div style={{ marginTop: 14, textAlign: 'center', fontSize: 12, color: C.g500 }}>
        Already registered?{' '}
        <button
          onClick={() => onJoined('Chipo Dube')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.amber700, fontWeight: 600, fontSize: 12, padding: 0, fontFamily: 'inherit' }}
        >
          Sign in
        </button>
      </div>
    </Screen>
  );
}

// ── S2: Home ──────────────────────────────────────────────────────────────────
function StudentHomeScreen({
  studentName, submissionsOpen, onSubmit, onResults, onTutor, onSettings, demoToken,
}: { studentName: string; submissionsOpen: boolean; onSubmit: () => void; onResults: () => void; onTutor: () => void; onSettings: () => void; demoToken: string | null }) {
  const firstName = studentName.split(' ')[0];
  const [assignments, setAssignments] = React.useState<{ id: string; title: string; subject?: string; total_marks?: number; open_for_submission?: boolean; has_pending_submission?: boolean; education_level?: string }[]>([]);
  const [loadingHw, setLoadingHw] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      const data = await demoFetch('/demo/assignments?class_id=demo-class-1&status=all', {}, demoToken);
      if (Array.isArray(data) && data.length > 0) {
        setAssignments(data);
      } else {
        // Fallback: show the hardcoded demo assignment controlled by submissionsOpen
        setAssignments([{
          id: 'demo-hw-1',
          title: 'Chapter 5 Maths Test',
          subject: 'Mathematics',
          total_marks: 20,
          open_for_submission: submissionsOpen,
          has_pending_submission: false,
          education_level: 'form_2',
        }]);
      }
      setLoadingHw(false);
    })();
  }, [demoToken, submissionsOpen]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg }}>
      {/* Header: [spacer] — [center title] — [avatar right] */}
      <div style={{ background: C.teal, paddingInline: 16, paddingTop: 16, paddingBottom: 14, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.white }}>Homework</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>
            {(() => { const g = { en: 'Hello', sn: 'Mhoro', nd: 'Sawubona' }; return `${g.en}, ${firstName}`; })()}
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <div
            onClick={onSettings}
            style={{ width: 38, height: 38, borderRadius: 19, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}
          >
            <span style={{ color: C.white, fontSize: 16, fontWeight: 700 }}>{firstName[0]}</span>
            <div style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5, background: C.green400, border: `2px solid ${C.teal}` }} />
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14, paddingBottom: 70 }}>
        {/* Class switcher — demo shows two classes */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {[
            { id: 'cls1', label: 'Form 2A — Harare High', active: true },
            { id: 'cls2', label: 'Form 3B — Allan Wilson', active: false },
          ].map(c => (
            <button key={c.id} style={{
              flex: 1, padding: '7px 0', borderRadius: 8, border: `1px solid ${c.active ? C.teal : C.g200}`,
              background: c.active ? C.teal50 : C.white, color: c.active ? C.teal : C.g500,
              fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            }}>{c.label}</button>
          ))}
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: C.g500, letterSpacing: '0.06em', marginBottom: 10, textTransform: 'uppercase' }}>
          My Assignments
        </div>

        {loadingHw ? (
          <div style={{ textAlign: 'center', padding: 20, color: C.g500, fontSize: 12 }}>Loading...</div>
        ) : assignments.length === 0 ? (
          <div style={{ background: C.white, borderRadius: 14, border: `1px solid ${C.border}`, padding: 28, textAlign: 'center' }}>
            <FileText size={32} color={C.g400} style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>No assignments yet</div>
            <div style={{ fontSize: 12, color: C.g500 }}>Your teacher has not assigned any homework yet.</div>
          </div>
        ) : (
          assignments.map(a => {
            const isOpen = a.open_for_submission !== false;
            const isSubmitted = a.has_pending_submission === true;
            return (
              <div key={a.id} style={{ background: C.white, borderRadius: 14, border: `1px solid ${C.border}`, overflow: 'hidden', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ padding: '13px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ flex: 1, paddingRight: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{a.title}</div>
                      <div style={{ fontSize: 11, color: C.g500, marginTop: 3 }}>{a.subject ?? ''}{a.total_marks ? ` · ${a.total_marks} marks` : ''}</div>
                    </div>
                    <div style={{
                      background: isSubmitted ? C.green100 : isOpen ? C.greenLt : C.redLt,
                      color: isSubmitted ? C.green700 : isOpen ? C.green : C.red,
                      fontSize: 11, fontWeight: 700, paddingInline: 8, paddingBlock: 4, borderRadius: 20,
                      flexShrink: 0, whiteSpace: 'nowrap',
                    }}>
                      {isSubmitted ? '● Submitted' : isOpen ? '● Open' : '● Closed'}
                    </div>
                  </div>

                  {isSubmitted ? (
                    <div style={{ fontSize: 12, color: C.green700, fontStyle: 'italic', paddingTop: 2 }}>
                      Your work has been submitted.
                    </div>
                  ) : isOpen ? (
                    <button
                      onClick={onSubmit}
                      style={{
                        width: '100%', background: C.amber, border: 'none', borderRadius: 8, padding: '10px 0',
                        cursor: 'pointer', color: C.white, fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        boxShadow: '0 2px 8px rgba(245,166,35,0.30)',
                      }}
                    >
                      <Upload size={14} /><span>Submit Work</span>
                    </button>
                  ) : (
                    <div style={{ fontSize: 12, color: C.g500, fontStyle: 'italic', paddingTop: 2 }}>
                      Submissions closed by your teacher.
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        <button
          onClick={onResults}
          style={{
            width: '100%', border: `1.5px solid ${C.amber}`, borderRadius: 10, padding: '11px 0', background: 'none',
            cursor: 'pointer', color: C.amber700, fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            marginBottom: 12, marginTop: 6,
          }}
        >
          <BarChart2 size={14} /><span>View My Results</span>
        </button>

        {/* AI Tutor card */}
        <button
          onClick={onTutor}
          style={{
            width: '100%', background: `linear-gradient(135deg, ${C.teal} 0%, ${C.tealMd} 100%)`,
            border: 'none', borderRadius: 12, padding: '14px 16px',
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            boxShadow: '0 4px 14px rgba(13,115,119,0.30)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Bot size={20} color={C.white} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.white, marginBottom: 2 }}>AI Tutor</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.80)', lineHeight: 1.3 }}>Ask questions · Get Socratic hints · Send a photo</div>
            </div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.70)' }}>›</div>
          </div>
          <div style={{ marginTop: 10, background: 'rgba(255,255,255,0.12)', borderRadius: 8, padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, background: C.amber, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>Powered by Gemma 4 · Socratic learning mode</span>
          </div>
        </button>
      </div>

      {/* Bottom tabs */}
      <div style={{ height: 50, background: C.white, borderTop: `1px solid ${C.border}`, display: 'flex', flexShrink: 0 }}>
        {([
          { icon: <FileText size={16} />, label: 'Homework', active: true, onClick: undefined as (() => void) | undefined },
          { icon: <Sparkles size={16} />, label: 'Tutor', active: false, onClick: onTutor },
          { icon: <BarChart2 size={16} />, label: 'Results', active: false, onClick: onResults },
        ]).map(tab => (
          <div
            key={tab.label}
            onClick={tab.onClick}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, cursor: 'pointer' }}
          >
            <span style={{ color: tab.active ? C.amber : C.g500 }}>{tab.icon}</span>
            <span style={{
              fontSize: 11, fontWeight: tab.active ? 600 : 400, color: tab.active ? C.amber700 : C.g500,
              borderBottom: tab.active ? `2px solid ${C.amber}` : '2px solid transparent', paddingBottom: 1,
            }}>{tab.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── S3: Submit Work ───────────────────────────────────────────────────────────
function StudentSubmitScreen({
  onBack, onCapture, onSubmitted, demoToken,
}: { onBack: () => void; onCapture?: () => void; onSubmitted: (sub: { id: string; fileName: string }) => void; demoToken: string | null }) {
  const [file, setFile]       = useState<{ name: string; mimeType: string; base64: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [dots, setDots]       = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [fileQualityWarnings, setFileQualityWarnings] = useState<string[]>([]);
  const [fileEnhanced, setFileEnhanced] = useState(false);
  const [fileWarningDismissed, setFileWarningDismissed] = useState(false);
  const [showQuestionsModal, setShowQuestionsModal] = useState(false);
  const [questionsData, setQuestionsData] = useState<{ question_number: number; question_text: string; marks: number }[]>([]);
  const [questionPaperText, setQuestionPaperText] = useState('');
  const [questionsLoading, setQuestionsLoading] = useState(false);

  useEffect(() => {
    if (!showQuestionsModal || questionsData.length > 0 || questionPaperText) return;
    setQuestionsLoading(true);
    demoFetch(`/demo/answer-keys/${DEMO_HOMEWORK.answer_key_id}/questions`, {}, demoToken)
      .then(data => {
        if (Array.isArray(data)) { setQuestionsData(data); }
        else if (data?.questions) {
          setQuestionsData(data.questions);
          if (data.question_paper_text) setQuestionPaperText(data.question_paper_text);
        }
      })
      .finally(() => setQuestionsLoading(false));
  }, [showQuestionsModal]);

  const galleryRef = useRef<HTMLInputElement>(null);
  const pdfRef     = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading) { setDots(''); return; }
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 450);
    return () => clearInterval(t);
  }, [loading]);

  function readFile(f: File) {
    const mimeType = f.type || 'application/octet-stream';
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setFileQualityWarnings([]);
      setFileEnhanced(false);
      setFileWarningDismissed(false);

      if (mimeType.startsWith('image/')) {
        try {
          const result = await analyseAndEnhanceWebImage(dataUrl);
          setFile({ name: f.name, mimeType, base64: result.base64 });
          setFileEnhanced(result.enhanced);
          if (result.warnings.length > 0) setFileQualityWarnings(result.warnings);
        } catch {
          setFile({ name: f.name, mimeType, base64: dataUrl.split(',')[1] });
        }
      } else {
        setFile({ name: f.name, mimeType, base64: dataUrl.split(',')[1] });
      }
      setError('');
    };
    reader.onerror = () => setError('Could not read file. Please try again.');
    reader.readAsDataURL(f);
  }
  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) readFile(f);
    e.target.value = '';
  }

  async function handleSubmit() {
    if (!file) { setError('Please upload your work first.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await demoFetch('/demo/submissions/student', {
        method: 'POST',
        body: JSON.stringify({ homework_id: DEMO_HOMEWORK.id, answer_key_id: DEMO_HOMEWORK.answer_key_id, file_data: file.base64, media_type: file.mimeType, file_name: file.name }),
      }, demoToken);
      onSubmitted({ id: res?.submission_id ?? res?.id ?? `sub-${Date.now()}`, fileName: file.name });
    } catch {
      onSubmitted({ id: `sub-${Date.now()}`, fileName: file.name });
    } finally {
      setLoading(false);
    }
  }

  const btnBase: React.CSSProperties = {
    flex: 1, border: `1.5px solid ${C.g200}`, borderRadius: 12, padding: '14px 4px',
    background: C.white, cursor: 'pointer', display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 5, fontFamily: 'inherit', transition: 'border-color 0.12s',
  };

  return (
    <Screen style={{ background: C.white }}>
      <div style={{ flex: 1, padding: '18px 16px', paddingBottom: 24 }}>
        <div style={{ marginBottom: 14 }}><BackButton label="Back" onClick={onBack} /></div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>Submit Work</div>
          <button
            onClick={() => setShowQuestionsModal(true)}
            style={{
              background: 'none', border: `1.5px solid ${C.teal}`, borderRadius: 8,
              padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: C.teal,
            }}
          >
            <Eye size={13} /><span>View Assignment</span>
          </button>
        </div>
        <div style={{ fontSize: 13, color: C.g500, marginBottom: 20, lineHeight: 1.5 }}>Chapter 5 Maths Test · Mathematics</div>

        {!file && (
          <>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.g500, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
              Upload Your Work
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {([
                { icon: <Camera size={26} color={C.amber} />, label: 'Camera',  onClick: () => setCameraOpen(true) },
                { icon: <ImageIcon size={26} color={C.amber} />, label: 'Gallery', onClick: () => galleryRef.current?.click() },
                { icon: <File size={26} color={C.amber} />, label: 'PDF',     onClick: () => pdfRef.current?.click() },
                ...(onCapture ? [{ icon: <FileText size={26} color={C.amber} />, label: 'Pages', onClick: onCapture }] : []),
              ]).map(btn => (
                <button
                  key={btn.label}
                  onClick={btn.onClick}
                  style={btnBase}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = C.amber)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = C.g200)}
                >
                  <span>{btn.icon}</span>
                  <span style={{ fontSize: 11, color: C.g700, fontWeight: 600 }}>{btn.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {file && (
          <>
            <div style={{ background: C.amber50, border: `1px solid ${C.amber100}`, borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>{file.mimeType.startsWith('image') ? <ImageIcon size={22} color={C.amber700} /> : <File size={22} color={C.amber700} />}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.amber700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                <div style={{ fontSize: 11, color: C.g500, marginTop: 2 }}>
                  {(file.base64.length * 0.75 / 1024).toFixed(1)} KB · Ready to submit
                  {fileEnhanced && (
                    <span style={{
                      marginLeft: 6, fontSize: 11, fontWeight: 700, color: C.teal,
                      background: C.teal50, borderRadius: 4, padding: '1px 5px',
                    }}>
                      ✓ Image enhanced
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => { setFile(null); setFileQualityWarnings([]); setFileEnhanced(false); setFileWarningDismissed(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g400, fontSize: 16, padding: 2, flexShrink: 0 }}>✕</button>
            </div>

            {/* Quality warning block */}
            {fileQualityWarnings.length > 0 && !fileWarningDismissed && (
              <div style={{
                marginTop: 8, background: C.amberLt, border: `1px solid ${C.amber200}`,
                borderRadius: 10, padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                  <span style={{ flexShrink: 0 }}><AlertTriangle size={15} color={C.amberText} /></span>
                  <div style={{ fontSize: 12, color: C.amberText, lineHeight: 1.5 }}>
                    <strong style={{ display: 'block', marginBottom: 2 }}>Image may be unclear</strong>
                    Your teacher may have difficulty reading it. Retake or replace for better results.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => { setFile(null); setFileQualityWarnings([]); setFileEnhanced(false); setFileWarningDismissed(false); galleryRef.current?.click(); }}
                    style={{
                      flex: 1, background: 'none', border: '1.5px solid #F59E0B', borderRadius: 8,
                      padding: '8px 0', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      color: C.amberText, fontFamily: 'inherit',
                    }}
                  >
                    Replace Image
                  </button>
                  <button
                    onClick={() => setFileWarningDismissed(true)}
                    style={{
                      flex: 1, background: C.amber400, border: 'none', borderRadius: 8,
                      padding: '8px 0', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      color: C.white, fontFamily: 'inherit',
                    }}
                  >
                    Use Anyway
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {error && <div style={{ marginTop: 8, fontSize: 12, color: C.red, fontWeight: 600 }}>{error}</div>}

        <button
          onClick={handleSubmit}
          disabled={loading || !file}
          style={{
            marginTop: 20, width: '100%', background: (!file || loading) ? C.amber100 : C.amber,
            border: 'none', borderRadius: 10, padding: '14px 0',
            cursor: (!file || loading) ? 'not-allowed' : 'pointer',
            color: C.white, fontWeight: 700, fontSize: 15, fontFamily: 'inherit',
            boxSizing: 'border-box', transition: 'background 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <Upload size={16} />
          <span>{loading ? `Submitting${dots}` : 'Submit Work'}</span>
        </button>

        <input ref={galleryRef} type="file" accept="image/*"                       style={{ display: 'none' }} onChange={handleInput} />
        <input ref={pdfRef}     type="file" accept=".pdf,application/pdf"          style={{ display: 'none' }} onChange={handleInput} />
      </div>

      <WebCameraModal
        open={cameraOpen}
        onCapture={(base64, mimeType) => {
          // WebCameraModal already runs quality+enhancement
          setFile({ name: `photo_${Date.now()}.jpg`, mimeType, base64 });
          setFileQualityWarnings([]);
          setFileEnhanced(true);
          setFileWarningDismissed(false);
          setError('');
          setCameraOpen(false);
        }}
        onClose={() => setCameraOpen(false)}
      />

      {/* View Assignment questions modal */}
      {showQuestionsModal && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50,
        }}>
          <div style={{
            background: C.white, borderRadius: '20px 20px 0 0', width: '100%',
            maxHeight: '80%', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 18px', borderBottom: `1px solid ${C.border}`,
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Assignment Questions</div>
              <button
                onClick={() => setShowQuestionsModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: C.g500, padding: 2 }}
              >✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px 24px' }}>
              {questionsLoading ? (
                <div style={{ textAlign: 'center', padding: 30, color: C.g500, fontSize: 13 }}>Loading questions...</div>
              ) : questionsData.length === 0 && !questionPaperText ? (
                <div style={{ textAlign: 'center', padding: 30 }}>
                  <FileText size={36} color={C.g400} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginTop: 10 }}>No question paper available</div>
                  <div style={{ fontSize: 12, color: C.g500, marginTop: 4 }}>Contact your teacher for the assignment details.</div>
                </div>
              ) : (
                <>
                  {/* Question paper text */}
                  {questionPaperText && (
                    <div style={{ background: C.g50, borderRadius: 10, padding: 14, marginBottom: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.g500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Question Paper</div>
                      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{questionPaperText}</div>
                    </div>
                  )}

                  {/* Per-question marks breakdown */}
                  {questionsData.length > 0 && (
                    <>
                      {questionPaperText && <div style={{ fontSize: 11, fontWeight: 700, color: C.g500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Marks Breakdown</div>}
                      {questionsData.map(q => (
                        <div key={q.question_number} style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 0',
                          borderBottom: `1px solid ${C.g100}`,
                        }}>
                          <div style={{
                            width: 26, height: 26, borderRadius: 13, background: C.teal50,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            fontSize: 12, fontWeight: 700, color: C.teal,
                          }}>{q.question_number}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{q.question_text || `Question ${q.question_number}`}</div>
                            <div style={{ fontSize: 11, color: C.g500, marginTop: 3 }}>{q.marks} mark{q.marks !== 1 ? 's' : ''}</div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Screen>
  );
}

// ── S4: Submission Success ─────────────────────────────────────────────────────
function StudentSubmissionSuccessScreen({
  fileName, onViewResults, onHome,
}: { fileName: string; onViewResults: () => void; onHome: () => void }) {
  return (
    <Screen style={{ justifyContent: 'center', padding: 28, alignItems: 'center' }}>
      <div style={{ width: 80, height: 80, borderRadius: 40, background: C.green50, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <svg width={40} height={40} viewBox="0 0 40 40" fill="none">
          <path d="M8 21l8 8L32 12" stroke={C.green} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 8, textAlign: 'center' }}>Submitted!</div>
      <div style={{ fontSize: 14, color: C.g500, textAlign: 'center', lineHeight: 1.6, marginBottom: 22, maxWidth: 250 }}>
        Your work has been submitted. You'll be notified as soon as it's marked.
      </div>
      <div style={{ background: C.g50, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, width: '100%', boxSizing: 'border-box' }}>
        <File size={18} color={C.g500} />
        <span style={{ fontSize: 12, color: C.g700, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</span>
      </div>
      <button
        onClick={onViewResults}
        style={{ width: '100%', background: C.amber, border: 'none', borderRadius: 10, padding: '14px 0', cursor: 'pointer', color: C.white, fontWeight: 700, fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 12 }}
      >
        View My Submissions
      </button>
      <button onClick={onHome} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g500, fontWeight: 600, fontSize: 14, fontFamily: 'inherit', padding: 4 }}>
        Back to Home
      </button>
    </Screen>
  );
}

// ── S5: Results (Pending / Graded tabs) ───────────────────────────────────────
function StudentResultsScreen({
  onBack, gradingComplete, onViewFeedback,
}: { onBack: () => void; gradingComplete: boolean; onViewFeedback: () => void }) {
  const [tab, setTab]         = useState<'pending' | 'graded'>('pending');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    setLoadError(false);
    const resolveTimer = setTimeout(() => setIsLoading(false), 600);
    // 10_000 ms safety guard — never spin forever, just show empty state
    const timeoutTimer = setTimeout(() => { setIsLoading(false); }, 10_000);
    return () => { clearTimeout(resolveTimer); clearTimeout(timeoutTimer); };
  }, []);

  useEffect(() => { if (gradingComplete) setTab('graded'); }, [gradingComplete]);

  const g = DEMO_STUDENT_GRADE;

  return (
    <Screen style={{ background: C.bg }}>
      {/* Header with avatar */}
      <div style={{ background: C.teal, paddingInline: 20, paddingTop: 14, paddingBottom: 12, display: 'flex', alignItems: 'center' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, marginRight: 8 }}><ChevronLeft size={20} color={C.white} /></button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.white }}>My Results</div>
        </div>
        <div style={{ width: 34, height: 34, borderRadius: 17, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', flexShrink: 0 }}>
          <span style={{ color: C.white, fontSize: 14, fontWeight: 700 }}>S</span>
          <div style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5, background: C.green400, border: `2px solid ${C.teal}` }} />
        </div>
      </div>
      <div style={{ flex: 1, padding: '18px 16px', paddingBottom: 24, overflowY: 'auto' }}>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, marginBottom: 16 }}>
          {(['pending', 'graded'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '9px 0', border: 'none', background: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t ? 700 : 400,
                color: tab === t ? C.amber700 : C.g500,
                borderBottom: `2px solid ${tab === t ? C.amber : 'transparent'}`, marginBottom: -1,
              }}
            >
              {t === 'pending' ? 'Pending' : 'Graded'}
              {t === 'graded' && gradingComplete && (
                <span style={{ marginLeft: 5, background: C.green, color: C.white, borderRadius: 10, paddingInline: 6, paddingBlock: 1, fontSize: 11, fontWeight: 700, verticalAlign: 'middle' }}>
                  1
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Pending: has submission, not yet graded */}
        {tab === 'pending' && !gradingComplete && (
          <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, padding: '13px 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 3 }}>Chapter 5 Maths Test</div>
            <div style={{ fontSize: 12, color: C.g500, marginBottom: 10 }}>Mathematics · Submitted</div>
            <div style={{ background: C.amber50, color: C.amber700, fontSize: 11, fontWeight: 700, paddingInline: 10, paddingBlock: 5, borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span>⏳</span> Awaiting grade
            </div>
          </div>
        )}
        {tab === 'pending' && gradingComplete && (
          <div style={{ textAlign: 'center', color: C.g400, fontSize: 13, padding: '32px 0' }}>No pending submissions</div>
        )}

        {/* Graded: loading / error / empty / result */}
        {tab === 'graded' && !gradingComplete && isLoading && (
          <div style={{ textAlign: 'center', padding: '40px 0 24px', color: C.g400, fontSize: 13 }}>
            Loading results…
          </div>
        )}
        {tab === 'graded' && !gradingComplete && !isLoading && loadError && (
          <div style={{ textAlign: 'center', padding: '40px 0 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}><ClipboardList size={28} color={C.g500} /></div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.g700, marginBottom: 6 }}>No results yet</div>
            <div style={{ fontSize: 12, color: C.g500, lineHeight: 1.5 }}>Your graded work will appear here once your teacher marks your submissions.</div>
          </div>
        )}
        {tab === 'graded' && !gradingComplete && !isLoading && !loadError && (
          <div style={{ textAlign: 'center', padding: '40px 0 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}><ClipboardList size={28} color={C.g500} /></div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.g700, marginBottom: 6 }}>No results yet</div>
            <div style={{ fontSize: 12, color: C.g500, lineHeight: 1.5 }}>Your teacher hasn't graded the homework yet. Check back soon!</div>
          </div>
        )}

        {/* Graded: result card */}
        {tab === 'graded' && gradingComplete && (
          <button
            onClick={onViewFeedback}
            style={{ width: '100%', background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, padding: '13px 14px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', transition: 'box-shadow 0.12s' }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(245,166,35,0.15)')}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)')}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Chapter 5 Maths Test</div>
                <div style={{ fontSize: 12, color: C.g500, marginTop: 2 }}>Mathematics · Form 2</div>
              </div>
              <div style={{ background: scoreBg(g.percentage), borderRadius: 10, padding: '6px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 17, fontWeight: 900, color: scoreColor(g.percentage), lineHeight: 1 }}>{g.score} / {g.max_score}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: scoreColor(g.percentage), marginTop: 2 }}>{g.percentage}%</div>
              </div>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: C.g100, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', borderRadius: 2, background: scoreColor(g.percentage), width: `${g.percentage}%` }} />
            </div>
            <div style={{ fontSize: 11, color: C.amber700, fontWeight: 600 }}>Tap for full feedback →</div>
          </button>
        )}
      </div>
    </Screen>
  );
}

// ── S6: Feedback (full detail) ────────────────────────────────────────────────
function StudentFeedbackScreen({
  onBack, annotatedImageUrl,
}: {
  onBack: () => void;
  annotatedImageUrl?: string;
}) {
  const g = DEMO_STUDENT_GRADE;
  const vIcon = (v: string) => v === 'correct' ? '✓' : v === 'partial' ? '~' : '✗';
  const vBg   = (v: string) => v === 'correct' ? C.greenLt : v === 'partial' ? C.amber50 : C.redLt;
  const vClr  = (v: string) => v === 'correct' ? C.green   : v === 'partial' ? C.amber500 : C.red;

  // ── Image zoom state ──────────────────────────────────────────────────────
  const [imgScale,   setImgScale]   = useState(1);
  const [imgLoaded,  setImgLoaded]  = useState(false);
  const [imgError,   setImgError]   = useState(false);
  const [imgRetryKey, setImgRetryKey] = useState(0);

  const hasImage = Boolean(annotatedImageUrl);

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    setImgScale(s => Math.min(4, Math.max(1, s - e.deltaY * 0.002)));
  }

  return (
    <Screen style={{ background: C.bg }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>
        {/* Header */}
        <div style={{
          background: C.white, borderBottom: `1px solid ${C.border}`,
          padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <BackButton onClick={onBack} label="" />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Your Results</div>
            <div style={{ fontSize: 11, color: C.g500 }}>Chapter 5 Maths Test · Mathematics</div>
          </div>
        </div>

        {/* ── Annotated image ── */}
        <div style={{ margin: '14px 16px 0', borderRadius: 12, overflow: 'hidden', background: C.g100, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.g500, padding: '8px 12px', background: C.white, borderBottom: `1px solid ${C.border}`, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Annotated Work
          </div>

          {hasImage ? (
            <div
              onWheel={handleWheel}
              style={{ overflow: 'hidden', cursor: imgScale > 1 ? 'grab' : 'zoom-in', position: 'relative', height: 260 }}
            >
              {/* Skeleton while loading */}
              {!imgLoaded && !imgError && (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 2,
                  background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.4s infinite',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ color: C.g400, fontSize: 12 }}>Loading annotated image…</span>
                </div>
              )}

              {/* Error state */}
              {imgError && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: C.redLt }}>
                  <span style={{ fontSize: 28 }}>🖼️</span>
                  <span style={{ fontSize: 12, color: C.red800 }}>Image unavailable</span>
                  <button
                    onClick={() => { setImgError(false); setImgLoaded(false); setImgRetryKey(k => k + 1); }}
                    style={{ fontSize: 12, color: C.teal, background: 'none', border: `1px solid ${C.teal}`, borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* The actual image */}
              <img
                key={imgRetryKey}
                src={annotatedImageUrl}
                alt="Annotated work"
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
                style={{
                  width: '100%', height: '100%', objectFit: 'contain',
                  transform: `scale(${imgScale})`,
                  transformOrigin: 'top left',
                  transition: 'transform 0.1s ease',
                  display: 'block',
                  opacity: imgLoaded ? 1 : 0,
                }}
              />
            </div>
          ) : (
            /* No image yet — show placeholder tile */
            <div style={{ height: 180, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: C.g50 }}>
              <span style={{ fontSize: 32 }}>📄</span>
              <span style={{ fontSize: 12, color: C.g500 }}>Annotated image will appear after teacher releases marks</span>
            </div>
          )}

          {hasImage && imgLoaded && (
            <div style={{ padding: '5px 12px', background: C.white, borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.g400, textAlign: 'center' }}>
              Scroll wheel to zoom · {Math.round(imgScale * 100)}%
            </div>
          )}
        </div>

        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Score card */}
          <div style={{ background: C.white, borderRadius: 14, padding: '16px', border: `1px solid ${C.border}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor(g.percentage), lineHeight: 1 }}>
                  {g.score} <span style={{ fontSize: 18, color: C.g400 }}>/ {g.max_score}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: scoreColor(g.percentage), marginTop: 2 }}>{g.percentage}%</div>
              </div>
              <div style={{
                background: scoreBg(g.percentage), border: `1.5px solid ${scoreColor(g.percentage)}`,
                borderRadius: 10, padding: '6px 12px',
                fontSize: 13, fontWeight: 700, color: scoreColor(g.percentage),
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: scoreColor(g.percentage), display: 'inline-block' }} />
                {g.percentage >= 70 ? 'Pass' : g.percentage >= 50 ? 'Borderline' : 'Needs support'}
              </div>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: C.g100, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 4, background: scoreColor(g.percentage), width: `${g.percentage}%`, transition: 'width 1.2s ease' }} />
            </div>
          </div>

          {/* Question breakdown */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.g700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
              Question Breakdown
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {DEMO_QUESTIONS.map((q, idx) => {
                const v = g.verdicts[idx];
                if (!v) return null;
                return (
                  <div key={q.question_number} style={{
                    background: C.white, borderRadius: 10, padding: '10px 12px',
                    border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${vClr(v.verdict)}`,
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 7,
                      background: vBg(v.verdict),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 900, color: vClr(v.verdict), flexShrink: 0,
                    }}>
                      {vIcon(v.verdict)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: C.g700 }}>Q{q.question_number}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: vClr(v.verdict) }}>{v.awarded}/{v.max}</span>
                      </div>
                      <div style={{ fontSize: 11, color: C.g500, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {q.question_text}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Back button */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 16px', background: C.white, borderTop: `1px solid ${C.border}` }}>
        <button
          onClick={onBack}
          style={{
            width: '100%', background: C.teal, color: C.white, border: 'none', borderRadius: 12,
            padding: '13px 0', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Back to Results
        </button>
      </div>
    </Screen>
  );
}

// ── S7: AI Tutor ──────────────────────────────────────────────────────────────
function StudentTutorScreen({
  studentName, onBack, demoToken,
}: { studentName: string; onBack: () => void; demoToken: string | null }) {
  const firstName = studentName.split(' ')[0];

  // Session + chat state
  type Msg = { id: string; role: 'user' | 'ai'; content: string; ts: number; imageUri?: string };
  type Session = { chat_id: string; created_at: string; updated_at: string; preview: string; messages: Msg[] };
  const STORAGE_KEY = 'neriah_student_tutor_sessions';
  const MAX_S = 50;
  const MAX_D = 20;

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [attachment, setAttachment] = useState<{ name: string; base64: string; type: string; dataUrl?: string } | null>(null);
  const [tutorCameraOpen, setTutorCameraOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  const makeId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const relTime = (iso: string) => {
    const d = Date.now() - new Date(iso).getTime();
    const m = Math.floor(d / 60000); const h = Math.floor(d / 3600000); const dy = Math.floor(d / 86400000);
    if (m < 1) return 'Just now'; if (m < 60) return `${m}m ago`; if (h < 24) return `${h}h ago`;
    if (dy === 1) return 'Yesterday'; if (dy < 7) return `${dy}d ago`;
    return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  };

  // Load sessions on mount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) { const s = JSON.parse(raw) as Session[]; setSessions(s); if (s.length > 0) { setMessages(s[0].messages); setCurrentChatId(s[0].chat_id); } }
    } catch {}
  }, []);

  // Greeting on first open
  useEffect(() => {
    const t = setTimeout(async () => {
      if (messages.length > 0) return;
      setSending(true);
      const res = await demoFetch('/tutor/chat', { method: 'POST', body: JSON.stringify({ message: '', is_greeting: true }) }, demoToken);
      const content = res?.response ?? `Hi ${firstName}! I'm Neriah, your AI tutor. What would you like help with today?`;
      const msg: Msg = { id: makeId(), role: 'ai', content, ts: Date.now() };
      const cid = makeId();
      setMessages([msg]); setCurrentChatId(cid); setSending(false);
      saveSessions([msg], cid);
    }, 500);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToBottom = () => setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

  // Save sessions
  const saveSessions = (msgs: Msg[], cid: string) => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      let all: Session[] = raw ? JSON.parse(raw) : [];
      const now = new Date().toISOString();
      const preview = (msgs.find(m => m.role === 'user')?.content ?? 'Chat').slice(0, 60);
      const existing = all.find(s => s.chat_id === cid);
      const session: Session = { chat_id: cid, created_at: existing?.created_at ?? now, updated_at: now, preview, messages: msgs };
      all = [session, ...all.filter(s => s.chat_id !== cid)].slice(0, MAX_S);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      setSessions(all);
    } catch {}
  };

  // Send
  const sendMsg = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text && !attachment) return;
    const cid = currentChatId ?? makeId();
    if (!currentChatId) setCurrentChatId(cid);
    const userMsg: Msg = { id: makeId(), role: 'user', content: text, ts: Date.now(), imageUri: attachment?.dataUrl };
    const next = [...messages, userMsg];
    setMessages(next); setInput(''); const sentAtt = attachment; setAttachment(null); saveSessions(next, cid);
    setSending(true);
    const history = messages.slice(-10).map(m => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content }));
    const res = await demoFetch('/tutor/chat', {
      method: 'POST',
      body: JSON.stringify({ message: text, history, ...(sentAtt ? { image: sentAtt.base64 } : {}) }),
    }, demoToken);
    const aiContent = res?.response ?? "I'm thinking about that... Could you rephrase your question?";
    const aiMsg: Msg = { id: makeId(), role: 'ai', content: aiContent, ts: Date.now() };
    const withAi = [...next, aiMsg];
    setMessages(withAi); saveSessions(withAi, cid); setSending(false); scrollToBottom();
  };

  const startNew = () => { if (messages.length > 0 && currentChatId) saveSessions(messages, currentChatId); setMessages([]); setCurrentChatId(null); setShowDrawer(false); };
  const loadSess = (s: Session) => { setMessages(s.messages); setCurrentChatId(s.chat_id); setShowDrawer(false); scrollToBottom(); };
  const deleteSess = (cid: string) => {
    const next = sessions.filter(s => s.chat_id !== cid);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSessions(next);
    if (cid === currentChatId) { setMessages([]); setCurrentChatId(null); }
  };

  // File input handler
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return; e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setAttachment({ name: f.name, base64: dataUrl.split(',')[1], type: f.type, dataUrl: f.type.startsWith('image/') ? dataUrl : undefined });
    };
    reader.readAsDataURL(f);
  };

  const QUICK_ACTIONS = [
    { label: 'Explain this concept', icon: <Sparkles size={15} color={C.teal} /> },
    { label: 'Help me practice', icon: <BookOpen size={15} color={C.teal} /> },
    { label: "I don't understand this", icon: <HelpCircle size={15} color={C.teal} /> },
    { label: 'Quiz me on this topic', icon: <ClipboardList size={15} color={C.teal} /> },
    { label: 'What are my weak areas?', icon: <BarChart2 size={15} color={C.teal} /> },
    { label: 'Help me prepare for exams', icon: <GraduationCap size={15} color={C.teal} /> },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg, position: 'relative' }}>
      {/* Header */}
      <div style={{ background: C.teal, paddingInline: 16, paddingTop: 14, paddingBottom: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => setShowDrawer(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><Menu size={22} color={C.white} /></button>
        <span style={{ fontSize: 17, fontWeight: 800, color: C.white }}>Neriah</span>
        <div onClick={onBack} style={{ width: 36, height: 36, borderRadius: 18, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative', flexShrink: 0 }}>
          <span style={{ color: C.white, fontSize: 15, fontWeight: 700 }}>{firstName[0]}</span>
          <div style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5, background: C.green400, border: `2px solid ${C.teal}` }} />
        </div>
      </div>

      {/* Context pills */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '8px 16px', background: C.white, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ background: C.primaryLight, borderRadius: 16, padding: '4px 12px', fontSize: 12, fontWeight: 600, color: C.teal }}>Mathematics</span>
        <span style={{ background: C.primaryLight, borderRadius: 16, padding: '4px 12px', fontSize: 12, fontWeight: 600, color: C.teal }}>Form 2</span>
      </div>

      {/* Empty state or messages */}
      {messages.length === 0 && !sending ? (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 20 }}>
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <div style={{ width: 72, height: 72, borderRadius: 36, background: C.primaryLight, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <img src="/images/icon-transparent.png" style={{ width: 40, height: 40 }} alt="Neriah" />
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>Neriah</div>
            <div style={{ fontSize: 13, color: C.grayTxt, marginTop: 2 }}>Your AI study assistant</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 24 }}>
            {QUICK_ACTIONS.map(({ label, icon }) => (
              <button key={label} onClick={() => sendMsg(label)} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: '11px 14px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                {icon}<span style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map(msg => {
            const isUser = msg.role === 'user';
            return (
              <div key={msg.id} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 6 }}>
                {!isUser && <div style={{ width: 28, height: 28, borderRadius: 14, background: C.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><img src="/images/icon-transparent.png" style={{ width: 16, height: 16, filter: 'brightness(0) invert(1)' }} alt="" /></div>}
                <div style={{ maxWidth: '78%', background: isUser ? C.teal : C.white, borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px', padding: '10px 13px', border: isUser ? 'none' : `1px solid ${C.border}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                  {msg.imageUri && <img src={msg.imageUri} alt="" style={{ width: '100%', borderRadius: 8, marginBottom: msg.content ? 8 : 0, maxHeight: 160, objectFit: 'cover' }} />}
                  {msg.content && <div style={{ fontSize: 13, color: isUser ? C.white : C.text, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{msg.content}</div>}
                </div>
              </div>
            );
          })}
          {sending && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
              <div style={{ width: 28, height: 28, borderRadius: 14, background: C.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><img src="/images/icon-transparent.png" style={{ width: 16, height: 16, filter: 'brightness(0) invert(1)' }} alt="" /></div>
              <div style={{ background: C.white, borderRadius: '16px 16px 16px 4px', padding: '12px 16px', border: `1px solid ${C.border}`, display: 'flex', gap: 5 }}>
                {[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: C.teal, opacity: 0.4 }} />)}
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      )}

      {/* Input bar */}
      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: C.g400, textAlign: 'center', paddingTop: 6, paddingBottom: 3 }}>Neriah can make mistakes. Verify important info.</div>
        {attachment && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 12px 6px', background: C.primaryLight, borderRadius: 10, padding: '5px 10px' }}>
            <span style={{ fontSize: 12, color: C.teal, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachment.name}</span>
            <button onClick={() => setAttachment(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g400, fontSize: 14, padding: 2 }}>&#x2715;</button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 12px 12px' }}>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowAttach(!showAttach)} style={{ width: 36, height: 36, borderRadius: 10, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Paperclip size={18} color={C.g500} /></button>
            {showAttach && (
              <div style={{ position: 'absolute', bottom: 42, left: 0, background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: 8, zIndex: 10, minWidth: 140 }}>
                {[
                  { icon: <Camera size={16} color={C.teal} />, label: 'Camera', onClick: () => { setShowAttach(false); setTutorCameraOpen(true); } },
                  { icon: <ImageIcon size={16} color={C.teal} />, label: 'Gallery', onClick: () => { setShowAttach(false); galleryRef.current?.click(); } },
                  { icon: <FileText size={16} color={C.teal} />, label: 'PDF', onClick: () => { setShowAttach(false); pdfRef.current?.click(); } },
                ].map(opt => (
                  <button key={opt.label} onClick={opt.onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 10px', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, color: C.text }}>{opt.icon}<span>{opt.label}</span></button>
                ))}
              </div>
            )}
          </div>
          <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } }} placeholder="Ask Neriah..." disabled={sending} style={{ flex: 1, border: 'none', background: C.g100, borderRadius: 20, padding: '10px 14px', fontSize: 13, color: C.text, outline: 'none', fontFamily: 'inherit' }} />
          <button onClick={() => sendMsg()} disabled={sending || (!input.trim() && !attachment)} style={{ width: 38, height: 38, borderRadius: 19, background: (!input.trim() && !attachment || sending) ? C.g200 : C.teal, border: 'none', cursor: (!input.trim() && !attachment || sending) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><ArrowUp size={18} color={C.white} /></button>
        </div>
        <input ref={galleryRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileInput} />
        <input ref={pdfRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleFileInput} />
      </div>

      {/* Camera */}
      <WebCameraModal open={tutorCameraOpen} onCapture={(b64, mime) => { setTutorCameraOpen(false); setAttachment({ name: `photo_${Date.now()}.jpg`, base64: b64, type: mime, dataUrl: `data:${mime};base64,${b64}` }); }} onClose={() => setTutorCameraOpen(false)} />

      {/* Session Drawer */}
      {showDrawer && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex' }}>
          <div style={{ width: '80%', background: C.white, boxShadow: '4px 0 20px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><img src="/images/icon-transparent.png" style={{ width: 24, height: 24 }} alt="" /><span style={{ fontSize: 17, fontWeight: 800, color: C.text }}>Neriah</span></div>
              <button onClick={() => setShowDrawer(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X size={20} color={C.g500} /></button>
            </div>
            <div style={{ padding: '12px 16px' }}>
              <button onClick={startNew} style={{ width: '100%', background: C.teal, border: 'none', borderRadius: 10, padding: '11px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: C.white, fontWeight: 700, fontSize: 14, fontFamily: 'inherit' }}><Plus size={18} /><span>New Chat</span></button>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.g500, letterSpacing: '0.05em', paddingInline: 16, marginBottom: 6 }}>RECENT CHATS</div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {sessions.length === 0 && <div style={{ padding: '20px 16px', fontSize: 13, color: C.g400, fontStyle: 'italic' }}>No recent chats</div>}
              {sessions.slice(0, MAX_D).map(sess => {
                const active = sess.chat_id === currentChatId;
                return (
                  <div key={sess.chat_id} onClick={() => loadSess(sess)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', background: active ? C.teal50 : 'transparent', borderLeft: active ? `3px solid ${C.teal}` : '3px solid transparent' }}>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sess.preview || 'Chat'}</div><div style={{ fontSize: 11, color: C.g500, marginTop: 2 }}>{relTime(sess.updated_at)}</div></div>
                    <button onClick={e => { e.stopPropagation(); deleteSess(sess.chat_id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><Trash2 size={14} color={C.g400} /></button>
                  </div>
                );
              })}
            </div>
          </div>
          <div onClick={() => setShowDrawer(false)} style={{ flex: 1, background: 'rgba(0,0,0,0.3)', cursor: 'pointer' }} />
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Student Class Management
// ──────────────────────────────────────────────────────────────────────────────

function StudentClassManagementScreen({ onBack, demoToken }: { onBack: () => void; demoToken: string | null }) {
  type CItem = { class_id: string; name: string; subject: string; teacher_name: string; school_name: string };
  type AvailCls = { id: string; name: string; subject: string | null; education_level: string; teacher: { first_name: string; surname: string } };
  const [classes, setClasses] = useState<CItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [loading, setLoading] = useState(true);
  const [joinOpen, setJoinOpen] = useState(false);
  const [school, setSchool] = useState('Harare High School');
  const [availClasses, setAvailClasses] = useState<AvailCls[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchedSchool, setSearchedSchool] = useState('');
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    (async () => {
      const data = await demoFetch('/demo/auth/student/classes', {}, demoToken);
      if (data?.classes) { setClasses(data.classes); setActiveId(data.active_class_id ?? ''); }
      setLoading(false);
    })();
  }, [demoToken]);

  const handleLeave = async (cid: string, name: string) => {
    if (!confirm(`Leave ${name}? You will lose access to its assignments and results.`)) return;
    await demoFetch('/demo/auth/student/leave-class', { method: 'DELETE', body: JSON.stringify({ class_id: cid }) }, demoToken);
    setClasses(prev => prev.filter(c => c.class_id !== cid));
  };

  return (
    <Screen style={{ background: C.bg }}>
      {/* Header */}
      <div style={{ background: C.teal, paddingInline: 16, paddingTop: 14, paddingBottom: 12, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><ChevronLeft size={20} color={C.white} /></button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: 800, color: C.white }}>My Classes</div>
        <div style={{ width: 28 }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: C.g500 }}>Loading...</div>
        ) : classes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <GraduationCap size={40} color={C.g400} />
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginTop: 12 }}>No classes yet</div>
            <div style={{ fontSize: 13, color: C.g500, marginTop: 4 }}>Join a class using a code from your teacher.</div>
          </div>
        ) : (
          classes.map(c => {
            const isActive = c.class_id === activeId;
            return (
              <div key={c.class_id} style={{ background: C.white, borderRadius: 12, border: `${isActive ? '1.5px' : '1px'} solid ${isActive ? C.teal : C.border}`, padding: '13px 14px', marginBottom: 10, display: 'flex', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{c.name}</span>
                    {isActive && <span style={{ fontSize: 11, fontWeight: 700, color: C.teal, background: C.teal50, borderRadius: 6, padding: '2px 8px' }}>Active</span>}
                  </div>
                  {c.subject && <div style={{ fontSize: 12, color: C.g500, marginTop: 2 }}>{c.subject}</div>}
                  {c.teacher_name && <div style={{ fontSize: 12, color: C.g500, marginTop: 1 }}>{c.teacher_name}</div>}
                  {c.school_name && <div style={{ fontSize: 12, color: C.g500, marginTop: 1 }}>{c.school_name}</div>}
                </div>
                <button onClick={() => handleLeave(c.class_id, c.name)} style={{ border: `1px solid ${C.red200}`, borderRadius: 8, padding: '5px 10px', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: C.red, fontFamily: 'inherit' }}>Leave</button>
              </div>
            );
          })
        )}

        {/* Join button */}
        <button onClick={() => setJoinOpen(true)} style={{ marginTop: 16, width: '100%', background: C.teal, border: 'none', borderRadius: 12, padding: '13px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: C.white, fontWeight: 700, fontSize: 14, fontFamily: 'inherit' }}>
          <Plus size={18} /><span>Join a Class</span>
        </button>
      </div>

      {/* Join modal — school search */}
      {joinOpen && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', zIndex: 50 }}>
          <div style={{ background: C.white, borderRadius: '20px 20px 0 0', width: '100%', maxHeight: '85%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Join a Class</span>
              <button onClick={() => { setJoinOpen(false); setAvailClasses([]); setSearchedSchool(''); setShowCode(false); setJoinCode(''); setJoinInfo(null); setJoinErr(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: C.g500 }}>\u2715</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 24px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.g500, marginTop: 16, marginBottom: 6 }}>School</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" value={school} onChange={e => setSchool(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { setSearching(true); setSearchedSchool(school); demoFetch(`/demo/classes/by-school?school=${encodeURIComponent(school)}`, {}, demoToken).then(data => { setAvailClasses(Array.isArray(data) ? data.filter((c: any) => !classes.some(ec => ec.class_id === c.id)) : []); }).finally(() => setSearching(false)); } }} placeholder="Type school name..." style={{ flex: 1, border: `1px solid ${C.g200}`, borderRadius: 10, padding: '10px 12px', fontSize: 14, outline: 'none', fontFamily: 'inherit' }} />
                <button onClick={() => { setSearching(true); setSearchedSchool(school); demoFetch(`/demo/classes/by-school?school=${encodeURIComponent(school)}`, {}, demoToken).then(data => { setAvailClasses(Array.isArray(data) ? data.filter((c: any) => !classes.some(ec => ec.class_id === c.id)) : []); }).finally(() => setSearching(false)); }} style={{ background: C.teal, border: 'none', borderRadius: 10, padding: '0 14px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></button>
              </div>
              {searching && <div style={{ textAlign: 'center', padding: 20, color: C.g500, fontSize: 13 }}>Searching...</div>}
              {!searching && searchedSchool && availClasses.length === 0 && (
                <div style={{ textAlign: 'center', padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>No classes found at {searchedSchool}</div>
                  <div style={{ fontSize: 12, color: C.g500, marginTop: 4 }}>Try a different school name or ask your teacher.</div>
                </div>
              )}
              {availClasses.map((cls: any) => {
                const tName = cls.teacher ? `${cls.teacher.first_name} ${cls.teacher.surname}`.trim() : '';
                return (
                  <div key={cls.id} style={{ display: 'flex', alignItems: 'center', padding: '14px 0', borderBottom: `1px solid ${C.g100}` }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{cls.name}{cls.subject ? ` \u2014 ${cls.subject}` : ''}</div>
                      <div style={{ fontSize: 12, color: C.g500, marginTop: 2 }}>{tName}{cls.education_level ? ` \u00b7 ${cls.education_level}` : ''}</div>
                    </div>
                    <button onClick={async () => { setJoiningId(cls.id); await demoFetch('/demo/auth/student/join-class', { method: 'POST', body: JSON.stringify({ class_id: cls.id }) }, demoToken); setClasses(prev => [...prev, { class_id: cls.id, name: cls.name, subject: cls.subject ?? '', teacher_name: tName, school_name: searchedSchool }]); setJoinOpen(false); setJoiningId(null); }} disabled={joiningId === cls.id} style={{ background: joiningId === cls.id ? C.g200 : C.teal, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: joiningId === cls.id ? 'default' : 'pointer', color: C.white, fontWeight: 700, fontSize: 13, fontFamily: 'inherit' }}>{joiningId === cls.id ? '...' : 'Join'}</button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Analytics (class overview)
// ──────────────────────────────────────────────────────────────────────────────

function AnalyticsScreen({
  onBack, demoToken, onViewStudent, onViewHomework, onSettings,
}: {
  onBack: () => void;
  demoToken: string | null;
  onViewStudent: (student: DemoAnalyticsStudent) => void;
  onViewHomework: (homeworkId: string) => void;
  onSettings: () => void;
}) {
  const [analytics, setAnalytics] = useState<DemoClassAnalytics>(DEMO_CLASS_ANALYTICS);
  const [hasData, setHasData]     = useState<boolean | null>(null);   // null = loading
  const [reason, setReason]       = useState<string | null>(null);
  const [limitedData, setLimitedData] = useState(false);
  const [homeworkList, setHomeworkList] = useState<Array<{ id: string; title: string }>>([]);
  const [aiSummary, setAiSummary]     = useState<string | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);

  // Try to fetch live data; fall back to pre-canned.
  // AbortController cancels in-flight request on unmount or demoToken change.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      demoFetch(
        `/demo/analytics/class/${DEMO_CLASS_ANALYTICS.class_id}`,
        { signal: controller.signal },
        demoToken,
      )
        .then((data: any) => {
          if (controller.signal.aborted) return;
          // Accept response whether it has data or not
          if (data) {
            setHasData(data.has_data !== false);
            setReason(data.reason ?? null);
            setLimitedData(!!data.limited_data);
            if (Array.isArray(data.students)) {
              setAnalytics(data as DemoClassAnalytics);
            }
          }
        })
        .catch(() => {
          // Network error — treat canned data as has_data=true
          setHasData(true);
        });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [demoToken]);

  // Fetch homework list for drill-down
  useEffect(() => {
    demoFetch('/demo/homeworks?class_id=demo-class-1', {}, demoToken)
      .then((data: any) => {
        if (data && Array.isArray(data.homeworks)) {
          setHomeworkList(data.homeworks.map((hw: any) => ({
            id: hw.id,
            title: hw.title || hw.subject || 'Homework',
          })));
        }
      })
      .catch(() => {});
  }, [demoToken]);

  async function generateAiSummary() {
    setAiSummaryLoading(true);
    try {
      const res = await demoFetch('/demo/teacher/assistant', {
        method: 'POST',
        body: JSON.stringify({
          action_type: 'general',
          message: `Generate a short class performance summary for Form 2A Mathematics. Class average: ${analytics.class_average}%, highest: ${analytics.highest_score}%, lowest: ${analytics.lowest_score}%. Give 2-3 sentences of actionable commentary for the teacher.`,
          class_id: analytics.class_id,
        }),
      }, demoToken);
      const text = (res as any)?.response ?? (res as any)?.message ?? null;
      if (text) setAiSummary(text);
      else setAiSummary('The class is performing at a moderate level. Consider reviewing the topics where students scored below 60% and providing targeted revision exercises. Encourage top performers to assist peers during group work sessions.');
    } catch {
      setAiSummary('The class is performing at a moderate level. Consider reviewing the topics where students scored below 60% and providing targeted revision exercises. Encourage top performers to assist peers during group work sessions.');
    } finally {
      setAiSummaryLoading(false);
    }
  }

  const studentsWithSubs = analytics.students.filter(s => (s.submission_count ?? 1) > 0);
  const highestScore = studentsWithSubs.length > 0 ? Math.max(...studentsWithSubs.map(s => s.latest_score)) : 0;

  const barData = studentsWithSubs.map(s => ({
    name: s.name.split(' ')[0],
    score: s.latest_score,
    fill: s.latest_score === highestScore ? C.amber : C.teal,
    student: s,
  }));

  function trendArrow(t: 'up' | 'down' | 'stable') {
    return t === 'up' ? '↑' : t === 'down' ? '↓' : '→';
  }
  function trendCol(t: 'up' | 'down' | 'stable') {
    return t === 'up' ? C.green : t === 'down' ? C.red : C.g500;
  }

  // ── Not-enough-data states ─────────────────────────────────────────────────
  const noDataContent = hasData === false ? (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 20px', gap: 12, textAlign: 'center' }}>
      {reason === 'no_homeworks' ? (
        <>
          <FileText size={48} color={C.g200} />
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>No homework assigned yet</div>
          <div style={{ fontSize: 13, color: C.g500, lineHeight: 1.5 }}>Analytics will appear once students start submitting homework.</div>
        </>
      ) : (
        <>
          <BarChart2 size={48} color={C.g200} />
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>This class doesn't have any submissions yet</div>
          <div style={{ fontSize: 13, color: C.g500, lineHeight: 1.5 }}>Analytics will appear here once homework is marked.</div>
        </>
      )}
      {/* Students are always viewable even without data */}
      <button onClick={() => onViewStudent(analytics.students[0] ?? { student_id: '', name: 'Student', latest_score: 0, average_score: 0, submission_count: 0, trend: 'stable' })} style={{ marginTop: 16, background: 'none', border: `1.5px solid ${C.teal}`, borderRadius: 10, padding: '10px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', color: C.teal, fontWeight: 600, fontSize: 13 }}>
        <Users size={14} /><span>View Students</span>
      </button>
    </div>
  ) : null;

  return (
    <Screen style={{ background: C.bg }}>
      <div style={{ flex: 1, padding: '16px 14px', overflowY: 'auto' }}>

        <div style={{ marginBottom: 14 }}><BackButton label="Classes" onClick={onBack} /></div>

        <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 10 }}>Analytics</div>

        {/* Class info card */}
        <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, padding: '12px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Form 2A</div>
            <div style={{ fontSize: 12, color: C.g500, marginTop: 2 }}>Form 2 · Mathematics</div>
          </div>
          <div style={{ background: C.teal50, borderRadius: 999, paddingInline: 10, paddingBlock: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.teal }}>3 homework</span>
          </div>
        </div>

        {/* Loading skeleton */}
        {hasData === null && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: C.g500, fontSize: 13 }}>Loading…</div>
        )}

        {/* Not enough data */}
        {noDataContent}

        {/* Limited data banner */}
        {hasData === true && limitedData && (
          <div style={{
            background: C.amberFaint, border: `1px solid ${C.amber100}`, borderRadius: 10,
            padding: '8px 12px', marginBottom: 14, fontSize: 12, color: C.amberText, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span>⚠</span> Limited data — analytics improve as more submissions are graded.
          </div>
        )}

        {/* Full analytics when has_data = true */}
        {hasData === true && (
          <>
            {/* Summary cards */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, overflowX: 'auto' }}>
              {[
                { label: 'Class Average', value: `${analytics.class_average}%`, color: scoreColor(analytics.class_average) },
                { label: 'Highest',       value: `${analytics.highest_score}%`, color: C.green },
                { label: 'Lowest',        value: `${analytics.lowest_score}%`,  color: C.red },
              ].map(card => (
                <div key={card.label} style={{
                  background: C.white, borderRadius: 10, border: `1px solid ${C.border}`,
                  padding: '10px 12px', minWidth: 76, textAlign: 'center', flexShrink: 0,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: card.color }}>{card.value}</div>
                  <div style={{ fontSize: 11, color: C.g500, marginTop: 2 }}>{card.label}</div>
                </div>
              ))}
            </div>

            {/* Submission rate */}
            <div style={{
              background: C.tealLt, border: `1px solid ${C.teal100}`, borderRadius: 10,
              padding: '8px 12px', marginBottom: 14, fontSize: 12, color: C.teal, fontWeight: 600,
            }}>
              {analytics.submission_rate}
            </div>

            {/* Bar chart — only when there is at least one bar to show */}
            {barData.length > 0 ? (
              <div style={{
                background: C.white, borderRadius: 12, border: `1px solid ${C.border}`,
                padding: '12px 8px', marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.g700, marginBottom: 10, paddingLeft: 4 }}>
                  Latest Homework Scores
                </div>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={barData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.g100} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.g500 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: C.g500 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v: unknown) => [`${v}%`, 'Score']}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.border}` }}
                    />
                    <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                      {barData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{
                background: C.white, borderRadius: 12, border: `1px solid ${C.border}`,
                padding: '24px 12px', marginBottom: 14, textAlign: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                <BarChart2 size={28} color={C.g200} style={{ marginBottom: 6 }} />
                <div style={{ fontSize: 13, color: C.g500 }}>No graded submissions to chart yet</div>
              </div>
            )}

            {/* Homework list for drill-down */}
            {homeworkList.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.g700, marginBottom: 8 }}>Homework</div>
                <div style={{
                  background: C.white, borderRadius: 12, border: `1px solid ${C.border}`,
                  overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                  {homeworkList.map((hw, i) => (
                    <button
                      key={hw.id}
                      onClick={() => onViewHomework(hw.id)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center',
                        padding: '10px 14px', background: 'none', border: 'none',
                        borderBottom: i < homeworkList.length - 1 ? `1px solid ${C.g100}` : 'none',
                        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', gap: 8,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = C.g50; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                    >
                      <FileText size={14} color={C.teal} style={{ flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.text }}>{hw.title}</span>
                      <span style={{ fontSize: 14, color: C.g400 }}>›</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Per-student table */}
            <div style={{
              background: C.white, borderRadius: 12, border: `1px solid ${C.border}`,
              overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              marginBottom: 14,
            }}>
              <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 700, color: C.g700 }}>
                Student Rankings
              </div>
              {analytics.students.map((s, i) => (
                <button
                  key={s.student_id}
                  onClick={() => onViewStudent(s)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', background: 'none', border: 'none',
                    borderBottom: i < analytics.students.length - 1 ? `1px solid ${C.g100}` : 'none',
                    cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.g50; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: 14, flexShrink: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, color: C.white,
                    background: i === 0 ? C.teal : i === 1 ? C.amber : C.red,
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: C.g500, marginTop: 1 }}>{s.submission_count} submission · avg {s.average_score}%</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: scoreColor(s.latest_score) }}>{s.latest_score}%</div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: trendCol(s.trend) }}>{trendArrow(s.trend)}</span>
                    <span style={{ fontSize: 13, color: C.g400 }}>›</span>
                  </div>
                </button>
              ))}
            </div>

            {/* AI Summary section */}
            {!aiSummary && (
              <button
                onClick={generateAiSummary}
                disabled={aiSummaryLoading}
                style={{
                  width: '100%', background: aiSummaryLoading ? C.teal100 : C.teal,
                  border: 'none', borderRadius: 10, padding: '12px 0',
                  cursor: aiSummaryLoading ? 'not-allowed' : 'pointer',
                  color: C.white, fontWeight: 700, fontSize: 14, fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  marginBottom: 8,
                }}
              >
                {aiSummaryLoading ? <><Spinner /> Generating summary…</> : <><Sparkles size={15} /> Generate AI Summary</>}
              </button>
            )}

            {aiSummary && (
              <div style={{
                background: C.tealLt, border: `1px solid ${C.teal100}`, borderRadius: 12,
                padding: '12px 14px', marginBottom: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Sparkles size={13} color={C.teal} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.teal }}>AI Class Summary</span>
                  <button
                    onClick={() => setAiSummary(null)}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: C.g500, fontFamily: 'inherit' }}
                  >
                    Refresh
                  </button>
                </div>
                <div style={{ fontSize: 13, color: C.teal, lineHeight: 1.6 }}>{aiSummary}</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom tab bar */}
      <div style={{ height: 50, background: C.white, borderTop: `1px solid ${C.border}`, display: 'flex', flexShrink: 0 }}>
        {[
          { icon: <Home size={16} />,     label: 'Classes',   active: false, onClick: onBack },
          { icon: <BarChart2 size={16} />, label: 'Analytics', active: true,  onClick: undefined as (() => void) | undefined },
          { icon: <Settings size={16} />, label: 'Settings',  active: false, onClick: onSettings },
        ].map(tab => (
          <div
            key={tab.label}
            onClick={tab.onClick}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, cursor: 'pointer' }}
          >
            <span style={{ color: tab.active ? C.teal : C.g500 }}>{tab.icon}</span>
            <span style={{
              fontSize: 11, fontWeight: tab.active ? 600 : 400, color: tab.active ? C.teal : C.g500,
              borderBottom: tab.active ? `2px solid ${C.teal}` : '2px solid transparent', paddingBottom: 1,
            }}>{tab.label}</span>
          </div>
        ))}
      </div>
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Student Analytics (per-student drill-down)
// ──────────────────────────────────────────────────────────────────────────────

function StudentAnalyticsScreen({
  student, onBack, demoToken,
}: {
  student: DemoAnalyticsStudent;
  onBack: () => void;
  demoToken: string | null;
}) {
  const [analytics, setAnalytics] = useState<DemoStudentAnalytics>(
    DEMO_STUDENT_ANALYTICS[student.student_id] ?? {
      student_id: student.student_id, name: student.name,
      class_average: 57, average_score: student.average_score,
      score_trend: [], weak_topics: [],
    },
  );
  const [suggestions, setSuggestions] = useState<Array<{ topic: string; suggestion: string }>>([]);
  const [loadingSug, setLoadingSug] = useState(false);
  const [sugShown, setSugShown] = useState(false);

  useEffect(() => {
    demoFetch(`/demo/analytics/student/${student.student_id}`, {}, demoToken)
      .then(data => { if (data && Array.isArray(data.score_trend)) setAnalytics(data as DemoStudentAnalytics); })
      .catch(() => {});
  }, [student.student_id, demoToken]);

  async function handleSuggest() {
    setLoadingSug(true);
    const res = await demoFetch('/demo/study-suggestions', {
      method: 'POST',
      body: JSON.stringify({ weak_topics: analytics.weak_topics }),
    }, demoToken);
    if (res?.suggestions) {
      setSuggestions(res.suggestions);
    } else {
      // Fallback: map from local data
      setSuggestions((analytics.weak_topics ?? []).map(t => ({
        topic: t,
        suggestion: `Before I explain ${t}, what do you already know about it? Can you describe it in your own words?`,
      })));
    }
    setLoadingSug(false);
    setSugShown(true);
  }

  const trendData = (analytics.score_trend ?? []).map(e => ({
    name: (e.homework_title ?? '').length > 8 ? (e.homework_title ?? '').slice(0, 8) : (e.homework_title ?? ''),
    score: e.score_pct ?? 0,
  }));

  return (
    <Screen style={{ background: C.bg }}>
      <div style={{ flex: 1, padding: '16px 14px', overflowY: 'auto' }}>

        <div style={{ marginBottom: 12 }}><BackButton label="Analytics" onClick={onBack} /></div>

        {/* Student header */}
        <div style={{ background: C.teal, borderRadius: 12, padding: '14px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: C.white }}>
            {student.name.charAt(0)}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.white }}>{student.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>Avg {analytics.average_score}% · Class avg {analytics.class_average}%</div>
          </div>
        </div>

        {/* Score trend line chart */}
        <div style={{
          background: C.white, borderRadius: 12, border: `1px solid ${C.border}`,
          padding: '12px 8px', marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.g700, marginBottom: 10, paddingLeft: 4 }}>Score Trend</div>
          {trendData.length >= 2 ? (
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.g100} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.g500 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: C.g500 }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v: unknown) => [`${v}%`, 'Score']}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.border}` }}
                />
                <Line
                  type="monotone" dataKey="score" stroke={C.teal} strokeWidth={2}
                  dot={{ fill: C.teal, r: 4, strokeWidth: 0 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 12, color: C.g400, fontStyle: 'italic' }}>
              More submissions needed for trend data
            </div>
          )}
        </div>

        {/* Weak topics */}
        <div style={{
          background: C.white, borderRadius: 12, border: `1px solid ${C.border}`,
          padding: '12px 14px', marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.g700, marginBottom: 8 }}>Weak Topics</div>
          {analytics.weak_topics.length === 0 ? (
            <div style={{ fontSize: 12, color: C.g400, fontStyle: 'italic' }}>No weak topics identified yet</div>
          ) : (
            analytics.weak_topics.map((topic, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
              }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: C.amber, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: C.text }}>{topic}</span>
              </div>
            ))
          )}
        </div>

        {/* Study suggestions */}
        {!sugShown ? (
          <button
            onClick={handleSuggest}
            disabled={loadingSug || analytics.weak_topics.length === 0}
            style={{
              width: '100%', background: C.teal, border: 'none', borderRadius: 10,
              padding: '13px 0', cursor: loadingSug ? 'not-allowed' : 'pointer',
              color: C.white, fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
              opacity: analytics.weak_topics.length === 0 ? 0.5 : 1,
              boxShadow: '0 3px 10px rgba(13,115,119,0.25)',
            }}
          >
            {loadingSug ? 'Getting suggestions…' : 'Suggest Study Topics'}
          </button>
        ) : (
          <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, padding: '12px 14px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.g700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Bot size={14} color={C.teal} /> Neriah Suggestions
            </div>
            {suggestions.map((s, i) => (
              <div key={i} style={{ marginBottom: i < suggestions.length - 1 ? 12 : 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.teal, marginBottom: 3 }}>{s.topic}</div>
                <div style={{ fontSize: 12, color: C.g700, lineHeight: 1.5, fontStyle: 'italic' }}>"{s.suggestion}"</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Homework Analytics (per-homework per-student scores)
// ──────────────────────────────────────────────────────────────────────────────

interface DemoHomeworkStudentResult {
  student_id: string;
  name: string;
  score: number;
  max_score: number;
  percentage: number;
  pass_fail: 'pass' | 'fail';
}

interface DemoHomeworkAnalytics {
  has_data: boolean;
  reason?: string;
  homework_id: string;
  homework_title: string;
  class_name: string;
  submission_count: number;
  average_score: number;
  highest_score: number;
  lowest_score: number;
  pass_rate: number;
  students: DemoHomeworkStudentResult[];
}

function HomeworkAnalyticsWebScreen({
  homeworkId,
  onBack,
  onViewStudent,
  demoToken,
}: {
  homeworkId: string;
  onBack: () => void;
  onViewStudent: (student: DemoAnalyticsStudent) => void;
  demoToken: string | null;
}) {
  const [analytics, setAnalytics] = useState<DemoHomeworkAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    demoFetch(`/demo/analytics/homework/${homeworkId}`, {}, demoToken)
      .then((data: any) => { if (data) setAnalytics(data as DemoHomeworkAnalytics); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [homeworkId, demoToken]);

  return (
    <Screen style={{ background: C.bg }}>
      <div style={{ flex: 1, padding: '16px 14px', overflowY: 'auto' }}>
        <div style={{ marginBottom: 14 }}><BackButton label="Analytics" onClick={onBack} /></div>

        <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 4 }}>
          {analytics?.homework_title ?? 'Homework Analytics'}
        </div>
        <div style={{ fontSize: 12, color: C.g500, marginBottom: 14 }}>
          {analytics?.class_name ?? ''}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: C.g500, fontSize: 13 }}>Loading…</div>
        )}

        {!loading && analytics && !analytics.has_data && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '32px 20px', textAlign: 'center' }}>
            <BarChart2 size={48} color={C.g200} />
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>No graded submissions yet</div>
            <div style={{ fontSize: 12, color: C.g500, lineHeight: 1.5 }}>Grade at least one student to see analytics for this homework.</div>
          </div>
        )}

        {!loading && analytics && analytics.has_data && (
          <>
            {/* Summary cards */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, overflowX: 'auto' }}>
              {[
                { label: 'Average',   value: `${analytics.average_score}%`,  color: scoreColor(analytics.average_score) },
                { label: 'Highest',   value: `${analytics.highest_score}%`,  color: C.green },
                { label: 'Lowest',    value: `${analytics.lowest_score}%`,   color: C.red },
                { label: 'Pass Rate', value: `${analytics.pass_rate}%`,      color: C.teal },
                { label: 'Submitted', value: `${analytics.submission_count}`, color: C.text },
              ].map(card => (
                <div key={card.label} style={{
                  background: C.white, borderRadius: 10, border: `1px solid ${C.border}`,
                  padding: '10px 12px', minWidth: 70, textAlign: 'center', flexShrink: 0,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: card.color }}>{card.value}</div>
                  <div style={{ fontSize: 11, color: C.g500, marginTop: 2 }}>{card.label}</div>
                </div>
              ))}
            </div>

            {/* Per-student results */}
            <div style={{ fontSize: 12, fontWeight: 700, color: C.g700, marginBottom: 8 }}>Student Results</div>
            {analytics.students.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 12, color: C.g400, fontStyle: 'italic' }}>
                No students graded yet
              </div>
            ) : (
              <div style={{
                background: C.white, borderRadius: 12, border: `1px solid ${C.border}`,
                overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                {analytics.students.map((s, i) => (
                  <button
                    key={s.student_id}
                    onClick={() => onViewStudent({
                      student_id: s.student_id,
                      name: s.name,
                      latest_score: s.percentage,
                      average_score: s.percentage,
                      submission_count: 1,
                      trend: 'stable' as const,
                    })}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', background: 'none', border: 'none',
                      borderBottom: i < analytics.students.length - 1 ? `1px solid ${C.g100}` : 'none',
                      cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.g50; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                  >
                    {/* Rank badge */}
                    <div style={{
                      width: 28, height: 28, borderRadius: 14, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 12, color: C.white,
                      background: scoreColor(s.percentage),
                    }}>
                      {i + 1}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{s.name}</div>
                      <div style={{
                        display: 'inline-block', marginTop: 2, fontSize: 11, fontWeight: 700,
                        color: s.pass_fail === 'pass' ? C.teal : C.red,
                        background: s.pass_fail === 'pass' ? C.tealLt : C.redLt,
                        borderRadius: 4, padding: '1px 6px',
                      }}>
                        {s.pass_fail === 'pass' ? 'Pass' : 'Fail'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', marginRight: 4 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: scoreColor(s.percentage) }}>{s.percentage}%</div>
                      <div style={{ fontSize: 11, color: C.g500 }}>{s.score}/{s.max_score}</div>
                    </div>
                    <span style={{ fontSize: 14, color: C.g400 }}>›</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Grading Detail
// ──────────────────────────────────────────────────────────────────────────────

function verdictColor(v: 'correct' | 'incorrect' | 'partial'): string {
  if (v === 'correct')   return C.green;
  if (v === 'partial')   return C.amber500;
  return C.red;
}
function verdictBg(v: 'correct' | 'incorrect' | 'partial'): string {
  if (v === 'correct')   return C.greenLt;
  if (v === 'partial')   return C.amber50;
  return C.redLt;
}
function verdictLabel(v: 'correct' | 'incorrect' | 'partial'): string {
  if (v === 'correct')   return '✓ Correct';
  if (v === 'partial')   return '~ Partial';
  return '✗ Incorrect';
}

/** SVG circular progress ring. r=28, stroke-width=6, circumference≈175.9 */
function ProgressRing({ pct }: { pct: number }) {
  const r = 28, sw = 6;
  const circ = 2 * Math.PI * r;
  const dash  = circ * Math.max(0, Math.min(100, pct)) / 100;
  const color = pct >= 75 ? C.teal : pct >= 50 ? C.amber : C.red;
  return (
    <svg width={72} height={72} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={36} cy={36} r={r} fill="none" stroke={C.g100} strokeWidth={sw} />
      <circle
        cx={36} cy={36} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.5s ease' }}
      />
    </svg>
  );
}

function GradingDetailScreen({
  submission, hw, onBack, demoToken, onApproved,
}: {
  submission: DemoSubmissionDetail;
  hw: HomeworkInfo;
  onBack: () => void;
  demoToken: string | null;
  onApproved?: (annotatedImageUrl: string) => void;
}) {
  const { grade, verdicts } = submission;

  const [awards, setAwards]         = useState<string[]>(verdicts.map(v => String(v.awarded)));
  const [feedback, setFeedback]     = useState('');
  const [approving, setApproving]   = useState(false);
  const [approved, setApproved]     = useState(false);
  const [expanded, setExpanded]     = useState<Set<number>>(new Set());

  const computedScore = awards.reduce((s, a) => s + (Number(a) || 0), 0);
  const pct = grade.max_score > 0 ? Math.round((computedScore / grade.max_score) * 100) : 0;
  const isEdited = awards.some((a, i) => Number(a) !== verdicts[i].awarded);
  const passFail = pct >= 50 ? 'Pass' : 'Fail';
  const MAX_FEEDBACK = 500;

  const toggleExpand = (qn: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(qn) ? next.delete(qn) : next.add(qn);
      return next;
    });
  };

  async function handleApprove(overrideMarks: boolean) {
    if (feedback.length > MAX_FEEDBACK) return;
    setApproving(true);
    const body: Record<string, unknown> = { feedback };
    if (overrideMarks) {
      body.overridden_verdicts = verdicts.map((v, i) => ({
        question_number: v.question_number,
        verdict:         v.verdict,
        awarded_marks:   Number(awards[i]) || 0,
        max_marks:       v.max,
        student_answer:  v.student_answer ?? '',
        feedback:        v.feedback ?? '',
      }));
    }
    const res = await demoFetch(
      `/demo/submissions/${submission.submissionId}/approve`,
      { method: 'PUT', body: JSON.stringify(body) },
      demoToken,
    );
    const annotatedImageUrl: string = res?.annotated_image_url ?? '';
    setApproved(true);
    setApproving(false);
    onApproved?.(annotatedImageUrl);
  }

  // Row tint by verdict
  const rowBg = (v: DemoVerdict['verdict']) =>
    v === 'correct' ? C.greenLt : v === 'incorrect' ? C.redLt : C.amberLt;

  // Verdict pill
  function VerdictPill({ v }: { v: DemoVerdict['verdict'] }) {
    const bg    = v === 'correct' ? C.greenLt  : v === 'incorrect' ? C.redLt  : C.amberLt;
    const color = v === 'correct' ? C.green     : v === 'incorrect' ? C.red    : C.amber;
    const label = v === 'correct' ? 'Correct'   : v === 'incorrect' ? 'Incorrect' : 'Partial';
    return (
      <span style={{
        display: 'inline-block', fontSize: 11, fontWeight: 700,
        paddingInline: 6, paddingBlock: 3, borderRadius: 20,
        background: bg, color, whiteSpace: 'nowrap',
      }}>{label}</span>
    );
  }

  return (
    <Screen style={{ background: C.bg }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 16px', paddingBottom: 24 }}>

        <div style={{ marginBottom: 14 }}><BackButton label="Back" onClick={onBack} /></div>

        {/* Score header card */}
        <div style={{ background: C.white, borderRadius: 14, padding: '14px 16px', marginBottom: 14, border: `1px solid ${C.border}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
            {/* Circular progress ring */}
            <div style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
              <ProgressRing pct={pct} />
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: C.text, lineHeight: 1 }}>{pct}%</span>
              </div>
            </div>
            {/* Score + student info */}
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: C.text }}>{computedScore}</span>
                <span style={{ fontSize: 15, color: C.g400, fontWeight: 400 }}>/ {grade.max_score}</span>
                {/* Pass / Fail badge */}
                <span style={{
                  fontSize: 11, fontWeight: 700, paddingInline: 8, paddingBlock: 3, borderRadius: 20,
                  background: passFail === 'Pass' ? C.greenLt : C.redLt,
                  color: passFail === 'Pass' ? C.green : C.red,
                }}>
                  {approved ? 'Released' : passFail}
                </span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{submission.studentName}</div>
              <div style={{ fontSize: 11, color: C.g500, marginTop: 2 }}>
                {hw.title} · {new Date(submission.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {isEdited && <span style={{ color: C.amber, marginLeft: 6, fontWeight: 600 }}>· Edited</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Verdict table */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.g700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Question Verdicts
          </div>

          {/* Scrollable table wrapper */}
          <div style={{ overflowX: 'auto', borderRadius: 10, border: `1px solid ${C.border}`, background: C.white, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 480, fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.g50 }}>
                  {['Q', 'Question', 'Student Answer', 'Correct Answer', 'Verdict', 'Marks'].map(h => (
                    <th key={h} style={{
                      padding: '8px 10px', textAlign: 'left', fontWeight: 700,
                      color: C.g500, fontSize: 11, letterSpacing: '0.04em',
                      textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`,
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {verdicts.map((v, i) => {
                  const isExp = expanded.has(v.question_number);
                  return (
                    <tr key={v.question_number} style={{ background: rowBg(v.verdict), borderBottom: i < verdicts.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                      {/* Q# */}
                      <td style={{ padding: '8px 10px', fontWeight: 800, color: C.teal, whiteSpace: 'nowrap' }}>
                        Q{v.question_number}
                      </td>
                      {/* Question text — tap to expand */}
                      <td
                        style={{ padding: '8px 10px', cursor: 'pointer', maxWidth: 120 }}
                        onClick={() => toggleExpand(v.question_number)}
                        title="Tap to expand"
                      >
                        <span style={{
                          display: '-webkit-box', WebkitLineClamp: isExp ? undefined : 2,
                          WebkitBoxOrient: 'vertical', overflow: isExp ? 'visible' : 'hidden',
                          color: C.text, lineHeight: 1.4,
                        }}>
                          {v.question_text || `Q${v.question_number}`}
                        </span>
                        {!isExp && (v.question_text?.length ?? 0) > 60 && (
                          <span style={{ fontSize: 11, color: C.teal, display: 'block', marginTop: 2 }}>more</span>
                        )}
                      </td>
                      {/* Student answer */}
                      <td style={{ padding: '8px 10px', color: C.g500, maxWidth: 100 }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.student_answer || '—'}
                        </span>
                      </td>
                      {/* Correct answer */}
                      <td style={{ padding: '8px 10px', color: C.green, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {v.correct_answer || '—'}
                      </td>
                      {/* Verdict pill */}
                      <td style={{ padding: '8px 10px' }}>
                        <VerdictPill v={v.verdict} />
                      </td>
                      {/* Marks — inline editable */}
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type="number"
                            min={0}
                            max={v.max}
                            value={awards[i]}
                            onChange={e => {
                              const next = [...awards];
                              next[i] = e.target.value;
                              setAwards(next);
                            }}
                            style={{
                              width: 38, border: `1px solid ${Number(awards[i]) !== v.awarded ? C.amber : C.g200}`,
                              borderRadius: 5, padding: '3px 5px', fontSize: 12,
                              fontFamily: 'inherit', outline: 'none', textAlign: 'center',
                              background: Number(awards[i]) !== v.awarded ? C.amberLt : C.white,
                              fontWeight: 700, color: C.text,
                            }}
                          />
                          <span style={{ color: C.g500 }}>/ {v.max}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {/* Total row */}
                <tr style={{ background: C.g50, borderTop: `2px solid ${C.border}` }}>
                  <td colSpan={5} style={{ padding: '8px 10px', fontWeight: 700, color: C.g700, textAlign: 'right', fontSize: 12 }}>
                    Total
                  </td>
                  <td style={{ padding: '8px 10px', fontWeight: 800, color: C.text, whiteSpace: 'nowrap' }}>
                    {computedScore} / {grade.max_score}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Teacher feedback */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.g700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Feedback for Student
          </div>
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value.slice(0, MAX_FEEDBACK))}
            placeholder="Add feedback for this student..."
            rows={3}
            style={{
              width: '100%', border: `1px solid ${feedback.length > MAX_FEEDBACK - 50 ? C.amber : C.g200}`,
              borderRadius: 10, padding: '10px 12px', fontSize: 13, fontFamily: 'inherit',
              resize: 'none', outline: 'none', color: C.text, background: C.white,
              boxSizing: 'border-box',
            }}
          />
          <div style={{ textAlign: 'right', fontSize: 11, color: feedback.length > MAX_FEEDBACK - 50 ? C.amber : C.g400, marginTop: 3 }}>
            {feedback.length} / {MAX_FEEDBACK}
          </div>
        </div>

        {/* Action buttons */}
        {approved ? (
          <div style={{ background: C.greenLt, color: C.green, borderRadius: 10, padding: '14px 16px', textAlign: 'center', fontWeight: 700, fontSize: 14 }}>
            Results released to student
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={() => handleApprove(false)}
              disabled={approving || feedback.length > MAX_FEEDBACK}
              style={{
                width: '100%', background: approving ? C.teal100 : C.teal, border: 'none', borderRadius: 10,
                padding: '14px 0', cursor: approving ? 'not-allowed' : 'pointer',
                color: C.white, fontWeight: 700, fontSize: 14, fontFamily: 'inherit',
                boxShadow: '0 4px 12px rgba(13,115,119,0.28)', transition: 'opacity 0.15s',
              }}
            >
              {approving ? 'Releasing…' : 'Approve & Release'}
            </button>
            {isEdited && (
              <button
                onClick={() => handleApprove(true)}
                disabled={approving || feedback.length > MAX_FEEDBACK}
                style={{
                  width: '100%', background: C.white, border: `1.5px solid ${C.teal}`, borderRadius: 10,
                  padding: '13px 0', cursor: approving ? 'not-allowed' : 'pointer',
                  color: C.teal, fontWeight: 700, fontSize: 14, fontFamily: 'inherit',
                }}
              >
                Override & Approve
              </button>
            )}
          </div>
        )}
      </div>
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PHONE FRAME
// ──────────────────────────────────────────────────────────────────────────────
interface PhoneFrameProps {
  label: string;
  labelColor?: string;
  children: React.ReactNode;
  /** When true, shows a blue "Cloud AI" dot in the status bar (web is always cloud). */
  showAIStatus?: boolean;
}

function PhoneFrame({ label, labelColor = C.teal, children, showAIStatus }: PhoneFrameProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{
        fontSize: 12, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
        color: labelColor, background: labelColor + '18', borderRadius: 20,
        paddingInline: 14, paddingBlock: 5,
      }}>
        {label}
      </div>
      <div style={{
        width: 320, height: 680, borderRadius: 44, border: `3px solid ${C.g200}`,
        background: C.white, boxShadow: '0 8px 40px rgba(13,115,119,0.10), 0 2px 8px rgba(0,0,0,0.07)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
      }}>
        {/* Status bar — white with centered dark Dynamic Island pill */}
        <div style={{
          height: 36, background: C.white, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: 72, height: 9, borderRadius: 5, background: C.darkBg }} />
        </div>
        {/* Cloud AI status — just below the notch, inside the screen content area */}
        {showAIStatus && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            paddingInline: 12, paddingBlock: 3, background: C.white, flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: C.tealLt, borderRadius: 8,
              paddingInline: 7, paddingBlock: 3,
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: 3,
                background: C.blue400,
                boxShadow: '0 0 4px rgba(96,165,250,0.7)',
              }} />
              <span style={{
                fontSize: 11, fontWeight: 700, color: C.teal,
                letterSpacing: '0.05em', whiteSpace: 'nowrap',
              }}>Cloud AI</span>
            </div>
          </div>
        )}
        {/* Screen area */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
        {/* Home indicator */}
        <div style={{ height: 28, background: C.white, borderTop: `1px solid ${C.g100}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ width: 56, height: 4, borderRadius: 2, background: C.g200 }} />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// ── PIN Modal component ────────────────────────────────────────────────────────
type PinModalMode = 'setup' | 'change' | 'remove';
type PinStep = 'enter' | 'confirm' | 'current' | 'new' | 'confirm-new';

function PinModal({
  mode, onClose, onSuccess,
}: {
  mode: PinModalMode;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const DEMO_USER = 'demo-teacher-1';

  // Step sequencing per mode
  const steps: PinStep[] = mode === 'setup'
    ? ['enter', 'confirm']
    : mode === 'change'
      ? ['current', 'new', 'confirm-new']
      : ['enter'];  // remove

  const [stepIdx, setStepIdx]       = useState(0);
  const [digits,  setDigits]        = useState<string[]>([]);
  const [first,   setFirst]         = useState('');  // stores the first entry for confirm checks
  const [error,   setError]         = useState('');
  const [loading, setLoading]       = useState(false);

  const step = steps[stepIdx];

  const stepTitle: Record<PinStep, string> = {
    enter:         mode === 'remove' ? 'Enter your PIN to remove it' : 'Create a 4-digit PIN',
    confirm:       'Confirm your PIN',
    current:       'Enter current PIN',
    new:           'Enter new PIN',
    'confirm-new': 'Confirm new PIN',
  };

  function pressDigit(d: string) {
    if (digits.length >= 4) return;
    setDigits(prev => [...prev, d]);
    setError('');
  }

  function pressDelete() {
    setDigits(prev => prev.slice(0, -1));
    setError('');
  }

  useEffect(() => {
    if (digits.length === 4) {
      // Auto-advance after a short delay so the 4th dot renders visibly
      const t = setTimeout(() => handleFullPin(digits.join('')), 120);
      return () => clearTimeout(t);
    }
  }, [digits]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFullPin(pin: string) {
    setLoading(true);
    setError('');

    try {
      if (mode === 'setup') {
        if (step === 'enter') {
          setFirst(pin);
          setDigits([]);
          setStepIdx(1);
        } else {
          // confirm
          if (pin !== first) {
            setError("PINs don't match — try again");
            setDigits([]);
            setStepIdx(0);
            setFirst('');
          } else {
            await demoFetch('/demo/pin/setup', {
              method: 'POST', body: JSON.stringify({ user_id: DEMO_USER, pin }),
            });
            onSuccess('PIN activated');
          }
        }

      } else if (mode === 'change') {
        if (step === 'current') {
          // Verify current PIN first
          const res = await demoFetch('/demo/pin/verify', {
            method: 'POST', body: JSON.stringify({ user_id: DEMO_USER, pin }),
          });
          if (!res?.valid) {
            setError('Incorrect PIN');
            setDigits([]);
          } else {
            setFirst('');
            setDigits([]);
            setStepIdx(1);
          }
        } else if (step === 'new') {
          setFirst(pin);
          setDigits([]);
          setStepIdx(2);
        } else {
          // confirm-new
          if (pin !== first) {
            setError("PINs don't match — try again");
            setDigits([]);
            setStepIdx(1);
            setFirst('');
          } else {
            // We stored current_pin from step 0 — we need it for the change call
            // Re-approach: we don't store it. Instead, we call setup with new pin
            // (demo doesn't enforce change requires current pin separately — we verified above)
            await demoFetch('/demo/pin/setup', {
              method: 'POST', body: JSON.stringify({ user_id: DEMO_USER, pin }),
            });
            onSuccess('PIN changed');
          }
        }

      } else {
        // remove
        const res = await demoFetch('/demo/pin/remove', {
          method: 'POST', body: JSON.stringify({ user_id: DEMO_USER, pin }),
        });
        if (res?.success) {
          onSuccess('PIN removed');
        } else {
          setError('Incorrect PIN');
          setDigits([]);
        }
      }
    } catch {
      setError('Something went wrong. Try again.');
      setDigits([]);
    } finally {
      setLoading(false);
    }
  }

  const dotStyle = (filled: boolean): React.CSSProperties => ({
    width: 18, height: 18, borderRadius: 9,
    background: filled ? C.teal : 'transparent',
    border: `2px solid ${filled ? C.teal : C.g400}`,
    transition: 'background 0.12s',
  });

  const keyStyle: React.CSSProperties = {
    width: 64, height: 48, borderRadius: 12, border: `1px solid ${C.border}`,
    background: C.white, fontSize: 20, fontWeight: 700, color: C.text,
    cursor: 'pointer', fontFamily: 'inherit', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.1s',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        background: C.white, borderRadius: '20px 20px 0 0',
        width: '100%', maxWidth: 360,
        padding: '24px 20px 32px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{stepTitle[step]}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: C.g400, padding: 4 }}>✕</button>
        </div>

        {/* 4 dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 18 }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={dotStyle(i < digits.length)} />
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{ textAlign: 'center', fontSize: 13, color: C.red, marginBottom: 12, minHeight: 18 }}>
            {error}
          </div>
        )}
        {!error && <div style={{ minHeight: 18, marginBottom: 12 }} />}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', fontSize: 13, color: C.g500, marginBottom: 12 }}>
            Checking…
          </div>
        )}

        {/* Number pad */}
        {!loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, justifyItems: 'center' }}>
            {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
              k === '' ? (
                <div key={i} />
              ) : (
                <button
                  key={k + i}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => k === '⌫' ? pressDelete() : pressDigit(k)}
                  style={{
                    ...keyStyle,
                    color: k === '⌫' ? C.red : C.text,
                    borderColor: k === '⌫' ? C.red200 : C.border,
                  }}
                >
                  {k}
                </button>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Toast helper ──────────────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'info';
const TOAST_STYLES: Record<ToastType, { bg: string; color: string; icon: string }> = {
  success: { bg: C.greenDk, color: C.white, icon: '✓' },
  error:   { bg: C.red800,  color: C.white, icon: '✗' },
  info:    { bg: C.tealDk2, color: C.white, icon: 'ℹ' },
};
function Toast({ message, type = 'success', onDone }: { message: string; type?: ToastType; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, [onDone]);
  const ts = TOAST_STYLES[type];
  return (
    <div style={{
      position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      background: ts.bg, color: ts.color, borderRadius: 10,
      padding: '10px 20px', fontSize: 14, fontWeight: 600,
      zIndex: 200, whiteSpace: 'nowrap',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span>{ts.icon}</span> {message}
    </div>
  );
}

// SCREEN: Teacher Settings (web)
// ──────────────────────────────────────────────────────────────────────────────
function TeacherSettingsWebScreen({ onBack, onAnalytics, onEditProfile }: { onBack: () => void; onAnalytics?: () => void; onEditProfile?: () => void }) {
  const [pinActive, setPinActive]   = useState(false);
  const [pinModal,  setPinModal]    = useState<PinModalMode | null>(null);
  const [toast,     setToast]       = useState('');
  const [language,  setLanguage]    = useState<'English' | 'Shona' | 'Ndebele'>('English');
  const [langOpen,  setLangOpen]    = useState(false);
  const [editProfile, setEditProfile] = useState(false);
  const [profileName,   setProfileName]   = useState('Mr Tendai Maisiri');
  const [profileSchool, setProfileSchool] = useState('Kuwadzana High School');
  const [profileDraft,  setProfileDraft]  = useState({ name: '', school: '' });

  function handlePinSuccess(msg: string) {
    setPinModal(null);
    if (msg === 'PIN removed') {
      setPinActive(false);
    } else {
      setPinActive(true);
    }
    setToast(msg);
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: C.bg }}>
      {/* Header */}
      <div style={{ background: C.white, paddingInline: 18, paddingTop: 16, paddingBottom: 14, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>Settings</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>

        {/* ── PROFILE section ── */}
        <div style={{ fontSize: 11, fontWeight: 700, color: C.g500, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Profile</div>
        <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, padding: '14px 16px', marginBottom: 14, position: 'relative' }}>
          {!editProfile ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 24, background: C.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: C.white }}>{profileName.charAt(0)}</span>
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{profileName}</div>
                  <div style={{ fontSize: 12, color: C.g500, marginTop: 2 }}>+263 •••• •••• 67</div>
                  <div style={{ fontSize: 12, color: C.g500, marginTop: 1 }}>{profileSchool}</div>
                </div>
              </div>
              <button
                onClick={onEditProfile ?? (() => { setProfileDraft({ name: profileName, school: profileSchool }); setEditProfile(true); })}
                style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <Pencil size={16} color={C.g400} />
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.g700, marginBottom: 2 }}>Edit Profile</div>
              <input
                style={{ width: '100%', padding: '9px 11px', fontSize: 14, borderRadius: 8, border: `1.5px solid ${C.teal}`, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', color: C.text }}
                value={profileDraft.name}
                onChange={e => setProfileDraft(d => ({ ...d, name: e.target.value }))}
                placeholder="Full name"
              />
              <input
                style={{ width: '100%', padding: '9px 11px', fontSize: 14, borderRadius: 8, border: `1.5px solid ${C.border}`, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', color: C.text }}
                value={profileDraft.school}
                onChange={e => setProfileDraft(d => ({ ...d, school: e.target.value }))}
                placeholder="School name"
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setEditProfile(false)}
                  style={{ flex: 1, padding: '9px 0', background: 'none', border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, color: C.g700, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (profileDraft.name.trim()) setProfileName(profileDraft.name.trim());
                    if (profileDraft.school.trim()) setProfileSchool(profileDraft.school.trim());
                    setEditProfile(false);
                    setToast('Profile updated');
                  }}
                  style={{ flex: 2, padding: '9px 0', background: C.teal, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, color: C.white, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── ACCOUNT section ── */}
        <div style={{ fontSize: 11, fontWeight: 700, color: C.g500, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Account</div>
        <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, marginBottom: 14, overflow: 'hidden' }}>
          {/* School row */}
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${C.g100}` }}>
            <span style={{ fontSize: 14, color: C.text }}>School</span>
            <span style={{ fontSize: 13, color: C.g400 }}>{profileSchool.split(' ').slice(0, 2).join(' ')}</span>
          </div>
          {/* PIN row */}
          <button
            onClick={() => setPinModal(pinActive ? 'change' : 'setup')}
            style={{
              width: '100%', background: 'none', border: 'none', borderBottom: `1px solid ${C.g100}`,
              padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            <span style={{ fontSize: 14, color: C.text }}>{pinActive ? 'Change PIN' : 'Set PIN'}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {pinActive && <span style={{ fontSize: 13, color: C.g400 }}>Active</span>}
              <ChevronLeft size={14} color={C.g400} style={{ transform: 'rotate(180deg)' }} />
            </div>
          </button>
          {/* Remove PIN row — only visible when PIN is active */}
          {pinActive && (
            <button
              onClick={() => setPinModal('remove')}
              style={{
                width: '100%', background: 'none', border: 'none', borderBottom: `1px solid ${C.g100}`,
                padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              <span style={{ fontSize: 14, color: C.red }}>Remove PIN</span>
              <ChevronLeft size={14} color={C.g400} style={{ transform: 'rotate(180deg)' }} />
            </button>
          )}
          {/* Language row */}
          <button
            onClick={() => setLangOpen(v => !v)}
            style={{
              width: '100%', background: 'none', border: 'none', borderBottom: langOpen ? `1px solid ${C.g100}` : 'none',
              padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            <span style={{ fontSize: 14, color: C.text }}>Language</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, color: C.g400 }}>{language}</span>
              <ChevronLeft size={14} color={C.g400} style={{ transform: langOpen ? 'rotate(90deg)' : 'rotate(270deg)' }} />
            </div>
          </button>
          {langOpen && (
            <div>
              {(['English', 'Shona', 'Ndebele'] as const).map((lang, i, arr) => (
                <button
                  key={lang}
                  onClick={() => { setLanguage(lang); setLangOpen(false); setToast(`Language changed to ${lang}`); }}
                  style={{
                    width: '100%', background: lang === language ? C.teal50 : 'none', border: 'none',
                    borderBottom: i < arr.length - 1 ? `1px solid ${C.g100}` : 'none',
                    padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <span style={{ fontSize: 13, color: lang === language ? C.teal : C.text, fontWeight: lang === language ? 600 : 400 }}>{lang}</span>
                  {lang === language && <span style={{ fontSize: 13, color: C.teal }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── OFFLINE AI MODEL section ── */}
        <div style={{ fontSize: 11, fontWeight: 700, color: C.g500, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Offline Mode</div>
        <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, marginBottom: 14, padding: '14px 16px' }}>
          <div style={{ fontSize: 14, color: C.g500, lineHeight: 1.5 }}>
            Offline mode is available on the mobile app. Download the Neriah app to grade homework without internet.
          </div>
        </div>

        {/* ── ABOUT section ── */}
        <div style={{ fontSize: 11, fontWeight: 700, color: C.g500, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>About</div>
        <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, marginBottom: 14, overflow: 'hidden' }}>
          {[
            { label: 'Version', right: '0.1.0' },
            { label: 'Terms of Service', right: '' },
            { label: 'Privacy Policy', right: '' },
          ].map((row, i, arr) => (
            <div key={row.label} style={{ padding: '12px 16px', borderBottom: i < arr.length - 1 ? `1px solid ${C.g100}` : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, color: C.text }}>{row.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {row.right && <span style={{ fontSize: 13, color: C.g400 }}>{row.right}</span>}
                {!row.right && <ChevronLeft size={14} color={C.g400} style={{ transform: 'rotate(180deg)' }} />}
              </div>
            </div>
          ))}
        </div>

        {/* Delete account */}
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.red, fontSize: 14, fontWeight: 600, fontFamily: 'inherit' }}>
            Delete Account
          </button>
        </div>

        {/* Log out */}
        <button
          onClick={onBack}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
            background: C.redLt, color: C.red, fontSize: 14, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'inherit', marginBottom: 8,
          }}
        >
          Log out
        </button>
      </div>

      {/* Bottom tab bar */}
      <div style={{ height: 50, background: C.white, borderTop: `1px solid ${C.border}`, display: 'flex', flexShrink: 0 }}>
        {[
          { icon: <Home size={16} />,     label: 'Classes',   active: false, onClick: onBack },
          { icon: <BarChart2 size={16} />, label: 'Analytics', active: false, onClick: onAnalytics },
          { icon: <Sparkles size={16} />, label: 'Assistant', active: false, onClick: undefined as (() => void) | undefined },
          { icon: <Settings size={16} />, label: 'Settings',  active: true,  onClick: undefined as (() => void) | undefined },
        ].map(tab => (
          <div
            key={tab.label}
            onClick={tab.onClick}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 2, cursor: 'pointer',
            }}
          >
            <span style={{ color: tab.active ? C.teal : C.g500 }}>{tab.icon}</span>
            <span style={{
              fontSize: 11, fontWeight: tab.active ? 600 : 400, color: tab.active ? C.teal : C.g500,
              borderBottom: tab.active ? `2px solid ${C.teal}` : '2px solid transparent', paddingBottom: 1,
            }}>
              {tab.label}
            </span>
          </div>
        ))}
      </div>

      {/* PIN modal */}
      {pinModal && (
        <PinModal
          mode={pinModal}
          onClose={() => setPinModal(null)}
          onSuccess={handlePinSuccess}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Student Settings (web) — mirrors teacher settings layout
// ──────────────────────────────────────────────────────────────────────────────
function StudentSettingsWebScreen({ onBack, onResults, onClasses, studentName }: { onBack: () => void; onResults?: () => void; onClasses?: () => void; studentName: string }) {
  const firstName = studentName.split(' ')[0];
  const surname = studentName.split(' ').slice(1).join(' ') || '';
  const initials = `${firstName[0] ?? ''}${surname[0] ?? ''}`.toUpperCase() || 'S';

  const [nameModal, setNameModal] = useState(false);
  const [joinModal, setJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinToast, setJoinToast] = useState('');
  const [editFirst, setEditFirst] = useState(firstName);
  const [editSurname, setEditSurname] = useState(surname);
  const [nameSaved, setNameSaved] = useState(false);
  const [language, setLanguage] = useState<'English' | 'Shona' | 'Ndebele'>('English');
  const [langOpen, setLangOpen] = useState(false);
  const [pinActive, setPinActive] = useState(false);
  const [pinModal, setPinModal] = useState<PinModalMode | null>(null);
  const [toast, setToast] = useState('');

  function handlePinSuccess(msg: string) { setPinModal(null); setPinActive(msg !== 'PIN removed'); setToast(msg); }

  const secLbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.g500, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 };
  const cardS: React.CSSProperties = { background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden', marginBottom: 18 };
  const rowS: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderTop: `1px solid ${C.bg}`, cursor: 'pointer' };
  const rowLbl: React.CSSProperties = { fontSize: 14, color: C.teal, fontWeight: 600 };
  const inpS: React.CSSProperties = { border: `1px solid ${C.g200}`, borderRadius: 10, padding: '11px 12px', fontSize: 14, color: C.text, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', background: C.white };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: C.bg }}>
      {/* Header */}
      <div style={{ background: C.white, paddingInline: 18, paddingTop: 16, paddingBottom: 14, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>Settings</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {/* ── Profile ── */}
        <div style={secLbl}>Profile</div>
        <div onClick={() => setNameModal(true)} style={{ ...cardS, display: 'flex', alignItems: 'center', padding: '14px 16px', cursor: 'pointer', position: 'relative' }}>
          <div style={{ width: 48, height: 48, borderRadius: 24, background: C.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 12 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: C.white }}>{initials}</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{editFirst} {editSurname}</div>
            <div style={{ fontSize: 12, color: C.g500, marginTop: 2 }}>+263 •••• •••• 67</div>
            <div style={{ marginTop: 4, display: 'inline-block', background: C.amber, borderRadius: 6, paddingInline: 8, paddingBlock: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.white }}>Student</span>
            </div>
          </div>
          <Pencil size={16} color={C.g400} />
        </div>

        {/* ── Account ── */}
        <div style={secLbl}>Account</div>
        <div style={cardS}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${C.bg}` }}>
            <span style={{ fontSize: 14, color: C.g500 }}>School</span>
            <span style={{ fontSize: 14, color: C.text, fontWeight: 500 }}>Harare High School</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${C.bg}` }}>
            <span style={{ fontSize: 14, color: C.g500 }}>Class</span>
            <span style={{ fontSize: 14, color: C.text, fontWeight: 500 }}>Form 2A — Mathematics</span>
          </div>
          <div style={rowS} onClick={onClasses}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <GraduationCap size={16} color={C.teal} />
              <span style={rowLbl}>My Classes</span>
            </div>
            <span style={{ fontSize: 18, color: C.teal }}>›</span>
          </div>
          {pinActive ? (
            <>
              <div style={rowS} onClick={() => setPinModal('change')}>
                <span style={rowLbl}>Change PIN</span><span style={{ fontSize: 18, color: C.teal }}>›</span>
              </div>
              <div style={rowS} onClick={() => setPinModal('remove')}>
                <span style={{ ...rowLbl, color: C.red }}>Remove PIN</span><span style={{ fontSize: 18, color: C.teal }}>›</span>
              </div>
            </>
          ) : (
            <div style={rowS} onClick={() => setPinModal('setup')}>
              <span style={rowLbl}>Set PIN</span><span style={{ fontSize: 18, color: C.teal }}>›</span>
            </div>
          )}
          <div style={rowS} onClick={() => setLangOpen(!langOpen)}>
            <span style={rowLbl}>Language</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, color: C.g500 }}>{language}</span>
              <span style={{ fontSize: 18, color: C.teal }}>›</span>
            </div>
          </div>
          {langOpen && (
            <div style={{ padding: '0 14px 12px', display: 'flex', gap: 6 }}>
              {(['English', 'Shona', 'Ndebele'] as const).map(l => (
                <button key={l} onClick={() => { setLanguage(l); setLangOpen(false); setToast(`Language set to ${l}`); }} style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${language === l ? C.teal : C.g200}`,
                  background: language === l ? C.teal50 : C.white, color: language === l ? C.teal : C.g500,
                  fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                }}>{l}</button>
              ))}
            </div>
          )}
        </div>

        {/* ── Offline Mode ── */}
        <div style={secLbl}>Offline Mode</div>
        <div style={cardS}>
          <div style={{ padding: '14px 16px', fontSize: 14, color: C.g500, lineHeight: 1.5 }}>
            Offline mode is available on the mobile app.
          </div>
        </div>

        {/* ── About ── */}
        <div style={secLbl}>About</div>
        <div style={cardS}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${C.bg}` }}>
            <span style={{ fontSize: 14, color: C.g900 }}>Version</span><span style={{ fontSize: 14, color: C.g500 }}>1.0.0</span>
          </div>
          <div style={{ ...rowS, borderTop: 'none' }} onClick={() => window.open('https://neriah.ai/terms', '_blank')}>
            <span style={{ fontSize: 14, color: C.g900 }}>Terms of Service</span><span style={{ fontSize: 18, color: C.g500 }}>›</span>
          </div>
          <div style={rowS} onClick={() => window.open('https://neriah.ai/privacy', '_blank')}>
            <span style={{ fontSize: 14, color: C.g900 }}>Privacy Policy</span><span style={{ fontSize: 18, color: C.g500 }}>›</span>
          </div>
          <div style={rowS} onClick={() => setToast('Contact support@neriah.ai to delete your account.')}>
            <span style={{ fontSize: 14, color: C.red, fontWeight: 600 }}>Delete Account</span><span style={{ fontSize: 18, color: C.g500 }}>›</span>
          </div>
        </div>

        {/* ── Log out ── */}
        <button onClick={onBack} style={{ width: '100%', background: C.redLt, border: `1px solid ${C.red200}`, borderRadius: 12, padding: '14px 0', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 16 }}>
          <span style={{ color: C.red, fontWeight: 700, fontSize: 16 }}>Sign out</span>
        </button>

        <div style={{ textAlign: 'center', fontSize: 12, color: C.g500, marginBottom: 16 }}>Neriah v1.0.0</div>
      </div>

      {/* Bottom tabs */}
      <div style={{ height: 50, background: C.white, borderTop: `1px solid ${C.border}`, display: 'flex', flexShrink: 0 }}>
        {[
          { icon: <Home size={16} />, label: 'Home', active: false, onClick: onBack },
          { icon: <BarChart2 size={16} />, label: 'Results', active: false, onClick: onResults },
          { icon: <Settings size={16} />, label: 'Settings', active: true, onClick: undefined as (() => void) | undefined },
        ].map(tab => (
          <div key={tab.label} onClick={tab.onClick} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, cursor: 'pointer' }}>
            <span style={{ color: tab.active ? C.amber : C.g500 }}>{tab.icon}</span>
            <span style={{ fontSize: 11, fontWeight: tab.active ? 600 : 400, color: tab.active ? C.amber700 : C.g500, borderBottom: tab.active ? `2px solid ${C.amber}` : '2px solid transparent', paddingBottom: 1 }}>{tab.label}</span>
          </div>
        ))}
      </div>

      {/* ── Change Name modal ── */}
      {nameModal && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'flex-end', zIndex: 10 }}>
          <div style={{ background: C.white, borderRadius: '16px 16px 0 0', width: '100%', padding: 16, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>Change Name</span>
              <button onClick={() => setNameModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: C.g500 }}>✕</button>
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.g900, display: 'block', marginBottom: 3 }}>First name</label>
            <input value={editFirst} onChange={e => setEditFirst(e.target.value)} style={{ ...inpS, marginBottom: 10 }} />
            <label style={{ fontSize: 12, fontWeight: 600, color: C.g900, display: 'block', marginBottom: 3 }}>Surname</label>
            <input value={editSurname} onChange={e => setEditSurname(e.target.value)} style={{ ...inpS, marginBottom: 14 }} />
            <button onClick={() => { setNameModal(false); setToast('Name updated'); }} style={{ width: '100%', background: C.teal, border: 'none', borderRadius: 10, padding: '13px 0', color: C.white, fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}>Save</button>
          </div>
        </div>
      )}

      {/* Join a Class modal — school autocomplete */}
      {joinModal && (() => {
        const q = joinCode.toLowerCase();
        const demoSchools = ['Chiredzi High School', 'Churchill High School', 'Allan Wilson High School', 'Harare High School', 'Goromonzi High School'];
        const suggestions = q.length >= 2 ? demoSchools.filter(s => s.toLowerCase().includes(q)) : [];
        const demoClasses: Record<string, Array<{ id: string; name: string; subject: string; teacher: string }>> = {
          'Chiredzi High School': [{ id: 'c1', name: 'Form 3B', subject: 'Science', teacher: 'Mrs Dube' }, { id: 'c3', name: 'Form 2A', subject: 'Mathematics', teacher: 'Mr Maisiri' }],
          'Allan Wilson High School': [{ id: 'c2', name: 'Form 2B', subject: 'Mathematics', teacher: 'Mr Phiri' }],
          'Harare High School': [{ id: 'c4', name: 'Form 1A', subject: 'English', teacher: 'Ms Nyathi' }],
        };
        const selectedClasses = joinToast ? [] : (demoClasses[joinCode] || []);
        return (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'flex-end', zIndex: 10 }}>
            <div style={{ background: C.white, borderRadius: '16px 16px 0 0', width: '100%', padding: 16, boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>Join a Class</span>
                <button onClick={() => { setJoinModal(false); setJoinCode(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: C.g500 }}>✕</button>
              </div>
              <div style={{ fontSize: 13, color: C.g500, marginBottom: 8 }}>School</div>
              <div style={{ position: 'relative' }}>
                <input
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value)}
                  placeholder="Start typing school name…"
                  autoFocus
                  style={inpS}
                />
                {suggestions.length > 0 && !demoClasses[joinCode] && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 20, maxHeight: 180, overflowY: 'auto' }}>
                    {suggestions.map(s => (
                      <div key={s} onClick={() => setJoinCode(s)} style={{ padding: '10px 12px', cursor: 'pointer', fontSize: 14, color: C.text, borderBottom: `1px solid ${C.bg}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, color: C.teal }}>🏫</span> {s}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {q.length >= 3 && suggestions.length === 0 && !demoClasses[joinCode] && (
                <div style={{ fontSize: 12, color: C.g500, marginTop: 6 }}>No schools found — try a different name</div>
              )}
              {selectedClasses.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.g500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{joinCode}</div>
                  {selectedClasses.map(c => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 8px', borderBottom: `1px solid ${C.bg}` }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{c.name} — {c.subject}</div>
                        <div style={{ fontSize: 11, color: C.g500, marginTop: 1 }}>{c.teacher}</div>
                      </div>
                      <button onClick={() => { setJoinModal(false); setJoinCode(''); setToast(`Joined ${c.name} — ${c.subject}!`); }} style={{ background: C.teal, border: 'none', borderRadius: 8, padding: '5px 14px', color: C.white, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Join</button>
                    </div>
                  ))}
                </div>
              )}
              {demoClasses[joinCode] !== undefined && selectedClasses.length === 0 && (
                <div style={{ textAlign: 'center', color: C.g500, fontSize: 13, padding: 14 }}>No classes at this school yet.</div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Student PIN modal */}
      {pinModal && (
        <PinModal
          mode={pinModal}
          onClose={() => setPinModal(null)}
          onSuccess={handlePinSuccess}
        />
      )}

      {/* Student Toast */}
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
    </div>
  );
}

// ── ClassDetailScreen (web) ──────────────────────────────────────────────────
interface DemoStudent { id: string; first_name: string; surname: string; register_number?: string }

const DEMO_STUDENTS: DemoStudent[] = [
  { id: 's1', first_name: 'Chipo', surname: 'Dube', register_number: '01' },
  { id: 's2', first_name: 'Tendai', surname: 'Moyo', register_number: '02' },
  { id: 's3', first_name: 'Farai', surname: 'Chikumba', register_number: '03' },
  { id: 's4', first_name: 'Rumbi', surname: 'Nyathi', register_number: '04' },
  { id: 's5', first_name: 'Tatenda', surname: 'Phiri', register_number: '05' },
];

function ClassDetailWebScreen({ onBack, onHomeworkList, onStudentTap }: {
  onBack: () => void; onHomeworkList: () => void; onStudentTap: (s: DemoStudent) => void;
}) {
  const [students, setStudents] = useState<DemoStudent[]>(DEMO_STUDENTS);
  const [addOpen, setAddOpen] = useState(false);
  const [newFirst, setNewFirst] = useState('');
  const [newSurname, setNewSurname] = useState('');
  const [newReg, setNewReg] = useState('');
  const handleAdd = () => {
    if (!newFirst.trim() || !newSurname.trim()) return;
    setStudents(p => [...p, { id: `s${Date.now()}`, first_name: newFirst.trim(), surname: newSurname.trim(), register_number: newReg.trim() || undefined }]);
    setNewFirst(''); setNewSurname(''); setNewReg(''); setAddOpen(false);
  };
  const inp: React.CSSProperties = { border: `1px solid ${C.g200}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, color: C.text, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', background: C.white };
  return (
    <Screen>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}><ChevronLeft size={20} color={C.g900} /></button>
          <span style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Form 2A</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.teal, background: C.teal50, borderRadius: 6, padding: '2px 7px' }}>ZIMSEC</span>
        </div>
        <button onClick={onHomeworkList} style={{ border: `1px solid ${C.teal}`, background: 'none', borderRadius: 10, padding: '5px 10px', cursor: 'pointer', fontSize: 12, color: C.teal, fontWeight: 600, fontFamily: 'inherit' }}>Marked Homework</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0 10px' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.g900 }}>Students ({students.length})</span>
          <button onClick={() => setAddOpen(true)} style={{ background: C.teal50, border: 'none', borderRadius: 10, padding: '4px 12px', cursor: 'pointer', fontSize: 13, color: C.teal, fontWeight: 600, fontFamily: 'inherit' }}>+ Add</button>
        </div>
        {students.map(s => (
          <div key={s.id} onClick={() => onStudentTap(s)} style={{ background: C.white, borderRadius: 10, padding: '11px 12px', marginBottom: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 17, background: C.teal50, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: C.teal, flexShrink: 0 }}>{s.first_name[0]}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{s.first_name} {s.surname}</div>
              {s.register_number && <div style={{ fontSize: 11, color: C.g500, marginTop: 1 }}>#{s.register_number}</div>}
            </div>
            <button onClick={(e) => { e.stopPropagation(); setStudents(p => p.filter(x => x.id !== s.id)); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: C.g200, fontSize: 14 }}>✕</button>
            <span style={{ fontSize: 18, color: C.g200 }}>›</span>
          </div>
        ))}
        {students.length === 0 && <div style={{ textAlign: 'center', color: C.g500, fontSize: 13, padding: 20 }}>No students yet. Tap + Add to add students.</div>}
      </div>
      {addOpen && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'flex-end', zIndex: 10 }}>
          <div style={{ background: C.white, borderRadius: '16px 16px 0 0', width: '100%', padding: 16, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>Add Student</span>
              <button onClick={() => setAddOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: C.g500 }}>✕</button>
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.g900, display: 'block', marginBottom: 3 }}>First name *</label>
            <input value={newFirst} onChange={e => setNewFirst(e.target.value)} placeholder="e.g. Tendai" style={{ ...inp, marginBottom: 10 }} />
            <label style={{ fontSize: 12, fontWeight: 600, color: C.g900, display: 'block', marginBottom: 3 }}>Surname *</label>
            <input value={newSurname} onChange={e => setNewSurname(e.target.value)} placeholder="e.g. Moyo" style={{ ...inp, marginBottom: 10 }} />
            <label style={{ fontSize: 12, fontWeight: 600, color: C.g900, display: 'block', marginBottom: 3 }}>Register number (optional)</label>
            <input value={newReg} onChange={e => setNewReg(e.target.value)} placeholder="e.g. 06" style={{ ...inp, marginBottom: 14 }} />
            <button onClick={handleAdd} style={{ width: '100%', background: C.teal, border: 'none', borderRadius: 10, padding: '13px 0', color: C.white, fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}>Add Student</button>
          </div>
        </div>
      )}
    </Screen>
  );
}

// ── GradingResultsScreen (web) ──────────────────────────────────────────────
function GradingResultsWebScreen({ onBack, onViewSubmission }: {
  onBack: () => void; onViewSubmission: (sub: DemoSubmissionDetail) => void;
}) {
  const [tab, setTab] = useState<'pending' | 'graded'>('pending');
  const [subs, setSubs] = useState([
    { id: 'sub1', student_name: 'Chipo Dube', score: 7 as number | null, max_score: 10, percentage: 70, submitted_at: '2026-04-14T08:30:00Z', status: 'graded' as const },
    { id: 'sub2', student_name: 'Tendai Moyo', score: 5 as number | null, max_score: 10, percentage: 50, submitted_at: '2026-04-14T09:15:00Z', status: 'graded' as const },
    { id: 'sub3', student_name: 'Farai Chikumba', score: null as number | null, max_score: 10, percentage: 0, submitted_at: '2026-04-14T10:00:00Z', status: 'pending' as const },
    { id: 'sub4', student_name: 'Rumbi Nyathi', score: null as number | null, max_score: 10, percentage: 0, submitted_at: '2026-04-14T10:30:00Z', status: 'pending' as const },
  ]);
  const graded = subs.filter(s => s.status === 'graded');
  const pending = subs.filter(s => s.status === 'pending');
  const visible = tab === 'pending' ? pending : graded;
  const avg = graded.length > 0 ? Math.round(graded.reduce((a, s) => a + (s.percentage || 0), 0) / graded.length) : null;
  const highest = graded.length > 0 ? Math.max(...graded.map(s => s.percentage || 0)) : null;
  const lowest = graded.length > 0 ? Math.min(...graded.map(s => s.percentage || 0)) : null;
  const approveAll = () => setSubs(p => p.map(s => s.status === 'pending' ? { ...s, status: 'graded' as const, score: Math.floor(Math.random() * 5 + 5), percentage: Math.floor(Math.random() * 40 + 50) } : s));
  const sc = (pct: number) => pct >= 70 ? C.teal : pct >= 50 ? C.amber : C.red;
  return (
    <Screen>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}><ChevronLeft size={20} color={C.g900} /></button>
        <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Grading Results</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1, background: C.white, borderRadius: 12, padding: '12px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.teal }}>{graded.length}</div>
            <div style={{ fontSize: 11, color: C.g500, fontWeight: 600 }}>Graded</div>
          </div>
          <div style={{ flex: 1, background: C.white, borderRadius: 12, padding: '12px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.amber }}>{pending.length}</div>
            <div style={{ fontSize: 11, color: C.g500, fontWeight: 600 }}>Pending</div>
          </div>
        </div>
        {avg != null && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {[{ v: avg, l: 'Average' }, { v: highest!, l: 'Highest' }, { v: lowest!, l: 'Lowest' }].map(x => (
              <div key={x.l} style={{ flex: 1, background: C.white, borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: sc(x.v) }}>{x.v}%</div>
                <div style={{ fontSize: 11, color: C.g500 }}>{x.l}</div>
              </div>
            ))}
          </div>
        )}
        {pending.length > 1 && (
          <button onClick={approveAll} style={{ width: '100%', background: C.teal, border: 'none', borderRadius: 10, padding: '12px 0', color: C.white, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 12 }}>Approve All ({pending.length}) ✓</button>
        )}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {(['pending', 'graded'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: tab === t ? C.teal : C.white, color: tab === t ? C.white : C.g500, fontWeight: 700, fontSize: 13 }}>{t === 'pending' ? `Pending (${pending.length})` : `Graded (${graded.length})`}</button>
          ))}
        </div>
        {visible.map(s => (
          <div key={s.id} onClick={() => s.status === 'graded' ? onViewSubmission({ submissionId: s.id, studentName: s.student_name, submittedAt: s.submitted_at, grade: { student_id: s.id, student_name: s.student_name, score: s.score ?? 0, max_score: s.max_score, percentage: s.percentage, verdicts: [] }, verdicts: [] }) : undefined} style={{ background: C.white, borderRadius: 10, padding: '10px 12px', marginBottom: 7, cursor: s.status === 'graded' ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{s.student_name}</div>
              <div style={{ fontSize: 11, color: C.g500, marginTop: 2 }}>{new Date(s.submitted_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {s.status === 'graded' && s.score != null && <span style={{ fontSize: 16, fontWeight: 800, color: sc(s.percentage) }}>{s.score}/{s.max_score}</span>}
              <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '3px 8px', background: s.status === 'graded' ? C.teal50 : C.amber50, color: s.status === 'graded' ? C.teal : C.amber700 }}>{s.status === 'graded' ? 'Graded' : 'Pending'}</span>
            </div>
          </div>
        ))}
        {visible.length === 0 && <div style={{ textAlign: 'center', color: C.g500, fontSize: 13, padding: 24 }}>No {tab} submissions.</div>}
      </div>
    </Screen>
  );
}

// ── EditProfileScreen (web) ─────────────────────────────────────────────────
function EditProfileWebScreen({ onBack }: { onBack: () => void }) {
  const [title, setTitle] = useState('Mr');
  const [firstName, setFirstName] = useState('Tinotenda');
  const [surname, setSurname] = useState('Maisiri');
  const [saved, setSaved] = useState(false);
  const titles = ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr', 'Prof'];
  const inp: React.CSSProperties = { border: `1px solid ${C.g200}`, borderRadius: 10, padding: '11px 12px', fontSize: 14, color: C.text, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', background: C.white };
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: C.g900, marginTop: 14, marginBottom: 4, display: 'block' };
  return (
    <Screen style={{ padding: '0 18px' }}>
      <div style={{ padding: '14px 0', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}><ChevronLeft size={20} color={C.g900} /></button>
        <span style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Edit Profile</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {saved && (
          <div style={{ background: C.teal50, borderRadius: 10, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Check size={16} color={C.teal} />
            <span style={{ fontSize: 13, fontWeight: 600, color: C.teal }}>Profile updated successfully</span>
          </div>
        )}
        <label style={lbl}>Title</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {titles.map(t => (
            <button key={t} onClick={() => setTitle(t)} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${title === t ? C.teal : C.g200}`, background: title === t ? C.teal50 : C.white, color: title === t ? C.teal : C.g500, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{t}</button>
          ))}
        </div>
        <label style={lbl}>First name</label>
        <input value={firstName} onChange={e => setFirstName(e.target.value)} style={inp} />
        <label style={lbl}>Surname</label>
        <input value={surname} onChange={e => setSurname(e.target.value)} style={inp} />
        <label style={lbl}>Phone</label>
        <input value="+263 77 123 4567" disabled style={{ ...inp, opacity: 0.6 }} />
        <div style={{ fontSize: 11, color: C.g500, marginTop: 4 }}>Phone number cannot be changed in the demo.</div>
        <button onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 3000); }} style={{ marginTop: 22, width: '100%', background: C.teal, border: 'none', borderRadius: 10, padding: '13px 0', color: C.white, fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}>Save Changes</button>
      </div>
    </Screen>
  );
}

// ── TeacherInboxScreen (web) ────────────────────────────────────────────────
function TeacherInboxWebScreen({ onBack, onViewSubmission }: {
  onBack: () => void; onViewSubmission: (sub: DemoSubmissionDetail) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'graded'>('all');
  const [subs, setSubs] = useState([
    { id: 'in1', student_name: 'Chipo Dube', hw: 'Chapter 5 Test', score: 7 as number | null, max_score: 10, percentage: 70, submitted_at: '2026-04-15T08:30:00Z', status: 'graded' as const },
    { id: 'in2', student_name: 'Farai Chikumba', hw: 'Chapter 5 Test', score: null as number | null, max_score: 10, percentage: 0, submitted_at: '2026-04-15T09:00:00Z', status: 'pending' as const },
    { id: 'in3', student_name: 'Rumbi Nyathi', hw: 'Chapter 4 Quiz', score: null as number | null, max_score: 10, percentage: 0, submitted_at: '2026-04-15T09:45:00Z', status: 'pending' as const },
    { id: 'in4', student_name: 'Tendai Moyo', hw: 'Chapter 5 Test', score: 9 as number | null, max_score: 10, percentage: 90, submitted_at: '2026-04-14T14:00:00Z', status: 'graded' as const },
  ]);
  const timeAgo = (d: string) => { const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000); if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`; };
  const handleApprove = (id: string) => { setSubs(p => p.map(s => s.id === id ? { ...s, status: 'graded' as const, score: Math.floor(Math.random() * 4 + 6), percentage: Math.floor(Math.random() * 30 + 60) } : s)); };
  const visible = subs.filter(s => filter === 'all' ? true : s.status === filter);
  const sc = (pct: number) => pct >= 70 ? C.teal : pct >= 50 ? C.amber : C.red;
  return (
    <Screen>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}><ChevronLeft size={20} color={C.g900} /></button>
        <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Inbox</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.white, background: C.amber, borderRadius: 10, padding: '2px 8px', marginLeft: 'auto' }}>{subs.filter(s => s.status === 'pending').length}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '10px 14px' }}>
        {(['all', 'pending', 'graded'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: filter === f ? C.teal : C.white, color: filter === f ? C.white : C.g500, fontWeight: 600, fontSize: 12, textTransform: 'capitalize' }}>{f} ({f === 'all' ? subs.length : subs.filter(s => s.status === f).length})</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 16px' }}>
        {visible.map(s => (
          <div key={s.id} style={{ background: C.white, borderRadius: 10, padding: '10px 12px', marginBottom: 7, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{s.student_name}</div>
              <div style={{ fontSize: 11, color: C.g500, marginTop: 1 }}>{s.hw} · {timeAgo(s.submitted_at)}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {s.status === 'graded' && s.score != null && <span style={{ fontSize: 14, fontWeight: 800, color: sc(s.percentage) }}>{s.score}/{s.max_score}</span>}
              {s.status === 'pending' ? (
                <button onClick={() => handleApprove(s.id)} style={{ background: C.teal, border: 'none', borderRadius: 8, padding: '5px 12px', color: C.white, fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Grade</button>
              ) : (
                <span style={{ fontSize: 11, fontWeight: 700, background: C.teal50, color: C.teal, borderRadius: 6, padding: '3px 8px' }}>Graded</span>
              )}
            </div>
          </div>
        ))}
        {visible.length === 0 && <div style={{ textAlign: 'center', color: C.g500, fontSize: 13, padding: 24 }}>No submissions.</div>}
      </div>
    </Screen>
  );
}

// ── CapturePagesScreen (web adaptation of StudentCameraScreen) ──────────────
function CapturePagesWebScreen({ onBack, onDone }: {
  onBack: () => void; onDone: (imageCount: number) => void;
}) {
  const [pages, setPages] = useState<string[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') setPages(p => [...p, reader.result as string]); };
    reader.readAsDataURL(file); e.target.value = '';
  };
  const handleWebcamCapture = (base64: string) => { setCameraOpen(false); setPages(p => [...p, `data:image/jpeg;base64,${base64}`]); };
  return (
    <Screen>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}><ChevronLeft size={20} color={C.g900} /></button>
        <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Capture Pages</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        <div style={{ fontSize: 13, color: C.g500, marginBottom: 14, lineHeight: 1.5 }}>Photograph each page of your homework. You can add as many pages as needed.</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {pages.map((src, i) => (
            <div key={i} style={{ position: 'relative', width: 80, height: 100, borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.g200}` }}>
              <img src={src} alt={`Page ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <button onClick={() => setPages(p => p.filter((_, j) => j !== i))} style={{ position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10, background: 'rgba(0,0,0,0.6)', border: 'none', color: C.white, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.5)', textAlign: 'center', fontSize: 11, color: C.white, padding: 2 }}>Page {i + 1}</div>
            </div>
          ))}
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
        <button onClick={() => fileRef.current?.click()} style={{ width: '100%', background: C.teal, border: 'none', borderRadius: 10, padding: '13px 0', color: C.white, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Camera size={18} color={C.white} />
          {pages.length === 0 ? 'Capture Page 1' : 'Add Another Page'}
        </button>
        <button onClick={() => setCameraOpen(true)} style={{ width: '100%', background: C.white, border: `1px solid ${C.g200}`, borderRadius: 10, padding: '12px 0', color: C.g900, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Camera size={16} color={C.g500} />
          Use Webcam
        </button>
        {pages.length > 0 && (
          <button onClick={() => onDone(pages.length)} style={{ width: '100%', background: C.amber, border: 'none', borderRadius: 10, padding: '14px 0', color: C.white, fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}>
            Continue with {pages.length} page{pages.length !== 1 ? 's' : ''} →
          </button>
        )}
      </div>
      {cameraOpen && <WebCameraModal open={cameraOpen} onCapture={handleWebcamCapture} onClose={() => setCameraOpen(false)} />}
    </Screen>
  );
}


// ──────────────────────────────────────────────────────────────────────────────
// PAGE
// ──────────────────────────────────────────────────────────────────────────────
export default function DemoPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authDenied, setAuthDenied]   = useState(false);

  // ── Auth guard — verify demo_admin_token cookie on mount ─────────────────────
  useEffect(() => {
    fetch('/api/admin/demo-verify', { credentials: 'same-origin' })
      .then(res => {
        if (!res.ok) { setAuthDenied(true); }
      })
      .catch(() => { setAuthDenied(true); })
      .finally(() => { setAuthChecked(true); });
  }, []);

  const [screen, setScreen]         = useState<TScreen>('welcome');
  const [prevScreen, setPrevScreen] = useState<TScreen>('welcome');
  const [otpPhone, setOtpPhone]     = useState('+263771234567');
  const [otpChannel, setOtpChannel] = useState<'whatsapp' | 'sms'>('sms');
  const [demoToken, setDemoToken]   = useState<string | null>(null);
  const [schemeData, setSchemeData]             = useState<{ answer_key_id: string; questions: ReviewQuestion[] } | null>(null);
  const [hwInfo, setHwInfo]                     = useState<HomeworkInfo>(DEMO_HOMEWORK);
  const [selectedSubmission, setSelectedSubmission]           = useState<DemoSubmissionDetail | null>(null);
  const [selectedStudent, setSelectedStudent]                 = useState<DemoAnalyticsStudent | null>(null);
  const [selectedHomeworkId, setSelectedHomeworkId]           = useState<string | null>(null);
  const [newClass, setNewClass]                               = useState<DemoClass | null>(null);
  const [annotatedImageUrl, setAnnotatedImageUrl]             = useState<string>('');

  // ── Shared real-time state (lifted so both phones react instantly) ──────────
  const [submissionsOpen, setSubmissionsOpen]   = useState(true);
  const [gradingComplete, setGradingComplete]   = useState(false);
  const [syncPulse, setSyncPulse]               = useState(false);

  // ── Student phone state ────────────────────────────────────────────────────
  const [sScreen, setSScreen]                   = useState<SStudentScreen>('s-welcome');
  const [studentName, setStudentName]           = useState('Chipo Dube');
  const [submissionFileName, setSubmissionFileName] = useState('');
  // Student phone's own OTP state (independent from teacher phone)
  const [sOtpPhone, setSSOtpPhone]               = useState('+263771234567');
  const [sOtpChannel, setSSOtpChannel]           = useState<'whatsapp' | 'sms'>('sms');
  // Student phone teacher-mode navigation (fully independent from left phone)
  const [sTeacherScreen, setSTeacherScreen]      = useState<TScreen>('register');
  const [sTeacherPrev, setSTeacherPrev]          = useState<TScreen>('register');
  const [sTeacherNewClass, setSTeacherNewClass]  = useState<DemoClass | null>(null);

  // Web is always cloud-only — set once on first visit, skip if already stored.
  useEffect(() => {
    if (!localStorage.getItem('device_capability')) {
      localStorage.setItem('device_capability', 'cloud');
      console.log('[deviceCapabilities] web demo → cloud');
    }
  }, []);

  // ── AI inference router (web is always cloud) ─────────────────────────────
  // Mirrors the mobile router contract: routeRequest(isOnline, modelLoaded).
  // Web has no on-device model and is always assumed to be online.
  // All AI requests in the demo call this before dispatching to the demo API.
  const routeAIRequest = useCallback(
    (_requestType: 'grading' | 'tutoring' | 'scheme'): 'cloud' => 'cloud',
    [],
  );

  function triggerSync() {
    setSyncPulse(true);
    setTimeout(() => setSyncPulse(false), 1200);
  }

  const go = (to: TScreen) => { setPrevScreen(screen); setScreen(to); };
  const back = () => setScreen(prevScreen);

  function renderTeacherScreen() {
    switch (screen) {
      case 'welcome':
        return <WelcomeScreen onTeacher={() => go('register')} highlight="teacher" />;
      case 'phone':
        return <PhoneScreen onContinue={(p, ch) => { setOtpPhone(p); setOtpChannel(ch); go('otp'); }} onRegister={() => go('welcome')} />;
      case 'otp':
        return <OTPScreen phone={otpPhone} channel={otpChannel} onVerify={() => go('classes')} onBack={back} />;
      case 'register':
        return <RegisterScreen onSignIn={() => go('phone')} onContinue={(p, ch) => { setOtpPhone(p); setOtpChannel(ch); go('otp'); }} />;
      case 'classes':
        return <ClassesScreen onAddHomework={() => go('add-homework')} onOpenHomework={() => go('homework-detail')} onHomeworkList={() => go('homework-list')} onSettings={() => go('t-settings')} onAnalytics={() => go('analytics')} onAssistant={() => go('t-assistant')} onNewClass={() => go('class-setup')} onClassDetail={() => go('class-detail')} onInbox={() => go('inbox')} />;
      case 'homework-list':
        return <HomeworkListWebScreen onBack={() => go('classes')} onOpenHomework={() => go('homework-detail')} demoToken={demoToken} />;
      case 'class-setup':
        return (
          <ClassSetupScreen
            onBack={() => go('classes')}
            onCreate={(cls) => { setNewClass(cls); go('class-join-code'); }}
          />
        );
      case 'class-join-code':
        if (!newClass) { go('classes'); return null; }
        return (
          <ClassJoinCodeScreen
            cls={newClass}
            onDone={() => { setNewClass(null); go('classes'); }}
          />
        );
      case 't-settings':
        return <TeacherSettingsWebScreen onBack={() => go('classes')} onAnalytics={() => go('analytics')} onEditProfile={() => go('edit-profile')} />;
      case 'add-homework':
        return (
          <AddHomeworkScreen
            onBack={() => go('classes')}
            onSuccess={(data) => { setSchemeData(data); go('review-scheme'); }}
            demoToken={demoToken}
          />
        );
      case 'review-scheme':
        return (
          <ReviewSchemeScreen
            answerKeyId={schemeData?.answer_key_id ?? 'demo-key'}
            initialQuestions={schemeData?.questions ?? DEMO_QUESTIONS}
            onBack={() => go('add-homework')}
            onConfirm={() => go('homework-created')}
            demoToken={demoToken}
          />
        );
      case 'homework-created':
        return (
          <HomeworkCreatedScreen
            answerKeyId={schemeData?.answer_key_id ?? 'demo-key'}
            onDone={() => go('classes')}
            demoToken={demoToken}
          />
        );
      case 'homework-detail':
        return (
          <HomeworkDetailScreen
            hw={hwInfo}
            isOpen={submissionsOpen}
            onToggleOpen={(next) => { setSubmissionsOpen(next); setHwInfo(h => ({ ...h, is_open: next })); triggerSync(); }}
            onBack={() => go('classes')}
            onGradeAll={() => go('grade-all')}
            onViewSubmission={(sub) => { setSelectedSubmission(sub); go('grading-detail'); }}
            demoToken={demoToken}
            gradingComplete={gradingComplete}
          />
        );
      case 'grade-all':
        return (
          <GradeAllScreen
            hw={hwInfo}
            onBack={() => go('homework-detail')}
            demoToken={demoToken}
            onGradingDone={() => { setGradingComplete(true); triggerSync(); }}
          />
        );
      case 'grading-detail':
        if (!selectedSubmission) { go('homework-detail'); return null; }
        return (
          <GradingDetailScreen
            submission={selectedSubmission}
            hw={hwInfo}
            onBack={() => go('homework-detail')}
            demoToken={demoToken}
            onApproved={(url) => { setAnnotatedImageUrl(url); triggerSync(); }}
          />
        );
      case 'analytics':
        return (
          <AnalyticsScreen
            onBack={() => go('classes')}
            demoToken={demoToken}
            onSettings={() => go('t-settings')}
            onViewStudent={(s) => { setSelectedStudent(s); go('student-analytics'); }}
            onViewHomework={(id) => { setSelectedHomeworkId(id); go('homework-analytics'); }}
          />
        );
      case 'student-analytics':
        if (!selectedStudent) { go('analytics'); return null; }
        return (
          <StudentAnalyticsScreen
            student={selectedStudent}
            onBack={() => go('analytics')}
            demoToken={demoToken}
          />
        );
      case 'homework-analytics':
        if (!selectedHomeworkId) { go('analytics'); return null; }
        return (
          <HomeworkAnalyticsWebScreen
            homeworkId={selectedHomeworkId}
            onBack={() => go('analytics')}
            onViewStudent={(s) => { setSelectedStudent(s); go('student-analytics'); }}
            demoToken={demoToken}
          />
        );
      case 'class-detail':
        return <ClassDetailWebScreen onBack={() => go('classes')} onHomeworkList={() => go('homework-list')} onStudentTap={(s) => { setSelectedStudent({ student_id: s.id, name: `${s.first_name} ${s.surname}`, latest_score: 65, average_score: 65, submission_count: 3, trend: 'up' }); go('student-analytics'); }} />;
      case 'grading-results':
        return <GradingResultsWebScreen onBack={() => go('homework-detail')} onViewSubmission={(sub) => { setSelectedSubmission(sub); go('grading-detail'); }} />;
      case 'edit-profile':
        return <EditProfileWebScreen onBack={() => go('t-settings')} />;
      case 'inbox':
        return <TeacherInboxWebScreen onBack={() => go('classes')} onViewSubmission={(sub) => { setSelectedSubmission(sub); go('grading-detail'); }} />;
      case 't-assistant':
        return <TeacherAIAssistantWebScreen onBack={() => go('classes')} />;
      default:
        return null;
    }
  }

  function renderStudentScreen() {
    // Student phone teacher-mode helpers (fully independent from left phone's go/back)
    const sGo = (to: TScreen) => { setSTeacherPrev(sTeacherScreen); setSTeacherScreen(to); };
    const sBack = () => setSTeacherScreen(sTeacherPrev);

    switch (sScreen) {
      // ── Auth flow ────────────────────────────────────────────────────────────
      case 's-welcome':
        return (
          <WelcomeScreen
            onTeacher={() => { setSTeacherScreen('register'); setSTeacherPrev('register'); setSScreen('s-teacher'); }}
            onStudent={() => setSScreen('s-register')}
            highlight="student"
          />
        );
      case 's-phone':
        return (
          <PhoneScreen
            onContinue={(p, ch) => { setSSOtpPhone(p); setSSOtpChannel(ch); setSScreen('s-otp'); }}
            onRegister={() => setSScreen('s-welcome')}
          />
        );
      case 's-otp':
        return (
          <OTPScreen
            phone={sOtpPhone} channel={sOtpChannel}
            onVerify={() => setSScreen('s-register')}
            onBack={() => setSScreen('s-phone')}
          />
        );

      // ── Student phone teacher-mode (independent navigation) ──────────────────
      case 's-teacher':
        switch (sTeacherScreen) {
          case 'welcome':
            return <WelcomeScreen onTeacher={() => sGo('register')} highlight="student" />;
          case 'phone':
            return <PhoneScreen onContinue={(p, ch) => { setSSOtpPhone(p); setSSOtpChannel(ch); sGo('otp'); }} onRegister={() => sGo('welcome')} />;
          case 'otp':
            return <OTPScreen phone={sOtpPhone} channel={sOtpChannel} onVerify={() => sGo('classes')} onBack={sBack} />;
          case 'register':
            return <RegisterScreen onSignIn={() => sGo('phone')} onContinue={(p, ch) => { setSSOtpPhone(p); setSSOtpChannel(ch); sGo('otp'); }} />;
          case 'classes':
            return <ClassesScreen onAddHomework={() => sGo('add-homework')} onOpenHomework={() => sGo('homework-detail')} onHomeworkList={() => sGo('homework-list')} onSettings={() => sGo('t-settings')} onAnalytics={() => sGo('analytics')} onAssistant={() => sGo('t-assistant')} onNewClass={() => sGo('class-setup')} onClassDetail={() => sGo('class-detail')} onInbox={() => sGo('inbox')} />;
          case 'class-setup':
            return <ClassSetupScreen onBack={() => sGo('classes')} onCreate={(cls) => { setSTeacherNewClass(cls); sGo('class-join-code'); }} />;
          case 'class-join-code':
            if (!sTeacherNewClass) { sGo('classes'); return null; }
            return <ClassJoinCodeScreen cls={sTeacherNewClass} onDone={() => { setSTeacherNewClass(null); sGo('classes'); }} />;
          case 't-settings':
            return <TeacherSettingsWebScreen onBack={() => sGo('classes')} onAnalytics={() => sGo('analytics')} onEditProfile={() => sGo('edit-profile')} />;
          case 'add-homework':
            return <AddHomeworkScreen onBack={() => sGo('classes')} onSuccess={(data) => { setSchemeData(data); sGo('review-scheme'); }} demoToken={demoToken} />;
          case 'review-scheme':
            return <ReviewSchemeScreen answerKeyId={schemeData?.answer_key_id ?? 'demo-key'} initialQuestions={schemeData?.questions ?? DEMO_QUESTIONS} onBack={() => sGo('add-homework')} onConfirm={() => sGo('homework-created')} demoToken={demoToken} />;
          case 'homework-created':
            return <HomeworkCreatedScreen answerKeyId={schemeData?.answer_key_id ?? 'demo-key'} onDone={() => sGo('classes')} demoToken={demoToken} />;
          case 'homework-list':
            return <HomeworkListWebScreen onBack={() => sGo('classes')} onOpenHomework={() => sGo('homework-detail')} demoToken={demoToken} />;
          case 'homework-detail':
            return (
              <HomeworkDetailScreen
                hw={hwInfo} isOpen={submissionsOpen}
                onToggleOpen={(next) => { setSubmissionsOpen(next); setHwInfo(h => ({ ...h, is_open: next })); triggerSync(); }}
                onBack={() => sGo('classes')} onGradeAll={() => sGo('grade-all')}
                onViewSubmission={(sub) => { setSelectedSubmission(sub); sGo('grading-detail'); }}
                demoToken={demoToken} gradingComplete={gradingComplete}
              />
            );
          case 'grade-all':
            return <GradeAllScreen hw={hwInfo} onBack={() => sGo('homework-detail')} demoToken={demoToken} onGradingDone={() => { setGradingComplete(true); triggerSync(); }} />;
          case 'grading-detail':
            if (!selectedSubmission) { sGo('homework-detail'); return null; }
            return <GradingDetailScreen submission={selectedSubmission} hw={hwInfo} onBack={() => sGo('homework-detail')} demoToken={demoToken} onApproved={(url) => { setAnnotatedImageUrl(url); triggerSync(); }} />;
          case 'analytics':
            return <AnalyticsScreen onBack={() => sGo('classes')} demoToken={demoToken} onSettings={() => sGo('t-settings')} onViewStudent={(s) => { setSelectedStudent(s); sGo('student-analytics'); }} onViewHomework={(id) => { setSelectedHomeworkId(id); sGo('homework-analytics'); }} />;
          case 'student-analytics':
            if (!selectedStudent) { sGo('analytics'); return null; }
            return <StudentAnalyticsScreen student={selectedStudent} onBack={() => sGo('analytics')} demoToken={demoToken} />;
          case 'homework-analytics':
            if (!selectedHomeworkId) { sGo('analytics'); return null; }
            return <HomeworkAnalyticsWebScreen homeworkId={selectedHomeworkId} onBack={() => sGo('analytics')} onViewStudent={(s) => { setSelectedStudent(s); sGo('student-analytics'); }} demoToken={demoToken} />;
          case 'class-detail':
            return <ClassDetailWebScreen onBack={() => sGo('classes')} onHomeworkList={() => sGo('homework-list')} onStudentTap={(s) => { setSelectedStudent({ student_id: s.id, name: `${s.first_name} ${s.surname}`, latest_score: 65, average_score: 65, submission_count: 3, trend: 'up' }); sGo('student-analytics'); }} />;
          case 'grading-results':
            return <GradingResultsWebScreen onBack={() => sGo('homework-detail')} onViewSubmission={(sub) => { setSelectedSubmission(sub); sGo('grading-detail'); }} />;
          case 'edit-profile':
            return <EditProfileWebScreen onBack={() => sGo('t-settings')} />;
          case 'inbox':
            return <TeacherInboxWebScreen onBack={() => sGo('classes')} onViewSubmission={(sub) => { setSelectedSubmission(sub); sGo('grading-detail'); }} />;
          case 't-assistant':
            return <TeacherAIAssistantWebScreen onBack={() => sGo('classes')} />;
          default:
            return <WelcomeScreen onTeacher={() => sGo('register')} highlight="student" />;
        }

      // ── Student flow ─────────────────────────────────────────────────────────
      case 's-register':
        return <StudentRegisterScreen onJoined={(name) => { setStudentName(name); setSScreen('s-home'); }} />;
      case 's-home':
        return <StudentHomeScreen studentName={studentName} submissionsOpen={submissionsOpen} onSubmit={() => setSScreen('s-submit')} onResults={() => setSScreen('s-results')} onTutor={() => setSScreen('s-tutor')} onSettings={() => setSScreen('s-settings')} demoToken={demoToken} />;
      case 's-settings':
        return <StudentSettingsWebScreen onBack={() => setSScreen('s-home')} onResults={() => setSScreen('s-results')} onClasses={() => setSScreen('s-classes')} studentName={studentName} />;
      case 's-classes':
        return <StudentClassManagementScreen onBack={() => setSScreen('s-settings')} demoToken={demoToken} />;
      case 's-capture':
        return <CapturePagesWebScreen onBack={() => setSScreen('s-submit')} onDone={(count) => { setSubmissionFileName(`homework_${count}pages.jpg`); setHwInfo(h => ({ ...h, submission_count: h.submission_count + 1 })); triggerSync(); setSScreen('s-success'); }} />;
      case 's-submit':
        return (
          <StudentSubmitScreen
            onBack={() => setSScreen('s-home')}
            onCapture={() => setSScreen('s-capture')}
            onSubmitted={(sub) => {
              setSubmissionFileName(sub.fileName);
              setHwInfo(h => ({ ...h, submission_count: h.submission_count + 1 }));
              triggerSync();
              setSScreen('s-success');
            }}
            demoToken={demoToken}
          />
        );
      case 's-success':
        return <StudentSubmissionSuccessScreen fileName={submissionFileName || 'homework.jpg'} onViewResults={() => setSScreen('s-results')} onHome={() => setSScreen('s-home')} />;
      case 's-results':
        return <StudentResultsScreen onBack={() => setSScreen('s-home')} gradingComplete={gradingComplete} onViewFeedback={() => setSScreen('s-feedback')} />;
      case 's-feedback':
        return <StudentFeedbackScreen onBack={() => setSScreen('s-results')} annotatedImageUrl={annotatedImageUrl} />;
      case 's-tutor':
        return <StudentTutorScreen studentName={studentName} onBack={() => setSScreen('s-home')} demoToken={demoToken} />;
      default:
        return null;
    }
  }

  // ── Auth gate ─────────────────────────────────────────────────────────────────
  if (!authChecked) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', color: C.teal, fontSize: 16 }}>Loading…</div>
      </div>
    );
  }

  if (authDenied) {
    return (
      <div style={{ minHeight: '100vh', background: C.nearWhite, display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: C.white, borderRadius: 16, padding: 40,
          maxWidth: 380, width: '100%', textAlign: 'center',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
          <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: C.darkBg }}>
            Access restricted
          </h1>
          <p style={{ margin: '0 0 24px', fontSize: 14, color: C.grayTxt, lineHeight: 1.5 }}>
            This demo is only accessible to Neriah admins.<br />
            Please sign in to continue.
          </p>
          <a href="/admin/curriculum"
            style={{ display: 'inline-block', background: C.teal, color: C.white,
              padding: '10px 24px', borderRadius: 8, fontWeight: 600, fontSize: 14,
              textDecoration: 'none' }}>
            Go to Admin Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        background: C.teal, boxShadow: '0 2px 12px rgba(13,115,119,0.18)',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{
          maxWidth: 1100, margin: '0 auto', padding: '0 24px', height: 64,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}>
          <Image src="/images/logo/logo-light-background.png" alt="Neriah" width={120} height={36} style={{ objectFit: 'contain', height: 36, width: 'auto' }} priority />
          <div style={{
            fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: C.teal, background: C.white, borderRadius: 20, paddingInline: 14, paddingBlock: 5,
          }}>
            Live Demo
          </div>
        </div>
      </header>

      {/* Hero text */}
      <div style={{ textAlign: 'center', padding: '40px 24px 0', maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ fontSize: 'clamp(22px, 4vw, 32px)', fontWeight: 800, color: C.g900, marginBottom: 10, lineHeight: 1.25 }}>
          See Neriah in action
        </h1>
        <p style={{ fontSize: 15, color: C.g500, lineHeight: 1.6, margin: 0 }}>
          Teacher (left) creates homework and grades with AI. Student (right) submits work and sees instant results. Try both phones.
        </p>
      </div>

      {/* Step indicator */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '20px 24px 0' }}>
        {(['welcome', 'register', 'otp', 'classes', 'add-homework', 'review-scheme', 'homework-created', 'homework-list', 'homework-detail', 'grade-all'] as TScreen[]).map((s, i) => (
          <div key={s} style={{
            width: screen === s ? 24 : 8, height: 8, borderRadius: 4,
            background: screen === s ? C.teal : C.g200,
            transition: 'width 0.25s, background 0.25s',
          }} />
        ))}
      </div>

      {/* Phone frames */}
      <main style={{
        flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        padding: '28px 16px 48px', gap: 0, flexWrap: 'wrap',
      }}>
        <PhoneFrame label="Teacher" labelColor={C.teal} showAIStatus={!(['welcome','phone','otp','register','class-setup','class-join-code'] as TScreen[]).includes(screen)}>
          {renderTeacherScreen()}
        </PhoneFrame>

        {/* Live sync connector */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          width: 52, alignSelf: 'center', gap: 6, flexShrink: 0,
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, fontWeight: 800, color: C.teal, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}><Zap size={9} color={C.teal} /> LIVE</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} style={{
                width: 5, height: 5, borderRadius: 2.5,
                background: syncPulse ? C.teal : C.g200,
                transition: `background 0.2s ${i * 80}ms`,
              }} />
            ))}
          </div>
        </div>

        <PhoneFrame label="Student" labelColor={C.amber700} showAIStatus={!(['s-welcome','s-phone','s-otp','s-register'] as SStudentScreen[]).includes(sScreen)}>
          {renderStudentScreen()}
        </PhoneFrame>
      </main>

      {/* Footer */}
      <footer style={{
        textAlign: 'center', padding: '16px 24px', borderTop: `1px solid ${C.g200}`,
        fontSize: 12, color: C.g400,
      }}>
        © {new Date().getFullYear()} Neriah Africa · Powered by Gemma 4
      </footer>
    </div>
  );
}
