// src/pages/Login.tsx
// Phone number + OTP login / registration for teachers on the web dashboard.
// Same two-step flow as the mobile app:
//   1. Enter phone → try login → if 404, show name fields → register
//   2. Enter OTP → verify → redirect to /dashboard

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  requestLoginOtp,
  requestRegisterOtp,
  verifyOtp,
  resendOtp,
} from '../services/api';
import { useAuth } from '../context/AuthContext';

const RESEND_COOLDOWN = 60;

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();

  // Step 1 — phone
  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [showNameFields, setShowNameFields] = useState(false);
  const [verificationId, setVerificationId] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 2 — OTP
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === 'otp') {
      setTimeout(() => otpRef.current?.focus(), 100);
    }
  }, [step]);

  // Auto-submit OTP when 6 digits entered
  useEffect(() => {
    if (otp.length === 6 && step === 'otp') {
      handleVerify();
    }
  }, [otp]);

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanPhone = phone.trim();
    if (!cleanPhone.startsWith('+')) {
      setError('Enter your number in international format, e.g. +263771234567');
      return;
    }

    setLoading(true);
    try {
      if (!showNameFields) {
        const res = await requestLoginOtp(cleanPhone);
        setVerificationId(res.verification_id);
        setStep('otp');
        setCooldown(RESEND_COOLDOWN);
      } else {
        if (!firstName.trim() || !surname.trim()) {
          setError('First name and surname are required.');
          return;
        }
        const res = await requestRegisterOtp({
          phone: cleanPhone,
          first_name: firstName.trim(),
          surname: surname.trim(),
        });
        setVerificationId(res.verification_id);
        setStep('otp');
        setCooldown(RESEND_COOLDOWN);
      }
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 404 && !showNameFields) {
        setShowNameFields(true);
        setError('');
      } else if (status === 409) {
        setError('This phone number is already registered. Leave name fields blank to log in.');
        setShowNameFields(false);
      } else {
        setError('Could not send OTP. Check your number and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (otp.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      const res = await verifyOtp({ verification_id: verificationId, otp_code: otp });
      login(res);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      const msg: string = err.response?.data?.error ?? '';
      if (msg.toLowerCase().includes('expired')) {
        setError('Code expired. Request a new one.');
      } else if (msg.toLowerCase().includes('attempt')) {
        setError('Too many incorrect attempts. Request a new code.');
      } else {
        setError('Incorrect code. Please try again.');
      }
      setOtp('');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setLoading(true);
    try {
      const res = await resendOtp(verificationId);
      setVerificationId(res.verification_id);
      setCooldown(RESEND_COOLDOWN);
      setOtp('');
      setError('');
    } catch {
      setError('Could not resend. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-10">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-brand-500 items-center justify-center mb-3">
            <span className="text-white text-3xl font-bold">N</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Neriah</h1>
          <p className="text-sm text-gray-500 mt-1">AI homework marking for teachers</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {step === 'phone' ? (
            <form onSubmit={handlePhoneSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Phone number
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+263771234567"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  autoFocus
                />
              </div>

              {showNameFields && (
                <>
                  <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                    No account found. Enter your name to create one.
                  </p>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">First name</label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="e.g. Tendai"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Surname</label>
                    <input
                      type="text"
                      value={surname}
                      onChange={(e) => setSurname(e.target.value)}
                      placeholder="e.g. Moyo"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                </>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-brand-500 hover:bg-brand-600 disabled:bg-brand-400 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
              >
                {loading ? 'Sending code...' : showNameFields ? 'Create account' : 'Continue'}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-4">
                  Enter the 6-digit code sent to <strong>{phone}</strong>
                </p>
                <input
                  ref={otpRef}
                  type="tel"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="------"
                  maxLength={6}
                  className="w-full border-2 border-brand-500 rounded-xl px-4 py-4 text-center text-3xl font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                onClick={handleVerify}
                disabled={loading || otp.length < 6}
                className="w-full bg-brand-500 hover:bg-brand-600 disabled:bg-brand-400 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>

              <div className="flex items-center justify-between text-sm">
                <button
                  onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ← Back
                </button>
                <button
                  onClick={handleResend}
                  disabled={cooldown > 0 || loading}
                  className={cooldown > 0 ? 'text-gray-400' : 'text-brand-600 hover:text-brand-700 font-semibold'}
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
