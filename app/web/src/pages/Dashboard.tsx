// src/pages/Dashboard.tsx
// Teacher overview: all classes, recent marks, quick stats.

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

// TODO: import typed API client once web API service is created (mirrors mobile/src/services/api.ts)

interface ClassSummary {
  id: string;
  name: string;
  education_level: string;
  student_count: number;
  last_marked?: string;
}

export default function Dashboard() {
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: call GET /api/classes, transform response into ClassSummary[]
    // TODO: for each class, call GET /api/students?class_id=... to get student_count
    // TODO: optimise — add ?include_summary=true param to backend to avoid N+1 requests
    setLoading(false);
  }, []);

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 'bold', margin: 0 }}>Dashboard</h1>
        {/* TODO: link to class creation flow */}
        <button style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          + New Class
        </button>
      </div>

      {/* TODO: add summary stats row: total students, marks this week, avg score */}

      <h2 style={{ fontSize: 18, fontWeight: '600', marginBottom: 12 }}>My Classes</h2>

      {classes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>
          <p>No classes yet. Create your first class to get started.</p>
          {/* TODO: add illustration */}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {classes.map((cls) => (
            <Link key={cls.id} to={`/classes/${cls.id}`} style={{ textDecoration: 'none' }}>
              <div style={{ background: '#fff', borderRadius: 8, padding: 20, border: '1px solid #e5e7eb', cursor: 'pointer' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: '#111' }}>{cls.name}</h3>
                <p style={{ margin: 0, fontSize: 13, color: '#888' }}>{cls.education_level.replace('_', ' ').toUpperCase()}</p>
                <p style={{ margin: '8px 0 0', fontSize: 13, color: '#555' }}>{cls.student_count} students</p>
                {cls.last_marked && (
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#aaa' }}>Last marked: {cls.last_marked}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
