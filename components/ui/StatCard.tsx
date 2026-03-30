'use client';

type ColorTheme = 'teal' | 'lime' | 'blue' | 'red' | 'orange';
type RiskLevel = 'green' | 'yellow' | 'red' | 'none';

const THEME_STYLES: Record<ColorTheme, string> = {
  teal:   'bg-teal-pale text-teal',
  lime:   'bg-lime-pale text-lime-dark',
  blue:   'bg-[#EBF1FA] text-[#1A4B8C]',
  red:    'bg-[#FDECEA] text-[#C0392B]',
  orange: 'bg-[#FEF3E2] text-[#C46A00]',
};

const RISK_BORDER: Record<RiskLevel, string> = {
  green:  'border-t-[3px] border-t-[#22C55E]',
  yellow: 'border-t-[3px] border-t-[#F59E0B]',
  red:    'border-t-[3px] border-t-[#DC2626]',
  none:   '',
};

interface StatCardProps {
  icon: string;
  label: string;
  value: string;
  subtitle?: string;
  theme?: ColorTheme;
  risk?: RiskLevel;
  trend?: { value: string; direction: 'up' | 'down' | 'neutral' };
}

export default function StatCard({
  icon,
  label,
  value,
  subtitle,
  theme = 'teal',
  risk = 'none',
  trend,
}: StatCardProps) {
  const trendColors = {
    up: 'bg-[#E8F5EE] text-[#1B7A45]',
    down: 'bg-[#FDECEA] text-[#C0392B]',
    neutral: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className={`bg-white rounded border border-gray-100 shadow-card px-3 py-2.5 hover:shadow-cardHover transition-all ${RISK_BORDER[risk]}`}>
      <div className="flex items-center justify-between mb-1">
        <div className={`w-7 h-7 rounded-md flex items-center justify-center text-sm ${THEME_STYLES[theme]}`}>
          {icon}
        </div>
        {trend && (
          <span className={`text-[0.62rem] font-bold px-1.5 py-0.5 rounded-full ${trendColors[trend.direction]}`}>
            {trend.value}
          </span>
        )}
      </div>
      <div className="text-[1.35rem] font-black text-teal-dark leading-none font-display tracking-tight">
        {value}
      </div>
      <div className="text-[0.7rem] text-gray-400 mt-0.5 font-medium">{label}</div>
      {subtitle && (
        <div className="text-[0.62rem] text-gray-400/70 mt-0.5 border-t border-gray-100 pt-0.5">
          {subtitle}
        </div>
      )}
    </div>
  );
}
