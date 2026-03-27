// src/pages/ClassView.tsx
// Drill-down view: student list + mark history for a single class.

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

// TODO: import typed API client

interface Student {
  id: string;
  name: string;
  register_number?: string;
}

interface MarkSummary {
  student_id: string;
  latest_score: number;
  latest_max: number;
  timestamp: string;
}

export default function ClassView() {
  const { classId } = useParams<{ classId: string }>();
  const [students, setStudents] = useState<Student[]>([]);
  const [marksByStudent, setMarksByStudent] = useState<Record<string, MarkSummary>>({});
  const [loading, setLoading] = useState(true);
  const [className, setClassName] = useState('');

  useEffect(() => {
    if (!classId) return;
    // TODO: load class details (name, education level) from GET /api/classes/{classId}
    // TODO: load students from GET /api/students?class_id={classId}
    // TODO: load latest mark per student from GET /api/analytics?class_id={classId}
    // TODO: combine into marksByStudent map for the table
    setLoading(false);
  }, [classId]);

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 'bold', marginBottom: 4 }}>
        {className || 'Class'}
      </h1>
      <p style={{ color: '#888', marginBottom: 24 }}>{students.length} students</p>

      {/* TODO: add answer key selector / management */}
      {/* TODO: add "Export marks" button → CSV download */}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#555' }}>#</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#555' }}>Name</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#555' }}>Latest Score</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#555' }}>%</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#555' }}>Last Marked</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => {
            const mark = marksByStudent[student.id];
            const pct = mark ? Math.round((mark.latest_score / mark.latest_max) * 100) : null;
            return (
              <tr key={student.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '10px 12px', fontSize: 13, color: '#aaa' }}>{student.register_number ?? '—'}</td>
                <td style={{ padding: '10px 12px', fontSize: 14, fontWeight: 600 }}>{student.name}</td>
                <td style={{ padding: '10px 12px', fontSize: 14 }}>
                  {mark ? `${mark.latest_score}/${mark.latest_max}` : '—'}
                </td>
                <td style={{ padding: '10px 12px', fontSize: 14, color: pct !== null ? (pct >= 50 ? '#15803d' : '#dc2626') : '#aaa' }}>
                  {pct !== null ? `${pct}%` : '—'}
                </td>
                <td style={{ padding: '10px 12px', fontSize: 13, color: '#aaa' }}>
                  {mark ? new Date(mark.timestamp).toLocaleDateString() : '—'}
                </td>
              </tr>
            );
          })}
          {students.length === 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: 'center', padding: 32, color: '#aaa' }}>
                No students in this class yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
