// src/pages/ClassView.tsx
// Drill-down: student list + per-student mark history, answer key management, add/delete students.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  listClasses,
  listStudents,
  listAnswerKeys,
  getAnalytics,
  createStudent,
  deleteStudent,
  deleteClass,
  Class,
  Student,
  AnswerKey,
  AnalyticsResponse,
} from '../services/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

const LEVEL_LABELS: Record<string, string> = {
  grade_1: 'Grade 1', grade_2: 'Grade 2', grade_3: 'Grade 3',
  grade_4: 'Grade 4', grade_5: 'Grade 5', grade_6: 'Grade 6', grade_7: 'Grade 7',
  form_1: 'Form 1', form_2: 'Form 2', form_3: 'Form 3',
  form_4: 'Form 4', form_5: 'Form 5', form_6: 'Form 6',
  tertiary: 'Tertiary',
};

function pctColor(pct: number) {
  if (pct >= 70) return 'text-green-700';
  if (pct >= 50) return 'text-yellow-700';
  return 'text-red-600';
}

// ── Add Student Modal ─────────────────────────────────────────────────────────

interface AddStudentModalProps {
  classId: string;
  onClose: () => void;
  onAdded: (student: Student) => void;
}

function AddStudentModal({ classId, onClose, onAdded }: AddStudentModalProps) {
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [regNum, setRegNum] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !surname.trim()) {
      setError('First name and surname are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const student = await createStudent({
        class_id: classId,
        first_name: firstName.trim(),
        surname: surname.trim(),
        register_number: regNum.trim() || undefined,
      });
      onAdded(student);
    } catch {
      setError('Could not add student. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-5">Add Student</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">First name</label>
            <input
              ref={firstRef}
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="e.g. Tendai"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Surname</label>
            <input
              type="text"
              value={surname}
              onChange={(e) => setSurname(e.target.value)}
              placeholder="e.g. Moyo"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Register number <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={regNum}
              onChange={(e) => setRegNum(e.target.value)}
              placeholder="e.g. 01"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 font-semibold py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-brand-500 hover:bg-brand-600 disabled:bg-brand-400 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Adding...' : 'Add student'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── ClassView ─────────────────────────────────────────────────────────────────

type Tab = 'students' | 'answer_keys';

export default function ClassView() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();

  const [cls, setCls] = useState<Class | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [answerKeys, setAnswerKeys] = useState<AnswerKey[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('students');
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(null);
  const [confirmDeleteClass, setConfirmDeleteClass] = useState(false);
  const [deletingClass, setDeletingClass] = useState(false);

  const loadData = useCallback(async () => {
    if (!classId) return;
    setLoading(true);
    setError('');
    try {
      const [allClasses, studentList, keys, analyticsData] = await Promise.all([
        listClasses(),
        listStudents(classId),
        listAnswerKeys(classId),
        getAnalytics({ class_id: classId }),
      ]);
      const found = allClasses.find((c) => c.id === classId) ?? null;
      setCls(found);
      setStudents(studentList);
      setAnswerKeys(keys);
      setAnalytics(analyticsData);
    } catch {
      setError('Could not load class data.');
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleStudentAdded = (student: Student) => {
    setStudents((prev) => [...prev, student]);
    setShowAddStudent(false);
  };

  const handleDeleteStudent = async (studentId: string) => {
    setDeletingStudentId(studentId);
    try {
      await deleteStudent(studentId);
      setStudents((prev) => prev.filter((s) => s.id !== studentId));
    } catch {
      // Silently fail — user can try again
    } finally {
      setDeletingStudentId(null);
    }
  };

  const handleDeleteClass = async () => {
    if (!classId) return;
    setDeletingClass(true);
    try {
      await deleteClass(classId);
      navigate('/dashboard', { replace: true });
    } catch {
      setDeletingClass(false);
      setConfirmDeleteClass(false);
    }
  };

  // Build per-student analytics map
  const studentAnalytics = new Map(
    analytics?.student_summaries?.map((s) => [s.student_id, s]) ?? [],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-red-600 mb-3">{error}</p>
        <button onClick={loadData} className="text-sm text-brand-600 font-semibold hover:text-brand-700">
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      {showAddStudent && classId && (
        <AddStudentModal
          classId={classId}
          onClose={() => setShowAddStudent(false)}
          onAdded={handleStudentAdded}
        />
      )}

      {/* Confirm delete class dialog */}
      {confirmDeleteClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Delete class?</h2>
            <p className="text-sm text-gray-600 mb-6">
              This will permanently delete <strong>{cls?.name}</strong> and all its students and
              answer keys. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteClass(false)}
                className="flex-1 border border-gray-300 text-gray-700 font-semibold py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteClass}
                disabled={deletingClass}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
              >
                {deletingClass ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={() => navigate('/dashboard')}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← Dashboard
            </button>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{cls?.name ?? 'Class'}</h1>
          <div className="flex items-center gap-3 mt-1">
            {cls && (
              <span className="text-xs font-semibold text-brand-700 bg-brand-50 rounded-full px-2.5 py-0.5">
                {LEVEL_LABELS[cls.education_level] ?? cls.education_level}
              </span>
            )}
            {cls?.subject && (
              <span className="text-sm text-gray-500">{cls.subject}</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setConfirmDeleteClass(true)}
          className="text-sm text-red-500 hover:text-red-700 font-medium"
        >
          Delete class
        </button>
      </div>

      {/* Analytics summary */}
      {analytics && analytics.total_marks > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Total Marks</p>
            <p className="text-2xl font-bold text-gray-900">{analytics.total_marks}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Avg Score</p>
            <p className="text-2xl font-bold text-gray-900">
              {Math.round(analytics.average_score * 10) / 10}
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Avg %</p>
            <p className={`text-2xl font-bold ${pctColor(Math.round(analytics.average_percentage))}`}>
              {Math.round(analytics.average_percentage)}%
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {(['students', 'answer_keys'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              tab === t
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'students' ? `Students (${students.length})` : `Answer Keys (${answerKeys.length})`}
          </button>
        ))}
      </div>

      {/* ── Students tab ── */}
      {tab === 'students' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              {students.length === 0 ? 'No students yet.' : `${students.length} student${students.length !== 1 ? 's' : ''}`}
            </p>
            <button
              onClick={() => setShowAddStudent(true)}
              className="text-sm bg-brand-500 hover:bg-brand-600 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              + Add Student
            </button>
          </div>

          {students.length === 0 ? (
            <div className="text-center py-16 bg-white border border-dashed border-gray-300 rounded-2xl">
              <p className="text-gray-500 text-sm">Add students to start marking.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">#</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Marks</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Avg Score</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Avg %</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Latest</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {students.map((student) => {
                    const summary = studentAnalytics.get(student.id);
                    const avgPct = summary ? Math.round(summary.average_percentage) : null;
                    return (
                      <tr key={student.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-400">
                          {student.register_number ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-brand-700">
                                {student.first_name[0]?.toUpperCase()}
                              </span>
                            </div>
                            <span className="text-sm font-semibold text-gray-900">
                              {student.first_name} {student.surname}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {summary?.mark_count ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {summary ? Math.round(summary.average_score * 10) / 10 : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold">
                          {avgPct !== null ? (
                            <span className={pctColor(avgPct)}>{avgPct}%</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {summary?.latest_mark
                            ? `${summary.latest_mark.score}/${summary.latest_mark.max_score}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDeleteStudent(student.id)}
                            disabled={deletingStudentId === student.id}
                            className="text-xs text-red-400 hover:text-red-600 disabled:text-gray-300 transition-colors"
                          >
                            {deletingStudentId === student.id ? '...' : 'Remove'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Answer Keys tab ── */}
      {tab === 'answer_keys' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              {answerKeys.length === 0 ? 'No answer keys yet.' : `${answerKeys.length} key${answerKeys.length !== 1 ? 's' : ''}`}
            </p>
          </div>

          {answerKeys.length === 0 ? (
            <div className="text-center py-16 bg-white border border-dashed border-gray-300 rounded-2xl">
              <p className="text-gray-500 text-sm mb-1">No answer keys for this class.</p>
              <p className="text-xs text-gray-400">Create answer keys from the mobile app to start marking.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {answerKeys.map((ak) => (
                <div
                  key={ak.id}
                  className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-gray-900">
                        {ak.title ?? ak.subject}
                      </p>
                      <span
                        className={`text-xs font-semibold rounded-full px-2 py-0.5 ${
                          ak.open_for_submission
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {ak.open_for_submission ? 'Open' : 'Closed'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {ak.subject}{ak.total_marks ? ` · ${ak.total_marks} marks` : ''}
                      {' · '}{ak.questions.length} question{ak.questions.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <p className="text-xs text-gray-400">
                    {new Date(ak.created_at).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
