interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export default function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`bg-white rounded border border-gray-100 shadow-card ${className}`}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  action?: React.ReactNode;
}

export function CardHeader({ title, action }: CardHeaderProps) {
  return (
    <div className="px-[18px] py-[13px] border-b border-gray-100 flex items-center justify-between">
      <h3 className="text-sm font-bold text-teal-dark">{title}</h3>
      {action}
    </div>
  );
}

export function CardBody({ children, className = '' }: CardProps) {
  return (
    <div className={`p-[18px] ${className}`}>
      {children}
    </div>
  );
}
