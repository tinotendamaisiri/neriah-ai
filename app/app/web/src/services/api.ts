// src/services/api.ts
// Typed API client for all Neriah backend endpoints (web dashboard).
// JWT is stored in localStorage and attached automatically.

import axios, { AxiosInstance, AxiosResponse } from 'axios';

// In development, Vite proxies /api → localhost:7071 (see vite.config.ts).
// In production, set VITE_API_BASE_URL to the APIM endpoint.
const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

export const JWT_KEY = 'neriah_jwt';
export const USER_KEY = 'neriah_user';

// ── Axios instance ─────────────────────────────────────────────────────────────

const client: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 35000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem(JWT_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let _onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  _onUnauthorized = fn;
};

client.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401 && _onUnauthorized) {
      _onUnauthorized();
    }
    return Promise.reject(error);
  },
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type EducationLevel =
  | 'grade_1' | 'grade_2' | 'grade_3' | 'grade_4' | 'grade_5' | 'grade_6' | 'grade_7'
  | 'form_1' | 'form_2' | 'form_3' | 'form_4' | 'form_5' | 'form_6'
  | 'tertiary';

export interface Teacher {
  id: string;
  phone: string;
  first_name: string;
  surname: string;
  email?: string;
  school?: string;
  subscription_status: string;
  created_at: string;
}

export interface Class {
  id: string;
  teacher_id: string;
  name: string;
  education_level: EducationLevel;
  subject?: string;
  join_code?: string;
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
}

export interface AnswerKey {
  id: string;
  class_id: string;
  subject: string;
  title?: string;
  education_level?: string;
  total_marks?: number;
  open_for_submission: boolean;
  questions: Array<{ number: number; correct_answer: string; max_marks: number }>;
  created_at: string;
}

export interface Mark {
  id: string;
  student_id: string;
  answer_key_id: string;
  score: number;
  max_score: number;
  percentage?: number;
  marked_image_url?: string;
  source: string;
  approved: boolean;
  feedback?: string;
  timestamp: string;
}

export interface OtpSentResponse {
  verification_id: string;
  message: string;
}

export interface VerifyResponse {
  token: string;
  role: string;
  user_id: string;
  first_name: string;
  surname: string;
  phone: string;
  school?: string;
}

export interface AuthUser {
  id: string;
  phone: string;
  role: string;
  first_name: string;
  surname: string;
  school?: string;
}

export interface AnalyticsResponse {
  class_id?: string;
  total_marks: number;
  average_score: number;
  average_percentage: number;
  student_summaries?: Array<{
    student_id: string;
    name: string;
    mark_count: number;
    average_score: number;
    average_percentage: number;
    latest_mark?: { score: number; max_score: number; timestamp: string };
  }>;
}

// ── Auth ───────────────────────────────────────────────────────────────────────

export const requestLoginOtp = async (phone: string): Promise<OtpSentResponse> => {
  const res: AxiosResponse<OtpSentResponse> = await client.post('/auth/login', { phone });
  return res.data;
};

export const requestRegisterOtp = async (payload: {
  phone: string;
  first_name: string;
  surname: string;
}): Promise<OtpSentResponse> => {
  const res: AxiosResponse<OtpSentResponse> = await client.post('/auth/register', payload);
  return res.data;
};

export const verifyOtp = async (payload: {
  verification_id: string;
  otp_code: string;
}): Promise<VerifyResponse> => {
  const res: AxiosResponse<VerifyResponse> = await client.post('/auth/verify', payload);
  return res.data;
};

export const resendOtp = async (verification_id: string): Promise<OtpSentResponse> => {
  const res: AxiosResponse<OtpSentResponse> = await client.post('/auth/resend-otp', {
    verification_id,
  });
  return res.data;
};

export const getMe = async (): Promise<Teacher> => {
  const res: AxiosResponse<Teacher> = await client.get('/auth/me');
  return res.data;
};

// ── Classes ────────────────────────────────────────────────────────────────────

export const listClasses = async (): Promise<Class[]> => {
  const res: AxiosResponse<Class[]> = await client.get('/classes');
  return res.data;
};

export const createClass = async (payload: {
  name: string;
  education_level: string;
  subject?: string;
}): Promise<Class> => {
  const res: AxiosResponse<Class> = await client.post('/classes', payload);
  return res.data;
};

export const updateClass = async (
  class_id: string,
  payload: Partial<Pick<Class, 'name' | 'subject'>>,
): Promise<Class> => {
  const res: AxiosResponse<Class> = await client.put(`/classes/${class_id}`, payload);
  return res.data;
};

export const deleteClass = async (class_id: string): Promise<void> => {
  await client.delete(`/classes/${class_id}`);
};

// ── Students ───────────────────────────────────────────────────────────────────

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
  students: Array<{ first_name: string; surname: string; register_number?: string }>;
}): Promise<{ created: Student[]; errors: Array<{ index: number; error: string }> }> => {
  const res = await client.post('/students/batch', payload);
  return res.data;
};

export const deleteStudent = async (student_id: string): Promise<void> => {
  await client.delete(`/students/${student_id}`);
};

// ── Answer keys ────────────────────────────────────────────────────────────────

export const listAnswerKeys = async (class_id: string): Promise<AnswerKey[]> => {
  const res: AxiosResponse<AnswerKey[]> = await client.get('/answer-keys', {
    params: { class_id },
  });
  return res.data;
};

export const createAnswerKey = async (payload: {
  class_id: string;
  subject: string;
  title?: string;
  education_level?: string;
  open_for_submission?: boolean;
  auto_generate?: boolean;
  question_paper_text?: string;
}): Promise<AnswerKey> => {
  const res: AxiosResponse<AnswerKey> = await client.post('/answer-keys', payload);
  return res.data;
};

export const updateAnswerKey = async (
  answer_key_id: string,
  payload: Partial<Pick<AnswerKey, 'title' | 'subject' | 'open_for_submission' | 'total_marks'>>,
): Promise<AnswerKey> => {
  const res: AxiosResponse<AnswerKey> = await client.put(`/answer-keys/${answer_key_id}`, payload);
  return res.data;
};

export const deleteAnswerKey = async (answer_key_id: string): Promise<void> => {
  await client.delete(`/answer-keys/${answer_key_id}`);
};

// ── Marks ──────────────────────────────────────────────────────────────────────

export const updateMark = async (
  mark_id: string,
  payload: { score?: number; max_score?: number; feedback?: string; approved?: boolean },
): Promise<Mark> => {
  const res: AxiosResponse<Mark> = await client.put(`/marks/${mark_id}`, payload);
  return res.data;
};

// ── Analytics ──────────────────────────────────────────────────────────────────

export const getAnalytics = async (params: {
  class_id?: string;
  student_id?: string;
}): Promise<AnalyticsResponse> => {
  const res: AxiosResponse<AnalyticsResponse> = await client.get('/analytics', { params });
  return res.data;
};
