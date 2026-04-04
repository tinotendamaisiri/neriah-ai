// src/App.tsx
// Router + layout shell for the Neriah web dashboard.
// Auth gate: redirects to /login if no JWT in localStorage.

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ClassView from './pages/ClassView';

// ── Protected layout ──────────────────────────────────────────────────────────

function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-6">
          <NavLink to="/dashboard" className="flex items-center gap-2 text-gray-900 no-underline">
            <span className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center text-white font-bold text-sm">N</span>
            <span className="font-semibold">Neriah</span>
          </NavLink>

          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `text-sm font-medium no-underline ${isActive ? 'text-brand-600' : 'text-gray-500 hover:text-gray-700'}`
            }
          >
            Dashboard
          </NavLink>

          <div className="ml-auto flex items-center gap-3">
            {user && (
              <span className="text-sm text-gray-500">
                {user.first_name} {user.surname}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Log out
            </button>
          </div>
        </div>
      </nav>

      {/* Page content */}
      <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}

// ── Auth guard ─────────────────────────────────────────────────────────────────

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Layout>{children}</Layout>;
}

// ── App ────────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
          <Route
            path="/classes/:classId"
            element={
              <RequireAuth>
                <ClassView />
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
