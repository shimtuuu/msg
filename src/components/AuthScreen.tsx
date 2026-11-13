import React, { useState } from 'react';
import {
  AlertCircle,
  Eye,
  EyeOff,
  Lock,
} from 'lucide-react';
import type { AuthUser } from '../types/messenger';
import {
  normalizeEmail,
  validateLoginInput,
} from '../utils/authValidation';

interface AuthScreenProps {
  initialError?: string | null;
  onAuthenticated: (payload: { token: string; user: AuthUser }) => void;
}

export function AuthScreen({
  initialError = null,
  onAuthenticated,
}: AuthScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const check = validateLoginInput(email, password);
    if (!check.valid) {
      setError(check.error ?? 'Проверьте введённые данные');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: normalizeEmail(email),
          password,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        token?: string;
        user?: AuthUser;
      };
      if (!res.ok || !data.token || !data.user) {
        throw new Error(data.error || 'Не удалось выполнить вход');
      }
      onAuthenticated({ token: data.token, user: data.user });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg overflow-hidden">
        {/* Top corporate header */}
        <div className="px-6 py-5 bg-[#1e1e2e] text-white border-b border-white/10">
          <div className="flex items-center gap-3.5">
            <svg
              viewBox="0 0 36 36"
              className="w-10 h-10 shrink-0"
              role="img"
              aria-label="Логотип МТС"
            >
              <rect width="36" height="36" rx="7" fill="#FF0032" />
              <text
                x="5.5"
                y="15"
                fill="#FFFFFF"
                fontSize="11.5"
                fontWeight="800"
                fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
              >
                М
              </text>
              <text
                x="23.5"
                y="15"
                fill="#FFFFFF"
                fontSize="11.5"
                fontWeight="800"
                fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
              >
                Т
              </text>
              <text
                x="23"
                y="30"
                fill="#FFFFFF"
                fontSize="11.5"
                fontWeight="800"
                fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
              >
                С
              </text>
            </svg>
            <div>
              <h1 className="font-display text-lg font-semibold tracking-tight">
                МТС Мессенджер
              </h1>
              <p className="text-xs text-[#8990b3]">
                Авторизация в защищённом корпоративном пространстве
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
          {error && (
            <div
              role="alert"
              data-testid="auth-error"
              className="px-3.5 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="auth-email"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Корпоративный email
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@corp.internal"
              required
              className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="auth-password"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Пароль
            </label>
            <div className="relative">
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Введите пароль"
                required
                className="w-full h-10 pl-3 pr-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                className="absolute right-2.5 top-2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
          >
            <Lock className="w-4 h-4" aria-hidden="true" />
            <span>{submitting ? 'Проверка учётных данных…' : 'Войти в систему'}</span>
          </button>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center pt-1">
            Учётные записи создаются администраторами и модераторами организации.
          </p>
        </form>
      </div>
    </div>
  );
}
