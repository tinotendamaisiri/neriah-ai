// src/App.tsx
// Router + layout shell for the Neriah web dashboard.

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ClassView from './pages/ClassView';

export default function App() {
  // TODO: add auth guard — redirect to /login if no JWT in localStorage
  // TODO: add /login route with phone + OTP flow
  // TODO: add layout with sidebar nav for larger screens

  return (
    <BrowserRouter>
      <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
        {/* TODO: replace with proper Tailwind nav component */}
        <nav style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '12px 24px', display: 'flex', gap: 24, alignItems: 'center' }}>
          <span style={{ fontWeight: 'bold', fontSize: 18 }}>Neriah</span>
          <NavLink to="/dashboard" style={{ color: '#555', textDecoration: 'none' }}>Dashboard</NavLink>
        </nav>

        <main style={{ padding: '24px' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/classes/:classId" element={<ClassView />} />
            {/* TODO: add /settings, /answer-keys, /login routes */}
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
