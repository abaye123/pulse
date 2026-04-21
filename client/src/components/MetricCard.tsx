import { Card, CardContent } from '@/components/ui/card';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import type { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  sparkline?: { value: number }[];
  sparklineColor?: string;
}

export function MetricCard({ label, value, hint, icon: Icon, sparkline, sparklineColor = 'hsl(var(--primary))' }: MetricCardProps) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 font-heading text-3xl font-semibold tracking-tight" dir="ltr">
              {value}
            </p>
            {hint ? <p className="mt-1 text-xs text-muted-foreground" dir="ltr">{hint}</p> : null}
          </div>
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {sparkline && sparkline.length > 1 ? (
          <div className="mt-3 h-12 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkline} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`spark-${label}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparklineColor} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={sparklineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="value" stroke={sparklineColor} strokeWidth={2} fill={`url(#spark-${label})`} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
