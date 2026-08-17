import React, { useEffect, useMemo, useState } from "react";
import { Plus, X, Check } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { preferencesApi } from "../lib/apiClient";
import { colors, fontDisplay, fontMono, formatMoney } from "../lib/theme";
import InfoBubble from "./InfoBubble";

const LINE_COLORS = [colors.accentLight, colors.positive, colors.warning, colors.alert, "#8A7FD9", colors.textMuted];

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs shadow-xl" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}`, color: colors.text }}>
      <div style={{ color: colors.textMuted }} className="mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color, fontFamily: fontMono }}>
          {p.dataKey}: {formatMoney(p.value)}
        </div>
      ))}
    </div>
  );
}

function AddChartForm({ divisions, onCancel, onAdd }) {
  const [selected, setSelected] = useState([]);

  function toggle(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  return (
    <div className="rounded-2xl p-4 mb-4" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
      <div className="flex items-center justify-between mb-3">
        <span style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>New chart</span>
        <button onClick={onCancel} aria-label="Cancel" style={{ color: colors.textMuted }}><X size={16} /></button>
      </div>
      <p className="text-xs mb-2" style={{ color: colors.textMuted }}>Pick one division, or several to combine onto the same chart.</p>
      <div className="rounded-lg mb-3" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
        {divisions.map((d, i) => {
          const checked = selected.includes(d.divisionId);
          return (
            <button
              key={d.divisionId}
              type="button"
              onClick={() => toggle(d.divisionId)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-opacity hover:opacity-80"
              style={{ borderBottom: i < divisions.length - 1 ? `1px solid ${colors.border}` : "none" }}
            >
              <span className="flex items-center justify-center rounded shrink-0" style={{ width: 16, height: 16, border: `1.5px solid ${checked ? colors.accentLight : colors.borderStrong}`, background: checked ? colors.accentLight : "transparent" }}>
                {checked && <Check size={11} style={{ color: colors.bg }} />}
              </span>
              <span className="text-sm" style={{ color: colors.text }}>{d.name}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={selected.length === 0}
        onClick={() => onAdd(selected)}
        className="w-full rounded-lg py-2.5 text-sm font-medium"
        style={{ background: selected.length ? colors.accent : colors.surface, color: selected.length ? colors.bg : colors.textMuted }}
      >
        Add chart
      </button>
    </div>
  );
}

export default function DivisionTrendCharts({ accountId, divisions, transactions }) {
  const [charts, setCharts] = useState(null); // null until loaded (either from preferences or auto-computed)
  const [customized, setCustomized] = useState(false);
  const [showAddChart, setShowAddChart] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    preferencesApi
      .get()
      .then((prefs) => {
        if (cancelled) return;
        const forThisAccount = prefs.divisionTrendCharts?.[accountId];
        if (forThisAccount) {
          setCharts(forThisAccount);
          setCustomized(true);
        }
        // else: leave charts null - the effect below fills in the
        // auto-computed default (one chart per division) once
        // divisions are in, and that default is never itself saved
        // unless the user actually customizes it.
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your chart layout.");
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    if (customized || charts !== null || divisions.length === 0) return;
    setCharts(divisions.map((d) => ({ id: d.divisionId, divisionIds: [d.divisionId] })));
  }, [customized, charts, divisions]);

  useEffect(() => {
    if (charts === null) return;
    const validDivisionIds = new Set(divisions.map((d) => d.divisionId));
    let changed = false;
    const cleaned = charts
      .map((chart) => {
        const filteredIds = chart.divisionIds.filter((id) => validDivisionIds.has(id));
        if (filteredIds.length !== chart.divisionIds.length) changed = true;
        return { ...chart, divisionIds: filteredIds };
      })
      .filter((chart) => chart.divisionIds.length > 0);
    if (changed) saveCharts(cleaned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisions]);

  // Reconstructed from real transaction history, same principle as the
  // account's own balance chart above this component: walk backward
  // from each division's CURRENT balance, undoing every transaction
  // tagged with it, to find what that balance was at each prior point.
  // A running total (stock), not a monthly sum (flow) - unlike Category
  // Trends, which sums spend per month, a division's meaningful trend
  // is what it was actually holding at each point in time.
  const balanceSeries = useMemo(() => {
    const byDivision = {};
    for (const division of divisions) {
      const relevant = (transactions || [])
        .filter((t) => t.divisionId === division.divisionId && !t.isRetroactiveEntry)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
      let running = division.balance;
      const points = [{ label: "Now", balance: running }];
      for (const t of relevant) {
        running = t.direction === "credit" ? running - t.amount : running + t.amount;
        points.push({ label: t.createdAt?.slice(5, 10) || "", balance: running });
      }
      byDivision[division.divisionId] = points.reverse().slice(-30); // oldest to newest, most recent 30 points
    }
    return byDivision;
  }, [divisions, transactions]);

  function chartDataFor(divisionIds) {
    // Combined charts merge by index position along each division's own
    // reconstructed timeline - divisions don't share transaction dates,
    // so there's no single shared date axis to merge by value.
    const maxLen = Math.max(0, ...divisionIds.map((id) => (balanceSeries[id] || []).length));
    const rows = [];
    for (let i = 0; i < maxLen; i++) {
      const row = { label: "" };
      for (const id of divisionIds) {
        const series = balanceSeries[id] || [];
        const point = series[series.length - maxLen + i];
        if (point) {
          row.label = point.label;
          const division = divisions.find((d) => d.divisionId === id);
          row[division?.name || id] = point.balance;
        }
      }
      rows.push(row);
    }
    return rows;
  }

  function saveCharts(next) {
    setCharts(next);
    setCustomized(true);
    preferencesApi
      .get()
      .then((prefs) =>
        preferencesApi.update({
          divisionTrendCharts: { ...(prefs.divisionTrendCharts || {}), [accountId]: next },
        })
      )
      .catch(() => setError("Couldn't save your chart layout - your change is showing but may not persist."));
  }

  function addChart(divisionIds) {
    saveCharts([...(charts || []), { id: uid(), divisionIds }]);
    setShowAddChart(false);
  }

  function removeChart(id) {
    saveCharts((charts || []).filter((c) => c.id !== id));
  }

  if (divisions.length === 0) return null;

  return (
    <div className="mb-5">
      <div className="flex items-center mb-2 px-1">
        <span className="text-sm font-medium" style={{ color: colors.text }}>Division trends</span>
        <InfoBubble text="Each division's balance over time, reconstructed from its real transaction history - not a spending total, but what it was actually holding at each point. Add your own charts (combining divisions if you want) or remove any of them, same as Category Trends. Your layout is saved per account." />
      </div>

      {error && <p className="text-xs mb-3" style={{ color: colors.alert }}>{error}</p>}

      {(charts || []).map((chart) => {
        const data = chartDataFor(chart.divisionIds);
        const names = chart.divisionIds.map((id) => divisions.find((d) => d.divisionId === id)?.name).filter(Boolean);
        return (
          <div key={chart.id} className="rounded-2xl p-4 mb-3" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs" style={{ color: colors.textMuted }}>{names.join(" + ")}</span>
              <button onClick={() => removeChart(chart.id)} aria-label="Remove chart" style={{ color: colors.textMuted }}><X size={14} /></button>
            </div>
            {data.length > 1 ? (
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                  <XAxis dataKey="label" tick={{ fill: colors.textMuted, fontSize: 10 }} axisLine={{ stroke: colors.border }} tickLine={false} interval={Math.ceil(data.length / 6)} />
                  <YAxis tick={{ fill: colors.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  {names.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: colors.textMuted }} />}
                  {names.map((name, i) => (
                    <Line key={name} type="monotone" dataKey={name} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-center py-6" style={{ color: colors.textMuted }}>Not enough history yet for this division.</p>
            )}
          </div>
        );
      })}

      {showAddChart ? (
        <AddChartForm divisions={divisions} onCancel={() => setShowAddChart(false)} onAdd={addChart} />
      ) : (
        <button
          type="button"
          onClick={() => setShowAddChart(true)}
          className="w-full rounded-xl py-2.5 mb-4 text-sm font-medium flex items-center justify-center gap-2"
          style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}
        >
          <Plus size={15} /> Add chart
        </button>
      )}
    </div>
  );
}
