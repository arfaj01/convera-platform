'use client';

export interface ReportKPIBarProps {
  title: string;
  actual: number;
  target: number;
  unit?: string;
  changePercent?: number;
}

export function ReportKPIBar({ title, actual, target, unit = '', changePercent }: ReportKPIBarProps) {
  const percent = Math.min(100, Math.round((actual / target) * 100));
  const isHealthy = percent >= 90;
  const color = isHealthy ? 'bg-green-500' : 'bg-red-500';

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <div className="text-center">
    L