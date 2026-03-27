// src/types/index.ts
// Shared TypeScript types mirroring the backend Pydantic models.
// Keep in sync with backend/shared/models.py.

export type EducationLevel =
  | 'grade_1' | 'grade_2' | 'grade_3' | 'grade_4'
  | 'grade_5' | 'grade_6' | 'grade_7'
  | 'form_1' | 'form_2' | 'form_3' | 'form_4' | 'form_5' | 'form_6'
  | 'tertiary';

export type SubscriptionStatus = 'active' | 'trial' | 'expired' | 'suspended';

export type GradingVerdictEnum = 'correct' | 'incorrect' | 'partial';

export interface Teacher {
  id: string;
  phone: string;
  name: string;
  subscription_status: SubscriptionStatus;
  education_levels_active: EducationLevel[];
  created_at: string;
}

export interface Class {
  id: string;
  teacher_id: string;
  name: string;
  education_level: EducationLevel;
  student_ids: string[];
  created_at: string;
}

export interface Student {
  id: string;
  class_id: string;
  name: string;
  register_number?: string;
}

export interface Question {
  number: number;
  correct_answer: string;
  max_marks: number;
  marking_notes?: string;
}

export interface AnswerKey {
  id: string;
  class_id: string;
  subject: string;
  questions: Question[];
  generated: boolean;
  created_at: string;
}

export interface GradingVerdict {
  question_number: number;
  verdict: GradingVerdictEnum;
  awarded_marks: number;
  feedback?: string;
}

export interface Mark {
  id: string;
  student_id: string;
  answer_key_id: string;
  score: number;
  max_score: number;
  marked_image_url: string;
  timestamp: string;
}

// API response types
export interface MarkResult {
  mark_id: string;
  student_id: string;
  score: number;
  max_score: number;
  percentage: number;
  marked_image_url: string;
  verdicts: GradingVerdict[];
}

// Navigation param lists — add route params here as screens are built
export type RootTabParamList = {
  Home: undefined;
  Mark: { class_id?: string } | undefined;
  Analytics: { class_id?: string } | undefined;
  Settings: undefined;
};
