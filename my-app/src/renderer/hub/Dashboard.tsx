import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Group } from '@visx/group';
import { scaleTime, scaleLinear } from '@visx/scale';
import { AreaClosed, LinePath, Line, Bar } from '@visx/shape';
import { curveMonotoneX } from '@visx/curve';
import { LinearGradient } from '@visx/gradient';
import { AxisBottom } from '@visx/axis';
import { ParentSize } from '@visx/responsive';
import { STATUS_LABEL } from './constants';
import { generateActivityData, getStatusBreakdown, MOCK_STATS } from './mock-metrics';
import type { AgentSession } from './types';
import type { ActivityPoint } from './mock-metrics';

interface StatusBreakdownEntry {
  status: string;
  count: number;
  label: string;
}

function deriveActivityFromSessions(sessions: AgentSession[]): ActivityPoint[] {
  const now = Date.now();
  const HOUR = 3600 * 1000;
  const buckets = new Map<number, { sessions: number; tokens: number }>();

  for (let i = 7 * 24; i >= 0; i--) {
    const bucketTime = now - i * HOUR;
    const bucketHour = Math.floor(bucketTime / HOUR) * HOUR;
    buckets.set(bucketHour, { sessions: 0, tokens: 0 });
  }

  for (const s of sessions) {
    const bucketHour = Math.floor(s.createdAt / HOUR) * HOUR;
    const entry = buckets.get(bucketHour);
    if (entry) {
      entry.sessions += 1;
    }
  }

  return Array.from(buckets, ([time, v]) => ({
    time,
    sessions: v.sessions,
    tokens: v.tokens,
  })).sort((a, b) => a.time - b.time);
}

function deriveBreakdown(sessions: AgentSession[]): StatusBreakdownEntry[] {
  const counts: Record<string, number> = { stopped: 0, running: 0, stuck: 0, draft: 0, idle: 0 };
  for (const s of sessions) {
    if (s.status in counts) counts[s.status] += 1;
  }
  return [
    { status: 'running', count: counts.running, label: 'Running' },
    { status: 'idle', count: counts.idle, label: 'Idle' },
    { status: 'stuck', count: counts.stuck, label: 'Stuck' },
    { status: 'stopped', count: counts.stopped, label: 'Stopped' },
    { status: 'draft', count: counts.draft, label: 'Draft' },
  ];
}

function countSessionsToday(sessions: AgentSession[]): number {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const threshold = startOfDay.getTime();
  return sessions.filter((s) => s.createdAt >= threshold).length;
}

const CHART_MARGIN = { top: 16, right: 0, bottom: 28, left: 0 };

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatElapsed(createdAt: number): string {
  const seconds = Math.floor((Date.now() - createdAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function ActivityChart({ width, height, data }: { width: number; height: number; data: ActivityPoint[] }): React.ReactElement | null {
  const [hover, setHover] = useState<ActivityPoint | null>(null);
  const [hoverX, setHoverX] = useState(0);

  const innerW = width - CHART_MARGIN.left - CHART_MARGIN.right;
  const innerH = height - CHART_MARGIN.top - CHART_MARGIN.bottom;

  const xScale = useMemo(() => scaleTime({
    domain: [
      Math.min(...data.map((d) => d.time)),
      Math.max(...data.map((d) => d.time)),
    ],
    range: [0, Math.max(innerW, 1)],
  }), [data, innerW]);

  const yScale = useMemo(() => scaleLinear({
    domain: [0, Math.max(...data.map((d) => d.sessions)) * 1.2],
    range: [Math.max(innerH, 1), 0],
    nice: true,
  }), [data, innerH]);

  const getX = useCallback((d: ActivityPoint) => xScale(d.time) ?? 0, [xScale]);
  const getY = useCallback((d: ActivityPoint) => yScale(d.sessions) ?? 0, [yScale]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const svg = event.currentTarget.closest('svg');
      if (!svg) return;
      const pt = svg.createSVGPoint();
      pt.x = event.clientX;
      pt.y = event.clientY;
      const svgPt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
      const x = svgPt.x - CHART_MARGIN.left;
      const time = xScale.invert(x).getTime();
      let closest = data[0];
      let minDist = Infinity;
      for (const d of data) {
        const dist = Math.abs(d.time - time);
        if (dist < minDist) { minDist = dist; closest = d; }
      }
      setHover(closest);
      setHoverX(getX(closest));
    },
    [data, xScale],
  );

  if (width < 10 || height < 10) return null;

  return (
    <div className="chart-wrapper">
      <svg width={width} height={height}>
        <LinearGradient id="area-gradient" from="rgba(109, 129, 150, 0.25)" to="rgba(109, 129, 150, 0)" />
        <Group left={CHART_MARGIN.left} top={CHART_MARGIN.top}>
          <AreaClosed
            data={data}
            x={getX}
            y={getY}
            yScale={yScale}
            curve={curveMonotoneX}
            fill="url(#area-gradient)"
          />
          <LinePath
            data={data}
            x={getX}
            y={getY}
            curve={curveMonotoneX}
            stroke="var(--color-accent-default)"
            strokeWidth={1.5}
            strokeOpacity={0.8}
          />
          {hover && (
            <>
              <Line
                from={{ x: hoverX, y: 0 }}
                to={{ x: hoverX, y: innerH }}
                stroke="var(--color-fg-disabled)"
                strokeWidth={1}
                strokeDasharray="3,3"
              />
              <circle
                cx={hoverX}
                cy={getY(hover)}
                r={4}
                fill="var(--color-accent-default)"
                stroke="var(--color-bg-base)"
                strokeWidth={2}
              />
            </>
          )}
          <Bar
            x={0}
            y={0}
            width={innerW}
            height={innerH}
            fill="transparent"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHover(null)}
          />
          <AxisBottom
            top={innerH}
            scale={xScale}
            numTicks={7}
            tickFormat={(v) => {
              const d = new Date(v as number);
              return d.toLocaleDateString([], { weekday: 'short' });
            }}
            stroke="var(--color-border-subtle)"
            tickStroke="transparent"
            tickLabelProps={() => ({
              fill: 'var(--color-fg-disabled)',
              fontSize: 10,
              fontFamily: 'var(--font-ui)',
              textAnchor: 'middle' as const,
              dy: 4,
            })}
            hideTicks
          />
        </Group>
      </svg>
      {hover && (
        <div
          className="chart-tooltip"
          style={{ left: hoverX + CHART_MARGIN.left }}
        >
          <span className="chart-tooltip__value">{hover.sessions} sessions</span>
          <span className="chart-tooltip__label">
            {new Date(hover.time).toLocaleDateString([], { weekday: 'short', hour: 'numeric' })}
          </span>
        </div>
      )}
    </div>
  );
}

interface DashboardProps {
  sessions: AgentSession[];
  onSwitchToGrid: () => void;
  onSelectSession?: (id: string) => void;
}

export function Dashboard({ sessions, onSwitchToGrid, onSelectSession }: DashboardProps): React.ReactElement {
  const isMock = import.meta.env.VITE_MOCK_MODE === '1';

  const runningCount = sessions.filter((s) => s.status === 'running').length;
  const stuckCount = sessions.filter((s) => s.status === 'stuck').length;
  const stoppedCount = sessions.filter((s) => s.status === 'stopped').length;

  const breakdown = useMemo(
    () => isMock ? getStatusBreakdown(MOCK_STATS.totalSessions) : deriveBreakdown(sessions),
    [isMock, sessions],
  );
  const total = breakdown.reduce((sum, b) => sum + b.count, 0);

  const activityData = useMemo(
    () => isMock ? generateActivityData(7) : deriveActivityFromSessions(sessions),
    [isMock, sessions],
  );

  const todayCount = useMemo(
    () => isMock ? MOCK_STATS.sessionsToday : countSessionsToday(sessions),
    [isMock, sessions],
  );

  const recentSessions = sessions;

  return (
    <div className="dashboard">
      <div className="dashboard__stats">
        <div className="dashboard__stat dashboard__stat--live">
          <span className="dashboard__stat-label">Running</span>
          <span className="dashboard__stat-value">
            <span className="dashboard__stat-dot dashboard__stat-dot--running" />
            {runningCount}
          </span>
        </div>
        <div className="dashboard__stat">
          <span className="dashboard__stat-label">Stuck</span>
          <span className="dashboard__stat-value">
            <span className="dashboard__stat-dot dashboard__stat-dot--stuck" />
            {stuckCount}
          </span>
        </div>
        <div className="dashboard__stat">
          <span className="dashboard__stat-label">Completed</span>
          <span className="dashboard__stat-value">{stoppedCount}</span>
        </div>
        <div className="dashboard__stat">
          <span className="dashboard__stat-label">Today</span>
          <span className="dashboard__stat-value">{todayCount}</span>
        </div>
      </div>

      <div className="dashboard__grid">
        <div className="dashboard__chart-card">
          <div className="dashboard__card-header">
            <span className="dashboard__card-title">Sessions (7d)</span>
          </div>
          <div className="dashboard__chart-area">
            <ParentSize>
              {({ width, height }) => <ActivityChart width={width} height={height} data={activityData} />}
            </ParentSize>
          </div>
        </div>

        <div className="dashboard__breakdown-card">
          <div className="dashboard__card-header">
            <span className="dashboard__card-title">Status breakdown</span>
            <span className="dashboard__card-count">{total} total</span>
          </div>
          <div className="dashboard__breakdown-bar">
            {breakdown.map((b) => (
              <div
                key={b.status}
                className={`dashboard__bar-segment dashboard__bar-segment--${b.status}`}
                style={{ flex: b.count }}
                title={`${b.label}: ${b.count}`}
              />
            ))}
          </div>
          <div className="dashboard__breakdown-legend">
            {breakdown.map((b) => (
              <div key={b.status} className="dashboard__legend-item">
                <span className={`dashboard__legend-dot dashboard__legend-dot--${b.status}`} />
                <span className="dashboard__legend-label">{b.label}</span>
                <span className="dashboard__legend-count">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="dashboard__recent">
        <div className="dashboard__card-header">
          <span className="dashboard__card-title">Recent sessions</span>
          <button className="dashboard__view-all" onClick={onSwitchToGrid}>
            View all
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="dashboard__recent-list">
          {recentSessions.map((session) => (
            <div
              key={session.id}
              className="dashboard__recent-row"
              onClick={() => onSelectSession?.(session.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelectSession?.(session.id); }}
            >
              <span className={`dashboard__recent-dot dashboard__recent-dot--${session.status}`} />
              <span className="dashboard__recent-status">{STATUS_LABEL[session.status]}</span>
              {session.group && <span className="dashboard__recent-group">{session.group}</span>}
              <span className="dashboard__recent-prompt">{session.prompt}</span>
              <span className="dashboard__recent-elapsed">{formatElapsed(session.createdAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
