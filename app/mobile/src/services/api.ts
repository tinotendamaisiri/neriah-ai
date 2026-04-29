// src/services/api.ts
// Typed API client for all Neriah backend endpoints.
// Auth token is attached automatically via request interceptor.
// 401 responses clear the stored token (handled by AuthContext listener).

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { withCache, readCacheOnly } from './readCache';
import { enqueueMutation } from './mutationQueue';

// Local helper — promotes "isOffline" axios rejections into the
// mutation queue with optimistic cache patching so callers can
// `await` the mutation in either online or offline mode and the
// teacher's UI updates immediately. Online errors propagate normally.
const isOfflineErr = (err: unknown): boolean =>
  !!(err && typeof err === 'object' && (err as { isOffline?: boolean }).isOffline);
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
        error_code: 'NO_CONNECTION',
        isOffline: true,
        _raw: error,
      });
    }

    const { status, data } = error.response as {
      status: number;
      data?: { error?: string; error_code?: string; retry_after?: number; attempts_remaining?: number };
    };
    // Backend contract: `data.error` is the user-facing string. Display it directly.
    // Only fall back to a generic string when the server gave us nothing.
    const serverMsg: string | undefined = data?.error;
    const errorCode: string | undefined = data?.error_code;
    const retryAfter: number | undefined = data?.retry_after;
    const attemptsRemaining: number | undefined = data?.attempts_remaining;

    if (status === 401) {
      if (_onUnauthorized) _onUnauthorized();
      return Promise.reject({
        title: 'Session expired',
        message: serverMsg || 'Please sign in again.',
        error_code: errorCode || 'UNAUTHORIZED',
        status,
        _raw: error,
      });
    }

    // Titles are fallbacks — the real user-facing text is `message`, which
    // is the backend's `error` field verbatim. Screens display `err.message`.
    const titleByStatus: Record<number, string> = {
      403: 'Not allowed',
      404: 'Not found',
      409: 'Already exists',
      410: 'Expired',
      422: 'Invalid data',
      429: 'Slow down',
      503: 'Service unavailable',
    };

    const fallbackByStatus: Record<number, string> = {
      403: "You don't have permission to do this.",
      404: 'This item may have been removed.',
      409: 'This action was already completed.',
      410: 'This code has expired. Please request a new one.',
      422: 'Please check your input and try again.',
      429: 'Please wait a moment before trying again.',
    };

    // Some typed errors (e.g. DuplicateSubmissionError) ship structured
    // `detail` or `extra` payloads the caller needs. Forward both so screen
    // code doesn't have to dig into `_raw.response.data`.
    const extra = (data as any)?.extra ?? (data as any)?.detail;

    return Promise.reject({
      title: titleByStatus[status] || (status >= 500 ? 'Service error' : 'Request failed'),
      message: serverMsg || fallbackByStatus[status] || 'Please try again. Your data is safe.',
      error_code: errorCode,
      retry_after: retryAfter,
      attempts_remaining: attemptsRemaining,
      extra,
      status,
      _raw: error,
    });
  },
);

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Request an OTP for login. Pass role to enforce role-gated auth.
 *
 * Defaults to channel_preference='whatsapp' — WhatsApp is the dominant
 * messaging channel across the SADC user base, and the backend's
 * send_otp() falls through to SMS automatically if the WhatsApp send
 * fails (template not approved yet, account not on WhatsApp, etc).
 * No reason to default to SMS-first.
 */
export const requestLoginOtp = async (phone: string, role?: 'teacher' | 'student'): Promise<OtpSentResponse> => {
  const res: AxiosResponse<OtpSentResponse> = await client.post('/auth/login', {
    phone,
    channel_preference: 'whatsapp',
    ...(role ? { role } : {}),
  });
  return res.data;
};

/** Fetch the public schools registry (no auth required). */
export const getSchools = async (): Promise<School[]> => {
  const res = await client.get('/schools');
  return res.data;
};

/** Search schools by partial name (no auth required). */
export const searchSchools = async (q: string): Promise<string[]> => {
  const res = await client.get('/schools/search', { params: { q } });
  return res.data?.schools ?? [];
};

/** Request an OTP for a new teacher registration. */
export const requestRegisterOtp = async (payload: {
  phone: string;
  first_name: string;
  surname: string;
  school_id?: string;       // from picker — preferred
  school_name?: string;     // free-text fallback when school not in list
  /** User ticked the "I agree to the Terms" checkbox. Backend requires true. */
  terms_accepted: boolean;
  /** Version of the terms the user saw (from src/constants/legal.ts). */
  terms_version: string;
}): Promise<OtpSentResponse> => {
  // Default to WhatsApp delivery; backend falls back to SMS if the
  // template send fails. See requestLoginOtp for rationale.
  const res: AxiosResponse<OtpSentResponse> = await client.post('/auth/register', {
    ...payload,
    channel_preference: 'whatsapp',
  });
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

// ── Curriculum picker options (teacher only) ──────────────────────────────────

export interface CurriculumOptions {
  country:             string;
  default_curriculum:  string;
  curriculum_options:  string[];
  level_options:       Record<string, string[]>;
}

/**
 * Fetch the curriculum + level picker config for the authenticated teacher.
 * Country is derived server-side from the teacher's phone number / school
 * document, so the picker reflects what the teacher actually teaches.
 *
 * Cached so the country-tailored picker survives an offline session — without
 * this the offline assistant would fall back to the hardcoded ZIMSEC list and
 * a Kenyan teacher would see the wrong levels.
 */
export const getCurriculumOptions = (): Promise<CurriculumOptions> =>
  withCache('curriculum:options', async () => {
    const res: AxiosResponse<CurriculumOptions> = await client.get('/curriculum/options');
    return res.data;
  });

// ── Classes ───────────────────────────────────────────────────────────────────

export const listClasses = async (): Promise<Class[]> =>
  withCache('classes', async () => {
    const res: AxiosResponse<Class[]> = await client.get('/classes');
    return res.data;
  });

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

export const getClassDetail = async (class_id: string): Promise<Class> => {
  const res: AxiosResponse<Class> = await client.get(`/classes/${class_id}`);
  return res.data;
};

export const getClassJoinInfo = async (code: string): Promise<ClassJoinInfo> => {
  const res = await client.get(`/classes/join/${code.toUpperCase()}`);
  return res.data;
};

/** Public: fetch classes for a school by name, optionally filtered by search term. */
export const getClassesBySchool = async (school_name: string, search?: string): Promise<Array<{
  id: string;
  name: string;
  education_level: string;
  subject?: string;
  teacher: { first_name: string; surname: string };
}>> => {
  const params: Record<string, string> = { school: school_name };
  if (search) params.search = search;
  const res = await client.get('/classes/by-school', { params });
  return Array.isArray(res.data) ? res.data : [];
};

// ── Students ──────────────────────────────────────────────────────────────────

export const listStudents = async (class_id: string): Promise<Student[]> =>
  withCache(`students:${class_id}`, async () => {
    const res: AxiosResponse<Student[]> = await client.get('/students', { params: { class_id } });
    return res.data;
  });

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

export const listAnswerKeys = async (class_id: string): Promise<AnswerKey[]> =>
  withCache(`answer-keys:${class_id}`, async () => {
    const res: AxiosResponse<AnswerKey[]> = await client.get('/answer-keys', {
      params: { class_id },
    });
    return res.data;
  });

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
/**
 * Submit a teacher scan with 1-5 pages. The backend contract is multi-page
 * only (page_0..page_N + page_count); single-page submissions send one file
 * via page_0. Replaces the legacy single-`image` field contract.
 */
export const submitTeacherScan = async (payload: {
  studentId: string;
  answerKeyId: string;
  classId: string;
  educationLevel: string;
  teacherId: string;
  pages: { uri: string }[];
  /** When true, backend cascade-deletes any existing mark + submission for
   *  the same (student_id, answer_key_id) before creating this one. */
  replace?: boolean;
  /** Pre-graded verdicts from offline E2B grading. When present, backend
   *  skips its own grading call and persists these verdicts as the
   *  canonical Mark (still applying dedupe + clamp guards server-side). */
  preGradedVerdicts?: Array<Record<string, unknown>>;
}): Promise<MarkResult> => {
  if (!payload.pages.length || payload.pages.length > 5) {
    throw new Error(`Invalid page count: ${payload.pages.length} (must be 1..5)`);
  }
  // Android: RN's JS-level multipart file upload (via axios) hangs on some
  // Samsung builds. Use expo-file-system's native uploadAsync instead, which
  // goes through the OS's HTTP stack and bypasses the RN bridge. One-file
  // limit per call, so multi-page isn't supported on Android via this path
  // yet — guard early with a clear error rather than silently dropping
  // pages 1-N.
  if (Platform.OS === 'android') {
    if (payload.pages.length > 1) {
      throw new Error(
        `Multi-page submissions not yet supported on Android (${payload.pages.length} pages). ` +
        `FileSystem.uploadAsync is single-file only; iOS still handles 1-5 pages normally.`,
      );
    }
    const token = await SecureStore.getItemAsync(JWT_STORAGE_KEY);
    if (!token) throw new Error('Not authenticated');
    const uploadResult = await FileSystem.uploadAsync(
      `${BASE_URL}/mark`,
      payload.pages[0].uri,
      {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'page_0',
        mimeType: 'image/jpeg',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        parameters: {
          teacher_id: payload.teacherId,
          student_id: payload.studentId,
          class_id: payload.classId,
          answer_key_id: payload.answerKeyId,
          education_level: payload.educationLevel,
          source: 'app',
          page_count: String(payload.pages.length),
          ...(payload.replace ? { replace: 'true' } : {}),
          // JSON-encoded so the backend can parse it from a single text
          // field. Absent ⇒ cloud grades from scratch.
          ...(payload.preGradedVerdicts && payload.preGradedVerdicts.length > 0
            ? { pre_graded_verdicts: JSON.stringify(payload.preGradedVerdicts) }
            : {}),
        },
      },
    );
    if (uploadResult.status === 200) {
      return JSON.parse(uploadResult.body) as MarkResult;
    }
    // Non-200 — mirror the axios interceptor's error shape so downstream
    // error-handling code (duplicate-submission dialog, quality-rejected
    // Alert, etc.) reads the same fields.
    let body: any = {};
    try {
      body = JSON.parse(uploadResult.body);
    } catch {
      /* non-JSON error body; keep empty */
    }
    const err: any = new Error(body.error || `Upload failed: HTTP ${uploadResult.status}`);
    err.status = uploadResult.status;
    err.error_code = body.error_code;
    err.extra = body.extra;
    throw err;
  }

  const formData = new FormData();
  formData.append('teacher_id', payload.teacherId);
  formData.append('student_id', payload.studentId);
  formData.append('class_id', payload.classId);
  formData.append('answer_key_id', payload.answerKeyId);
  formData.append('education_level', payload.educationLevel);
  formData.append('source', 'app');
  formData.append('page_count', String(payload.pages.length));
  if (payload.replace) formData.append('replace', 'true');
  if (payload.preGradedVerdicts && payload.preGradedVerdicts.length > 0) {
    formData.append('pre_graded_verdicts', JSON.stringify(payload.preGradedVerdicts));
  }
  for (let i = 0; i < payload.pages.length; i++) {
    formData.append(`page_${i}`, {
      uri: payload.pages[i].uri,
      name: `page_${i}.jpg`,
      type: 'image/jpeg',
    } as any);
  }
  const res: AxiosResponse<MarkResult> = await client.post('/mark', formData, {
    headers: {
      // The axios instance default is `application/json` (see client.create
      // above), which would override FormData's auto-detected
      // `multipart/form-data; boundary=...` and cause Flask's parser to 422.
      // Setting undefined lets axios recompute the correct multipart header
      // from the FormData body (boundary included).
      'Content-Type': undefined,
    },
    timeout: 90000, // multi-page grading can take ~60s
  });
  return res.data;
};

/**
 * Legacy single-page wrapper. Kept so offlineQueue replay of old queued
 * items still runs — forwards to submitTeacherScan with one page. New code
 * should call submitTeacherScan directly.
 */
export const submitMark = async (payload: {
  image_uri: string;
  teacher_id: string;
  student_id: string;
  class_id: string;
  answer_key_id: string;
  education_level: string;
  replace?: boolean;
}): Promise<MarkResult> => {
  return submitTeacherScan({
    studentId: payload.student_id,
    answerKeyId: payload.answer_key_id,
    classId: payload.class_id,
    educationLevel: payload.education_level,
    teacherId: payload.teacher_id,
    pages: [{ uri: payload.image_uri }],
    replace: payload.replace,
  });
};

/** Fetch a single mark document by ID (teacher review or student feedback). */
export const getMarkById = async (mark_id: string): Promise<any> =>
  withCache(`mark:${mark_id}`, async () => {
    const res = await client.get(`/marks/${mark_id}`);
    return res.data;
  });

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
  try {
    const res: AxiosResponse<Mark> = await client.put(`/marks/${mark_id}`, payload);
    return res.data;
  } catch (err) {
    if (!isOfflineErr(err)) throw err;
    // Offline — queue for replay and patch the read-cache so screens
    // see the updated mark immediately. We don't have the full server
    // shape here so we synthesise a minimal Mark-like object from the
    // payload + whatever was cached. The real server response replaces
    // it on next online fetch.
    await enqueueMutation({ type: 'update_mark', mark_id, payload });
    const cached = await readCacheOnly<Mark>(`mark:${mark_id}`);
    return { ...(cached as Mark | null ?? ({} as Mark)), ...(payload as Partial<Mark>) } as Mark;
  }
};

/**
 * Bulk-approve graded student submissions. Takes submission IDs (not mark IDs) —
 * approval flips status=graded → status=approved on student_submissions and
 * mirrors approved=true onto the linked marks. Submissions not in "graded"
 * state, or not owned by the caller, are skipped (reported per id).
 */
export const approveAllMarks = async (
  submission_ids: string[],
): Promise<{
  approved: number;
  skipped: Array<{ sub_id: string; reason: string }>;
  errors: Array<{ sub_id: string; error: string }>;
}> => {
  const res = await client.post('/submissions/approve-bulk', { submission_ids });
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

// Cached so class weak topics survive an offline session — withCache returns
// the stale snapshot only when the device is genuinely offline.
export const getClassesAnalytics = (): Promise<ClassAnalyticsSummary[]> =>
  withCache('analytics:classes', async () => {
    const res = await client.get('/analytics/classes');
    return res.data;
  });

export const getClassAnalytics = (class_id: string): Promise<ClassAnalyticsDetail> =>
  withCache(`analytics:class:${class_id}`, async () => {
    const res = await client.get(`/analytics/class/${class_id}`);
    return res.data;
  });

export const getTeacherStudentAnalytics = async (
  student_id: string,
  class_id: string,
): Promise<TeacherStudentAnalyticsData> => {
  const res = await client.get(`/analytics/student/${student_id}`, { params: { class_id } });
  return res.data;
};

export const getHomeworkAnalytics = async (homework_id: string): Promise<any> => {
  const res = await client.get(`/analytics/homework/${homework_id}`);
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

/** Self-register as a new student. Provide class_id, class_join_code, or manual_class_name (offline/unmatched). */
export const studentRegister = async (data: {
  first_name: string;
  surname: string;
  phone: string;
  class_id?: string;
  class_join_code?: string;
  manual_class_name?: string;
  /** User ticked the "I agree to the Terms" checkbox. Backend requires true. */
  terms_accepted: boolean;
  /** Version of the terms the user saw (from src/constants/legal.ts). */
  terms_version: string;
}): Promise<OtpSentResponse> => {
  // Default to WhatsApp delivery; backend falls back to SMS if the
  // template send fails. See requestLoginOtp for rationale.
  const res = await client.post('/auth/student/register', {
    ...data,
    channel_preference: 'whatsapp',
  });
  return res.data;
};

/** Update student profile (name). */
export const updateStudentProfile = async (data: {
  first_name?: string;
  surname?: string;
}): Promise<{ student: Student }> => {
  const res = await client.put('/auth/student/update', data);
  return res.data;
};

/** Join a class by class_id or join_code. Sends class_id if value is longer than 6 chars. */
export const joinClassByCode = async (idOrCode: string): Promise<{
  success: boolean; class_id: string; class_name: string; subject: string; message: string;
}> => {
  const isCode = idOrCode.length <= 6 && /^[A-Z0-9]+$/.test(idOrCode);
  const body = isCode ? { join_code: idOrCode.toUpperCase() } : { class_id: idOrCode };
  const res = await client.post('/auth/student/join-class', body);
  return res.data;
};

/** Get all classes the student is enrolled in. */
export const getStudentClasses = async (): Promise<{
  classes: Array<{ class_id: string; name: string; subject: string; education_level: string; teacher_name: string; school_name: string }>;
  active_class_id: string;
  total: number;
}> => {
  const res = await client.get('/auth/student/classes');
  return res.data;
};

/** Leave a class. */
export const leaveClass = async (class_id: string): Promise<{ success: boolean; remaining_classes: number; active_class_id: string | null }> => {
  const res = await client.delete('/auth/student/leave-class', { data: { class_id } });
  return res.data;
};

/** Delete student account. */
export const deleteStudentAccount = async (studentId: string): Promise<void> => {
  await client.delete(`/auth/student/${studentId}`);
};

// ── Student data ──────────────────────────────────────────────────────────────

/** All assignments for this student's class. */
export const getAssignments = async (class_id: string): Promise<Assignment[]> => {
  const res: AxiosResponse<Assignment[]> = await client.get('/assignments', {
    params: { class_id, status: 'all' },
  });
  return res.data;
};

/** Fetch question list for an answer key (student view — no answers included). */
export const getAnswerKeyQuestions = async (
  answer_key_id: string,
): Promise<{ questions: Array<{ question_number: number; question_text: string; marks: number }>; question_paper_text?: string }> => {
  const res = await client.get(`/answer-keys/${answer_key_id}/questions`);
  // Handle both old (flat array) and new (object) response shapes
  if (Array.isArray(res.data)) return { questions: res.data };
  return res.data ?? { questions: [] };
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
  answer_key_id?: string;
}): Promise<TeacherSubmission[]> => {
  // Cache key encodes params so different filter views each get their
  // own offline snapshot when used online. The teacher-wide slot
  // (just `teacher_id`) is the broadest and acts as the offline
  // fallback for narrower views — see below.
  const specificKey = `submissions:${JSON.stringify(params ?? {})}`;
  const teacherWideKey = params?.teacher_id
    ? `submissions:${JSON.stringify({ teacher_id: params.teacher_id })}`
    : null;

  try {
    return await withCache(specificKey, async () => {
      const res: AxiosResponse<TeacherSubmission[]> = await client.get('/submissions', { params });
      // Mirror the result into the teacher-wide slot too, so that
      // narrower views (e.g. {class_id, teacher_id}) hitting offline
      // for the first time can still draw on whatever the home screen
      // already cached. We only mirror when the request itself is the
      // broad teacher-wide one — we don't want a class-filtered result
      // to overwrite the wide cache, that'd corrupt other screens.
      return res.data;
    });
  } catch (err) {
    const isOffline = !!(err && typeof err === 'object' && (err as { isOffline?: boolean }).isOffline);
    if (!isOffline || !teacherWideKey || teacherWideKey === specificKey) throw err;

    // Fallback: try the teacher-wide cache slot and filter client-side
    // to match the requested params. Lets HomeworkDetail render its
    // submissions list using data the HomeScreen already cached, even
    // though the param shapes (and therefore the cache keys) differ.
    const wide = await readCacheOnly<TeacherSubmission[]>(teacherWideKey);
    if (!wide) throw err;
    return wide.filter((s) => {
      if (params?.class_id && s.class_id !== params.class_id) return false;
      if (params?.answer_key_id && s.answer_key_id !== params.answer_key_id) return false;
      if (params?.status && s.status !== params.status) return false;
      return true;
    });
  }
};

/** Teacher: approve a student submission. */
export const approveSubmission = async (submission_id: string): Promise<void> => {
  try {
    await client.post(`/submissions/${submission_id}/approve`);
  } catch (err) {
    if (!isOfflineErr(err)) throw err;
    await enqueueMutation({ type: 'approve_submission', submission_id });
  }
};

/**
 * Cascade-delete a submission. Also removes the linked mark + annotated
 * image blob in GCS. Weakness profile is not rolled back (out of scope).
 */
export const deleteSubmission = async (
  submission_id: string,
): Promise<{ deleted: boolean; cascades?: { mark: boolean; image_blob: boolean; training_sample: boolean } }> => {
  try {
    const res = await client.delete(`/submissions/${submission_id}`);
    return res.data;
  } catch (err) {
    if (!isOfflineErr(err)) throw err;
    await enqueueMutation({ type: 'delete_submission', submission_id });
    // Synthesise a delete-shaped success so callers don't break.
    return { deleted: true };
  }
};

/**
 * Same cascade, keyed by mark_id. Used by post-scan views (MarkResult)
 * that have the mark but not the linked submission id.
 */
export const deleteMark = async (
  mark_id: string,
): Promise<{ deleted: boolean; submission_id?: string | null; cascades?: { mark: boolean; image_blob: boolean; training_sample: boolean } }> => {
  try {
    const res = await client.delete(`/marks/${mark_id}`);
    return res.data;
  } catch (err) {
    if (!isOfflineErr(err)) throw err;
    await enqueueMutation({ type: 'delete_mark', mark_id });
    return { deleted: true };
  }
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
  // LLM generation + Cloud Function cold start can exceed the default 35s.
  const res: AxiosResponse<AssistantResponse> = await client.post('/teacher/assistant', params, { timeout: 90000 });
  return res.data;
};

// teacherAssistantExport / AssistantExportResult removed 2026-04-22. The
// /teacher/assistant/export backend endpoint was deleted because it created
// draft answer_keys that polluted analytics counts. The chat endpoint above
// still emits structured homework/quiz content — nothing persists it now.

// ── Mutation queue wiring ────────────────────────────────────────────────────
//
// The mutation queue calls back into these api functions during
// replay. We register them lazily here (after the functions are
// declared above) to avoid an import cycle: mutationQueue.ts is
// imported by api.ts to enqueue offline mutations, and api.ts gives
// it the replay handles via this register call.
import { _registerReplayApi } from './mutationQueue';
_registerReplayApi({
  approveSubmission,
  deleteSubmission,
  deleteMark,
  updateMark: (id, payload) => updateMark(id, payload as Parameters<typeof updateMark>[1]),
});
