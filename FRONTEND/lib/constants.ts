/**
 * CONVERA Platform Constants & Configuration
 * Arabic labels, MoMaH brand colors, status mappings, SLA thresholds
 */

import type {
  ClaimStatus,
  ContractType,
  UserRole,
  ChangeOrderType,
  ChangeOrderStatus,
  NotificationType,
} from './types';

// ─── MoMaH Official Brand Colors (from Ministry Brand Guidelines) ─

/**
 * Official MoMaH color palette
 * PANTONE references from Ministry Brand Guidelines V.01
 */
export const MOMAH_COLORS = {
  darkGreen: '#045859',      // PANTONE 7476C — Primary
  lightGreen: '#87BA26',     // PANTONE 376C  — Success
  grey: '#54565B',           // PANTONE CoolGrey11C
  white: '#FFFFFF',

  teal: '#00A79D',           // PANTONE 326C
  purple: '#502C7C',         // PANTONE 7680C
  orange: '#C05728',         // PANTONE 167C
  gold: '#FFC845',           // PANTONE 1225C
} as const;

// ─── Semantic Color Tokens (mapped to MoMaH brand) ─

export const COLOR_TOKENS = {
  primary: MOMAH_COLORS.darkGreen,
  primaryDark: '#034342',
  primaryLight: '#087272',
  primaryPale: '#E8F4F4',

  success: MOMAH_COLORS.lightGreen,
  successPale: '#F0F7E0',

  warning: MOMAH_COLORS.gold,
  warningPale: '#FFF8E0',

  danger: MOMAH_COLORS.orange,
  dangerPale: '#FAEEE8',

  info: MOMAH_COLORS.teal,
  infoPale: '#E0F4F3',

  textPrimary: '#1A1A2E',
  textSecondary: MOMAH_COLORS.grey,
  border: '#DDE2E8',
  bgPage: '#F7F8FA',
  bgSidebar: MOMAH_COLORS.darkGreen,
  bgTopbar: '#034342',
} as const;

// ─── Claim Status Labels (Arabic) ────────────────────────────────

/**
 * 5-Stage Workflow Status Labels
 * Arabic labels for all claim states
 */
export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  draft: 'مسودة',
  submitted: 'مُرسَلة',
  under_supervisor_review: 'مراجعة جهة الإشراف',
  returned_by_supervisor: 'مُرجَّعة من جهة الإشراف',
  under_auditor_review: 'مراجعة المدقق',
  returned_by_auditor: 'مُرجَّعة من المدقق',
  under_reviewer_check: 'فحص المراجع',
  pending_director_approval: 'بانتظار اعتماد المدير',
  approved: 'معتمدة',
  rejected: 'مرفوضة',
  cancelled: 'ملغاة',
};

// ─── Claim Status Colors (MoMaH Brand) ──────────────────────────

/**
 * Status color scheme using MoMaH official colors
 * Each status has bg, text, and border colors for UI components
 */
export const CLAIM_STATUS_COLORS: Record<
  ClaimStatus,
  { bg: string; text: string; border: string }
> = {
  draft: {
    bg: COLOR_TOKENS.bgPage,
    text: COLOR_TOKENS.textSecondary,
    border: COLOR_TOKENS.textSecondary,
  },
  submitted: {
    bg: COLOR_TOKENS.warningPale,
    text: MOMAH_COLORS.gold,
    border: MOMAH_COLORS.gold,
  },
  under_supervisor_review: {
    bg: COLOR_TOKENS.infoPale,
    text: MOMAH_COLORS.teal,
    border: MOMAH_COLORS.teal,
  },
  returned_by_supervisor: {
    bg: COLOR_TOKENS.dangerPale,
    text: MOMAH_COLORS.orange,
    border: MOMAH_COLORS.orange,
  },
  under_auditor_review: {
    bg: '#F3E5FF',
    text: MOMAH_COLORS.purple,
    border: MOMAH_COLORS.purple,
  },
  returned_by_auditor: {
    bg: COLOR_TOKENS.dangerPale,
    text: MOMAH_COLORS.orange,
    border: MOMAH_COLORS.orange,
  },
  under_reviewer_check: {
    bg: '#FCE7F3',
    text: '#EC4899',
    border: '#EC4899',
  },
  pending_director_approval: {
    bg: COLOR_TOKENS.warningPale,
    text: MOMAH_COLORS.gold,
    border: MOMAH_COLORS.gold,
  },
  approved: {
    bg: COLOR_TOKENS.successPale,
    text: MOMAH_COLORS.lightGreen,
    border: MOMAH_COLORS.lightGreen,
  },
  rejected: {
    bg: COLOR_TOKENS.dangerPale,
    text: '#EF4444',
    border: '#EF4444',
  },
  cancelled: {
    bg: COLOR_TOKENS.bgPage,
    text: COLOR_TOKENS.textSecondary,
    border: COLOR_TOKENS.textSecondary,
  },
};

// ─── Contract Type Labels ────────────────────────────────────────

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  consultancy:        'استشارات هندسية',
  supervision:        'استشارات هندسية اشرافية',
  construction:       'مقاولات',
  supply:             'توريد مواد',
  // kept for backward compatibility
  design:             'دراسات وتصاميم',
  design_supervision: 'دراسات وتصاميم وإشراف',
  maintenance:        'صيانة',
};

/**
 * Construction contract types that should NOT show staff grid
 */
export const CONSTRUCTION_TYPES: ContractType[] = ['construction', 'maintenance'];

export function isConstructionContract(type: ContractType): boolean {
  return CONSTRUCTION_TYPES.includes(type);
}

// ─── User Role Labels (Arabic) ──────────────────────────────────

/**
 * 5-stage workflow roles:
 * - director: Final approval authority (مدير الإدارة)
 * - reviewer: Governance/اعتماد alignment monitor (مراجع)
 * - auditor: Technical auditor (مدقق)
 * - supervisor: External consulting firm representative (جهة الإشراف)
 * - contractor: Project contractor/vendor (مقاول)
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  director:       'مدير الإدارة',
  final_approver: 'المعتمد النهائي',
  admin:          'مدقق',
  reviewer:       'مراجع',
  consultant:     'جهة الإشراف',
  contractor:     'مقاول',
  // Legacy aliases
  auditor:        'مدقق',
  supervisor:     'جهة الإشراف',
};

// ─── Role Colors ────────────────────────────────────────────────

/**
 * Color coding for roles in workflow visualization
 */
export const ROLE_COLORS: Record<UserRole, string> = {
  director:       MOMAH_COLORS.darkGreen,
  final_approver: '#026D69',
  admin:          MOMAH_COLORS.teal,
  reviewer:       MOMAH_COLORS.purple,
  consultant:     MOMAH_COLORS.gold,
  contractor:     MOMAH_COLORS.grey,
  // Legacy aliases
  auditor:        MOMAH_COLORS.teal,
  supervisor:     MOMAH_COLORS.gold,
};

// ─── Workflow Action Labels (Arabic) ─────────────────────────────

/**
 * Labels for workflow actions in the 5-stage pipeline
 */
export const WORKFLOW_ACTION_LABELS: Record<string, string> = {
  submit: 'تقديم',
  resubmit: 'إعادة تقديم',
  comment: 'تعليق',
  supervisor_review: 'مراجعة جهة الإشراف',
  supervisor_return: 'إرجاع من جهة الإشراف',
  auditor_review: 'مراجعة المدقق',
  auditor_return: 'إرجاع من المدقق',
  reviewer_check: 'فحص المراجع',
  reviewer_return: 'إرجاع من المراجع',
  director_approval: 'اعتماد المدير',
  approve: 'موافقة',
  reject: 'رفض',
  return: 'إرجاع',
  close: 'إغلاق',
};

// ─── Change Order Type Labels ───────────────────────────────────

export const CHANGE_ORDER_TYPE_LABELS: Record<ChangeOrderType, string> = {
  addition: 'إضافة بنود جديدة',
  quantity_modification: 'تعديل كميات',
  deletion: 'حذف بنود',
  duration_extension: 'تمديد المدة الزمنية',
};

// ─── Change Order Status Labels ─────────────────────────────────

export const CHANGE_ORDER_STATUS_LABELS: Record<ChangeOrderStatus, string> = {
  draft: 'مسودة',
  submitted: 'مُرسَلة',
  under_supervisor_review: 'مراجعة جهة الإشراف',
  under_auditor_review: 'مراجعة المدقق',
  under_reviewer_check: 'فحص المراجع',
  pending_director_approval: 'بانتظار اعتماد المدير',
  approved: 'معتمدة',
  rejected: 'مرفوضة',
};

// ─── Document Type Labels ──────────────────────────────────────

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  invoice: 'فاتورة / الفاتورة الضريبية',
  technical_report: 'التقرير التقني',
  completion_certificate: 'شهادة الإنجاز',
  audit_review_form: 'استمارة المراجعة والتدقيق',
  other: 'مستندات أخرى',
};

// ─── Page Titles (Arabic) ───────────────────────────────────────

export const PAGE_TITLES: Record<string, string> = {
  dashboard: 'لوحة التحكم',
  contracts: 'العقود',
  claims: 'المطالبات المالية',
  'new-claim': 'مطالبة مالية جديدة',
  'view-claim': 'عرض المطالبة',
  'contract-detail': 'تفاصيل العقد',
  workflow: 'سير الاعتماد',
  settings: 'الإعدادات',
  'change-orders': 'طلبات التغيير',
  'new-change-order': 'طلب تغيير جديد',
  reports: 'التقارير',
};

// ─── Navigation Items ───────────────────────────────────────────

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  href: string;
  roles?: UserRole[];
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'لوحة التحكم',
    icon: '📊',
    href: '/dashboard',
  },
  {
    id: 'contracts',
    label: 'العقود',
    icon: '📋',
    href: '/contracts',
  },
  {
    id: 'claims',
    label: 'المطالبات المالية',
    icon: '📄',
    href: '/claims',
  },
  {
    id: 'workflow',
    label: 'سير الاعتماد',
    icon: '✅',
    href: '/workflow',
    roles: ['director', 'final_approver', 'reviewer', 'auditor', 'supervisor'],
  },
  {
    id: 'reports',
    label: 'التقارير',
    icon: '📈',
    href: '/reports',
    roles: ['director', 'final_approver', 'reviewer'],
  },
  {
    id: 'executive',
    label: 'الأداء التنفيذي',
    icon: '🏛️',
    href: '/dashboard/executive',
    roles: ['director', 'final_approver', 'reviewer'],
  },
  {
    id: 'action-center',
    label: 'مركز الإجراءات',
    icon: '🎯',
    href: '/action-center',
    // No roles restriction — content is automatically role-scoped by the API
  },
  {
    id: 'permissions',
    label: 'إدارة الصلاحيات',
    icon: '🔐',
    href: '/permissions',
    roles: ['director', 'admin', 'auditor', 'reviewer'],
  },
  {
    id: 'import',
    label: 'الاستيراد الجماعي',
    icon: '📥',
    href: '/import',
    roles: ['director', 'admin'],
  },
  {
    id: 'users',
    label: 'إدارة المستخدمين',
    icon: '👥',
    href: '/users',
    roles: ['director', 'admin'],
  },
  {
    id: 'settings',
    label: 'الإعدادات',
    icon: '⚙️',
    href: '/settings',
  },
];

// ─── SLA & Governance Constants ─────────────────────────────────

/**
 * Supervisor review SLA: 3 working days maximum
 * Day 2: Warning notification sent
 * Day 3: Escalation notification + flag as breached
 */
export const SLA_SUPERVISOR_WARNING_DAYS = 2;
export const SLA_SUPERVISOR_BREACH_DAYS = 3;
export const SLA_SUPERVISOR_WARNING_HOURS = SLA_SUPERVISOR_WARNING_DAYS * 24;
export const SLA_SUPERVISOR_BREACH_HOURS = SLA_SUPERVISOR_BREACH_DAYS * 24;

/**
 * Change order limit: 10% of contract base value
 * Cumulative cap on all approved change orders
 * Warning trigger: 90% of limit (9%)
 */
export const CHANGE_ORDER_LIMIT_PCT = 10;
export const CHANGE_ORDER_WARNING_PCT = 9;

/**
 * Financial defaults
 */
export const VAT_RATE_DEFAULT = 0.15; // 15% VAT
export const PERFORMANCE_PCT_DEFAULT = 100; // 100% = no deduction
export const RETENTION_PCT_DEFAULT = 0; // Default no retention

/**
 * Document constraints
 */
export const MAX_DOCUMENT_SIZE_MB = 100;
export const ALLOWED_DOCUMENT_FORMATS = ['application/pdf'];

// ─── Staff Position Colors ──────────────────────────────────────

/**
 * Assigns a color to a staff position based on role keywords
 * Used for visual differentiation in staff grids
 */
export function staffPositionColor(name: string): string {
  const n = (name || '').toLowerCase();
  if (n.includes('مدير')) return '#026D69';
  if (n.includes('معمار')) return '#1A4B8C';
  if (n.includes('مدن')) return '#6A5ACD';
  if (n.includes('كهرباء')) return '#B8860B';
  if (n.includes('ميكانيك')) return '#8B4513';
  if (n.includes('مواد')) return '#2E8B57';
  if (n.includes('كميات')) return '#9932CC';
  if (n.includes('سلامة')) return '#DC143C';
  if (n.includes('مراقب')) return '#4682B4';
  if (n.includes('منسق')) return '#FF8C00';
  return MOMAH_COLORS.darkGreen;
}

/**
 * Normalizes staff position names
 * Maps abbreviated or colloquial names to standard titles
 */
export function normalizePositionName(ar: string): string {
  if (!ar) return '';
  if (ar.includes('مدير')) return 'مدير المشروع';
  if (ar.includes('معمار')) return 'مهندس معماري';
  if (ar.includes('مدن')) return 'مهندس مدني';
  if (ar.includes('كهرباء')) return 'مهندس كهرباء';
  if (ar.includes('ميكانيك')) return 'مهندس ميكانيك';
  if (ar.includes('مواد')) return 'أخصائي مواد';
  if (ar.includes('كميات')) return 'حاسب كميات';
  if (ar.includes('سلامة')) return 'أخصائي سلامة';
  if (ar.includes('مراقب')) return 'مراقب';
  if (ar.includes('منسق')) return 'منسق فني';
  return ar;
}

// ─── Notification Message Templates ────────────────────────────

/**
 * Notification templates with Arabic messages
 * Used for generating in-app and email notifications
 */
export const NOTIFICATION_TEMPLATES: Record<NotificationType, { title: string; bodyTemplate: string }> = {
  claim_submitted: {
    title: 'تم تقديم مطالبة جديدة',
    bodyTemplate: 'تم تقديم المطالبة #{claimNo} من قبل {submitterName} للعقد "{contractNo}"',
  },
  claim_approved: {
    title: 'تم اعتماد المطالبة',
    bodyTemplate: 'تم اعتماد المطالبة #{claimNo} من قبل {approverName}. المبلغ المعتمد: {amount}',
  },
  claim_rejected: {
    title: 'تم رفض المطالبة',
    bodyTemplate: 'تم رفض المطالبة #{claimNo} من قبل المدير. السبب: {reason}',
  },
  claim_returned: {
    title: 'تم إرجاع المطالبة',
    bodyTemplate: 'تم إرجاع المطالبة #{claimNo} من قبل {returnerName}. السبب: {reason}',
  },
  supervisor_sla_warning: {
    title: 'تنبيه: قرب انتهاء صلاحية المراجعة',
    bodyTemplate: 'المطالبة #{claimNo} تقترب من انتهاء صلاحية مراجعة جهة الإشراف. يرجى إكمال المراجعة في أقرب وقت',
  },
  supervisor_sla_escalation: {
    title: 'تصعيد: تجاوز صلاحية المراجعة',
    bodyTemplate: 'المطالبة #{claimNo} تجاوزت صلاحية مراجعة جهة الإشراف. يرجى إحالتها للمدير فوراً',
  },
  change_order_submitted: {
    title: 'تم تقديم طلب تغيير جديد',
    bodyTemplate: 'تم تقديم طلب تغيير #{orderNo} للعقد "{contractNo}" بقيمة {value}',
  },
  change_order_approved: {
    title: 'تم اعتماد طلب التغيير',
    bodyTemplate: 'تم اعتماد طلب التغيير #{orderNo} من قبل المدير',
  },
  change_order_rejected: {
    title: 'تم رفض طلب التغيير',
    bodyTemplate: 'تم رفض طلب التغيير #{orderNo}. السبب: {reason}',
  },
  change_order_approaching_limit: {
    title: 'تحذير: تقارب الحد الأقصى للتغييرات',
    bodyTemplate: 'العقد "{contractNo}" يقترب من الحد الأقصى المسموح به للتغييرات ({current}%)',
  },
};

// ─── Error Messages (Arabic) ────────────────────────────────────

export const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'أنت غير مخول بالقيام بهذا الإجراء',
  NOT_FOUND: 'المورد المطلوب غير موجود',
  VALIDATION_ERROR: 'تحقق من صحة البيانات المدخلة',
  NETWORK_ERROR: 'حدث خطأ في الاتصال. يرجى محاولة لاحقاً',
  SERVER_ERROR: 'حدث خطأ بالخادم. يرجى التواصل مع دعم النظام',
  SESSION_EXPIRED: 'انتهت جلستك. يرجى تسجيل الدخول مرة أخرى',
  INVALID_CREDENTIALS: 'بيانات المستخدم غير صحيحة',
  CLAIM_NOT_SUBMITTABLE: 'لا يمكن تقديم هذه المطالبة في وضعها الحالي',
  MISSING_ATTACHMENTS: 'يرجى إرفاق جميع المستندات المطلوبة',
  CHANGE_ORDER_EXCEEDS_LIMIT: 'طلب التغيير يتجاوز الحد الأقصى المسموح به (10%)',
  BOQ_EXCEEDS_QUANTITY: 'الكميات المدخلة تتجاوز الكميات المتعاقد عليها',
};

// ─── Success Messages (Arabic) ──────────────────────────────────

export const SUCCESS_MESSAGES: Record<string, string> = {
  CLAIM_SUBMITTED: 'تم تقديم المطالبة بنجاح',
  CLAIM_APPROVED: 'تم اعتماد المطالبة بنجاح',
  CLAIM_REJECTED: 'تم رفض المطالبة بنجاح',
  CLAIM_RETURNED: 'تم إرجاع المطالبة بنجاح',
  CLAIM_SAVED: 'تم حفظ المطالبة كمسودة',
  CHANGE_ORDER_SUBMITTED: 'تم تقديم طلب التغيير بنجاح',
  CHANGE_ORDER_APPROVED: 'تم اعتماد طلب التغيير بنجاح',
  DOCUMENT_UPLOADED: 'تم رفع المستند بنجاح',
  PROFILE_UPDATED: 'تم تحديث الملف الشخصي بنجاح',
};
