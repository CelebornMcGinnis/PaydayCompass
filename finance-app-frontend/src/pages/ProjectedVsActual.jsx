import React, { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { budgetsApi } from "../lib/apiClient";
import { colors, fontBody, fontMono, formatMoney, chartCrossesZero } from "../lib/theme";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import InfoBubble from "../components/InfoBubble";

const RANGE_OPTIONS = [
  { key: 6, label: "6 periods" },
  { key: 12, label: "12 periods" },
  { key: 26, label: "26 periods" },
];

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs shadow-xl" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}`, color: colors.text }}>
      <div style={{ color: colors.textMuted }} className="mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color, fontFamily: fontMono }}>
          {p.name}: {formatMoney(p.value)}
        </div>
      ))}
    </div>
  );
}

export default function ProjectedVsActualPage() {
  const [numPeriods, setNumPeriods] = useState(6);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    budgetsApi
      .projectedVsActual(numPeriods)
      .then(setData)
      .catch((err) => setError(err.message || "Couldn't load this projection."));
  }, [numPeriods]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.series.map((pt) => ({
      period: `${pt.periodStart.slice(5)}–${pt.periodEnd.slice(5)}`,
      Projected: pt.projected,
      Actual: pt.actual,
    }));
  }, [data]);

  const latest = data && data.series.length > 0 ? data.series[data.series.length - 1] : null;
  const latestGap = latest ? latest.actual - latest.projected : null;

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Projected vs Actual" />

      <div className="px-5 pt-6 max-w-lg mx-auto">
        <PageBlurb>
          Total money in minus total money out, for each of your real pay periods - what you expected to have
          left over, next to what actually happened.
        </PageBlurb>

        {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}

        <div className="flex gap-1.5 mb-5" data-wizard-target="wizard-pva-range">
          {RANGE_OPTIONS.map((opt) => {
            const active = numPeriods === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setNumPeriods(opt.key)}
                className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
                style={{ background: active ? colors.accent : "transparent", color: active ? colors.bg : colors.textMuted, border: `1px solid ${active ? colors.accent : colors.border}` }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {data === null && !error && <p className="text-sm" style={{ color: colors.textMuted }}>Loading…</p>}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-5" data-wizard-target="wizard-pva-stats">
              <div className="rounded-2xl p-4" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
                <div className="flex items-center mb-1">
                  <p className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Projected / period</p>
                  <InfoBubble text="Your recurring monthly income minus active budgets and planned-expense contributions, prorated to each period's length. One-time credits aren't included - a projection shouldn't assume a windfall repeats." />
                </div>
                <p style={{ fontFamily: fontMono, fontSize: 18, color: colors.text }}>
                  {formatMoney(latest ? latest.projected : 0)}
                </p>
              </div>
              <div className="rounded-2xl p-4" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
                <div className="flex items-center mb-1">
                  <p className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Actual (most recent)</p>
                  <InfoBubble text="Real net money movement across every account you own during this period - every transaction, including anything moved through the Payday calculator and any expense added during it." />
                </div>
                <p style={{ fontFamily: fontMono, fontSize: 18, color: latest && latest.actual >= latest.projected ? colors.positive : colors.alert }}>
                  {formatMoney(latest ? latest.actual : 0)}
                </p>
              </div>
            </div>

            {latestGap !== null && (
              <div className="rounded-2xl p-4 mb-5" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.border}` }}>
                <p className="text-sm" style={{ color: latestGap >= 0 ? colors.positive : colors.alert }}>
                  {latestGap >= 0
                    ? `Your most recent period came in ${formatMoney(latestGap)} ahead of projection.`
                    : `Your most recent period came in ${formatMoney(Math.abs(latestGap))} behind projection.`}
                </p>
              </div>
            )}

            <div className="rounded-2xl p-3 pt-5" style={{ background: colors.surface, border: `1px solid ${colors.border}`, height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke={colors.border} vertical={false} />
                  <XAxis dataKey="period" tick={{ fill: colors.textMuted, fontSize: 10 }} axisLine={{ stroke: colors.border }} tickLine={false} interval={chartData.length > 8 ? Math.ceil(chartData.length / 8) - 1 : 0} />
                  <YAxis tick={{ fill: colors.textMuted, fontSize: 10, fontFamily: fontMono }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `$${Math.round(v / 100) / 10}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: colors.textMuted }} />
                  {chartCrossesZero(chartData, ["Projected", "Actual"]) && <ReferenceLine y={0} stroke={colors.alert} strokeWidth={1.5} />}
                  <Line type="monotone" dataKey="Projected" stroke={colors.accentLight} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Actual" stroke={colors.warning} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
