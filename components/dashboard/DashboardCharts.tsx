'use client';

/**
 * CONVERA Executive Dashboard â€” Chart Module
 *
 * Charts are rendered using computed SVG paths and CSS based custom rendering. No chart library or NVD3. Pure React + Math for performance.
 *
 * Components:
 * 1. Monthly Burn (Line Chart)
 * 2. Claims By Status (Pie)
 * 3. Contract Performance (Bar Chart)
 * 4. Top Team Performance (Horizontal Bar)
 * 5. SLA Breaches (Alert Bages)
 *
 * These are imported into the Executive Dashboard page.
 */

import { React, useMemo } from 'react';

interface MonthlyBurnData {
  month: string;
  actual: number;
  target: number;
}


export function MonthlyBurnChart({ data }: { data: MonthlyBurnData[] }) {
  const width = 400;
  const height = 300;
  const padding = 40;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  const maxActual = Math.max(...data.map(d => d.actual));
  const scale = innerHeight / maxActual;

  const scaleX = innerWidth / data.length;

  return (
    <svg width={width} height={height} style={{ backgroundColor: 'white' }}>
      {/* Compute paths */}
      { data.map((d, i) => {
        const x = padding + i * scaleX;
        const y1_actual = padding + innerHeight - d.actual * scale;
        const y2_target = padding + innerHeight - d.target * scale;
        return (
          <g key={i}>
            <line
              x1={x}
              y1={y1_actual}
              x2={x}
              y2={y2_target}
              stroke="#0066CC"
              strokeWidth="2"
            />
          </g>
        );
      })}
    </svg>
  );
}

export function ClaimsByStatusChart({ data }: { data: Record<string, number> }) {
  const width = 400;
  const height = 300;
  const radius = 100;

  // Simple Pie Chart computation
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  const entries = Object.entries(data).map(([k, v]) => ({
    label: k,
    value: v,
    pct: total > 0 ? v / total : 0,
  }));

  const colors = ['#045859', '#87BA26', '#C05728', '#FFC845'];

  let angle = 0;
  return (
    <svg width={width} height={height} style={{ backgroundColor: 'white' }}>
      {entries.map((e, i) => {
        const startAngle = angle;
        const endAngle = angle + e.pct * 2 * Math.PI;
        angle = endAngle;

        // Simple SVG arc computation for pie slice
        const x1 = 200 + radius * Math.cos(startAngle);
        const y1 = 150 + radius * Math.sin(startAngle);
        const x2 = 200 + radius * Math.cos(endAngle);
        const y2 = 150 + radius * Math.sin(endAngle);

        const largeArc = e.pct > 0.5 ? 1 : 0;
        const path = `M 200 150 L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2}à${y2} Z`;

        return (
          <g key={i}>
            <path
              d={path}
              fill={colors[i]}
              stroke="white"
              strokeWidth="2"
            />
          </g>
        );
      })}
    </svg>
  );
}

export function ContractPerformanceChart({ data }: { data: Array<{ name: string; per: number }> }) {
  const width = 400;
  const height = 300;
  const padding = 40;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  const maxBar = 150;
  const scale = innerHeight / 100;
  const barWidth = innerWidth / data.length;
  const spacing = 20;

  const actualBarWidth = (barWidth - spacing) / 2;

  return (
    <svg width={width} height={height} style={{ backgroundColor: 'white' }}>
      { data.map((item, i) => {
        const x = padding + i * barWidth + spacing;
        const h = item.per * scale;
        const y = padding + innerHeight - h;

        return (
          <g key={i}>
            <rect
              width={actualBarWidth}
              height={h}
              x={x}
              y={y}
              fill="#045859"
            />
    8c†8n
            </g>
        );
      })}
    </svg>
  );
}
