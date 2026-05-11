// ─── Supabase Error Handler ──────────────────────────────────────
// Maps raw database/RLS errors to user-friendly Arabic messages.
// Always logs the technical error to console for debugging.

const ERROR_MAP: Array<{ pattern: RegExp; message: string }> = [
  // ─── Empty-field validation (added 2026-05-11) ──────────────────
  // These must come BEFORE the generic "invalid login credentials" pattern
  // so that explicit empty-field submissions yield a precise hint, not the
  // generic "credentials wrong" message. The patterns also cover Supabase
  // GoTrue's `validation_failed` error_code which arrives as plain text
  // (e.g. "missing email or phone").
  {
    pattern: /CONVERA_EMPTY_BOTH|empty email and password/i,
    message: 'يرجى التأكد من إدخال البريد الإلكتروني وكلمة المرور.',
  },
  {
    pattern: /CONVERA_EMPTY_EMAIL|missing email or phone|missing[_\s]+email|empty email|email is required|email[_\s]+required/i,
    message: 'يرجى إدخال البريد الإلكتروني.',
  },
  {
    pattern: /CONVERA_EMPTY_PASSWORD|missing[_\s]+password|empty password|password is required|password[_\s]+required/i,
    message: 'يرجى إدخال كلمة المرور.',
  },
  {
    pattern: /validation_failed/i,
    message: 'يرجى التأكد من إدخال البريد الإلكتروني وكلمة المرور.',
  },
  // ─── Auth errors (Supabase GoTrue) ─────────────────────────────
  // Account suspension — checked after successful GoTrue login
  {
    pattern: /ACCOUNT_SUSPENDED|الحساب موقوف/i,
    message: 'الحساب موقوف — تواصل مع مدير النظام لإعادة التفعيل',
  },
  // Supabase GoTrue ban_duration enforcement (banned users get this error)
  {
    pattern: /User is banned/i,
    message: 'الحساب موقوف — تواصل مع مدير النظام لإعادة التفعيل',
  },
  {
    pattern: /invalid login credentials|invalid.*password|invalid.*email|Invalid login/i,
    message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة. يرجى المحاولة مجدداً.',
  },
  {
    pattern: /email not confirmed/i,
    message: 'لم يتم تأكيد البريد الإلكتروني بعد. يرجى مراجعة صندوق الوارد.',
  },
  {
    pattern: /user not found|no user found/i,
    message: 'لا يوجد حساب مرتبط بهذا البريد الإلكتروني.',
  },
  {
    pattern: /password should be|password.*weak|too short|at least.*character/i,
    message: 'كلمة المرور ضعيفة — يجب أن تتضمن ٨ أحرف على الأقل، حروفاً كبيرة وصغيرة، أرقاماً، ورموزاً.',
  },
  {
    pattern: /same.*password|new password.*same/i,
    message: 'كلمة المرور الجديدة يجب أن تختلف عن القديمة.',
  },
  {
    pattern: /rate.*limit|too many requests|429/i,
    message: 'تم تجاوز الحد المسموح من المحاولات. يرجى الانتظار ثم المحاولة مجدداً.',
  },
  {
    pattern: /signup.*disabled|signups.*not allowed/i,
    message: 'التسجيل غير مفعَّل في هذه المنصة. تواصل مع مدير النظام.',
  },
  {
    pattern: /otp.*expired|token.*expired.*recovery|recovery.*token.*expired/i,
    message: 'رابط إعادة تعيين كلمة المرور انتهت صلاحيته. يرجى طلب رابط جديد.',
  },
  {
    pattern: /code.*verifier|pkce|invalid.*code/i,
    message: 'رابط إعادة التعيين غير صالح أو مستخدَم مسبقاً. يرجى طلب رابط جديد.',
  },
  // ─── Database / RLS errors ─────────────────────────────────────
  {
    pattern: /row-level security/i,
    message: 'ليس لديك صلاحية لتنفيذ هذا الإجراء. تواصل مع مدير النظام.',
  },
  {
    pattern: /violates foreign key/i,
    message: 'لا يمكن تنفيذ العملية — يوجد ارتباط ببيانات أخرى.',
  },
  {
    pattern: /duplicate key|unique.*constraint|already exists/i,
    message: 'هذا السجل موجود بالفعل. تحقق من البيانات وحاول مرة أخرى.',
  },
  {
    pattern: /check.*constraint|violates check/i,
    message: 'القيمة المدخلة غير صالحة. تحقق من الحقول وحاول مرة أخرى.',
  },
  {
    pattern: /not.null|null value/i,
    message: 'يوجد حقل مطلوب لم يتم تعبئته.',
  },
  {
    pattern: /permission denied/i,
    message: 'ليس لديك صلاحية للوصول إلى هذه البيانات.',
  },
  {
    pattern: /JWT expired|token.*expired|refresh_token/i,
    message: 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى.',
  },
  {
    pattern: /network|fetch|ECONNREFUSED|timeout/i,
    message: 'خطأ في الاتصال بالخادم. تحقق من اتصالك بالإنترنت.',
  },
  {
    pattern: /exceeds contract value|10%.*tolerance/i,
    message: 'المطالبة تتجاوز قيمة العقد المسموح بها (١٠%).',
  },
  {
    pattern: /approved.*claim.*edit|cannot modify/i,
    message: 'لا يمكن تعديل مطالبة معتمدة أو مغلقة.',
  },
];

const FALLBACK_MESSAGE = 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى أو التواصل مع الدعم الفني.';

export function friendlyError(error: unknown): string {
  const raw = extractMessage(error);

  // Always log technical details
  console.error('[CONVERA Error]', raw, error);

  // Match against known patterns
  for (const { pattern, message } of ERROR_MAP) {
    if (pattern.test(raw)) {
      return message;
    }
  }

  return FALLBACK_MESSAGE;
}

function extractMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const e = error as Record<string, any>;
    return e.message || e.error_description || e.msg || e.details || JSON.stringify(error);
  }
  return String(error);
}
