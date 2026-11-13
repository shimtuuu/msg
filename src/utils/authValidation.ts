export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidCorporateEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized);
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateLoginInput(
  email: string,
  password: string
): ValidationResult {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { valid: false, error: 'Введите корпоративный email' };
  }
  if (!isValidCorporateEmail(normalized)) {
    return { valid: false, error: 'Некорректный формат email' };
  }
  if (!password || password.length < 6) {
    return { valid: false, error: 'Пароль должен содержать минимум 6 символов' };
  }
  return { valid: true };
}

export interface RegisterInput {
  name: string;
  email: string;
  department: string;
  title: string;
  password: string;
  confirmPassword?: string;
}

export function validateRegisterInput(input: RegisterInput): ValidationResult {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const department = input.department.trim();
  const title = input.title.trim();

  if (name.length < 2) {
    return { valid: false, error: 'Укажите имя и фамилию (минимум 2 символа)' };
  }
  if (!email || !isValidCorporateEmail(email)) {
    return { valid: false, error: 'Введите корректный корпоративный email' };
  }
  if (department.length < 2) {
    return { valid: false, error: 'Укажите департамент или подразделение' };
  }
  if (title.length < 2) {
    return { valid: false, error: 'Укажите должность' };
  }
  if (!input.password || input.password.length < 6) {
    return { valid: false, error: 'Пароль должен содержать минимум 6 символов' };
  }
  if (
    input.confirmPassword !== undefined &&
    input.password !== input.confirmPassword
  ) {
    return { valid: false, error: 'Пароли не совпадают' };
  }
  return { valid: true };
}
