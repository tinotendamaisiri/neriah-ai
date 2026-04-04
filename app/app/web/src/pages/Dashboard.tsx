// src/pages/Dashboard.tsx
// Teacher overview: all classes with student counts, analytics summary, + New Class modal.

import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listClasses,
  listStudents,
  getAnalytics,
  createClass,
  Class,
  EducationLevel,
} from '../services/api';
import { useAuth } from '../context/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClassSummary {
  cls: Class;
  studentCount: number;
  avgPct: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LEVEL_LABELS: Record<string, string> = {
  grade_1: 'Grade 1', grade_2: 'Grade 2', grade_3: 'Grade 3',
  grade_4: 'Grade 4', grade_5: 'Grade 5', grade_6: 'Grade 6', grade_7: 'Grade 7',
  form_1: 'Form 1', form_2: 'Form 2', form_3: 'Form 3',
  form_4: 'Form 4', form_5: 'Form 5', form_6: 'Form 6',
  tertiary: 'Tertiary',
};

const EDUCATION_LEVELS: EducationLevel[] = [
  'grade_1','grade_2','grade_3','grade_4','grade_5','grade_6','grade_7',
  'form_1','form_2','form_3','form_4','form_5','form_6','tertiary',
];

// ── New Class Modal ────────────────────────────────────────────────────────────

interface NewClassModalProps {
  onClose: () => void;
  onCreated: (cls: Class) => void;
}

function NewClassModal({ onClose, onCreated }: NewClassModalProps) {
  const [name, setName] = useState('');
  const [level, setLevel] = useState<EducationLevel>('form_1');
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Class name is required.'); return; }
    setLoading(true);
    setError('');
    try {
      const cls = await createClass({
        name: name.trim(),
        education_level: level,
        subject: subject.trim() || undefined,
      });
      onCreated(cls);
    } catch {
      setError('Could not create class. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-5">New Class</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Class name</label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 4A Maths"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Education level</label>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as EducationLevel)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {EDUCATION_LEVELS.map((l) => (
                <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Subject <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Mathematics"
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
              {loading ? 'Creating...' : 'Create class'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const [summaries, setSummaries] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const classes = await listClasses();

      const enriched = await Promise.all(
        classes.map(async (cls) => {
          const [students, analytics] = await Promise.allSettled([
            listStudents(cls.id),
            getAnalytics({ class_id: cls.id }),
          ]);
          const studentCount = students.status === 'fulfilled' ? students.value.length : 0;
          const avgPct =
            analytics.status === 'fulfilled' && analytics.value.total_marks > 0
              ? Math.round(analytics.value.average_percentage)
              : null;
          return { cls, studentCount, avgPct };
        }),
      );

      setSummaries(enriched);
    } catch {
      setError('Could not load classes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleCreated = (cls: Class) => {
    setShowModal(false);
    setSummaries((prev) => [...prev, { cls, studentCount: 0, avgPct: null }]);
  };

  const totalStudents = summaries.reduce((n, s) => n + s.studentCount, 0);
  const classesWithData = summaries.filter((s) => s.avgPct !== null);
  const overallAvg =
    classesWithData.length > 0
      ? Math.round(classesWithData.reduce((n, s) => n + (s.avgPct ?? 0), 0) / classesWithData.length)
      : null;

  return (
    <>
      {showModal && (
        <NewClassModal onClose={() => setShowModal(false)} onCreated={handleCreated} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {user ? `Welcome back, ${user.first_name}` : 'Dashboard'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Here's an overview of your classes.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          + New Class
        </button>
      </div>

      {/* Stats row */}
      {!loading && summaries.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Classes</p>
            <p className="text-2xl font-bold text-gray-900">{summaries.length}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Total Students</p>
            <p className="text-2xl font-bold text-gray-900">{totalStudents}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Avg Score</p>
            <p className="text-2xl font-bold text-gray-900">
              {overallAvg !== null ? `${overallAvg}%` : '—'}
            </p>
          </div>
        </div>
      )}

      {/* Classes grid */}
      <h2 className="text-base font-semibold text-gray-700 mb-4">My Classes</h2>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-sm text-red-600 mb-3">{error}</p>
          <button
            onClick={loadData}
            className="text-sm text-brand-600 font-semibold hover:text-brand-700"
          >
            Try again
          </button>
        </div>
      ) : summaries.length === 0 ? (
        <div className="text-center py-20 bg-white border border-dashed border-gray-300 rounded-2xl">
          <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center mx-auto mb-4">
            <span className="text-brand-500 text-2xl font-bold">N</span>
          </div>
          <p className="text-gray-900 font-semibold mb-1">No classes yet</p>
          <p className="text-sm text-gray-500 mb-5">Create your first class to start marking.</p>
          <button
            onClick={() => setShowModal(true)}
            className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
          >
            + New Class
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {summaries.map(({ cls, studentCount, avgPct }) => (
            <Link
              key={cls.id}
              to={`/classes/${cls.id}`}
              className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-brand-400 hover:shadow-sm transition-all no-underline group"
            >
              {/* Level badge */}
              <span className="inline-block text-xs font-semibold text-brand-700 bg-brand-50 rounded-full px-2.5 py-0.5 mb-3">
                {LEVEL_LABELS[cls.education_level] ?? cls.education_level}
              </span>

              <h3 className="text-base font-bold text-gray-900 mb-0.5 group-hover:text-brand-700 transition-colors">
                {cls.name}
              </h3>
              {cls.subject && (
                <p className="text-sm text-gray-500 mb-3">{cls.subject}</p>
              )}

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <span className="text-sm text-gray-600">
                  <span className="font-semibold text-gray-900">{studentCount}</span> students
                </span>
                {avgPct !== null && (
                  <span
                    className={`text-sm font-semibold ${
                      avgPct >= 50 ? 'text-green-700' : 'text-red-600'
                    }`}
                  >
                    {avgPct}% avg
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
