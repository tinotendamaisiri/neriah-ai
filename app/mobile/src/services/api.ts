// src/services/api.ts
// Typed API client for all Neriah backend endpoints.
// Auth token is attached automatically via request interceptor.
// 401 responses clear the stored token (handled by AuthContext listener).

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import {
  Class,
  ClassJoinInfo,
  School,
  Student,
  AnswerKey,
  Mark,
  MarkResult,
  Teacher,
  OtpSentResponse,
  VerifyResponse,
  LookupResponse,
  Assignment,
  StudentMark,
  StudentSubmission,
  StudentClassAnalytics,
  TeacherSubmission,
  ClassAnalyticsSummary,
  ClassAnalyticsDetail,
  TeacherStudentAnalyticsData,
  ReviewQuestion,
} from '../types';

const BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'https://us-central1-neriah-ai-492302.cloudfunctions.net/neriah-grading/api';

export const JWT_STORAGE_KEY = 'neriah_jwt';
export const USER_STORAGE_KEY = 'neriah_user';

// ── Axios instance ────────────────────────────────────────────────────────────

const client: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 35000, // marking pipeline can take ~20s
  headers: { 'Content-Type': 'application/json' },
});

console.log('[API] Base URL:', client.defaults.baseURL);

client.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(JWT_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 401 listener — AuthContext subscribes via onUnauthorized
let _onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  _onUnauthorized = fn;
};

client.interceptors.response.use(
  (res) => res,
  (error) => {
    // No response at all — network unreachable
    if (!error.response) {
      return Promise.reject({
        title: 'No connection',
        message: 'Check your internet and try again.',
        isOffline: true,
        _raw: error,
      });
    }

    const { status, data } = error.response as { status: number; data?: { error?: string } };
    const serverMsg: string | undefined = data?.error;

    if (status === 401) {
      if (_onUnauthorized) _onUnauthorized();
      return Promise.reject({ title: 'Session expired', message: 'Please sign in again.', status, _raw: error });
    }

    if (status === 429) {
      const retryAfter: number | undefined = (data as any)?.retry_after;
      return Promise.reject({
        title: 'Too many requests',
        message: serverMsg || 'Please wait a moment and try again.',
        retry_after: retryAfter,
        status,
        _raw: error,
      });
    }

    const mapped: Record<number, { title: string; message: string }> = {
      403: { title: 'Not allowed', message: serverMsg || "You don't have permission to do this." },
      404: { title: 'Not found', message: serverMsg || 'This item may have been removed.' },
      409: { title: 'Already exists', message: serverMsg || 'This action was already completed.' },
      410: { title: 'Expired', message: serverMsg || 'This code has expired. Request a new one.' },
      422: { title: 'Invalid data', message: serverMsg || 'Please check your input and try again.' },
    };

    if (mapped[status]) {
      return Promise.reject({ ...mapped[status], status, _raw: error });
    }

    // 5xx and everything else
    return Promise.reject({
      title: 'Something went wrong',
      message: serverMsg || 'Please try again. Your data is safe.',
      status,
      _raw: error,
    });
  },
);

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Request an OTP for login (teacher account must exist). */
export const requestLoginOtp = async (phone: string): Promise<OtpSentResponse> => {
  const res: AxiosResponse<OtpSentResponse> = await client.post('/auth/login', { phone });
  return res.data;
};

/** Fetch the public schools registry (no auth required). */
export const getSchools = async (): Promise<School[]> => {
  const res = await client.get('/schools');
  return res.data;
};

/** Request an OTP for a new teacher registration. */
export const requestRegisterOtp = async (payload: {
  phone: string;
  first_name: string;
  surname: string;
  school_id?: string;       // from picker — preferred
  school_name?: string;     // free-text fallback when school not in list
}): Promise<OtpSentResponse> => {
  const res: AxiosResponse<OtpSentResponse> = await client.post('/auth/register', payload);
  return res.data;
};

/** Submit the OTP code to complete login or registration. */
export const verifyOtp = async (payload: {
  verification_id: string;
  otp_code: string;
}): Promise<VerifyResponse> => {
  const res: AxiosResponse<VerifyResponse> = await client.post('/auth/verify', payload);
  return res.data;
};

/** Resend OTP (same verification_id, new code issued). */
export const resendOtp = async (
  verification_id: string,
  channel_preference?: 'whatsapp' | 'sms',
): Promise<OtpSentResponse> => {
  const res: AxiosResponse<OtpSentResponse> = await client.post('/auth/resend-otp', {
    verification_id,
    ...(channel_preference ? { channel_preference } : {}),
  });
  return res.data;
};

/** Fetch the authenticated user's profile. */
export const getMe = async (): Promise<Teacher | Student> => {
  const res: AxiosResponse<Teacher | Student> = await client.get('/auth/me');
  return res.data;
};

// ── Push token ────────────────────────────────────────────────────────────────

export const registerPushToken = async (push_token: string): Promise<void> => {
  await client.post('/push/register', { push_token });
};

// ── Classes ───────────────────────────────────────────────────────────────────

export const listClasses = async (): Promise<Class[]> => {
  const res: AxiosResponse<Class[]> = await client.get('/classes');
  return res.data;
};

export const createClass = async (payload: {
  name: string;
  education_level: string;
  grade?: string;
  curriculum?: string;
}): Promise<Class> => {
  const res: AxiosResponse<Class> = await client.post('/classes', payload);
  return res.data;
};

export const updateClass = async (
  class_id: string,
  payload: Partial<Pick<Class, 'name' | 'grade' | 'share_analytics' | 'share_rank'>>,
): Promise<Class> => {
  const res: AxiosResponse<Class> = await client.put(`/classes/${class_id}`, payload);
  return res.data;
};

export const deleteClass = async (class_id: string): Promise<void> => {
  await client.delete(`/classes/${class_id}`);
};

export const getClassJoinInfo = async (code: string): Promise<ClassJoinInfo> => {
  const res = await client.get(`/classes/join/${code.toUpperCase()}`);
  return res.data;
};

/** Public: fetch all classes for a school (no auth required). */
export const getClassesBySchool = async (school_id: string): Promise<Array<{
  id: string;
  name: string;
  education_level: string;
  subject?: string;
  teacher: { first_name: string; surname: string };
}>> => {
  const res = await client.get(`/classes/school/${school_id}`);
  return res.data;
};

// ── Students ──────────────────────────────────────────────────────────────────

export const listStudents = async (class_id: string): Promise<Student[]> => {
  const res: AxiosResponse<Student[]> = await client.get('/students', { params: { class_id } });
  return res.data;
};

export const createStudent = async (payload: {
  class_id: string;
  first_name: string;
  surname: string;
  register_number?: string;
  phone?: string;
}): Promise<Student> => {
  const res: AxiosResponse<Student> = await client.post('/students', payload);
  return res.data;
};

export const createStudentsBatch = async (payload: {
  class_id: string;
  students: Array<{
    first_name: string;
    surname: string;
    register_number?: string;
    phone?: string;
  }>;
}): Promise<{ created: Student[]; errors: Array<{ index: number; error: string }> }> => {
  const res = await client.post('/students/batch', payload);
  return res.data;
};

export const updateStudent = async (
  student_id: string,
  payload: Partial<Pick<Student, 'first_name' | 'surname' | 'phone' | 'register_number'>>,
): Promise<Student> => {
  const res: AxiosResponse<Student> = await client.put(`/students/${student_id}`, payload);
  return res.data;
};

export const deleteStudent = async (student_id: string): Promise<void> => {
  await client.delete(`/students/${student_id}`);
};

// ── Answer Keys ───────────────────────────────────────────────────────────────

export const listAnswerKeys = async (class_id: string): Promise<AnswerKey[]> => {
  const res: AxiosResponse<AnswerKey[]> = await client.get('/answer-keys', {
    params: { class_id },
  });
  return res.data;
};

export const createAnswerKey = async (payload: {
  class_id: string;
  title: string;
  subject?: string;
  education_level?: string;
  open_for_submission?: boolean;
  due_date?: string;
  questions?: Array<{ number: number; correct_answer: string; marks: number; marking_notes?: string }>;
  auto_generate?: boolean;
  question_paper_text?: string;
  /** "draft" keeps the scheme pending teacher review; omit or null for immediate use */
  status?: string | null;
  /** "question_paper" (default) = generate answers; "answer_key" = extract existing answers */
  input_type?: string;
  /** Base64-encoded file contents */
  file_data?: string;
  /** MIME type matching file_data (e.g. "image/jpeg", "application/pdf") */
  media_type?: string;
  /** Teacher-specified total marks; AI distributes marks per question to match */
  teacher_total_marks?: number;
}): Promise<AnswerKey> => {
  const res: AxiosResponse<AnswerKey> = await client.post('/homework/generate-scheme', {
    status: 'draft',
    input_type: 'question_paper',
    ...payload,
  }, { timeout: 90000 });
  return res.data;
};

export const updateAnswerKey = async (
  answer_key_id: string,
  payload: Partial<Pick<AnswerKey, 'title' | 'open_for_submission' | 'education_level' | 'total_marks' | 'due_date' | 'status'>> & {
    questions?: Array<{ number: number; correct_answer: string; marks: number; marking_notes?: string }>;
    auto_generate?: boolean;
    question_paper_text?: string;
  },
): Promise<AnswerKey> => {
  const res: AxiosResponse<AnswerKey> = await client.put(`/answer-keys/${answer_key_id}`, payload);
  return res.data;
};

/**
 * Re-generate the marking scheme for a DRAFT answer key.
 * The server updates the draft in Firestore and returns the new questions.
 */
export const regenerateScheme = async (
  answer_key_id: string,
  input: { text?: string; fileBase64?: string; mediaType?: string },
): Promise<{ questions: ReviewQuestion[]; total_marks: number }> => {
  const body: Record<string, string> = {};
  if (input.fileBase64 && input.mediaType) {
    body.file_data = input.fileBase64;
    body.media_type = input.mediaType;
  } else if (input.text) {
    body.question_paper_text = input.text;
  }
  const res = await client.post(`/answer-keys/${answer_key_id}/regenerate`, body, { timeout: 90000 });
  return res.data;
};

export const deleteAnswerKey = async (answer_key_id: string): Promise<void> => {
  await client.delete(`/answer-keys/${answer_key_id}`);
};

export const closeAndGrade = async (
  answer_key_id: string,
): Promise<{ message: string; pending_count: number }> => {
  const res = await client.post(`/answer-keys/${answer_key_id}/close`);
  return res.data;
};

// ── Roster extraction ─────────────────────────────────────────────────────────

export interface ExtractedStudent {
  first_name: string;
  surname: string;
  register_number?: string | null;
  phone?: string | null;
}

/** Send a photo of a class register to Gemma 4 and get structured student rows back. */
export const extractStudentsFromImage = async (imageUri: string): Promise<ExtractedStudent[]> => {
  const formData = new FormData();
  formData.append('image', {
    uri: imageUri,
    name: 'register.jpg',
    type: 'image/jpeg',
  } as any);
  const res = await client.post('/students/extract-from-image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
  return res.data.students ?? [];
};

/** Send an xlsx / csv / pdf / docx file and get structured student rows back. */
export const extractStudentsFromFile = async (
  fileUri: string,
  fileName: string,
  mimeType: string,
): Promise<ExtractedStudent[]> => {
  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: mimeType,
  } as any);
  const res = await client.post('/students/extract-from-file', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
  return res.data.students ?? [];
};

// ── Teacher marking ───────────────────────────────────────────────────────────

/**
 * Submit a teacher-scan mark.
 * Reads the image from the local file URI and uploads as multipart/form-data.
 */
export const submitMark = async (payload: {
  image_uri: string;
  teacher_id: string;
  student_id: string;
  class_id: string;
  answer_key_id: string;
  education_level: string;
}): Promise<MarkResult> => {
  const formData = new FormData();
  formData.append('teacher_id', payload.teacher_id);
  formData.append('student_id', payload.student_id);
  formData.append('class_id', payload.class_id);
  formData.append('answer_key_id', payload.answer_key_id);
  formData.append('education_level', payload.education_level);
  formData.append('source', 'app');
  // React Native FormData accepts { uri, name, type } for file fields
  formData.append('image', {
    uri: payload.image_uri,
    name: 'scan.jpg',
    type: 'image/jpeg',
  } as any);

  const res: AxiosResponse<MarkResult> = await client.post('/mark', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000, // full pipeline can take up to 40s
  });
  return res.data;
};

/** Fetch a single mark document by ID (teacher review or student feedback). */
export const getMarkById = async (mark_id: string): Promise<any> => {
  const res = await client.get(`/marks/${mark_id}`);
  return res.data;
};

/** Teacher updates score, feedback, verdicts, or approves a student submission. */
export const updateMark = async (
  mark_id: string,
  payload: {
    score?: number;
    max_score?: number;
    feedback?: string;
    approved?: boolean;
    verdicts?: Array<{
      question_number: number;
      verdict: string;
      awarded_marks: number;
      max_marks: number;
      feedback?: string;
    }>;
    overall_feedback?: string;
    manually_edited?: boolean;
  },
): Promise<Mark> => {
  const res: AxiosResponse<Mark> = await client.put(`/marks/${mark_id}`, payload);
  return res.data;
};

/** Bulk-approve multiple marks in a single call. */
export const approveAllMarks = async (
  mark_ids: string[],
): Promise<{ approved_count: number; skipped_count: number }> => {
  const res = await client.post('/marks/approve-bulk', { mark_ids });
  return res.data;
};

// ── Analytics ─────────────────────────────────────────────────────────────────

export const getAnalytics = async (params: {
  class_id?: string;
  student_id?: string;
}): Promise<Record<string, unknown>> => {
  const res = await client.get('/analytics', { params });
  return res.data;
};

export const getClassesAnalytics = async (): Promise<ClassAnalyticsSummary[]> => {
  const res = await client.get('/analytics/classes');
  return res.data;
};

export const getClassAnalytics = async (class_id: string): Promise<ClassAnalyticsDetail> => {
  const res = await client.get(`/analytics/class/${class_id}`);
  return res.data;
};

export const getTeacherStudentAnalytics = async (
  student_id: string,
  class_id: string,
): Promise<TeacherStudentAnalyticsData> => {
  const res = await client.get(`/analytics/student/${student_id}`, { params: { class_id } });
  return res.data;
};

// ── Student auth ──────────────────────────────────────────────────────────────

/** Look up pre-registered students by name and/or phone (no auth). */
export const studentLookup = async (data: {
  first_name: string;
  surname: string;
  phone: string;
}): Promise<LookupResponse> => {
  const res = await client.post('/auth/student/lookup', data);
  return res.data;
};

/** Claim a pre-created student record (teacher-added) by providing student_id + phone. */
export const studentActivate = async (data: {
  student_id: string;
  phone: string;
}): Promise<OtpSentResponse> => {
  const res = await client.post('/auth/student/activate', data);
  return res.data;
};

/** Self-register as a new student. Provide class_id (new flow) or class_join_code (legacy). */
export const studentRegister = async (data: {
  first_name: string;
  surname: string;
  phone: string;
  class_id?: string;
  class_join_code?: string;
}): Promise<OtpSentResponse> => {
  const res = await client.post('/auth/student/register', data);
  return res.data;
};

// ── Student data ──────────────────────────────────────────────────────────────

/** Open assignments for this student's class (open_for_submission = true). */
export const getAssignments = async (class_id: string): Promise<Assignment[]> => {
  const res: AxiosResponse<Assignment[]> = await client.get('/assignments', {
    params: { class_id, status: 'open' },
  });
  return res.data;
};

/** Approved marks visible to this student. Pass limit to get recent N. */
export const getStudentMarks = async (
  student_id: string,
  limit?: number,
): Promise<StudentMark[]> => {
  const res: AxiosResponse<StudentMark[]> = await client.get(
    `/marks/student/${student_id}`,
    limit ? { params: { limit } } : undefined,
  );
  return res.data;
};

/** All submissions (pending + graded) for this student. */
export const getStudentSubmissions = async (student_id: string): Promise<StudentSubmission[]> => {
  const res: AxiosResponse<StudentSubmission[]> = await client.get(
    `/submissions/student/${student_id}`,
  );
  return res.data;
};

/** Submit work via the App channel (multipart/form-data with image). */
export const submitStudentWork = async (formData: FormData): Promise<{ mark_id: string }> => {
  const res = await client.post('/submissions/student', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
  return res.data;
};

/** Withdraw a pending student submission. */
export const withdrawSubmission = async (mark_id: string): Promise<void> => {
  await client.delete(`/submissions/student/${mark_id}`);
};

/** Class analytics scoped to this student's view. */
export const getStudentClassAnalytics = async (
  class_id: string,
  student_id: string,
): Promise<StudentClassAnalytics> => {
  const res: AxiosResponse<StudentClassAnalytics> = await client.get(
    `/analytics/student-class/${class_id}`,
    { params: { student_id } },
  );
  return res.data;
};

/** Fetch a single mark by ID (student feedback view). */
export const getMark = async (mark_id: string): Promise<StudentMark> => {
  const res: AxiosResponse<StudentMark> = await client.get(`/marks/${mark_id}`);
  return res.data;
};

/** Student joins a class via join code. */
export const joinClass = async (join_code: string): Promise<{ class_id: string; class_name: string }> => {
  const res = await client.post('/classes/join', { join_code });
  return res.data;
};

/**
 * Upload a file (PDF, Word, or image) as the answer key question paper.
 * Backend extracts text and auto-generates the marking scheme.
 */
export const createAnswerKeyWithFile = async (
  payload: {
    class_id: string;
    title: string;
    education_level?: string;
    subject?: string;
    /** "draft" keeps the scheme pending teacher review (default) */
    status?: string | null;
    /** "question_paper" (default) = generate answers; "answer_key" = extract existing answers */
    input_type?: string;
  },
  fileUri: string,
  filename: string,
  mimeType: string,
): Promise<AnswerKey> => {
  const formData = new FormData();
  formData.append('class_id', payload.class_id);
  formData.append('title', payload.title);
  if (payload.education_level) formData.append('education_level', payload.education_level);
  if (payload.subject) formData.append('subject', payload.subject);
  formData.append('status', payload.status ?? 'draft');
  formData.append('input_type', payload.input_type ?? 'question_paper');
  formData.append('file', { uri: fileUri, name: filename, type: mimeType } as any);
  const res: AxiosResponse<AnswerKey> = await client.post(
    '/answer-keys',
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 90000 },
  );
  return res.data;
};

export const uploadAnswerKeyFile = async (
  answer_key_id: string,
  fileUri: string,
  filename: string,
  mimeType: string,
): Promise<AnswerKey> => {
  const formData = new FormData();
  formData.append('auto_generate', 'true');
  formData.append('file', { uri: fileUri, name: filename, type: mimeType } as any);
  const res: AxiosResponse<AnswerKey> = await client.put(
    `/answer-keys/${answer_key_id}`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 },
  );
  return res.data;
};

/** Teacher: list student submissions (pending + graded). */
export const getTeacherSubmissions = async (params?: {
  status?: 'pending' | 'graded';
  class_id?: string;
  teacher_id?: string;
}): Promise<TeacherSubmission[]> => {
  const res: AxiosResponse<TeacherSubmission[]> = await client.get('/submissions', { params });
  return res.data;
};

/** Teacher: approve a student submission. */
export const approveSubmission = async (submission_id: string): Promise<void> => {
  await client.post(`/submissions/${submission_id}/approve`);
};

/** Record terms acceptance on the server (fire-and-forget; no OTP required). */
export const acceptTermsOnServer = async (): Promise<void> => {
  await client.post('/auth/terms-accept', { terms_version: '1.0' });
};

// ── PIN management ────────────────────────────────────────────────────────────

/** Request OTP for profile update verification (send to current or new phone). */
export const requestProfileOtp = async (phone: string): Promise<OtpSentResponse> => {
  const res: AxiosResponse<OtpSentResponse> = await client.post('/auth/profile/request-otp', { phone });
  return res.data;
};

/** Update teacher profile. Requires OTP verification. Returns updated user + new token if phone changed. */
export const updateProfile = async (payload: {
  title?: string;
  first_name?: string;
  surname?: string;
  phone?: string;
  verification_id: string;
  otp_code: string;
}): Promise<{ user: { id: string; first_name: string; surname: string; name?: string; title?: string; display_name?: string; phone: string; role: string; school?: string }; token?: string }> => {
  const res = await client.patch('/auth/me', payload);
  return res.data;
};

/** Set or change the 4-digit app lock PIN. */
export const setPin = async (pin: string): Promise<void> => {
  await client.post('/auth/pin/set', { pin });
};

/** Verify the 4-digit PIN (cold-start unlock). Returns attempts remaining on failure. */
export const verifyPin = async (pin: string): Promise<{ message: string }> => {
  const res = await client.post('/auth/pin/verify', { pin });
  return res.data;
};

/** Remove the app lock PIN. */
export const deletePin = async (): Promise<void> => {
  await client.delete('/auth/pin');
};

// ── AI Tutor ──────────────────────────────────────────────────────────────────

export interface TutorChatMessage {
  role:    'user' | 'assistant';
  content: string;
}

export interface TutorResponse {
  response:        string;
  conversation_id: string;
}

/**
 * POST /api/tutor/chat
 * Send a text or image message to the Socratic AI tutor.
 * student_id comes from the JWT — not passed explicitly.
 */
export const sendTutorMessage = async (params: {
  message:          string;
  conversation_id?: string;
  /** Base64-encoded image (no data: prefix) */
  image?:           string;
  history?:         TutorChatMessage[];
  is_greeting?:     boolean;
  weak_topics?:     string[];
}): Promise<TutorResponse> => {
  const res: AxiosResponse<TutorResponse> = await client.post('/tutor/chat', params);
  return res.data;
};

// ── Teacher AI Assistant ───────────────────────────────────────────────────────

export type AssistantActionType =
  | 'chat'
  | 'create_homework'
  | 'create_quiz'
  | 'prepare_notes'
  | 'class_performance'
  | 'teaching_methods'
  | 'exam_questions';

export interface AssistantChatMessage {
  role:    'user' | 'assistant';
  content: string;
}

export interface AssistantResponse {
  action_type:      AssistantActionType;
  conversation_id:  string;
  curriculum:       string;
  level:            string;
  /** Present for chat / teaching_methods (free-form text) */
  response?:        string;
  /** Present for structured outputs (homework, quiz, notes, exam, performance) */
  structured?:      Record<string, unknown>;
  /** True when the structured content can be exported to a class */
  exportable?:      boolean;
  /** True when the message was off-topic and redirected */
  off_topic?:       boolean;
}

export interface AssistantExportResult {
  answer_key_id: string;
  title:         string;
  class_id:      string;
  status:        string;
  questions:     number;
  total_marks:   number;
}

/**
 * POST /api/teacher/assistant
 * Send a message to the teacher AI assistant.
 */
export const teacherAssistantChat = async (params: {
  message:          string;
  action_type?:     AssistantActionType;
  curriculum?:      string;
  level?:           string;
  class_id?:        string;
  chat_history?:    AssistantChatMessage[];
  conversation_id?: string;
  file_data?:       string;
  media_type?:      'image' | 'pdf' | 'word';
}): Promise<AssistantResponse> => {
  const res: AxiosResponse<AssistantResponse> = await client.post('/teacher/assistant', params);
  return res.data;
};

/**
 * POST /api/teacher/assistant/export
 * Persist AI-generated homework or quiz to Firestore as a draft answer_key.
 */
export const teacherAssistantExport = async (params: {
  content_type: 'homework' | 'quiz';
  content:      Record<string, unknown>;
  class_id:     string;
  title?:       string;
}): Promise<AssistantExportResult> => {
  const res: AxiosResponse<AssistantExportResult> = await client.post(
    '/teacher/assistant/export',
    params,
  );
  return res.data;
};
