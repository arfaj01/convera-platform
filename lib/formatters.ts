// ─── Number Formatting ───────────────────────────────────────────

export function fmt(n: number | null | undefined): string {
  return Math.round(n || 0).toLocaleString('ar-SA');
}

export function fmtCurrency(n: number | null | undefined): string {
  return fmt(n) + ' ريال';
}

export function fmtPct(n: number | null | undefined): string {
  return (n || 0).toFixed(1) + '%';
}

// ─── Date Formatting ─────────────────────────────────────────────

export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function fmtDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export function fmtDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}
