'use client';

/**
 * ExportButton — CSV export + Print trigger for report pages.
 *
 * CSV export serializes the current filtered rows client-side.
 * Print triggers window.print() — pages use @media print styles.
 */

interface ExportButtonProps {
  onExportCSV: () => void;
  reportTitle?: string;
  disabled?: boolean;
}

export default function ExportButton({ onExportCSV, reportTitle = 'تقرير', disabled = false }: ExportButtonProps) {
  const handlePrint = () => {
    if (reportTitle) document.title = reportTitle;
    window.print();
  };

  return (
    <div className="flex gap-2 print:hidden">
      <button
        onClick={onExportCSV}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#045859] text-[#045859] bg-white hover:bg-[#E8F4F4] text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <span>⬇</span>
        <span>تصدير CSV</span>
      </button>
      <button
        onClick={handlePrint}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <span>🖨</span>
        <span>طباعة</span>
      </button>
    </div>
  );
}

/**
 * Utility: convert array of objects to CSV string (RTL-safe, UTF-8 BOM).
 * BOM ensures Arabic text displays correctly in Excel.
 */
export function exportToCSV(headers: { key: string; label: string }[], rows: Record<string, unknown>[], filename: string) {
  const bom = '\uFEFF';
  const headerRow = headers.map(h => `"${h.label}"`).join(',');
  const dataRows = rows.map(row =>
    headers.map(h => {
      const val = row[h.key];
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    }).join(',')
  );
  const csv = bom + [headerRow, ...dataRows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
