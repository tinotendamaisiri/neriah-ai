'use client';

import React, {
  useState, useCallback, useEffect, useRef,
  createContext, useContext,
} from 'react';

// ── Brand ─────────────────────────────────────────────────────────────────────
const C = {
  teal:    '#0D9488',
  tealDk:  '#0F766E',
  tealLt:  '#F0FDFA',
  teal100: '#CCFBF1',
  amber:   '#F59E0B',
  amberLt: '#FFFBEB',
  amberDk: '#92400E',
  green:   '#16A34A',
  greenLt: '#F0FDF4',
  red:     '#DC2626',
  redLt:   '#FEF2F2',
  blue:    '#2563EB',
  blueLt:  '#EFF6FF',
  g50:     '#F9FAFB',
  g100:    '#F3F4F6',
  g200:    '#E5E7EB',
  g400:    '#9CA3AF',
  g500:    '#6B7280',
  g700:    '#374151',
  g900:    '#111827',
  white:   '#FFFFFF',
};

// ── Static data ───────────────────────────────────────────────────────────────
const SCHEME = [
  { q: 'Q1', text: 'Solve for x: 2x + 5 = 11', ans: 'x = 3', marks: 2 },
  { q: 'Q2', text: 'What is 15% of 200?', ans: '30', marks: 2 },
  { q: 'Q3', text: 'Area of rectangle 8cm × 5cm', ans: '40 cm²', marks: 2 },
  { q: 'Q4', text: 'Simplify 3(2x+4) − 2(x−1)', ans: '4x + 14', marks: 2 },
  { q: 'Q5', text: 'Probability of red (3 red, 7 blue)', ans: '3/10', marks: 2 },
];

const VERDICTS = [
  { q: 'Q1', correct: true,  awarded: 2, feedback: 'Correct — x = 3' },
  { q: 'Q2', correct: true,  awarded: 2, feedback: 'Correct — 30' },
  { q: 'Q3', correct: true,  awarded: 2, feedback: 'Correct — 40 cm²' },
  { q: 'Q4', correct: false, awarded: 0, feedback: 'Expected 4x + 14, got 4x + 12' },
  { q: 'Q5', correct: false, awarded: 1, feedback: 'Partial credit — 3/10 accepted' },
];

// ── Tutor replies ─────────────────────────────────────────────────────────────
const TUTOR_PAIRS: [string, string][] = [
  ['2x + 5', 'Great question! What is the first step to get x by itself?'],
  ['subtract 5', 'Exactly! Subtract 5 from both sides. What do you get?'],
  ['2x = 6', 'Perfect! Now how do you isolate x from 2x = 6?'],
  ['divide by 2', '🎉 Brilliant! So x = 3. Try this next: 3x − 4 = 14'],
  ['x = 3', 'That\'s right! Now try: 3x − 4 = 14. What\'s your first step?'],
  ['percent', 'For percentages, convert to decimal: 15% = 0.15. Then multiply. What is 0.15 × 200?'],
  ['area', 'Area of a rectangle = length × width. You have 8 and 5. What is 8 × 5?'],
  ['probability', 'Probability = favourable ÷ total. How many red balls? How many total?'],
  ['3/10', '✓ Correct! The probability is 3 out of 10, or 3/10. Well done!'],
];

function getTutorReply(msg: string): string {
  const lower = msg.toLowerCase();
  for (const [trigger, reply] of TUTOR_PAIRS) {
    if (lower.includes(trigger.toLowerCase())) return reply;
  }
  return "That's a great question! Let me guide you step by step. What do you already know about this topic?";
}

// ── Hint ──────────────────────────────────────────────────────────────────────
function getHint(s: {
  homeworkCreated: boolean; schemeReady: boolean; studentSubmitted: boolean;
  gradingStatus: string; approved: boolean; tScreen: string; sScreen: string;
}): string {
  if (!s.homeworkCreated) return "👆 Start by tapping 'Add Homework' on the teacher's phone";
  if (!s.schemeReady) return "✨ Tap 'Generate with AI' to create a marking scheme with Gemma 4";
  if (!s.studentSubmitted) return "📱 Homework assigned! Tap the homework card on the student phone, then 'Take Photo' to submit";
  if (s.gradingStatus === 'none') return "👨‍🏫 Back to the teacher phone — tap 'Close & Grade All' to start AI grading";
  if (s.gradingStatus === 'grading') return "⏳ Gemma 4 is marking Tendai's submission…";
  if (s.gradingStatus === 'complete' && !s.approved) return "✅ Grading done! Tap the submission card to view annotated results, then tap 'Approve'";
  if (s.approved && s.sScreen === 'student-home') return "🎉 Results released! Tap 'Results' on the student phone to see the score";
  if (s.sScreen === 'student-results') return "💬 Try the AI Tutor — tap 'Ask Neriah' or the Tutor tab to chat about any question";
  if (s.sScreen === 'student-tutor') return "🤖 Type a question or tap one of the chips. Neriah uses Socratic questioning — try 'How do I solve 2x + 5?'";
  return "🎓 The demo is fully interactive — explore both phones freely";
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARED CONTEXT
// ══════════════════════════════════════════════════════════════════════════════

interface DemoCtx {
  homeworkCreated: boolean;
  schemeReady: boolean;
  studentSubmitted: boolean;
  gradingStatus: 'none' | 'grading' | 'complete';
  approved: boolean;
  tScreen: string;
  tPush: (s: string) => void;
  tPop: () => void;
  tGoTo: (s: string) => void;
  sScreen: string;
  sPush: (s: string) => void;
  sPop: () => void;
  sGoTo: (s: string) => void;
  createHomework: () => void;
  saveScheme: () => void;
  studentSubmit: () => void;
  closeAndGrade: () => void;
  approveAll: () => void;
  tutorMessages: { role: 'user' | 'bot'; text: string }[];
  sendTutorMsg: (text: string) => void;
}

const Demo = createContext<DemoCtx>(null!);
const useDemo = () => useContext(Demo);

// ══════════════════════════════════════════════════════════════════════════════
// PRIMITIVES
// ══════════════════════════════════════════════════════════════════════════════

function Badge({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
  return (
    <span style={{ backgroundColor: bg, color, borderRadius: 10, padding: '2px 8px', fontSize: 10, fontWeight: 700, display: 'inline-block', lineHeight: 1.6, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function TealBtn({ children, onClick, style, disabled }: {
  children: React.ReactNode; onClick?: () => void;
  style?: React.CSSProperties; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      backgroundColor: disabled ? C.g400 : C.teal, color: '#fff', border: 'none', borderRadius: 10,
      padding: '11px 16px', fontWeight: 600, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
      width: '100%', fontFamily: 'inherit', ...style,
    }}>
      {children}
    </button>
  );
}

function OutlineBtn({ children, onClick, style }: {
  children: React.ReactNode; onClick?: () => void; style?: React.CSSProperties;
}) {
  return (
    <button onClick={onClick} style={{
      border: `1.5px solid ${C.teal}`, color: C.teal, backgroundColor: 'transparent', borderRadius: 10,
      padding: '11px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer',
      width: '100%', fontFamily: 'inherit', ...style,
    }}>
      {children}
    </button>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ backgroundColor: C.white, borderRadius: 12, padding: 13, marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', ...style }}>
      {children}
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PHONE FRAME
// ══════════════════════════════════════════════════════════════════════════════

function PhoneFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{
        width: 340, height: 700, borderRadius: 44, backgroundColor: '#0F172A',
        padding: '12px 6px 8px',
        boxShadow: '0 32px 80px rgba(0,0,0,0.5), 0 0 0 2px #1E293B, inset 0 0 0 1px rgba(255,255,255,0.05)',
        flexShrink: 0, position: 'relative', display: 'flex', flexDirection: 'column',
      }}>
        {/* Dynamic island */}
        <div style={{ position: 'absolute', top: 13, left: '50%', transform: 'translateX(-50%)', width: 96, height: 26, backgroundColor: '#0F172A', borderRadius: 18, zIndex: 10 }} />
        {/* Screen */}
        <div style={{ flex: 1, borderRadius: 36, overflow: 'hidden', backgroundColor: C.g50, display: 'flex', flexDirection: 'column' }}>
          {/* Status bar */}
          <div style={{ height: 42, backgroundColor: C.white, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 16, flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.g900 }}>9:41</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="14" height="10" viewBox="0 0 15 11">
                <rect x="0" y="7" width="3" height="4" rx="0.5" fill={C.g900} />
                <rect x="4" y="5" width="3" height="6" rx="0.5" fill={C.g900} />
                <rect x="8" y="3" width="3" height="8" rx="0.5" fill={C.g900} />
                <rect x="12" y="0" width="3" height="11" rx="0.5" fill={C.g900} />
              </svg>
              <svg width="14" height="11" viewBox="0 0 16 12">
                <circle cx="8" cy="10.5" r="1" fill={C.g900} />
                <path d="M4.5 7.5Q8 4 11.5 7.5" stroke={C.g900} strokeWidth="1.5" fill="none" strokeLinecap="round" />
                <path d="M2 5Q8-0.5 14 5" stroke={C.g900} strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
              <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <div style={{ width: 20, height: 10, border: `1.5px solid ${C.g900}`, borderRadius: 3, padding: 1.5, display: 'flex' }}>
                  <div style={{ flex: 0.8, backgroundColor: C.g900, borderRadius: 1 }} />
                </div>
                <div style={{ width: 2, height: 5, backgroundColor: C.g900, borderRadius: '0 1px 1px 0' }} />
              </div>
            </div>
          </div>
          {/* Content */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            {children}
          </div>
        </div>
        {/* Home indicator */}
        <div style={{ height: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 3 }}>
          <div style={{ width: 90, height: 3, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 3 }} />
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SCREEN HEADER & TAB BARS
// ══════════════════════════════════════════════════════════════════════════════

function ScreenHeader({ title, subtitle, onBack, right }: {
  title: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode;
}) {
  return (
    <div style={{ backgroundColor: C.white, padding: '10px 14px', borderBottom: `1px solid ${C.g200}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      {onBack && (
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.teal, padding: 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <BackIcon />
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.g900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 10, color: C.g500, marginTop: 1 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

function TeacherTabs({ active }: { active: string }) {
  const { tGoTo } = useDemo();
  const tabs = [
    { id: 'teacher-home', label: 'Classes', icon: '🏫' },
    { id: 'teacher-analytics', label: 'Analytics', icon: '📊' },
    { id: 'teacher-settings', label: 'Settings', icon: '⚙️' },
  ];
  return (
    <div style={{ display: 'flex', borderTop: `1px solid ${C.g200}`, backgroundColor: C.white, flexShrink: 0 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => tGoTo(t.id)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '7px 0 9px', gap: 2, background: 'none', border: 'none', cursor: 'pointer' }}>
          <span style={{ fontSize: 17 }}>{t.icon}</span>
          <span style={{ fontSize: 9, fontWeight: 600, color: active === t.id ? C.teal : C.g500 }}>{t.label}</span>
          {active === t.id && <div style={{ width: 16, height: 2, backgroundColor: C.teal, borderRadius: 2, marginTop: 1 }} />}
        </button>
      ))}
    </div>
  );
}

function StudentTabs({ active, resultsLocked }: { active: string; resultsLocked: boolean }) {
  const { sGoTo } = useDemo();
  const tabs = [
    { id: 'student-home', label: 'Home', icon: '📚' },
    { id: 'student-submit', label: 'Submit', icon: '📤' },
    { id: 'student-tutor', label: 'Tutor', icon: '🤖' },
    { id: 'student-results', label: 'Results', icon: '📋', locked: resultsLocked },
    { id: 'student-settings', label: 'Settings', icon: '⚙️' },
  ];
  return (
    <div style={{ display: 'flex', borderTop: `1px solid ${C.g200}`, backgroundColor: C.white, flexShrink: 0 }}>
      {tabs.map(t => {
        const locked = 'locked' in t && t.locked;
        return (
          <button key={t.id} onClick={() => !locked && sGoTo(t.id)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '5px 0 7px', gap: 1, background: 'none', border: 'none', cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.35 : 1 }}>
            <span style={{ fontSize: 14 }}>{t.icon}</span>
            <span style={{ fontSize: 8, fontWeight: 600, color: active === t.id ? C.teal : C.g500 }}>{t.label}</span>
            {active === t.id && <div style={{ width: 14, height: 2, backgroundColor: C.teal, borderRadius: 2 }} />}
          </button>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TEACHER SCREENS
// ══════════════════════════════════════════════════════════════════════════════

function TeacherHome() {
  const { homeworkCreated, schemeReady, studentSubmitted, gradingStatus, approved, tPush, tGoTo } = useDemo();
  const subCount = studentSubmitted ? 1 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader
        title="My Classes"
        right={
          <button onClick={() => tPush('teacher-add-homework')} style={{ backgroundColor: C.teal, color: '#fff', border: 'none', borderRadius: 18, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            + Homework
          </button>
        }
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {/* Class card */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.g900 }}>Form 2A</div>
              <div style={{ fontSize: 11, color: C.g500 }}>Mathematics · Form 2</div>
            </div>
            <Badge color={C.tealDk} bg={C.tealLt}>Form 2</Badge>
          </div>
          <div style={{ display: 'flex', gap: 16, borderTop: `1px solid ${C.g100}`, paddingTop: 8 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.g900 }}>1</div>
              <div style={{ fontSize: 9, color: C.g500 }}>students</div>
            </div>
            <div style={{ width: 1, backgroundColor: C.g200 }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.g900 }}>{homeworkCreated ? 1 : 0}</div>
              <div style={{ fontSize: 9, color: C.g500 }}>homework</div>
            </div>
          </div>
        </Card>

        {/* Homework card */}
        {homeworkCreated && (
          <button onClick={() => tGoTo('teacher-homework-detail')} style={{ width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
            <Card style={{ border: `1px solid ${C.g200}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.g900 }}>Maths Chapter 5 Test</div>
                  <div style={{ fontSize: 10, color: C.g500, marginTop: 2 }}>Created 8 Apr 2026 · {subCount} submissions</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 8 }}>
                  {!schemeReady ? (
                    <Badge color={C.amberDk} bg={C.amberLt}>Upload Scheme</Badge>
                  ) : gradingStatus === 'complete' ? (
                    <Badge color={C.tealDk} bg={C.tealLt}>View Grading ›</Badge>
                  ) : studentSubmitted ? (
                    <Badge color={C.amberDk} bg={C.amberLt}>Ready to Grade</Badge>
                  ) : (
                    <Badge color={C.green} bg={C.greenLt}>Open</Badge>
                  )}
                  {approved && <Badge color={C.green} bg={C.greenLt}>✓ All Approved</Badge>}
                </div>
              </div>
            </Card>
          </button>
        )}

        {/* Add homework CTA */}
        <button onClick={() => tPush('teacher-add-homework')} style={{ width: '100%', background: 'none', border: `1.5px dashed ${C.g200}`, borderRadius: 12, padding: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'inherit' }}>
          <span style={{ color: C.teal, fontSize: 16, fontWeight: 700 }}>+</span>
          <span style={{ color: C.teal, fontSize: 12, fontWeight: 600 }}>Add Homework</span>
        </button>
      </div>
      <TeacherTabs active="teacher-home" />
    </div>
  );
}

function TeacherAddHomework() {
  const { tPop, tPush, tGoTo, createHomework } = useDemo();
  const [title, setTitle] = useState('Maths Chapter 5 Test');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader title="Add Homework" subtitle="Form 2A — Mathematics" onBack={tPop} />
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: C.g500, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>CLASS</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.g900 }}>Form 2A</div>
              <div style={{ fontSize: 11, color: C.g500 }}>Mathematics · Form 2</div>
            </div>
            <Badge color={C.tealDk} bg={C.tealLt}>Form 2</Badge>
          </div>
        </Card>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.g900, marginBottom: 6 }}>Homework Title</div>
          <input value={title} onChange={e => setTitle(e.target.value)} style={{ width: '100%', border: `1.5px solid ${C.g200}`, borderRadius: 10, padding: '9px 12px', fontSize: 13, color: C.g900, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.g900, marginBottom: 6 }}>Answer Key</div>
          <div style={{ border: `1.5px dashed ${C.g200}`, borderRadius: 10, padding: 14, textAlign: 'center', opacity: 0.55 }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>📄</div>
            <div style={{ fontSize: 11, color: C.g500, marginBottom: 6 }}>Upload from device</div>
            <div style={{ fontSize: 10, color: C.g400 }}>PDF · Image · Word (coming soon)</div>
          </div>
        </div>

        <button onClick={() => { createHomework(); tPush('teacher-generate-scheme'); }} style={{ width: '100%', backgroundColor: C.teal, color: '#fff', border: 'none', borderRadius: 10, padding: '13px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', boxShadow: `0 2px 10px ${C.teal}55`, fontFamily: 'inherit' }}>
          <span style={{ fontSize: 17 }}>✨</span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Generate with AI</span>
        </button>
        <div style={{ fontSize: 10, color: C.g400, textAlign: 'center', marginTop: 6 }}>Powered by Gemma 4 · on-device</div>
      </div>
      <TeacherTabs active="teacher-home" />
    </div>
  );
}

function TeacherGenerateScheme() {
  const { tPop, tGoTo, saveScheme } = useDemo();
  const [phase, setPhase] = useState<'preview' | 'generating' | 'done'>('preview');

  const handleGenerate = () => {
    setPhase('generating');
    setTimeout(() => setPhase('done'), 2200);
  };

  const handleSave = () => {
    saveScheme();
    tGoTo('teacher-homework-detail');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader
        title={phase === 'done' ? 'Marking Scheme' : 'Generate Scheme'}
        subtitle={phase === 'done' ? 'Gemma 4 generated · Tap cards to edit' : 'Form 2A — Mathematics'}
        onBack={phase === 'generating' ? undefined : tPop}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {phase === 'preview' && (
          <>
            <div style={{ border: `1px solid ${C.g200}`, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ backgroundColor: C.g100, padding: '6px 12px', fontSize: 10, color: C.g500, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>QUESTION PAPER</div>
              <div style={{ padding: 12, fontFamily: 'monospace', fontSize: 10, color: C.g700, lineHeight: 1.8, backgroundColor: '#FEFEFE' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>MATHEMATICS — FORM 2A</div>
                {SCHEME.slice(0, 3).map((q, i) => <div key={q.q}>{i + 1}. {q.text}</div>)}
                <div style={{ color: C.g400, marginTop: 4 }}>…and 2 more questions</div>
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.g900, marginBottom: 6 }}>Education Level</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['Form 1', 'Form 2', 'Form 3'].map(l => (
                  <button key={l} style={{ padding: '5px 10px', borderRadius: 14, border: `1.5px solid ${l === 'Form 2' ? C.teal : C.g200}`, backgroundColor: l === 'Form 2' ? C.tealLt : C.white, color: l === 'Form 2' ? C.teal : C.g500, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>
                ))}
              </div>
            </div>
            <TealBtn onClick={handleGenerate}>Generate Marking Scheme</TealBtn>
          </>
        )}

        {phase === 'generating' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 50, gap: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', backgroundColor: C.tealLt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>✨</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.g900, marginBottom: 4 }}>Gemma 4 is reading your paper…</div>
              <div style={{ fontSize: 11, color: C.g500 }}>Generating marking scheme</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: C.teal, animation: `neriah-bounce 0.8s ${i * 0.2}s ease-in-out infinite alternate` }} />)}
            </div>
          </div>
        )}

        {phase === 'done' && (
          <>
            <div style={{ backgroundColor: C.tealLt, borderRadius: 10, padding: 10, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>✅</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.tealDk }}>Scheme generated</div>
                <div style={{ fontSize: 10, color: C.tealDk }}>5 questions · 10 marks total</div>
              </div>
            </div>
            {SCHEME.map(item => (
              <Card key={item.q} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, fontSize: 11, color: C.teal }}>{item.q}</span>
                  <Badge color={C.tealDk} bg={C.tealLt}>{item.marks} marks</Badge>
                </div>
                <div style={{ fontSize: 11, color: C.g500, marginBottom: 3 }}>{item.text}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.green }}>✓ {item.ans}</div>
              </Card>
            ))}
            <TealBtn onClick={handleSave} style={{ marginTop: 4 }}>Save and Use This Scheme</TealBtn>
          </>
        )}
      </div>
      <TeacherTabs active="teacher-home" />
    </div>
  );
}

function AnnotatedImageModal({ onClose, onApprove, alreadyApproved }: {
  onClose: () => void; onApprove: () => void; alreadyApproved: boolean;
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.92)', zIndex: 50, display: 'flex', flexDirection: 'column', borderRadius: 0 }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        <div style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>Tendai Moyo — 7/10 (70%)</div>
        <div style={{ width: 24 }} />
      </div>

      {/* Exercise book mockup */}
      <div style={{ flex: 1, margin: '0 12px', backgroundColor: '#FEFDF5', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `repeating-linear-gradient(transparent, transparent 22px, #DBEAFE 22px, #DBEAFE 23px)`, backgroundPositionY: '28px' }} />
        <div style={{ position: 'absolute', left: 34, top: 0, bottom: 0, width: 1.5, backgroundColor: '#FCA5A5' }} />
        <div style={{ position: 'relative', padding: '8px 10px 8px 42px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 10, color: '#111' }}>NAME: Tendai Moyo · Form 2A</div>
          {VERDICTS.map((v, i) => (
            <div key={v.q} style={{ marginBottom: 14, position: 'relative', paddingRight: 28 }}>
              <div style={{ fontSize: 9, color: '#222', lineHeight: 1.5 }}>
                <span style={{ fontWeight: 700 }}>{v.q}. </span>
                {['2x + 5 = 11, x = 3', '15% of 200 = 30', '8 × 5 = 40 cm²', '4x + 12', '3/10'][i]}
              </div>
              <div style={{ position: 'absolute', right: 2, top: 0, width: 18, height: 18, borderRadius: '50%', backgroundColor: v.correct ? C.green : v.awarded > 0 ? C.amber : C.red, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 700, flexShrink: 0 }}>
                {v.correct ? '✓' : v.awarded > 0 ? '~' : '✗'}
              </div>
            </div>
          ))}
        </div>
        {/* Score stamp */}
        <div style={{ position: 'absolute', bottom: 10, right: 10, width: 48, height: 48, borderRadius: '50%', border: '2.5px solid #DC2626', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.9)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#DC2626', lineHeight: 1 }}>7</div>
          <div style={{ fontSize: 8, color: '#DC2626', fontWeight: 600 }}>/ 10</div>
        </div>
      </div>

      {/* Verdicts strip */}
      <div style={{ margin: '8px 12px', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px' }}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {VERDICTS.map(v => (
            <div key={v.q} style={{ backgroundColor: v.correct ? C.green : v.awarded > 0 ? C.amber : C.red, borderRadius: 6, padding: '2px 7px', fontSize: 10, color: '#fff', fontWeight: 700 }}>
              {v.q}: {v.awarded}/{SCHEME.find(s => s.q === v.q)!.marks}
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '6px 12px 12px', display: 'flex', gap: 8, flexShrink: 0 }}>
        {!alreadyApproved ? (
          <>
            <button onClick={onApprove} style={{ flex: 1, backgroundColor: C.teal, color: '#fff', border: 'none', borderRadius: 10, padding: 11, fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✓ Approve</button>
            <button onClick={onClose} style={{ flex: 1, backgroundColor: 'transparent', color: '#fff', border: '1.5px solid rgba(255,255,255,0.25)', borderRadius: 10, padding: 11, fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Override Score</button>
          </>
        ) : (
          <div style={{ flex: 1, backgroundColor: C.greenLt, borderRadius: 10, padding: 11, textAlign: 'center', fontSize: 12, fontWeight: 700, color: C.green }}>✓ Approved & Released</div>
        )}
      </div>
    </div>
  );
}

function TeacherHomeworkDetail() {
  const { tPop, studentSubmitted, gradingStatus, approved, closeAndGrade, approveAll } = useDemo();
  const [showAnnotated, setShowAnnotated] = useState(false);
  const subCount = studentSubmitted ? 1 : 0;

  const banner = (() => {
    if (gradingStatus === 'complete') return { bg: C.blueLt, color: C.blue, icon: '✅', title: 'Grading Complete', sub: `${approved ? 1 : 0}/1 Approved` };
    if (gradingStatus === 'grading') return { bg: C.tealLt, color: C.tealDk, icon: '⏳', title: 'Grading in progress…', sub: 'Gemma 4 is marking submissions' };
    if (studentSubmitted) return { bg: C.amberLt, color: C.amberDk, icon: '📥', title: 'Ready to Grade', sub: `${subCount} submission received` };
    return { bg: C.greenLt, color: C.green, icon: '🟢', title: 'Accepting Submissions', sub: `${subCount} received · Due 10 Apr 2026` };
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <ScreenHeader title="Maths Chapter 5 Test" subtitle="Form 2A · Mathematics" onBack={tPop} />

      <div style={{ backgroundColor: banner.bg, padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, borderBottom: `1px solid ${C.g200}` }}>
        <span style={{ fontSize: 14 }}>{banner.icon}</span>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: banner.color }}>{banner.title}</div>
          <div style={{ fontSize: 10, color: banner.color }}>{banner.sub}</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.g900 }}>Marking Scheme</span>
            <Badge color={C.tealDk} bg={C.tealLt}>5 questions · 10 marks</Badge>
          </div>
          {SCHEME.slice(0, 3).map(q => (
            <div key={q.q} style={{ fontSize: 10, color: C.g500, padding: '2px 0', borderBottom: `1px solid ${C.g100}` }}>
              <span style={{ fontWeight: 600, color: C.g700 }}>{q.q}: </span>{q.ans}
            </div>
          ))}
          <div style={{ fontSize: 10, color: C.teal, marginTop: 4, fontWeight: 600 }}>+ 2 more</div>
        </Card>

        <div style={{ fontSize: 11, fontWeight: 700, color: C.g900, marginBottom: 8 }}>Submissions ({subCount})</div>

        {subCount === 0 ? (
          <div style={{ backgroundColor: C.white, borderRadius: 12, padding: 18, textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>📤</div>
            <div style={{ fontSize: 12, color: C.g500 }}>No submissions yet.</div>
            <div style={{ fontSize: 10, color: C.g400, marginTop: 4 }}>Students can submit via app, WhatsApp, or email.</div>
          </div>
        ) : (
          <button onClick={() => gradingStatus === 'complete' && setShowAnnotated(true)} style={{ width: '100%', background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: gradingStatus === 'complete' ? 'pointer' : 'default' }}>
            <Card style={{ border: `1px solid ${C.g200}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.g900 }}>Tendai Moyo</div>
                  <div style={{ fontSize: 10, color: C.g500 }}>Submitted 8 Apr · 14:32</div>
                </div>
                {gradingStatus === 'complete' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                    <Badge color={approved ? C.tealDk : C.blue} bg={approved ? C.tealLt : C.blueLt}>{approved ? '✓ Approved' : '7/10 — 70%'}</Badge>
                    {!approved && <span style={{ fontSize: 10, color: C.teal, fontWeight: 600 }}>Tap to review →</span>}
                  </div>
                ) : (
                  <Badge color={C.amberDk} bg={C.amberLt}>Pending</Badge>
                )}
              </div>
            </Card>
          </button>
        )}
      </div>

      <div style={{ padding: 12, backgroundColor: C.white, borderTop: `1px solid ${C.g200}`, flexShrink: 0 }}>
        {gradingStatus === 'none' && studentSubmitted && <TealBtn onClick={closeAndGrade}>Close & Grade All</TealBtn>}
        {gradingStatus === 'none' && !studentSubmitted && <OutlineBtn>Close Submissions</OutlineBtn>}
        {gradingStatus === 'grading' && (
          <div style={{ backgroundColor: C.tealLt, borderRadius: 10, padding: 11, textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: C.tealDk, fontWeight: 600 }}>Grading in progress…</div>
          </div>
        )}
        {gradingStatus === 'complete' && !approved && <TealBtn onClick={approveAll}>Approve All Results</TealBtn>}
        {gradingStatus === 'complete' && approved && (
          <div style={{ backgroundColor: C.greenLt, borderRadius: 10, padding: 11, textAlign: 'center', border: `1px solid ${C.green}` }}>
            <div style={{ fontSize: 12, color: C.green, fontWeight: 700 }}>✓ All results approved & released to students</div>
          </div>
        )}
      </div>

      {showAnnotated && (
        <AnnotatedImageModal
          onClose={() => setShowAnnotated(false)}
          onApprove={() => { approveAll(); setShowAnnotated(false); }}
          alreadyApproved={approved}
        />
      )}
    </div>
  );
}

function TeacherAnalytics() {
  const { gradingStatus } = useDemo();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader title="Analytics" />
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {gradingStatus !== 'complete' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 60, textAlign: 'center' }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>📊</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.g900, marginBottom: 6 }}>No data yet</div>
            <div style={{ fontSize: 11, color: C.g500 }}>Grade homework to see class analytics</div>
          </div>
        ) : (
          <>
            <Card style={{ textAlign: 'center', padding: 18, marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: C.g500, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Form 2A Class Average</div>
              <div style={{ position: 'relative', width: 90, height: 90, margin: '0 auto 10px' }}>
                <svg viewBox="0 0 36 36" style={{ width: 90, height: 90, transform: 'rotate(-90deg)' }}>
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke={C.g200} strokeWidth="3" />
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke={C.teal} strokeWidth="3" strokeDasharray="70 30" strokeLinecap="round" />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.g900 }}>70%</div>
                  <div style={{ fontSize: 9, color: C.g500 }}>7/10</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: C.g500 }}>1 student graded</div>
            </Card>
            <Card>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.g900, marginBottom: 8 }}>Question Analysis</div>
              {SCHEME.map((q, i) => {
                const v = VERDICTS[i];
                const pct = (v.awarded / q.marks) * 100;
                return (
                  <div key={q.q} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: C.g700 }}>{q.q}: {q.text.slice(0, 22)}…</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: pct >= 100 ? C.green : pct > 0 ? C.amber : C.red }}>{v.awarded}/{q.marks}</span>
                    </div>
                    <div style={{ height: 4, backgroundColor: C.g200, borderRadius: 4 }}>
                      <div style={{ height: 4, width: `${pct}%`, backgroundColor: pct >= 100 ? C.green : pct > 0 ? C.amber : C.red, borderRadius: 4, transition: 'width 0.5s ease' }} />
                    </div>
                  </div>
                );
              })}
            </Card>
          </>
        )}
      </div>
      <TeacherTabs active="teacher-analytics" />
    </div>
  );
}

function TeacherSettings() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader title="Settings" />
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        <div style={{ fontSize: 10, color: C.g500, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>PROFILE</div>
        <Card style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: '50%', backgroundColor: C.tealLt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>👨‍🏫</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.g900 }}>Mr. Maisiri</div>
              <div style={{ fontSize: 10, color: C.g500 }}>Form 2A · Neriah Demo School</div>
              <div style={{ marginTop: 3 }}><Badge color={C.tealDk} bg={C.tealLt}>Teacher</Badge></div>
            </div>
          </div>
        </Card>

        <div style={{ fontSize: 10, color: C.g500, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>ON-DEVICE AI</div>
        <Card style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.g900 }}>Gemma 4</span>
            <Badge color={C.green} bg={C.greenLt}>● Ready</Badge>
          </div>
          <div style={{ fontSize: 10, color: C.g500, marginBottom: 6 }}>Downloaded · 2.1 GB · Marks offline</div>
          <div style={{ height: 4, backgroundColor: C.g200, borderRadius: 4 }}>
            <div style={{ height: 4, width: '100%', backgroundColor: C.teal, borderRadius: 4 }} />
          </div>
        </Card>

        <div style={{ fontSize: 10, color: C.g500, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>SECURITY</div>
        <Card style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: C.g900 }}>Set PIN Lock</span>
            <span style={{ color: C.g400 }}>›</span>
          </div>
        </Card>

        <button style={{ width: '100%', backgroundColor: C.redLt, color: C.red, border: `1px solid #FECACA`, borderRadius: 10, padding: 11, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Log Out</button>
      </div>
      <TeacherTabs active="teacher-settings" />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// STUDENT SCREENS
// ══════════════════════════════════════════════════════════════════════════════

function StudentHome() {
  const { homeworkCreated, studentSubmitted, approved, sPush, sGoTo } = useDemo();
  const [notifVisible, setNotifVisible] = useState(false);
  const prevCreated = useRef(false);

  useEffect(() => {
    if (homeworkCreated && !prevCreated.current) {
      setNotifVisible(true);
      setTimeout(() => setNotifVisible(false), 3500);
    }
    prevCreated.current = homeworkCreated;
  }, [homeworkCreated]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {notifVisible && (
        <div style={{ position: 'absolute', top: 8, left: 8, right: 8, zIndex: 20, backgroundColor: C.white, borderRadius: 14, padding: '9px 12px', boxShadow: '0 4px 20px rgba(0,0,0,0.22)', display: 'flex', gap: 10, alignItems: 'center', animation: 'neriah-slide-down 0.4s ease' }}>
          <span style={{ fontSize: 18 }}>📚</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.g900 }}>New Homework — Neriah</div>
            <div style={{ fontSize: 10, color: C.g500 }}>Maths Chapter 5 Test assigned</div>
          </div>
        </div>
      )}

      <div style={{ backgroundColor: C.teal, padding: '12px 16px 10px', flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Hello, Tendai 👋</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.8)', marginTop: 1 }}>Form 2A · Mathematics</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.g700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>OPEN ASSIGNMENTS</div>

        {!homeworkCreated ? (
          <div style={{ backgroundColor: C.white, borderRadius: 12, padding: 22, textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 12, color: C.g500 }}>No homework yet.</div>
            <div style={{ fontSize: 10, color: C.g400, marginTop: 4 }}>Your teacher hasn't assigned anything.</div>
          </div>
        ) : (
          <button onClick={() => sPush('student-submit')} style={{ width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
            <Card style={{ border: `1px solid ${C.g200}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.g900 }}>Maths Chapter 5 Test</div>
                  <div style={{ fontSize: 10, color: C.g500, marginTop: 2 }}>Form 2A · Due: 10 Apr 2026</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, marginLeft: 8 }}>
                  {studentSubmitted ? (
                    <Badge color={C.tealDk} bg={C.tealLt}>Submitted ✓</Badge>
                  ) : (
                    <Badge color={C.green} bg={C.greenLt}>Open</Badge>
                  )}
                  {approved && <Badge color={C.blue} bg={C.blueLt}>Results Ready!</Badge>}
                </div>
              </div>
              {approved && (
                <div style={{ marginTop: 8, padding: '7px 10px', backgroundColor: C.tealLt, borderRadius: 8, textAlign: 'center' }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: C.teal }}>70%</span>
                  <span style={{ fontSize: 11, color: C.g500, marginLeft: 6 }}>7 / 10 marks</span>
                </div>
              )}
            </Card>
          </button>
        )}
      </div>
      <StudentTabs active="student-home" resultsLocked={!approved} />
    </div>
  );
}

function StudentSubmit() {
  const { sPop, sPush, sGoTo, homeworkCreated } = useDemo();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader title="Submit Homework" onBack={sPop} />
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {!homeworkCreated ? (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 12, color: C.g500 }}>No open assignments</div>
          </div>
        ) : (
          <>
            <Card style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: C.g500, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>OPEN ASSIGNMENT</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.g900 }}>Maths Chapter 5 Test</div>
              <div style={{ fontSize: 10, color: C.g500 }}>Form 2A · Due: 10 Apr 2026</div>
            </Card>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.g900, marginBottom: 10 }}>How would you like to submit?</div>
            <TealBtn onClick={() => sPush('student-camera')} style={{ marginBottom: 10 }}>📷  Take Photo of Exercise Book</TealBtn>
            <OutlineBtn style={{ marginBottom: 10 }}>💬  Submit via WhatsApp</OutlineBtn>
            <OutlineBtn>📧  Submit via Email</OutlineBtn>
          </>
        )}
      </div>
      <StudentTabs active="student-submit" resultsLocked={true} />
    </div>
  );
}

function StudentCamera() {
  const { sPop, sPush } = useDemo();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#000' }}>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={sPop} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        <div style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>Point at your exercise book</div>
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', margin: '0 12px', borderRadius: 8 }}>
        {/* Simulated book */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#FEFDF5', backgroundImage: `repeating-linear-gradient(transparent, transparent 22px, #CBD5E1 22px, #CBD5E1 23px)`, backgroundPositionY: '30px' }}>
          <div style={{ position: 'absolute', left: 30, top: 0, bottom: 0, width: 1.5, backgroundColor: '#FCA5A5' }} />
          <div style={{ padding: '10px 10px 10px 38px', fontFamily: 'monospace', fontSize: 10, color: '#374151' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>NAME: Tendai Moyo</div>
            <div style={{ marginBottom: 10 }}>1. 2x + 5 = 11</div>
            <div style={{ paddingLeft: 12, marginBottom: 4 }}>2x = 11 − 5 = 6</div>
            <div style={{ paddingLeft: 12 }}>x = 3 ✓</div>
          </div>
        </div>
        {/* Corner brackets */}
        {[
          { top: 10, left: 10 }, { top: 10, right: 10 },
          { bottom: 10, left: 10 }, { bottom: 10, right: 10 },
        ].map((pos, i) => (
          <div key={i} style={{ position: 'absolute', width: 26, height: 26, ...pos,
            borderTop: 'top' in pos ? '3px solid #fff' : 'none',
            borderBottom: 'bottom' in pos ? '3px solid #fff' : 'none',
            borderLeft: 'left' in pos ? '3px solid #fff' : 'none',
            borderRight: 'right' in pos ? '3px solid #fff' : 'none',
          }} />
        ))}
        <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', backgroundColor: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10, padding: '3px 10px', borderRadius: 10, whiteSpace: 'nowrap' }}>
          Align page within the frame
        </div>
      </div>
      <div style={{ padding: '14px 0 18px', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        <button onClick={() => sPush('student-preview')} style={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', border: '3px solid rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 50, height: 50, borderRadius: '50%', backgroundColor: '#fff' }} />
        </button>
      </div>
    </div>
  );
}

function StudentPreview() {
  const { sPop, sGoTo, studentSubmit } = useDemo();
  const [status, setStatus] = useState<'optimizing' | 'ready'>('optimizing');

  useEffect(() => { setTimeout(() => setStatus('ready'), 1600); }, []);

  const handleSubmit = () => { studentSubmit(); sGoTo('student-home'); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader title="Preview" subtitle="Maths Chapter 5 Test" onBack={sPop} />
      <div style={{ flex: 1, margin: 12, backgroundColor: '#FEFDF5', borderRadius: 12, position: 'relative', overflow: 'hidden', backgroundImage: `repeating-linear-gradient(transparent, transparent 22px, #E5E7EB 22px, #E5E7EB 23px)`, backgroundPositionY: '28px' }}>
        <div style={{ position: 'absolute', left: 30, top: 0, bottom: 0, width: 1.5, backgroundColor: '#FCA5A5' }} />
        <div style={{ padding: '10px 10px 10px 38px', fontFamily: 'monospace', fontSize: 10, color: '#374151' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>NAME: Tendai Moyo · Form 2A</div>
          {['1. 2x + 5 = 11 → x = 3', '2. 15% × 200 = 30', '3. 8 × 5 = 40 cm²', '4. 3(2x+4)−2(x−1) = 4x + 12', '5. 3/10'].map((line, i) => (
            <div key={i} style={{ marginBottom: 8 }}>{line}</div>
          ))}
        </div>
        <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', backgroundColor: status === 'ready' ? C.greenLt : 'rgba(0,0,0,0.6)', border: status === 'ready' ? `1px solid ${C.green}` : 'none', borderRadius: 18, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'all 0.3s' }}>
          {status === 'optimizing' ? (
            <><div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#fff', animation: 'neriah-pulse 1s infinite' }} /><span style={{ color: '#fff', fontSize: 10 }}>Optimizing…</span></>
          ) : (
            <><span>✅</span><span style={{ color: C.green, fontSize: 10, fontWeight: 700 }}>Looks good! Ready to submit</span></>
          )}
        </div>
      </div>
      <div style={{ padding: '0 12px 12px' }}>
        <TealBtn onClick={handleSubmit} disabled={status === 'optimizing'}>
          {status === 'optimizing' ? 'Checking image quality…' : 'Submit Homework'}
        </TealBtn>
      </div>
    </div>
  );
}

function StudentResults() {
  const { approved, sGoTo } = useDemo();
  if (!approved) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <ScreenHeader title="My Results" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 42, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.g900, marginBottom: 6 }}>Results not yet released</div>
          <div style={{ fontSize: 11, color: C.g500 }}>Waiting for your teacher to review and approve.</div>
        </div>
        <StudentTabs active="student-results" resultsLocked={false} />
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader title="My Results" />
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        <Card style={{ textAlign: 'center', padding: 18, marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: C.g500, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Maths Chapter 5 Test</div>
          <div style={{ fontSize: 40, fontWeight: 800, color: C.teal, lineHeight: 1 }}>70%</div>
          <div style={{ fontSize: 13, color: C.g500, marginTop: 4, marginBottom: 6 }}>7 / 10 marks</div>
          <Badge color={C.amberDk} bg={C.amberLt}>Good work! 🎉</Badge>
        </Card>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.g900, marginBottom: 8 }}>Question Breakdown</div>
        {VERDICTS.map(v => (
          <Card key={v.q} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
              <span style={{ fontWeight: 700, fontSize: 11, color: C.g900 }}>{v.q}</span>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: v.correct ? C.green : v.awarded > 0 ? C.amber : C.red }}>
                  {v.awarded}/{SCHEME.find(s => s.q === v.q)!.marks}
                </span>
                <Badge color={v.correct ? C.green : v.awarded > 0 ? C.amberDk : C.red} bg={v.correct ? C.greenLt : v.awarded > 0 ? C.amberLt : C.redLt}>
                  {v.correct ? '✓ Correct' : v.awarded > 0 ? '~ Partial' : '✗ Wrong'}
                </Badge>
              </div>
            </div>
            <div style={{ fontSize: 10, color: C.g500 }}>{v.feedback}</div>
          </Card>
        ))}
        <TealBtn onClick={() => sGoTo('student-tutor')} style={{ marginTop: 6 }}>💬 Didn't understand? Ask Neriah</TealBtn>
      </div>
      <StudentTabs active="student-results" resultsLocked={false} />
    </div>
  );
}

function StudentTutor() {
  const { tutorMessages, sendTutorMsg, sGoTo, approved } = useDemo();
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [tutorMessages, typing]);

  const send = useCallback((text: string) => {
    if (!text.trim()) return;
    setInput('');
    setTyping(true);
    sendTutorMsg(text);
    setTimeout(() => setTyping(false), 1500);
  }, [sendTutorMsg]);

  const CHIPS = ['How do I solve 2x + 5?', 'Explain percentages', 'Help with area'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader title="Neriah Tutor" subtitle="AI-powered · Socratic method" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tutorMessages.length === 0 && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: C.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#fff', fontWeight: 700, flexShrink: 0 }}>N</div>
              <div style={{ backgroundColor: C.white, borderRadius: '12px 12px 12px 3px', padding: '9px 12px', maxWidth: '80%', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', fontSize: 11, color: C.g900, lineHeight: 1.5 }}>
                Hi Tendai! 👋 I'm Neriah, your AI study tutor. I guide you through problems with questions — not just answers. What do you need help with?
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingLeft: 36 }}>
              {CHIPS.map(c => (
                <button key={c} onClick={() => send(c)} style={{ backgroundColor: C.tealLt, color: C.teal, border: `1px solid ${C.teal100}`, borderRadius: 12, padding: '4px 9px', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{c}</button>
              ))}
            </div>
          </>
        )}
        {tutorMessages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 6, alignItems: 'flex-end' }}>
            {msg.role === 'bot' && <div style={{ width: 26, height: 26, borderRadius: '50%', backgroundColor: C.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 700, flexShrink: 0 }}>N</div>}
            <div style={{ backgroundColor: msg.role === 'user' ? C.teal : C.white, color: msg.role === 'user' ? '#fff' : C.g900, borderRadius: msg.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px', padding: '7px 11px', maxWidth: '75%', fontSize: 11, boxShadow: '0 1px 3px rgba(0,0,0,0.07)', lineHeight: 1.5 }}>
              {msg.text}
            </div>
          </div>
        ))}
        {typing && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', backgroundColor: C.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 700, flexShrink: 0 }}>N</div>
            <div style={{ backgroundColor: C.white, borderRadius: '12px 12px 12px 3px', padding: '10px 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', display: 'flex', gap: 4 }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: C.g400, animation: `neriah-bounce 0.8s ${i * 0.2}s ease-in-out infinite alternate` }} />)}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: '7px 10px 8px', borderTop: `1px solid ${C.g200}`, backgroundColor: C.white, display: 'flex', gap: 7, alignItems: 'center', flexShrink: 0 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') send(input); }}
          placeholder="Ask a question…"
          style={{ flex: 1, border: `1.5px solid ${C.g200}`, borderRadius: 18, padding: '7px 12px', fontSize: 11, outline: 'none', fontFamily: 'inherit' }}
        />
        <button onClick={() => send(input)} style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: input.trim() ? C.teal : C.g200, color: '#fff', border: 'none', cursor: input.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13, fontFamily: 'inherit' }}>›</button>
      </div>
      <StudentTabs active="student-tutor" resultsLocked={!approved} />
    </div>
  );
}

function StudentSettings() {
  const { approved } = useDemo();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader title="Settings" />
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        <div style={{ fontSize: 10, color: C.g500, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>PROFILE</div>
        <Card style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: '50%', backgroundColor: C.amberLt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>👩‍🎓</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.g900 }}>Tendai Moyo</div>
              <div style={{ fontSize: 10, color: C.g500 }}>Form 2A · Neriah Demo School</div>
              <div style={{ marginTop: 3 }}><Badge color={C.blue} bg={C.blueLt}>Student</Badge></div>
            </div>
          </div>
        </Card>
        <div style={{ fontSize: 10, color: C.g500, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>ON-DEVICE AI</div>
        <Card style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.g900 }}>Gemma 4 Nano</span>
            <Badge color={C.green} bg={C.greenLt}>● Ready</Badge>
          </div>
          <div style={{ fontSize: 10, color: C.g500 }}>Powers offline AI tutor · 890 MB</div>
        </Card>
        <button style={{ width: '100%', backgroundColor: C.redLt, color: C.red, border: `1px solid #FECACA`, borderRadius: 10, padding: 11, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Log Out</button>
      </div>
      <StudentTabs active="student-settings" resultsLocked={!approved} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTERS
// ══════════════════════════════════════════════════════════════════════════════

function TeacherRouter() {
  const { tScreen } = useDemo();
  const map: Record<string, React.ReactNode> = {
    'teacher-home': <TeacherHome />,
    'teacher-add-homework': <TeacherAddHomework />,
    'teacher-generate-scheme': <TeacherGenerateScheme />,
    'teacher-homework-detail': <TeacherHomeworkDetail />,
    'teacher-analytics': <TeacherAnalytics />,
    'teacher-settings': <TeacherSettings />,
  };
  return <>{map[tScreen] ?? <TeacherHome />}</>;
}

function StudentRouter() {
  const { sScreen } = useDemo();
  const map: Record<string, React.ReactNode> = {
    'student-home': <StudentHome />,
    'student-submit': <StudentSubmit />,
    'student-camera': <StudentCamera />,
    'student-preview': <StudentPreview />,
    'student-results': <StudentResults />,
    'student-tutor': <StudentTutor />,
    'student-settings': <StudentSettings />,
  };
  return <>{map[sScreen] ?? <StudentHome />}</>;
}

// ══════════════════════════════════════════════════════════════════════════════
// SYNC ARROW
// ══════════════════════════════════════════════════════════════════════════════

function SyncArrow({ active }: { active: boolean }) {
  return (
    <div style={{ width: 52, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      <div style={{ fontSize: 18, color: active ? C.teal : 'rgba(255,255,255,0.15)', animation: active ? 'neriah-flow 1.2s ease-in-out infinite' : 'none', transition: 'color 0.4s' }}>⟶</div>
      {active && <div style={{ fontSize: 8, color: C.teal, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>sync</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════════

export default function DemoPage() {
  const [homeworkCreated, setHomeworkCreated] = useState(false);
  const [schemeReady, setSchemeReady] = useState(false);
  const [studentSubmitted, setStudentSubmitted] = useState(false);
  const [gradingStatus, setGradingStatus] = useState<'none' | 'grading' | 'complete'>('none');
  const [approved, setApproved] = useState(false);
  const [tutorMessages, setTutorMessages] = useState<{ role: 'user' | 'bot'; text: string }[]>([]);

  const [tStack, setTStack] = useState(['teacher-home']);
  const tScreen = tStack[tStack.length - 1];
  const tPush = useCallback((s: string) => setTStack(p => [...p, s]), []);
  const tPop  = useCallback(() => setTStack(p => p.length > 1 ? p.slice(0, -1) : p), []);
  const tGoTo = useCallback((s: string) => setTStack([s]), []);

  const [sStack, setSStack] = useState(['student-home']);
  const sScreen = sStack[sStack.length - 1];
  const sPush = useCallback((s: string) => setSStack(p => [...p, s]), []);
  const sPop  = useCallback(() => setSStack(p => p.length > 1 ? p.slice(0, -1) : p), []);
  const sGoTo = useCallback((s: string) => setSStack([s]), []);

  const createHomework = useCallback(() => setHomeworkCreated(true), []);
  const saveScheme     = useCallback(() => setSchemeReady(true), []);
  const studentSubmit  = useCallback(() => setStudentSubmitted(true), []);
  const closeAndGrade  = useCallback(() => {
    setGradingStatus('grading');
    setTimeout(() => setGradingStatus('complete'), 2600);
  }, []);
  const approveAll = useCallback(() => setApproved(true), []);

  const sendTutorMsg = useCallback((text: string) => {
    setTutorMessages(prev => {
      const reply = getTutorReply(text);
      setTimeout(() => setTutorMessages(p => [...p, { role: 'bot', text: reply }]), 1500);
      return [...prev, { role: 'user', text }];
    });
  }, []);

  const [mobileTab, setMobileTab] = useState<'teacher' | 'student'>('teacher');
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 820);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const flowActive = homeworkCreated || studentSubmitted || approved;
  const hint = getHint({ homeworkCreated, schemeReady, studentSubmitted, gradingStatus, approved, tScreen, sScreen });
  const steps = [homeworkCreated, schemeReady, studentSubmitted, gradingStatus === 'complete', approved];
  const doneCount = steps.filter(Boolean).length;

  const ctx: DemoCtx = {
    homeworkCreated, schemeReady, studentSubmitted, gradingStatus, approved,
    tScreen, tPush, tPop, tGoTo,
    sScreen, sPush, sPop, sGoTo,
    createHomework, saveScheme, studentSubmit, closeAndGrade, approveAll,
    tutorMessages, sendTutorMsg,
  };

  return (
    <Demo.Provider value={ctx}>
      <style>{`
        @keyframes neriah-bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes neriah-slide-down { from{transform:translateY(-70px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes neriah-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes neriah-flow { 0%,100%{opacity:0.5;transform:translateX(-3px)} 50%{opacity:1;transform:translateX(3px)} }
        @keyframes neriah-fade { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing: border-box; }
        button:focus { outline: none; }
        input:focus { border-color: #0D9488 !important; }
      `}</style>

      <div style={{ minHeight: '100vh', backgroundColor: '#0B1120', padding: '28px 16px 48px', display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>

        {/* Page header */}
        <div style={{ textAlign: 'center', marginBottom: 28, maxWidth: 600 }}>
          <div style={{ display: 'inline-block', backgroundColor: 'rgba(13,148,136,0.15)', color: C.teal, borderRadius: 20, padding: '3px 14px', fontSize: 10, fontWeight: 700, marginBottom: 10, letterSpacing: 1, textTransform: 'uppercase', border: `1px solid rgba(13,148,136,0.3)` }}>
            Interactive Demo
          </div>
          <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 800, color: '#F1F5F9', margin: '0 0 8px', lineHeight: 1.2 }}>
            Try Neriah Live
          </h1>
          <p style={{ fontSize: 13, color: '#64748B', margin: 0, lineHeight: 1.6 }}>
            Fully interactive — click buttons, type messages, and navigate screens just like the real app
          </p>
        </div>

        {/* Mobile tab toggle */}
        {isMobile && (
          <div style={{ display: 'flex', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 4, marginBottom: 20, gap: 4 }}>
            {(['teacher', 'student'] as const).map(tab => (
              <button key={tab} onClick={() => setMobileTab(tab)} style={{ padding: '8px 24px', borderRadius: 8, border: 'none', backgroundColor: mobileTab === tab ? C.teal : 'transparent', color: mobileTab === tab ? '#fff' : '#94A3B8', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>
                {tab === 'teacher' ? '👨‍🏫 Teacher' : '👩‍🎓 Student'}
              </button>
            ))}
          </div>
        )}

        {/* Phones */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 800 }}>
          {(!isMobile || mobileTab === 'teacher') && (
            <PhoneFrame label="Teacher — Mr. Maisiri">
              <TeacherRouter />
            </PhoneFrame>
          )}
          {!isMobile && <SyncArrow active={flowActive} />}
          {(!isMobile || mobileTab === 'student') && (
            <PhoneFrame label="Student — Tendai Moyo">
              <StudentRouter />
            </PhoneFrame>
          )}
        </div>

        {/* Hint */}
        <div style={{ marginTop: 24, textAlign: 'center', maxWidth: 520, minHeight: 40 }}>
          <div key={hint} style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.6, animation: 'neriah-fade 0.4s ease' }}>
            {hint}
          </div>
        </div>

        {/* Progress */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
          {['Homework', 'Scheme', 'Submitted', 'Graded', 'Approved'].map((label, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div title={label} style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: steps[i] ? C.teal : 'rgba(255,255,255,0.15)', transition: 'background-color 0.4s ease', boxShadow: steps[i] ? `0 0 6px ${C.teal}` : 'none' }} />
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10, color: '#475569', marginTop: 5 }}>{doneCount}/5 steps complete</div>

        {/* CTA */}
        <div style={{ marginTop: 36, textAlign: 'center' }}>
          <a href="/site/contact?subject=demo" style={{ display: 'inline-block', backgroundColor: C.teal, color: '#fff', borderRadius: 12, padding: '13px 30px', fontWeight: 700, fontSize: 14, textDecoration: 'none', boxShadow: `0 4px 20px rgba(13,148,136,0.4)` }}>
            Request Full Access →
          </a>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>Free for the first 3 months · No credit card</div>
        </div>
      </div>
    </Demo.Provider>
  );
}
