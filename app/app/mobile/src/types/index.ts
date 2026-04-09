// src/types/index.ts
// Shared TypeScript types mirroring backend/shared/models.py.
// Keep in sync with the backend Pydantic models.

// ── Enums ─────────────────────────────────────────────────────────────────────

export type EducationLevel =
  | 'grade_1' | 'grade_2' | 'grade_3' | 'grade_4'
  | 'grade_5' | 'grade_6' | 'grade_7'
  | 'form_1' | 'form_2' | 'form_3' | 'form_4' | 'form_5' | 'form_6'
  | 'tertiary';

export type SubscriptionStatus = 'active' | 'trial' | 'expired' | 'suspended';

export type GradingVerdictEnum = 'correct' | 'incorrect' | 'partial';

export type UserRole = 'teacher' | 'student';

// ── Models ────────────────────────────────────────────────────────────────────

export interface School {
  id: string;
  name: string;
  city: string;
  province: string;
  type: 'primary' | 'secondary' | 'tertiary';
}

export interface Teacher {
  id: string;
  phone: string;
  first_name: string;
  surname: string;
  email?: string;
  school?: string;
  subscription_status: SubscriptionStatus;
  education_levels_active: EducationLevel[];
  push_token?: string;
  created_at: string;
  role: 'teacher';
  training_data_consent?: boolean;
}

export interface Class {
  id: string;
  teacher_id: string;
  name: string;
  education_level: EducationLevel;
  subject?: string;
  grade?: string;
  join_code?: string;
  share_analytics: boolean;
  share_rank: boolean;
  student_ids: string[];
  created_at: string;
}

export interface Student {
  id: string;
  class_id: string;
  first_name: string;
  surname: string;
  phone?: string;
  register_number?: string;
  push_token?: string;
  role: 'student';
}

export interface Question {
  number: number;
  correct_answer: string;
  max_marks: number;
  marking_notes?: string;
  question_text?: string; // populated for AI-generated schemes
}

export interface AnswerKey {
  id: string;
  class_id: string;
  subject: string;
  title?: string;
  teacher_id?: string;
  education_level?: EducationLevel;
  questions: Question[];
  total_marks?: number;
  open_for_submission: boolean;
  generated: boolean;
  created_at: string;
  due_date?: string;
  status?: string | null; // "pending_setup" = unlabeled auto-created, null/undefined = normal
}

export interface GradingVerdict {
  question_number: number;
  verdict: GradingVerdictEnum;
  awarded_marks: number;
  max_marks: number;
  feedback?: string;
}

export interface Mark {
  id: string;
  student_id: string;
  teacher_id: string;
  class_id?: string;
  answer_key_id: string;
  score: number;
  max_score: number;
  percentage?: number;
  marked_image_url: string;
  source: 'teacher_scan' | 'student_submission';
  approved: boolean;
  approved_at?: string;
  feedback?: string;
  verdicts: GradingVerdict[];
  timestamp: string;
}

// ── API response shapes ───────────────────────────────────────────────────────

/** Response from POST /api/mark (teacher scan pipeline) */
export interface MarkResult {
  mark_id: string;
  student_id: string;
  score: number;
  max_score: number;
  percentage: number;
  marked_image_url: string;
  verdicts: GradingVerdict[];
}

/** Response from POST /api/auth/login or /api/auth/register */
export interface OtpSentResponse {
  verification_id: string;
  message: string;
  debug_otp?: string; // DEV ONLY — present when no OTP delivery channel is configured (no Twilio, no WhatsApp template)
}

/** Response from POST /api/auth/verify — user object is nested */
export interface VerifyResponse {
  token: string;
  user: {
    id: string;
    first_name: string;
    surname: string;
    phone: string;
    role: UserRole;
    school?: string;    // teacher only
    class_id?: string;  // student only
  };
}

/** Decoded JWT payload stored in AuthContext */
export interface AuthUser {
  id: string;
  phone: string;
  role: UserRole;
  first_name: string;
  surname: string;
  school?: string;
  class_id?: string;   // student only
  join_code?: string;  // student only — stored when registered via join code
}

// ── Student auth types ────────────────────────────────────────────────────────

/** One match entry from POST /api/auth/student/lookup */
export interface StudentMatch {
  student: {
    id: string;
    first_name: string;
    surname: string;
    register_number?: string;
    class_id: string;
  };
  class: {
    id: string;
    name: string;
    subject?: string;
    education_level: string;
  };
  teacher: {
    first_name: string;
    surname: string;
  };
  school?: string;
}

/** Response from POST /api/auth/student/lookup */
export interface LookupResponse {
  matches: StudentMatch[];
}

/** Response from GET /api/classes/join/{code} */
export interface ClassJoinInfo {
  id: string;
  name: string;
  subject?: string;
  education_level?: string;
  teacher: { first_name: string; surname: string };
}

/** Student-facing: open assignment from GET /api/assignments */
export interface Assignment {
  id: string;
  title?: string;
  subject?: string;
  total_marks?: number;
  education_level?: string;
  created_at?: string;
  has_pending_submission?: boolean;
}

/** Approved mark visible to a student (GET /api/marks/student/{id}) */
export interface StudentMark {
  id: string;
  answer_key_id: string;
  answer_key_title?: string;
  score: number;
  max_score: number;
  percentage?: number;
  marked_image_url?: string;
  source: string;
  approved: boolean;
  feedback?: string;           // overall teacher comment
  manually_edited?: boolean;   // true if teacher edited AI verdicts/feedback
  timestamp: string;
  verdicts?: GradingVerdict[];
  subject?: string;
}

/** Teacher-side view of a student submission (GET /api/submissions) */
export interface TeacherSubmission {
  id: string;
  mark_id: string;
  student_id: string;
  student_name?: string;
  class_id: string;
  class_name?: string;
  answer_key_id: string;
  answer_key_title?: string;
  status: 'pending' | 'graded' | 'approved';
  approved?: boolean;
  submitted_at: string;
  graded_at?: string;
  score?: number;
  max_score?: number;
  marked_image_url?: string;
  source: string;
  verdicts?: GradingVerdict[];
  overall_feedback?: string;
  manually_edited?: boolean;
  // Offline grading support (future LiteRT on-device model)
  graded_offline?: boolean;
  grading_model?: string; // "gemma4-26b" | "gemma4-e4b" | etc.
}

/** Pending or graded submission (GET /api/submissions/student/{id}) */
export interface StudentSubmission {
  mark_id: string;
  answer_key_id: string;
  answer_key_title?: string;
  status: 'pending' | 'graded';
  submitted_at: string;
  graded_at?: string;
  score?: number;
  max_score?: number;
  percentage?: number;
  marked_image_url?: string;
}

/** Teacher analytics: per-class summary card (GET /api/analytics/classes) */
export interface ClassAnalyticsSummary {
  class_id: string;
  class_name: string;
  education_level: string;
  subject?: string;
  total_students: number;
  total_submissions: number;
  average_score: number;
  recent_trend: 'up' | 'down' | 'stable';
  last_activity?: string;
}

/** Teacher analytics: full class breakdown (GET /api/analytics/class/{class_id}) */
export interface ClassAnalyticsDetail {
  class_id: string;
  class_name: string;
  total_students: number;
  summary: {
    average_score: number;
    total_submissions: number;
    completion_rate: number;
    improvement_pct: number | null;
  };
  score_distribution: Array<{ range: string; count: number }>;
  performance_over_time: Array<{ homework_title: string; date: string; average_score: number }>;
  students: Array<{
    id: string;
    name: string;
    register_number?: string;
    average_score: number;
    submissions_count: number;
    trend: 'up' | 'down' | 'stable';
  }>;
}

/** Teacher analytics: student breakdown (GET /api/analytics/student/{student_id}) */
export interface TeacherStudentAnalyticsData {
  student: {
    id: string;
    name: string;
    register_number?: string;
    average_score: number;
    total_submissions: number;
    first_submission_date?: string;
  };
  performance_over_time: Array<{
    homework_title: string;
    date: string;
    score_pct: number;
    class_average: number;
  }>;
  strengths: Array<{ homework_title: string; score: number; class_average: number }>;
  weaknesses: Array<{ homework_title: string; score: number; class_average: number }>;
  submissions: Array<{
    id: string;
    homework_title: string;
    date: string;
    score: number;
    max_score: number;
    feedback_preview?: string;
  }>;
}

/** Class analytics visible to student (GET /api/analytics/student-class/{class_id}) */
export interface StudentClassAnalytics {
  enabled: boolean;
  rank_enabled?: boolean;
  student_average?: number;
  class_average?: number;
  student_rank?: number;
  total_students?: number;
  total_assignments_graded?: number;
  trend?: number[];
  per_assignment?: Array<{
    title: string;
    student_score: number;
    class_average: number;
  }>;
  strengths?: string[];
  weaknesses?: string[];
}

// ── Navigation param lists ────────────────────────────────────────────────────

export type AuthStackParamList = {
  RoleSelect: undefined;    // Landing screen — role selection or "sign in"
  Phone: undefined;         // Login flow (existing users)
  OTP: { phone: string; verification_id: string; debug_otp?: string };
  TeacherRegister: undefined;
  StudentRegister: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Analytics: { class_id?: string } | undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Main: undefined;
  ClassSetup: undefined;
  ClassDetail: { class_id: string; class_name: string; education_level: EducationLevel };
  TeacherInbox: undefined;
  HomeworkDetail: { answer_key_id: string; class_id: string; class_name: string; homework_title?: string };
  AddHomework: { class_id?: string; class_name?: string };
  GenerateScheme: { class_id: string; class_name: string; education_level?: string; subject?: string };
  SetPin: undefined;
  PinLock: { mode: 'setup' | 'change' | 'remove' };
  GradingResults: { answer_key_id: string; class_id: string; class_name: string; answer_key_title: string };
  GradingDetail: { mark_id: string; student_name: string; class_name: string; answer_key_title: string };
  Mark: { class_id: string; class_name: string; education_level: EducationLevel; answer_key_id?: string } | undefined;
  TeacherClassAnalytics: { class_id: string; class_name: string };
  TeacherStudentAnalytics: { student_id: string; student_name: string; class_id: string; class_name: string };
};

export type StudentTabParamList = {
  StudentHome: undefined;
  StudentSubmit: undefined;
  StudentTutor: undefined;
  StudentResults: undefined;
  StudentSettings: undefined;
};

export type StudentRootStackParamList = {
  StudentTabs: undefined;
  PinLock: { mode: 'setup' | 'change' | 'remove' };
  StudentCamera: { answer_key_id: string; answer_key_title: string; class_id: string };
  StudentPreview: { images: string[]; answer_key_id: string; answer_key_title: string; class_id: string };
  StudentConfirm: { images: string[]; answer_key_id: string; answer_key_title: string; class_id: string };
  SubmissionSuccess: { method: 'app' | 'whatsapp' | 'email' };
  Feedback: { mark_id: string; mark?: StudentMark };
  StudentAnalytics: { class_id: string };
};
