export interface Point {
  x: number // 0..1 relative position
  y: number // 0..1 relative value
  label?: string
}

/** Minimal SVG line chart with a soft area fill; 0..1 domain, theme-aware. */
export function LineChart({
  points,
  height = 140,
  color = "var(--color-primary)",
  showGrid = true,
}: {
  points: Point[]
  height?: number
  color?: string
  showGrid?: boolean
}) {
  const width = 600
  const pad = 8
  const path = points.map((p) => `${(p.x * (width - pad * 2) + pad).toFixed(1)},${((1 - p.y) * (height - pad * 2) + pad).toFixed(1)}`)

  if (points.length === 0) {
    return <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">No data yet</div>
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" role="img">
      {showGrid && (
        <>
          <line x1={pad} x2={width - pad} y1={pad} y2={pad} stroke="var(--glass-border)" strokeDasharray="4 4" />
          <line x1={pad} x2={width - pad} y1={height / 2} y2={height / 2} stroke="var(--glass-border)" strokeDasharray="4 4" />
          <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} stroke="var(--glass-border)" strokeDasharray="4 4" />
        </>
      )}
      <polygon
        points={`${pad},${height - pad} ${path.join(" ")} ${width - pad},${height - pad}`}
        fill={color}
        opacity={0.08}
      />
      <polyline
        points={path.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x * (width - pad * 2) + pad}
          cy={(1 - p.y) * (height - pad * 2) + pad}
          r={2.5}
          fill={color}
          opacity={0.9}
        />
      ))}
    </svg>
  )
}

/** Minimal SVG bar chart; values in 0..1 relative to `max`. */
export function BarsChart({
  values,
  max,
  height = 120,
  targetRatio,
}: {
  values: number[]
  max: number
  height?: number
  targetRatio?: number
}) {
  const width = 600
  const pad = 8
  if (values.length === 0 || max <= 0) {
    return <div className="flex h-28 items-center justify-center text-xs text-muted-foreground">No data yet</div>
  }
  const gap = 2
  const barWidth = (width - pad * 2 - gap * (values.length - 1)) / values.length

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" role="img">
      {targetRatio !== undefined && (
        <line
          x1={pad}
          x2={width - pad}
          y1={(1 - Math.min(1, targetRatio)) * (height - pad * 2) + pad}
          y2={(1 - Math.min(1, targetRatio)) * (height - pad * 2) + pad}
          stroke="var(--color-primary)"
          strokeDasharray="4 4"
          opacity={0.6}
        />
      )}
      {values.map((v, i) => {
        const h = Math.max(1, Math.min(1, v / max) * (height - pad * 2))
        return (
          <rect
            key={i}
            x={pad + i * (barWidth + gap)}
            y={height - pad - h}
            width={barWidth}
            height={h}
            rx={2}
            fill="var(--color-primary)"
            opacity={0.55}
          />
        )
      })}
    </svg>
  )
}
