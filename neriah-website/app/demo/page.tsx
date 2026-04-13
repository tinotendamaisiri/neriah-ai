'use client';

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';

// ── Brand ─────────────────────────────────────────────────────────────────────
const C = {
  teal:    '#0D7377',
  tealMd:  '#0D9488',
  tealDk:  '#0F766E',
  teal50:  '#E1F5EE',
  teal100: '#9FE1CB',
  tealLt:  '#F0FDFA',
  teal300: '#3AAFA9',
  amber:   '#F5A623',
  amber50: '#FFF3E0',
  amber100:'#FAC775',
  amber500:'#D4880B',
  amber700:'#854F0B',
  amberLt: '#FFFBEB',
  green:   '#16A34A',
  greenLt: '#F0FDF4',
  red:     '#E74C3C',
  redLt:   '#FEF2F2',
  g50:     '#FAFAFA',
  g100:    '#F3F4F6',
  g200:    '#E8E8E8',
  g400:    '#9CA3AF',
  g500:    '#6B6B6B',
  g700:    '#374151',
  g900:    '#2C2C2A',
  text:    '#2C2C2A',
  white:   '#FFFFFF',
  bg:      '#FAFAFA',
  border:  '#E8E8E8',
};

// ── Demo API ──────────────────────────────────────────────────────────────────
export const DEMO_API = 'https://us-central1-neriah-ai-492302.cloudfunctions.net/neriah-grading/api';

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
type TScreen = 'welcome' | 'phone' | 'otp' | 'register' | 'classes' | 'add-homework' | 'review-scheme' | 'homework-created' | 'homework-detail' | 'grade-all';

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
type SStudentScreen = 's-register' | 's-home' | 's-submit' | 's-success' | 's-results' | 's-feedback' | 's-tutor';

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

// ── Shared: screen scroll wrapper ─────────────────────────────────────────────
function Screen({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      overflowX: 'hidden',
      background: C.white,
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── Shared: phone number input row ─────────────────────────────────────────────
function PhoneInputRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        border: `1px solid ${C.g200}`, borderRight: 'none',
        borderRadius: '10px 0 0 10px', paddingInline: 12, paddingBlock: 14,
        background: C.g50, minWidth: 88, whiteSpace: 'nowrap',
      }}>
        <span style={{ fontSize: 16 }}>🇿🇼</span>
        <span style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>+263</span>
        <span style={{ fontSize: 11, color: C.g500 }}>▾</span>
      </div>
      <input
        type="tel"
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
        placeholder="77 123 4567"
        style={{
          flex: 1, border: `1px solid ${C.g200}`, borderRadius: '0 10px 10px 0',
          padding: '14px 12px', fontSize: 15, color: C.text, outline: 'none',
          fontFamily: 'inherit',
        }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Welcome / Role Select
// ──────────────────────────────────────────────────────────────────────────────
function WelcomeScreen({ onTeacher, onSignIn }: { onTeacher: () => void; onSignIn: () => void }) {
  return (
    <Screen style={{ justifyContent: 'center', padding: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 36 }}>
        <div style={{
          width: 80, height: 80, borderRadius: 20, overflow: 'hidden', marginBottom: 12,
          background: C.teal50, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Image
            src="/images/logo/logo-dark-brackground.png"
            alt="Neriah"
            width={80} height={80}
            style={{ objectFit: 'contain', width: '100%', height: '100%' }}
          />
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.text, textAlign: 'center' }}>
          Welcome to Neriah
        </div>
      </div>

      {/* Role cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Teacher */}
        <button
          onClick={onTeacher}
          style={{
            background: C.teal, border: 'none', borderRadius: 16, padding: '24px 20px',
            cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 8, minHeight: 130, justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(13,115,119,0.30)', transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.92')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          <span style={{ fontSize: 36 }}>💼</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: C.white }}>I'm a Teacher</span>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 1.4 }}>
            Mark exercise books with AI
          </span>
        </button>

        {/* Student */}
        <button
          style={{
            background: C.amber, border: 'none', borderRadius: 16, padding: '24px 20px',
            cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 8, minHeight: 130, justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(245,166,35,0.30)', transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.92')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          <span style={{ fontSize: 36 }}>🎓</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: C.white }}>I'm a Student</span>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 1.4 }}>
            Submit work and get feedback
          </span>
        </button>
      </div>

      {/* Sign in link */}
      <div style={{ marginTop: 32, textAlign: 'center', fontSize: 14, color: C.g500 }}>
        Already have an account?{' '}
        <button
          onClick={onSignIn}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.teal, fontWeight: 600, fontSize: 14, padding: 0 }}
        >
          Sign in
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
}: { onContinue: (phone: string) => void; onRegister: () => void }) {
  const [number, setNumber] = useState('');

  return (
    <Screen style={{ justifyContent: 'center', padding: 20 }}>
      {/* Branding */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 40 }}>
        <div style={{
          width: 80, height: 80, borderRadius: 20, overflow: 'hidden', marginBottom: 12,
          background: C.teal50, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Image
            src="/images/logo/logo-dark-brackground.png"
            alt="Neriah"
            width={80} height={80}
            style={{ objectFit: 'contain', width: '100%', height: '100%' }}
          />
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.g900 }}>Neriah</div>
        <div style={{ fontSize: 13, color: C.g500, marginTop: 4, textAlign: 'center', lineHeight: 1.4 }}>
          AI homework marking for African schools
        </div>
      </div>

      {/* Form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.g900, marginTop: 8 }}>Phone number</div>
        <PhoneInputRow value={number} onChange={setNumber} />

        <button
          onClick={() => onContinue('+263' + number)}
          disabled={number.length < 7}
          style={{
            marginTop: 20, background: number.length >= 7 ? C.teal : C.teal100,
            border: 'none', borderRadius: 10, padding: 16, cursor: number.length >= 7 ? 'pointer' : 'not-allowed',
            color: C.white, fontWeight: 700, fontSize: 16, fontFamily: 'inherit', transition: 'background 0.15s',
          }}
        >
          Continue
        </button>
      </div>

      <div style={{ marginTop: 36, textAlign: 'center', fontSize: 12, color: C.g500, lineHeight: 1.6 }}>
        By continuing you agree to Neriah's terms of service.{'\n'}Standard SMS rates may apply.
      </div>

      <button
        onClick={onRegister}
        style={{ marginTop: 14, background: 'none', border: 'none', cursor: 'pointer', color: C.teal, fontWeight: 600, fontSize: 14, fontFamily: 'inherit' }}
      >
        New user? Register here
      </button>
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: OTP
// ──────────────────────────────────────────────────────────────────────────────
function OTPScreen({ phone, onVerify, onBack }: { phone: string; onVerify: () => void; onBack: () => void }) {
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(60);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 300); }, []);
  useEffect(() => { if (cooldown <= 0) return; const t = setTimeout(() => setCooldown(s => s - 1), 1000); return () => clearTimeout(t); }, [cooldown]);
  useEffect(() => { if (otp.length === 6) onVerify(); }, [otp]);

  const masked = phone.replace(/(\+\d{4})\d+(\d{3})/, '$1 *** ***$2');

  return (
    <Screen style={{ padding: 20, paddingTop: 28 }}>
      <button
        onClick={onBack}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g500, fontSize: 16, textAlign: 'left', marginBottom: 28, fontFamily: 'inherit', padding: 0 }}
      >
        ← Back
      </button>

      <div style={{ fontSize: 26, fontWeight: 800, color: C.text, marginBottom: 8 }}>Enter your code</div>
      <div style={{ fontSize: 14, color: C.g500, lineHeight: 1.6, marginBottom: 28 }}>
        We sent a 6-digit code to{'\n'}
        <span style={{ color: C.text, fontWeight: 600 }}>{masked}</span>
      </div>

      {/* OTP input */}
      <input
        ref={inputRef}
        type="tel"
        inputMode="numeric"
        maxLength={6}
        value={otp}
        onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="——————"
        style={{
          fontSize: 32, fontWeight: 800, letterSpacing: 12, textAlign: 'center',
          border: `2px solid ${C.teal}`, borderRadius: 12, padding: '14px 12px',
          marginBottom: 20, color: C.text, outline: 'none', width: '100%',
          boxSizing: 'border-box', fontFamily: 'monospace', background: C.white,
        }}
      />

      <button
        onClick={onVerify}
        disabled={otp.length < 6}
        style={{
          background: otp.length === 6 ? C.teal : C.teal100,
          border: 'none', borderRadius: 10, padding: 16, cursor: otp.length === 6 ? 'pointer' : 'not-allowed',
          color: C.white, fontWeight: 700, fontSize: 16, fontFamily: 'inherit', marginBottom: 14,
        }}
      >
        Verify
      </button>

      <button
        disabled={cooldown > 0}
        style={{
          background: 'none', border: 'none', cursor: cooldown > 0 ? 'not-allowed' : 'pointer',
          color: cooldown > 0 ? C.g400 : C.teal, fontWeight: 600, fontSize: 15,
          fontFamily: 'inherit', padding: 6,
        }}
      >
        {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
      </button>

      {cooldown <= 0 && (
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g500, fontSize: 13, fontFamily: 'inherit', padding: '4px 0' }}>
          Send via SMS instead
        </button>
      )}
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Teacher Register
// ──────────────────────────────────────────────────────────────────────────────
const TITLES = ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr', 'Prof', 'Sir', 'Eng', 'Rev'];

function RegisterScreen({ onSignIn, onContinue }: { onSignIn: () => void; onContinue: (phone: string) => void }) {
  const [title, setTitle] = useState('');
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [number, setNumber] = useState('');
  const [school, setSchool] = useState('');

  const inputStyle: React.CSSProperties = {
    border: `1px solid ${C.g200}`, borderRadius: 10, padding: '12px 14px',
    fontSize: 15, color: C.text, outline: 'none', width: '100%', boxSizing: 'border-box',
    fontFamily: 'inherit', background: C.white,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 14, fontWeight: 600, color: C.g900, marginTop: 10, marginBottom: 4, display: 'block',
  };

  return (
    <Screen style={{ padding: 20, paddingTop: 28 }}>
      <button
        onClick={onSignIn}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g500, fontSize: 16, textAlign: 'left', marginBottom: 20, fontFamily: 'inherit', padding: 0 }}
      >
        ← Back
      </button>

      {/* Icon badge */}
      <div style={{
        width: 64, height: 64, borderRadius: 18, background: C.teal50,
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
      }}>
        <span style={{ fontSize: 30 }}>📋</span>
      </div>

      <div style={{ fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 4 }}>Create teacher account</div>
      <div style={{ fontSize: 13, color: C.g500, marginBottom: 24, lineHeight: 1.5 }}>Enter your details to get started.</div>

      {/* Title chips */}
      <label style={labelStyle}>
        Title <span style={{ fontWeight: 400, color: C.g500 }}>(optional)</span>
      </label>
      <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBlock: 4, paddingBottom: 6 }}>
        {TITLES.map(t => (
          <button
            key={t}
            onClick={() => setTitle(prev => prev === t ? '' : t)}
            style={{
              flexShrink: 0, paddingInline: 13, paddingBlock: 7, borderRadius: 20,
              border: `1.5px solid ${title === t ? C.teal : C.g200}`,
              background: title === t ? C.teal : C.white,
              color: title === t ? C.white : C.g900,
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.12s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* First name */}
      <label style={labelStyle}>First name</label>
      <input
        type="text"
        placeholder="e.g. Tendai"
        value={firstName}
        onChange={e => setFirstName(e.target.value)}
        style={inputStyle}
      />

      {/* Surname */}
      <label style={labelStyle}>Surname</label>
      <input
        type="text"
        placeholder="e.g. Moyo"
        value={surname}
        onChange={e => setSurname(e.target.value)}
        style={inputStyle}
      />

      {/* Phone */}
      <label style={labelStyle}>Phone number</label>
      <PhoneInputRow value={number} onChange={setNumber} />

      {/* School */}
      <label style={labelStyle}>School</label>
      <button
        onClick={() => setSchool(prev => prev ? '' : 'Harare High School')}
        style={{
          width: '100%', border: `1px solid ${C.g200}`, borderRadius: 10, padding: '12px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: C.white, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 15, color: school ? C.text : C.g500 }}>
          {school || 'Select your school'}
        </span>
        <span style={{ fontSize: 13, color: C.g500 }}>▾</span>
      </button>

      {/* Create account button */}
      <button
        onClick={() => onContinue('+263' + number)}
        style={{
          marginTop: 22, background: C.teal, border: 'none', borderRadius: 10, padding: 16,
          cursor: 'pointer', color: C.white, fontWeight: 700, fontSize: 16, fontFamily: 'inherit',
          width: '100%', boxSizing: 'border-box',
        }}
      >
        Create account
      </button>

      <button
        onClick={onSignIn}
        style={{ marginTop: 20, background: 'none', border: 'none', cursor: 'pointer', color: C.teal, fontWeight: 600, fontSize: 14, fontFamily: 'inherit', padding: 4 }}
      >
        Already have an account? Sign in
      </button>

      <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12, color: C.g500, lineHeight: 1.6, paddingBottom: 24 }}>
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
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  // Hidden file inputs
  const cameraRef  = useRef<HTMLInputElement>(null);
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
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const base64 = dataUrl.split(',')[1];
      const mimeType = file.type || 'application/octet-stream';
      setQpFile({ name: file.name, mimeType, label, base64 });
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

  function clearQP() { setQpFile(null); setQpText(''); setTextMode(false); setTextDraft(''); }

  // ── Create & Generate ───────────────────────────────────────────────────────
  async function handleCreate() {
    setError('');
    if (!title.trim()) { setError('Please enter a homework title.'); return; }
    if (!subject.trim()) { setError('Please select a subject.'); return; }
    if (!qpFile && !qpText) { setError('Please upload the homework paper.'); return; }

    setLoading(true);
    try {
      const body: Record<string, string> = {
        class_id:        'demo',
        title:           title.trim(),
        subject:         subject.trim(),
        education_level: 'Form 2',
        status:          'draft',
        input_type:      'question_paper',
      };
      if (qpFile) {
        body.file_data  = qpFile.base64;
        body.media_type = qpFile.mimeType;
      } else {
        body.text = qpText;
      }

      const res = await demoFetch('/homework/generate-scheme', {
        method: 'POST',
        body: JSON.stringify(body),
      }, demoToken);

      const questions: ReviewQuestion[] = res?.questions
        ? (res.questions as any[]).map((q: any, i: number) => normaliseQ(q, i))
        : DEMO_QUESTIONS;
      const answer_key_id: string = res?.answer_key_id ?? 'demo-key';
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
    border: `1px solid ${C.g200}`, borderRadius: 10, padding: '11px 13px',
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
      <div style={{ flex: 1, padding: '20px 18px', paddingBottom: 24 }}>
        {/* Back */}
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g500, fontSize: 15, textAlign: 'left', marginBottom: 16, fontFamily: 'inherit', padding: 0 }}
        >
          ← Back
        </button>

        <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 4 }}>Add Homework</div>
        <div style={{ fontSize: 13, color: C.g500, marginBottom: 20, lineHeight: 1.5 }}>
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

        {/* ── HOMEWORK PAPER section ────────────────────────────────────────── */}
        <div style={{
          marginTop: 20, marginBottom: 6,
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
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { icon: '📷', label: 'Camera',  onClick: () => cameraRef.current?.click() },
              { icon: '🖼',  label: 'Gallery', onClick: () => galleryRef.current?.click() },
              { icon: '📄', label: 'PDF',     onClick: () => pdfRef.current?.click() },
              { icon: '📝', label: 'Word',    onClick: () => wordRef.current?.click() },
              { icon: '✏️',  label: 'Text',    onClick: () => { setTextDraft(qpText); setTextMode(true); } },
            ].map(btn => (
              <button
                key={btn.label}
                onClick={btn.onClick}
                style={{
                  flex: 1, border: `1px solid ${C.g200}`, borderRadius: 10,
                  padding: '10px 4px', background: C.white, cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  fontFamily: 'inherit', transition: 'border-color 0.12s, background 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.background = C.teal50; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.g200; e.currentTarget.style.background = C.white; }}
              >
                <span style={{ fontSize: 18 }}>{btn.icon}</span>
                <span style={{ fontSize: 10, color: C.g700, fontWeight: 600 }}>{btn.label}</span>
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
          <div style={{
            marginTop: 8, display: 'flex', alignItems: 'center', gap: 8,
            background: C.teal50, border: `1px solid ${C.teal100}`, borderRadius: 10,
            padding: '9px 12px',
          }}>
            <span style={{ color: C.teal, fontWeight: 700, fontSize: 13 }}>✓</span>
            <span style={{ flex: 1, fontSize: 12, color: C.teal, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {qpFile ? qpFile.label : `✏️ ${qpText.length} chars of text`}
            </span>
            <button
              onClick={clearQP}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g500, fontSize: 14, padding: '0 2px', fontFamily: 'inherit' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.red, fontWeight: 600 }}>{error}</div>
        )}

        {/* Create & Generate button */}
        <button
          onClick={handleCreate}
          disabled={loading}
          style={{
            marginTop: 22, width: '100%', background: loading ? C.teal100 : C.teal,
            border: 'none', borderRadius: 10, padding: '14px 0',
            cursor: loading ? 'not-allowed' : 'pointer', color: C.white,
            fontWeight: 700, fontSize: 15, fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxSizing: 'border-box', transition: 'background 0.15s',
          }}
        >
          {loading ? (
            <>
              <span style={{ fontSize: 16 }}>✨</span>
              <span>Generating marking scheme{dots}</span>
            </>
          ) : (
            <span>Create &amp; Generate Answers</span>
          )}
        </button>
      </div>

      {/* Hidden file inputs */}
      <input ref={cameraRef}  type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => handleFileInput(e, '📷')} />
      <input ref={galleryRef} type="file" accept="image/*"                       style={{ display: 'none' }} onChange={e => handleFileInput(e, '🖼')} />
      <input ref={pdfRef}     type="file" accept=".pdf,application/pdf"          style={{ display: 'none' }} onChange={e => handleFileInput(e, '📄')} />
      <input ref={wordRef}    type="file" accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display: 'none' }} onChange={e => handleFileInput(e, '📝')} />
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
        {/* Back */}
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g500, fontSize: 15, textAlign: 'left', marginBottom: 14, fontFamily: 'inherit', padding: 0 }}
        >
          ← Back
        </button>

        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 4 }}>Review Marking Scheme</div>
        <div style={{ fontSize: 12, color: C.g500, marginBottom: 16, lineHeight: 1.5 }}>
          Check each answer. Edit anything that looks wrong, then confirm.
        </div>

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
          {regen ? '✨ Regenerating…' : '↻ Regenerate'}
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
        background: '#E6F4EA',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 22,
      }}>
        <svg width={40} height={40} viewBox="0 0 40 40" fill="none">
          <path d="M8 21l8 8L32 12" stroke="#2E7D32" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
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

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: My Classes
// ──────────────────────────────────────────────────────────────────────────────
function ClassesScreen({ onAddHomework, onOpenHomework }: { onAddHomework: () => void; onOpenHomework: () => void }) {
  const [fabOpen, setFabOpen] = useState(false);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg, position: 'relative' }}>
      {/* Header */}
      <div style={{
        background: C.white, paddingInline: 18, paddingTop: 16, paddingBottom: 14,
        borderBottom: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        <div style={{ fontSize: 12, color: C.g500 }}>Hello,</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginTop: 2 }}>My Classes</div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, paddingBottom: 80 }}>
        {/* Class group */}
        <div style={{ marginBottom: 18 }}>
          {/* Class card */}
          <div style={{
            background: C.white, borderRadius: 12, marginBottom: 0,
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: C.text }}>Form 2A</div>
                <div style={{ fontSize: 12, color: C.g500, marginTop: 2 }}>Form 2</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ textAlign: 'center', minWidth: 40 }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: C.teal }}>3</div>
                  <div style={{ fontSize: 10, color: C.g500 }}>students</div>
                </div>
                <div style={{ width: 1, height: 28, background: C.border }} />
                <div style={{ textAlign: 'center', minWidth: 40 }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: C.teal }}>1</div>
                  <div style={{ fontSize: 10, color: C.g500 }}>homework</div>
                </div>
              </div>
            </div>
          </div>

          {/* Homework under this class */}
          <div style={{ marginTop: 4, marginLeft: 12, borderLeft: `2px solid ${C.teal100}`, paddingLeft: 10 }}>
            {/* Homework card — tappable */}
            <button
              onClick={onOpenHomework}
              style={{
                width: '100%', background: C.white, borderRadius: 10, marginBottom: 6, padding: '11px 12px',
                display: 'flex', alignItems: 'center', gap: 8, border: 'none', cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)', fontFamily: 'inherit', textAlign: 'left',
                transition: 'box-shadow 0.12s',
              }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(13,115,119,0.14)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)')}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Chapter 5 Maths Test</div>
                <div style={{ fontSize: 11, color: C.g500, marginTop: 2 }}>Created 12 Apr 2026</div>
                <div style={{ fontSize: 11, color: C.teal, marginTop: 3, fontWeight: 600 }}>2 submissions</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  background: C.teal50, borderRadius: 8, paddingInline: 7, paddingBlock: 5,
                  fontSize: 10, color: C.teal, fontWeight: 700, textAlign: 'center', lineHeight: 1.3,
                }}>
                  Ready to{'\n'}Grade
                </div>
                <span style={{ fontSize: 18, color: C.g400 }}>›</span>
              </div>
            </button>

            {/* Add homework */}
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

        {/* Empty-state second class hint */}
        <button
          style={{
            width: '100%', border: `1.5px dashed ${C.teal300}`, borderRadius: 12,
            padding: '18px 16px', background: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit',
          }}
          onClick={() => setFabOpen(true)}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ background: C.g900, color: C.white, fontSize: 12, fontWeight: 600, paddingInline: 9, paddingBlock: 5, borderRadius: 7 }}>New Class</div>
            <div style={{
              width: 40, height: 40, borderRadius: 20, background: C.teal,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 3px 8px rgba(13,115,119,0.4)',
            }}>
              <span style={{ fontSize: 16, color: C.white }}>👥</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => { setFabOpen(false); onAddHomework(); }}>
            <div style={{ background: C.g900, color: C.white, fontSize: 12, fontWeight: 600, paddingInline: 9, paddingBlock: 5, borderRadius: 7, cursor: 'pointer' }}>Add Homework</div>
            <div style={{
              width: 40, height: 40, borderRadius: 20, background: C.teal, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 3px 8px rgba(13,115,119,0.4)',
            }}>
              <span style={{ fontSize: 16, color: C.white }}>📖</span>
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
          background: fabOpen ? '#085041' : C.teal, border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(13,115,119,0.45)', transition: 'background 0.15s',
          fontSize: 26, color: C.white, fontFamily: 'inherit',
        }}
      >
        {fabOpen ? '✕' : '+'}
      </button>

      {/* Bottom tab bar */}
      <div style={{
        height: 50, background: C.white, borderTop: `1px solid ${C.border}`,
        display: 'flex', flexShrink: 0,
      }}>
        {[
          { icon: '🏠', label: 'Classes', active: true },
          { icon: '📊', label: 'Analytics', active: false },
          { icon: '⚙️', label: 'Settings', active: false },
        ].map(tab => (
          <div
            key={tab.label}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 2, cursor: 'pointer',
              borderTop: tab.active ? `2px solid ${C.teal}` : '2px solid transparent',
            }}
          >
            <span style={{ fontSize: 16 }}>{tab.icon}</span>
            <span style={{ fontSize: 10, fontWeight: tab.active ? 700 : 400, color: tab.active ? C.teal : C.g500 }}>
              {tab.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SCREEN: Homework Detail
// ──────────────────────────────────────────────────────────────────────────────
function HomeworkDetailScreen({
  hw, isOpen, onToggleOpen, onBack, onGradeAll, demoToken,
}: {
  hw: HomeworkInfo;
  isOpen: boolean;
  onToggleOpen: (next: boolean) => void;
  onBack: () => void;
  onGradeAll: () => void;
  demoToken: string | null;
}) {
  const [toggling, setToggling] = useState(false);

  async function handleToggle() {
    setToggling(true);
    const next = !isOpen;
    try {
      await demoFetch(`/answer-keys/${hw.answer_key_id}`, {
        method: 'PUT',
        body: JSON.stringify({ open_for_submission: next }),
      }, demoToken);
    } catch { /* proceed */ }
    onToggleOpen(next);
    setToggling(false);
  }

  const badgeBase: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, paddingInline: 9, paddingBlock: 4,
    borderRadius: 20, display: 'inline-block',
  };

  const DEMO_STUDENTS = ['Tendai Moyo', 'Chipo Dube'];

  return (
    <Screen style={{ background: C.bg }}>
      <div style={{ flex: 1, padding: '18px 16px', paddingBottom: 24 }}>

        {/* Back */}
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g500, fontSize: 15, textAlign: 'left', marginBottom: 14, fontFamily: 'inherit', padding: 0 }}
        >
          ← Back
        </button>

        {/* Header card */}
        <div style={{ background: C.white, borderRadius: 14, padding: '14px 16px', marginBottom: 12, border: `1px solid ${C.border}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text, marginBottom: 10, lineHeight: 1.3 }}>{hw.title}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ ...badgeBase, background: C.teal50, color: C.teal }}>{hw.subject}</span>
            <span style={{ ...badgeBase, background: C.amber50, color: C.amber700 }}>{hw.education_level}</span>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[
            { icon: '❓', value: hw.question_count,   label: 'Questions' },
            { icon: '⭐', value: hw.total_marks,       label: 'Total marks' },
            { icon: '📬', value: hw.submission_count,  label: 'Submissions' },
          ].map(s => (
            <div key={s.label} style={{
              flex: 1, background: C.white, border: `1px solid ${C.border}`, borderRadius: 12,
              padding: '10px 8px', textAlign: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              <div style={{ fontSize: 16 }}>{s.icon}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.teal, marginTop: 3 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: C.g500, marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Accepting submissions toggle */}
        <div style={{
          background: C.white, borderRadius: 12, padding: '13px 16px', marginBottom: 12,
          border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Accepting Submissions</div>
            <div style={{ fontSize: 12, color: isOpen ? C.teal : C.g500, marginTop: 2, fontWeight: isOpen ? 600 : 400 }}>
              {isOpen ? 'Students can submit their work' : 'Submissions are closed'}
            </div>
          </div>
          {/* Toggle switch */}
          <button
            onClick={handleToggle}
            disabled={toggling}
            aria-label={isOpen ? 'Close submissions' : 'Open submissions'}
            style={{
              flexShrink: 0, width: 48, height: 26, borderRadius: 13,
              background: isOpen ? C.teal : C.g200, border: 'none', cursor: toggling ? 'not-allowed' : 'pointer',
              position: 'relative', transition: 'background 0.2s', padding: 0,
            }}
          >
            <div style={{
              position: 'absolute', top: 3,
              left: isOpen ? 25 : 3,
              width: 20, height: 20, borderRadius: 10,
              background: C.white, transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            }} />
          </button>
        </div>

        {/* Submission list */}
        <div style={{
          background: C.white, borderRadius: 12, border: `1px solid ${C.border}`,
          overflow: 'hidden', marginBottom: 18,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            padding: '11px 16px', borderBottom: `1px solid ${C.border}`,
            fontSize: 13, fontWeight: 700, color: C.g700,
          }}>
            Submissions ({hw.submission_count})
          </div>
          {DEMO_STUDENTS.map((name, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', padding: '10px 16px', gap: 10,
                borderBottom: i < DEMO_STUDENTS.length - 1 ? `1px solid ${C.g100}` : 'none',
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 16, background: C.teal50,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: C.teal, flexShrink: 0,
              }}>
                {name.charAt(0)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{name}</div>
                <div style={{ fontSize: 11, color: C.g500, marginTop: 1 }}>Submitted · Awaiting grade</div>
              </div>
              <div style={{
                background: C.amber50, color: C.amber700,
                fontSize: 10, fontWeight: 700, paddingInline: 7, paddingBlock: 4, borderRadius: 6,
              }}>
                Pending
              </div>
            </div>
          ))}
        </div>

        {/* Grade All */}
        <button
          onClick={onGradeAll}
          style={{
            width: '100%', background: C.teal, border: 'none', borderRadius: 10, padding: '15px 0',
            cursor: 'pointer', color: C.white, fontWeight: 700, fontSize: 15, fontFamily: 'inherit',
            boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            boxShadow: '0 4px 14px rgba(13,115,119,0.30)', transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.92')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          <span>✨ Grade All with AI</span>
          <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.8 }}>Powered by Gemma 4</span>
        </button>
      </div>
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

        {/* Back */}
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g500, fontSize: 15, textAlign: 'left', marginBottom: 14, fontFamily: 'inherit', padding: 0 }}
        >
          ← Back
        </button>

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
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
            }}>✨</div>
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
                ✨ Grading student {revealed} of {allGrades.length}…
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
                        {g.percentage >= 70 ? '🟢 Pass' : g.percentage >= 50 ? '🟡 Borderline' : '🔴 Needs support'}
                      </div>
                    </div>
                  </div>
                  <div style={{
                    background: scoreBg(g.percentage), borderRadius: 10, padding: '6px 10px',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: scoreColor(g.percentage), lineHeight: 1 }}>
                      {g.score}/{g.max_score}
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: scoreColor(g.percentage), marginTop: 2 }}>
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
                      <span style={{ fontSize: 10, fontWeight: 700, color: verdictColor(v.verdict) }}>
                        Q{v.question_number}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: verdictColor(v.verdict) }}>
                        {verdictIcon(v.verdict)}
                      </span>
                      <span style={{ fontSize: 9, color: verdictColor(v.verdict), fontWeight: 600 }}>
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
  const [joinCode, setJoinCode]   = useState('NR2A01');
  const [firstName, setFirstName] = useState('Chipo');
  const [surname, setSurname]     = useState('Dube');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  async function handleJoin() {
    if (!joinCode.trim() || !firstName.trim() || !surname.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await demoFetch('/auth/student/lookup', {
        method: 'POST',
        body: JSON.stringify({ join_code: joinCode.trim().toUpperCase() }),
      });
    } catch { /* proceed on error — demo fallback */ }
    setLoading(false);
    onJoined(`${firstName.trim()} ${surname.trim()}`);
  }

  const inp: React.CSSProperties = {
    border: `1px solid ${C.g200}`, borderRadius: 10, padding: '12px 14px',
    fontSize: 15, color: C.text, outline: 'none', width: '100%',
    boxSizing: 'border-box', fontFamily: 'inherit', background: C.white,
  };
  const lbl: React.CSSProperties = {
    fontSize: 13, fontWeight: 700, color: C.g900, marginTop: 14, marginBottom: 5, display: 'block',
  };

  return (
    <Screen style={{ padding: '24px 20px' }}>
      <div style={{ width: 60, height: 60, borderRadius: 18, background: C.amber50, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 28 }}>🎓</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 4 }}>Join a Class</div>
      <div style={{ fontSize: 13, color: C.g500, marginBottom: 22, lineHeight: 1.5 }}>
        Enter the code your teacher gave you to get started.
      </div>

      <label style={lbl}>Class Join Code</label>
      <input
        type="text"
        value={joinCode}
        onChange={e => setJoinCode(e.target.value.toUpperCase())}
        maxLength={10}
        placeholder="e.g. NR2A01"
        style={{ ...inp, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'center', fontWeight: 800, fontSize: 20, border: `2px solid ${C.amber}` }}
      />

      <div style={{ display: 'flex', gap: 10, marginTop: 0 }}>
        <div style={{ flex: 1 }}>
          <label style={lbl}>First Name</label>
          <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Chipo" style={inp} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Surname</label>
          <input type="text" value={surname} onChange={e => setSurname(e.target.value)} placeholder="Dube" style={inp} />
        </div>
      </div>

      {error && <div style={{ marginTop: 10, fontSize: 12, color: C.red, fontWeight: 600 }}>{error}</div>}

      <button
        onClick={handleJoin}
        disabled={loading}
        style={{
          marginTop: 22, width: '100%', background: loading ? C.amber100 : C.amber,
          border: 'none', borderRadius: 10, padding: '15px 0',
          cursor: loading ? 'not-allowed' : 'pointer', color: C.white,
          fontWeight: 700, fontSize: 16, fontFamily: 'inherit', boxSizing: 'border-box', transition: 'background 0.15s',
        }}
      >
        {loading ? 'Joining…' : 'Join Class →'}
      </button>

      <div style={{ marginTop: 16, textAlign: 'center', fontSize: 12, color: C.g500 }}>
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
  studentName, submissionsOpen, onSubmit, onResults, onTutor,
}: { studentName: string; submissionsOpen: boolean; onSubmit: () => void; onResults: () => void; onTutor: () => void }) {
  const firstName = studentName.split(' ')[0];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg }}>
      {/* Header */}
      <div style={{ background: C.white, paddingInline: 18, paddingTop: 16, paddingBottom: 14, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: C.g500 }}>Hello,</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginTop: 2 }}>{firstName} 👋</div>
        <div style={{ fontSize: 11, color: C.g500, marginTop: 3 }}>Form 2A · Harare High School</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14, paddingBottom: 70 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.g500, letterSpacing: '0.06em', marginBottom: 10, textTransform: 'uppercase' }}>
          My Homework
        </div>

        {/* Homework card */}
        <div style={{ background: C.white, borderRadius: 14, border: `1px solid ${C.border}`, overflow: 'hidden', marginBottom: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ padding: '13px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ flex: 1, paddingRight: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>Chapter 5 Maths Test</div>
                <div style={{ fontSize: 11, color: C.g500, marginTop: 3 }}>Mathematics · Form 2</div>
              </div>
              <div style={{
                background: submissionsOpen ? C.greenLt : C.redLt,
                color: submissionsOpen ? C.green : C.red,
                fontSize: 10, fontWeight: 700, paddingInline: 8, paddingBlock: 4, borderRadius: 20,
                flexShrink: 0, whiteSpace: 'nowrap', transition: 'background 0.3s, color 0.3s',
              }}>
                {submissionsOpen ? '● Open' : '● Closed'}
              </div>
            </div>

            {submissionsOpen ? (
              <button
                onClick={onSubmit}
                style={{
                  width: '100%', background: C.amber, border: 'none', borderRadius: 8, padding: '10px 0',
                  cursor: 'pointer', color: C.white, fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  boxShadow: '0 2px 8px rgba(245,166,35,0.30)',
                }}
              >
                <span>📤</span><span>Submit Work</span>
              </button>
            ) : (
              <div style={{ fontSize: 12, color: C.g500, fontStyle: 'italic', paddingTop: 2 }}>
                Submissions closed by your teacher.
              </div>
            )}
          </div>
        </div>

        <button
          onClick={onResults}
          style={{
            width: '100%', border: `1.5px solid ${C.amber}`, borderRadius: 10, padding: '11px 0', background: 'none',
            cursor: 'pointer', color: C.amber700, fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            marginBottom: 12,
          }}
        >
          <span>📊</span><span>View My Results</span>
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
            <div style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
              🤖
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
        {[{ icon: '🏠', label: 'Home', active: true }, { icon: '📊', label: 'Results', active: false }, { icon: '⚙️', label: 'Settings', active: false }].map(tab => (
          <div
            key={tab.label}
            onClick={tab.label === 'Results' ? onResults : undefined}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, cursor: 'pointer', borderTop: tab.active ? `2px solid ${C.amber}` : '2px solid transparent' }}
          >
            <span style={{ fontSize: 16 }}>{tab.icon}</span>
            <span style={{ fontSize: 10, fontWeight: tab.active ? 700 : 400, color: tab.active ? C.amber700 : C.g500 }}>{tab.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── S3: Submit Work ───────────────────────────────────────────────────────────
function StudentSubmitScreen({
  onBack, onSubmitted, demoToken,
}: { onBack: () => void; onSubmitted: (sub: { id: string; fileName: string }) => void; demoToken: string | null }) {
  const [file, setFile]       = useState<{ name: string; mimeType: string; base64: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [dots, setDots]       = useState('');

  const cameraRef  = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const pdfRef     = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading) { setDots(''); return; }
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 450);
    return () => clearInterval(t);
  }, [loading]);

  function readFile(f: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setFile({ name: f.name, mimeType: f.type || 'application/octet-stream', base64: dataUrl.split(',')[1] });
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
      const res = await demoFetch('/submissions/student', {
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
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g500, fontSize: 15, marginBottom: 14, fontFamily: 'inherit', padding: 0 }}>
          ← Back
        </button>

        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 4 }}>Submit Work</div>
        <div style={{ fontSize: 13, color: C.g500, marginBottom: 20, lineHeight: 1.5 }}>Chapter 5 Maths Test · Mathematics</div>

        {!file && (
          <>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.g500, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
              Upload Your Work
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {([
                { icon: '📷', label: 'Camera',  ref: cameraRef },
                { icon: '🖼',  label: 'Gallery', ref: galleryRef },
                { icon: '📄', label: 'PDF',     ref: pdfRef },
              ] as const).map(btn => (
                <button
                  key={btn.label}
                  onClick={() => btn.ref.current?.click()}
                  style={btnBase}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = C.amber)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = C.g200)}
                >
                  <span style={{ fontSize: 26 }}>{btn.icon}</span>
                  <span style={{ fontSize: 11, color: C.g700, fontWeight: 600 }}>{btn.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {file && (
          <div style={{ background: C.amber50, border: `1px solid ${C.amber100}`, borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>{file.mimeType.startsWith('image') ? '🖼' : '📄'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.amber700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
              <div style={{ fontSize: 11, color: C.g500, marginTop: 2 }}>{(file.base64.length * 0.75 / 1024).toFixed(1)} KB · Ready to submit</div>
            </div>
            <button onClick={() => setFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g400, fontSize: 16, padding: 2, flexShrink: 0 }}>✕</button>
          </div>
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
          <span>📤</span>
          <span>{loading ? `Submitting${dots}` : 'Submit Work'}</span>
        </button>

        <input ref={cameraRef}  type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleInput} />
        <input ref={galleryRef} type="file" accept="image/*"                       style={{ display: 'none' }} onChange={handleInput} />
        <input ref={pdfRef}     type="file" accept=".pdf,application/pdf"          style={{ display: 'none' }} onChange={handleInput} />
      </div>
    </Screen>
  );
}

// ── S4: Submission Success ─────────────────────────────────────────────────────
function StudentSubmissionSuccessScreen({
  fileName, onViewResults, onHome,
}: { fileName: string; onViewResults: () => void; onHome: () => void }) {
  return (
    <Screen style={{ justifyContent: 'center', padding: 28, alignItems: 'center' }}>
      <div style={{ width: 80, height: 80, borderRadius: 40, background: '#E6F4EA', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <svg width={40} height={40} viewBox="0 0 40 40" fill="none">
          <path d="M8 21l8 8L32 12" stroke="#2E7D32" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 8, textAlign: 'center' }}>Submitted!</div>
      <div style={{ fontSize: 14, color: C.g500, textAlign: 'center', lineHeight: 1.6, marginBottom: 22, maxWidth: 250 }}>
        Your work has been submitted. You'll be notified as soon as it's marked.
      </div>
      <div style={{ background: C.g50, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, width: '100%', boxSizing: 'border-box' }}>
        <span style={{ fontSize: 18 }}>📄</span>
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
  const [tab, setTab] = useState<'pending' | 'graded'>('pending');

  useEffect(() => { if (gradingComplete) setTab('graded'); }, [gradingComplete]);

  const g = DEMO_STUDENT_GRADE;

  return (
    <Screen style={{ background: C.bg }}>
      <div style={{ flex: 1, padding: '18px 16px', paddingBottom: 24 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g500, fontSize: 15, marginBottom: 14, fontFamily: 'inherit', padding: 0 }}>
          ← Back
        </button>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 16 }}>My Submissions</div>

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
                <span style={{ marginLeft: 5, background: C.green, color: C.white, borderRadius: 10, paddingInline: 6, paddingBlock: 1, fontSize: 10, fontWeight: 700, verticalAlign: 'middle' }}>
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

        {/* Graded: empty until teacher grades */}
        {tab === 'graded' && !gradingComplete && (
          <div style={{ textAlign: 'center', padding: '40px 0 24px' }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>📭</div>
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
                <div style={{ fontSize: 17, fontWeight: 900, color: scoreColor(g.percentage), lineHeight: 1 }}>{g.score}/{g.max_score}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: scoreColor(g.percentage), marginTop: 2 }}>{g.percentage}%</div>
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
function StudentFeedbackScreen({ onBack }: { onBack: () => void }) {
  const g = DEMO_STUDENT_GRADE;
  const vIcon = (v: string) => v === 'correct' ? '✓' : v === 'partial' ? '½' : '✗';
  const vBg   = (v: string) => v === 'correct' ? C.greenLt : v === 'partial' ? C.amber50 : C.redLt;
  const vClr  = (v: string) => v === 'correct' ? C.green   : v === 'partial' ? C.amber500 : C.red;

  return (
    <Screen style={{ background: C.bg }}>
      <div style={{ flex: 1, padding: '18px 16px', paddingBottom: 24 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.g500, fontSize: 15, marginBottom: 14, fontFamily: 'inherit', padding: 0 }}>
          ← Back
        </button>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 2 }}>Your Results</div>
        <div style={{ fontSize: 12, color: C.g500, marginBottom: 18 }}>Chapter 5 Maths Test · Mathematics</div>

        {/* Score circle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <div style={{ width: 96, height: 96, borderRadius: 48, background: scoreBg(g.percentage), border: `4px solid ${scoreColor(g.percentage)}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 26, fontWeight: 900, color: scoreColor(g.percentage), lineHeight: 1 }}>{g.score}/{g.max_score}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: scoreColor(g.percentage), marginTop: 2 }}>{g.percentage}%</div>
          </div>
        </div>

        {/* Score bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: C.g500 }}>Score</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor(g.percentage) }}>
            {g.percentage >= 70 ? '🟢 Pass' : g.percentage >= 50 ? '🟡 Borderline' : '🔴 Needs support'}
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: C.g100, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ height: '100%', borderRadius: 4, background: scoreColor(g.percentage), width: `${g.percentage}%`, transition: 'width 1s ease' }} />
        </div>

        {/* Question breakdown */}
        <div style={{ fontSize: 13, fontWeight: 700, color: C.g700, marginBottom: 10 }}>Question Breakdown</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DEMO_QUESTIONS.map((q, idx) => {
            const v = g.verdicts[idx];
            return (
              <div key={q.question_number} style={{
                background: C.white, borderRadius: 10, padding: '11px 13px',
                border: `1px solid ${C.border}`,
                borderLeft: `3px solid ${v ? vClr(v.verdict) : C.g200}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 6, background: v ? vBg(v.verdict) : C.g100, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: v ? vClr(v.verdict) : C.g500 }}>
                      {v ? vIcon(v.verdict) : '?'}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.g700 }}>Q{q.question_number}</span>
                  </div>
                  {v && <span style={{ fontSize: 12, fontWeight: 800, color: vClr(v.verdict) }}>{v.awarded}/{v.max}</span>}
                </div>
                <div style={{ fontSize: 12, color: C.text, marginBottom: 5, lineHeight: 1.4 }}>{q.question_text}</div>
                <div style={{ fontSize: 11, color: C.g500, lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 700, color: C.g700 }}>Answer: </span>{q.answer}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}

// ── S7: AI Tutor ──────────────────────────────────────────────────────────────
function StudentTutorScreen({
  studentName, onBack, demoToken,
}: { studentName: string; onBack: () => void; demoToken: string | null }) {
  const firstName = studentName.split(' ')[0];

  const welcomeMsg: TutorMessage = {
    id:      'welcome',
    role:    'ai',
    content: `Hi ${firstName}! I'm your AI tutor powered by Gemma 4. Ask me anything about Chapter 5 Maths, or send a photo of a problem you're stuck on. 🌟`,
    ts:      Date.now(),
  };

  const [messages,  setMessages]  = useState<TutorMessage[]>([welcomeMsg]);
  const [input,     setInput]     = useState('');
  const [typing,    setTyping]    = useState(false);
  const [dotPhase,  setDotPhase]  = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileRef        = useRef<HTMLInputElement>(null);
  const demoIdxRef     = useRef(0);

  // Cycle typing dots
  useEffect(() => {
    if (!typing) return;
    const t = setInterval(() => setDotPhase(p => (p + 1) % 4), 400);
    return () => clearInterval(t);
  }, [typing]);

  // Auto-scroll on new messages or typing indicator
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  async function sendMessage(text: string, imageBase64?: string, imageMimeType?: string) {
    if (!text.trim() && !imageBase64) return;

    const userMsg: TutorMessage = {
      id:   `u-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      imageBase64,
      imageMimeType,
      ts: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setTyping(true);

    // Build last-6-message history for context
    const history = messages.slice(-6).map(m => ({ role: m.role, content: m.content }));

    let aiText: string | null = null;

    // Try real API first
    if (demoToken) {
      const res = await demoFetch('/tutor', {
        method: 'POST',
        body: JSON.stringify({
          message:         text.trim(),
          history,
          student_name:    studentName,
          subject:         'Mathematics',
          education_level: 'Form 2',
          ...(imageBase64   ? { image_data: imageBase64 }   : {}),
          ...(imageMimeType ? { media_type: imageMimeType }  : {}),
        }),
      }, demoToken);
      if (res) {
        aiText = res?.response ?? res?.message ?? res?.text ?? res?.reply ?? null;
      }
    }

    // Fallback with simulated delay
    if (!aiText) {
      await new Promise(r => setTimeout(r, 1400));
      aiText = DEMO_TUTOR_RESPONSES[demoIdxRef.current % DEMO_TUTOR_RESPONSES.length];
      demoIdxRef.current += 1;
    }

    setTyping(false);
    const aiMsg: TutorMessage = {
      id:      `a-${Date.now()}`,
      role:    'ai',
      content: aiText,
      ts:      Date.now(),
    };
    setMessages(prev => [...prev, aiMsg]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const b64     = dataUrl.split(',')[1];
      sendMessage(input || 'Can you help me with this problem?', b64, f.type || 'image/jpeg');
      setInput('');
    };
    reader.readAsDataURL(f);
  }

  const dots = ['', '.', '..', '...'][dotPhase];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg }}>
      {/* Header */}
      <div style={{ background: C.teal, paddingInline: 16, paddingTop: 14, paddingBottom: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={onBack}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: C.white, fontSize: 16, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            ←
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.white, lineHeight: 1.2 }}>AI Tutor</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', marginTop: 1 }}>
              {typing ? `Thinking${dots}` : 'Gemma 4 · Socratic mode · Chapter 5 Maths'}
            </div>
          </div>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
            🤖
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map(msg => {
          const isUser = msg.role === 'user';
          return (
            <div key={msg.id} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 6 }}>
              {!isUser && (
                <div style={{ width: 24, height: 24, borderRadius: 8, background: C.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, marginBottom: 2 }}>
                  🤖
                </div>
              )}
              <div style={{
                maxWidth: '75%',
                background: isUser ? C.amber : C.white,
                borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                padding: '9px 12px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                border: isUser ? 'none' : `1px solid ${C.border}`,
              }}>
                {msg.imageBase64 && (
                  <img
                    src={`data:${msg.imageMimeType ?? 'image/jpeg'};base64,${msg.imageBase64}`}
                    alt="uploaded"
                    style={{ width: '100%', borderRadius: 8, marginBottom: msg.content ? 8 : 0, display: 'block', maxHeight: 160, objectFit: 'cover' }}
                  />
                )}
                {msg.content && (
                  <div style={{ fontSize: 13, color: isUser ? C.white : C.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {msg.content}
                  </div>
                )}
              </div>
              {isUser && (
                <div style={{ width: 24, height: 24, borderRadius: 8, background: C.amber100, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, marginBottom: 2, fontWeight: 800, color: C.amber700 }}>
                  {firstName[0]}
                </div>
              )}
            </div>
          );
        })}

        {/* Typing indicator */}
        {typing && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ width: 24, height: 24, borderRadius: 8, background: C.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, marginBottom: 2 }}>
              🤖
            </div>
            <div style={{
              background: C.white, borderRadius: '14px 14px 14px 4px', padding: '10px 14px',
              border: `1px solid ${C.border}`, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              display: 'flex', gap: 5, alignItems: 'center',
            }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 7, height: 7, borderRadius: '50%', background: C.teal,
                  opacity: dotPhase === i + 1 ? 1 : 0.3,
                  transform: `scale(${dotPhase === i + 1 ? 1.25 : 1})`,
                  transition: 'opacity 0.2s, transform 0.2s',
                }} />
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: '10px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Camera button */}
          <button
            onClick={() => fileRef.current?.click()}
            style={{ width: 36, height: 36, borderRadius: 10, background: C.g100, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}
            title="Send a photo"
          >
            📷
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {/* Text input */}
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything…"
            disabled={typing}
            style={{
              flex: 1, border: `1.5px solid ${input.trim() ? C.teal : C.g200}`, borderRadius: 20,
              padding: '9px 14px', fontSize: 13, color: C.text, outline: 'none',
              fontFamily: 'inherit', background: C.white, transition: 'border-color 0.15s',
            }}
          />

          {/* Send button */}
          <button
            onClick={() => sendMessage(input)}
            disabled={typing || !input.trim()}
            style={{
              width: 36, height: 36, borderRadius: 10, border: 'none', cursor: (typing || !input.trim()) ? 'default' : 'pointer',
              background: (typing || !input.trim()) ? C.g100 : C.amber,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              transition: 'background 0.15s', boxShadow: (typing || !input.trim()) ? 'none' : '0 2px 8px rgba(245,166,35,0.35)',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke={(typing || !input.trim()) ? C.g400 : C.white} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div style={{ marginTop: 7, fontSize: 10, color: C.g400, textAlign: 'center' }}>
          Socratic AI — guides you to the answer, doesn't give it away
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PHONE FRAME
// ──────────────────────────────────────────────────────────────────────────────
interface PhoneFrameProps { label: string; labelColor?: string; children: React.ReactNode }

function PhoneFrame({ label, labelColor = C.teal, children }: PhoneFrameProps) {
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
        width: 320, height: 640, borderRadius: 44, border: `3px solid ${C.g200}`,
        background: C.white, boxShadow: '0 8px 40px rgba(13,115,119,0.10), 0 2px 8px rgba(0,0,0,0.07)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
      }}>
        {/* Status bar */}
        <div style={{ height: 36, background: C.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ width: 80, height: 10, borderRadius: 6, background: 'rgba(255,255,255,0.25)' }} />
        </div>
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
// PAGE
// ──────────────────────────────────────────────────────────────────────────────
export default function DemoPage() {
  const [screen, setScreen]         = useState<TScreen>('welcome');
  const [prevScreen, setPrevScreen] = useState<TScreen>('welcome');
  const [otpPhone, setOtpPhone]     = useState('+263771234567');
  const [demoToken, setDemoToken]   = useState<string | null>(null);
  const [schemeData, setSchemeData] = useState<{ answer_key_id: string; questions: ReviewQuestion[] } | null>(null);
  const [hwInfo, setHwInfo]         = useState<HomeworkInfo>(DEMO_HOMEWORK);

  // ── Shared real-time state (lifted so both phones react instantly) ──────────
  const [submissionsOpen, setSubmissionsOpen]   = useState(true);
  const [gradingComplete, setGradingComplete]   = useState(false);
  const [syncPulse, setSyncPulse]               = useState(false);

  // ── Student phone state ────────────────────────────────────────────────────
  const [sScreen, setSScreen]                   = useState<SStudentScreen>('s-register');
  const [studentName, setStudentName]           = useState('Chipo Dube');
  const [submissionFileName, setSubmissionFileName] = useState('');

  function triggerSync() {
    setSyncPulse(true);
    setTimeout(() => setSyncPulse(false), 1200);
  }

  const go = (to: TScreen) => { setPrevScreen(screen); setScreen(to); };
  const back = () => setScreen(prevScreen);

  function renderTeacherScreen() {
    switch (screen) {
      case 'welcome':
        return <WelcomeScreen onTeacher={() => go('register')} onSignIn={() => go('phone')} />;
      case 'phone':
        return <PhoneScreen onContinue={(p) => { setOtpPhone(p); go('otp'); }} onRegister={() => go('welcome')} />;
      case 'otp':
        return <OTPScreen phone={otpPhone} onVerify={() => go('classes')} onBack={back} />;
      case 'register':
        return <RegisterScreen onSignIn={() => go('phone')} onContinue={(p) => { setOtpPhone(p); go('otp'); }} />;
      case 'classes':
        return <ClassesScreen onAddHomework={() => go('add-homework')} onOpenHomework={() => go('homework-detail')} />;
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
            demoToken={demoToken}
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
      default:
        return null;
    }
  }

  function renderStudentScreen() {
    switch (sScreen) {
      case 's-register':
        return <StudentRegisterScreen onJoined={(name) => { setStudentName(name); setSScreen('s-home'); }} />;
      case 's-home':
        return <StudentHomeScreen studentName={studentName} submissionsOpen={submissionsOpen} onSubmit={() => setSScreen('s-submit')} onResults={() => setSScreen('s-results')} onTutor={() => setSScreen('s-tutor')} />;
      case 's-submit':
        return (
          <StudentSubmitScreen
            onBack={() => setSScreen('s-home')}
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
        return <StudentFeedbackScreen onBack={() => setSScreen('s-results')} />;
      case 's-tutor':
        return <StudentTutorScreen studentName={studentName} onBack={() => setSScreen('s-home')} demoToken={demoToken} />;
      default:
        return null;
    }
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
        {(['welcome', 'register', 'otp', 'classes', 'add-homework', 'review-scheme', 'homework-created', 'homework-detail', 'grade-all'] as TScreen[]).map((s, i) => (
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
        <PhoneFrame label="Teacher" labelColor={C.teal}>
          {renderTeacherScreen()}
        </PhoneFrame>

        {/* Live sync connector */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          width: 52, alignSelf: 'center', gap: 6, flexShrink: 0,
        }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: C.teal, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>⚡ LIVE</span>
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

        <PhoneFrame label="Student" labelColor={C.amber700}>
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
