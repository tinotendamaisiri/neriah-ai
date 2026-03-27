// src/services/api.ts
// Typed fetch wrapper for all Neriah backend endpoints.
// Uses axios under the hood. Auth token is attached via request interceptor.

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Class, Student, AnswerKey, MarkResult } from '../types';

// TODO: read from app.json extras or environment variable
const BASE_URL = 'https://neriah-apim-dev.azure-api.net/api';

const client: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30000, // 30s — marking pipeline can take up to 20s
  headers: { 'Content-Type': 'application/json' },
});

// ── Auth interceptor ──────────────────────────────────────────────────────────

client.interceptors.request.use(async (config) => {
  // TODO: read JWT from AsyncStorage and attach as Authorization: Bearer <token>
  const token = await AsyncStorage.getItem('neriah_jwt');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (error) => {
    // TODO: handle 401 → clear token → redirect to login
    // TODO: handle 429 → show "too many requests" toast
    return Promise.reject(error);
  }
);

// ── Classes ───────────────────────────────────────────────────────────────────

export const listClasses = async (): Promise<Class[]> => {
  // TODO: implement
  const res: AxiosResponse<Class[]> = await client.get('/classes');
  return res.data;
};

export const createClass = async (payload: {
  name: string;
  education_level: string;
}): Promise<Class> => {
  // TODO: implement
  const res: AxiosResponse<Class> = await client.post('/classes', payload);
  return res.data;
};

// ── Students ──────────────────────────────────────────────────────────────────

export const listStudents = async (class_id: string): Promise<Student[]> => {
  // TODO: implement
  const res: AxiosResponse<Student[]> = await client.get('/students', { params: { class_id } });
  return res.data;
};

export const createStudent = async (payload: {
  class_id: string;
  name: string;
  register_number?: string;
}): Promise<Student> => {
  // TODO: implement
  const res: AxiosResponse<Student> = await client.post('/students', payload);
  return res.data;
};

// ── Answer Keys ───────────────────────────────────────────────────────────────

export const listAnswerKeys = async (class_id: string): Promise<AnswerKey[]> => {
  // TODO: implement
  const res: AxiosResponse<AnswerKey[]> = await client.get('/answer-keys', { params: { class_id } });
  return res.data;
};

// ── Marking ───────────────────────────────────────────────────────────────────

export const submitMark = async (payload: {
  image_uri: string;   // local file URI from camera
  student_id: string;
  answer_key_id: string;
}): Promise<MarkResult> => {
  // TODO: implement — create FormData with image file, POST to /mark
  // TODO: read image from file system as blob, append to FormData
  // TODO: set Content-Type: multipart/form-data on this request specifically
  const formData = new FormData();
  formData.append('student_id', payload.student_id);
  formData.append('answer_key_id', payload.answer_key_id);
  formData.append('source', 'app');
  // TODO: append image file to formData

  const res: AxiosResponse<MarkResult> = await client.post('/mark', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
};
