/**
 * CONVERA — Password Strength Checker
 *
 * Validates password strength against the platform's security policy.
 * Designed for Arabic RTL UI. Score is 0–5 (one per rule met).
 */

export interface PasswordRule {
  key: string;
  label: string;   // Arabic label shown in UI
  met: boolean;
}

export interface PasswordStrength {
  score: number;           // 0–5
  isStrong: boolean;       // all 5 rules met
  label: string;           // Arabic label
  color: string;           // MoMaH brand color
  barWidth: string;        // CSS percentage for progress bar
  rules: PasswordRule[];
}

const RULES: Array<{ key: string; label: string; test: (p: string) => boolean }> = [
  {
    key: 'length',
    label: '٨ أحرف على الأقل',
    test: (p) => p.length >= 8,
  },
  {
    key: 'uppercase',
    label: 'حرف كبير واحد على الأقل (A–Z)',
    test: (p) => /[A-Z]/.test(p),
  },
  {
    key: 'lowercase',
    label: 'حرف صغير واحد على الأقل (a–z)',
    test: (p) => /[a-z]/.test(p),
  },
  {
    key: 'number',
    label: 'رقم واحد على الأقل (0–9)',
    test: (p) => /[0-9]/.test(p),
  },
  {
    key: 'special',
    label: 'رمز خاص واحد على الأقل (!@#$%^&*…)',
    test: (p) => /[^A-Za-z0-9]/.test(p),
  },
];

// MoMaH brand colors mapped to score:
//   0–1 → danger  (#C05728)
//   2   → warning (#FFC845)
//   3   → info    (#00A79D)
//   4   → light-green (#87BA26 tinted)
//   5   → success (#87BA26)

const SCORE_LABELS = ['ضعيفة جداً', 'ضعيفة', 'متوسطة', 'جيدة', 'قوية', 'قوية جداً'];
const SCORE_COLORS = ['#C05728', '#C05728', '#FFC845', '#00A79D', '#87BA26', '#045859'];
const SCORE_WIDTHS = ['10%', '20%', '40%', '60%', '80%', '100%'];

export function checkPasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return {
      score: 0,
      isStrong: false,
      label: 'أدخل كلمة المرور',
      color: '#DDE2E8',
      barWidth: '0%',
      rules: RULES.map(r => ({ key: r.key, label: r.label, met: false })),
    };
  }

  const rules: PasswordRule[] = RULES.map(r => ({
    key: r.key,
    label: r.label,
    met: r.test(password),
  }));

  const score = rules.filter(r => r.met).length;

  return {
    score,
    isStrong: score === 5,
    label: SCORE_LABELS[score],
    color: SCORE_COLORS[score],
    barWidth: SCORE_WIDTHS[score],
    rules,
  };
}

/**
 * Returns a brief validation error message if the password doesn't meet
 * minimum requirements, or null if it's acceptable.
 */
export function validatePasswordPolicy(password: string): string | null {
  const strength = checkPasswordStrength(password);
  if (strength.score < 3) {
    const unmet = strength.rules.filter(r => !r.met).map(r => r.label);
    return `كلمة المرور لا تستوفي المتطلبات: ${unmet.join(' · ')}`;
  }
  return null;
}
