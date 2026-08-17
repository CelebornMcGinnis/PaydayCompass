import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, X, Check } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { accountsApi, transactionsApi, preferencesApi } from "../lib/apiClient";
import { colors, fontDisplay, fontBody, fontMono, formatMoney } from "../lib/theme";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import InfoBubble from "../components/InfoBubble";

const RANGE_OPTIONS = [
  { key: "3M", label: "3M", months: 3 },
  { key: "6M", label: "6M", months: 6 },
  { key: "1Y", label: "1Y", months: 12 },
  { key: "2Y", label: "2Y", months: 24 },
];

// A fixed, readable palette - reused per-chart (a chart with 2 combined
// categories uses colors 0 and 1, the next chart starts over at 0), not
// shared globally, since each chart is visually independent now.
const LINE_COLORS = [colors.accentLight, colors.positive, colors.warning, colors.alert, "#8A7FD9", colors.textMuted];
const DEFAULT_CHART_COUNT = 5;


function monthKey(dateStr) {
  return dateStr?.slice(0, 7); // "2026-08"
}
function monthLabel(key) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
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

function AddChartForm({ allCategories, onCancel, onAdd }) {
  const [selected, setSelected] = useState([]);

  function toggle(cat) {
    setSelected((s) => (s.includes(cat) ? s.filter((c) => c !== cat) : [...s, cat]));
  }

  return (
    <div className="rounded-2xl p-4 mb-5" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
      <div className="flex items-center justify-between mb-3">
        <span style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>New chart</span>
        <button onClick={onCancel} aria-label="Cancel" style={{ color: colors.textMuted }}><X size={16} /></button>
      </div>
      <p className="text-xs mb-2" style={{ color: colors.textMuted }}>Pick one category, or several to combine onto the same chart.</p>
      <div className="rounded-lg mb-3" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
        {allCategories.map((cat, i) => {
          const checked = selected.includes(cat);
          return (
            <button
              key={cat}
              type="button"
              onClick={() => toggle(cat)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-opacity hover:opacity-80"
              style={{ borderBottom: i < allCategories.length - 1 ? `1px solid ${colors.border}` : "none" }}
            >
              <span className="flex items-center justify-center rounded shrink-0" style={{ width: 16, height: 16, border: `1.5px solid ${checked ? colors.accentLight : colors.borderStrong}`, background: checked ? colors.accentLight : "transparent" }}>
                {checked && <Check size={11} style={{ color: colors.bg }} />}
              </span>
              <span className="text-sm" style={{ color: colors.text }}>{cat}</span>
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

export default function CategoryTrendsPage() {
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState(null);
  const [charts, setCharts] = useState(null); // null until loaded (either from preferences or auto-computed)
  const [customized, setCustomized] = useState(false); // has the user ever added/removed a chart this session
  const [error, setError] = useState(null);
  const [range, setRange] = useState("6M");
  const [showAddChart, setShowAddChart] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      accountsApi.list().then((accounts) => Promise.all(accounts.map((a) => transactionsApi.list(a.accountId)))),
      preferencesApi.get(),
    ])
      .then(([perAccount, prefs]) => {
        if (cancelled) return;
        setTransactions(perAccount.flat());
        if (prefs.categoryTrendCharts) {
          setCharts(prefs.categoryTrendCharts);
          setCustomized(true);
        }
        // else: leave charts null - the effect below fills in the
        // auto-computed default once transactions are in, and that
        // default is never saved unless the user actually customizes it.
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your spending history.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // monthlyByCategory: { "2026-08": { "Groceries": 412.50, "Dining": 88.20, ... }, ... }
  // Bucketed by every real category, not folded into a top-N - each
  // chart config decides for itself which categories to sum and display.
  const { monthlyByCategory, months, allCategories } = useMemo(() => {
    if (!transactions) return { monthlyByCategory: {}, months: [], allCategories: [] };

    const rangeConfig = RANGE_OPTIONS.find((r) => r.key === range);
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - rangeConfig.months + 1);
    const cutoffKey = monthKey(cutoff.toISOString());

    const relevant = transactions.filter(
      (t) => t.direction === "debit" && !t.isTransfer && monthKey(t.createdAt) >= cutoffKey
    );

    const monthsList = [];
    const cursor = new Date(cutoff);
    cursor.setDate(1);
    const now = new Date();
    while (cursor <= now) {
      monthsList.push(cursor.toISOString().slice(0, 7));
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const buckets = Object.fromEntries(monthsList.map((m) => [m, {}]));
    const totalsByCategory = {};
    for (const t of relevant) {
      const mKey = monthKey(t.createdAt);
      totalsByCategory[t.category] = (totalsByCategory[t.category] || 0) + t.amount;
      if (!buckets[mKey]) continue;
      buckets[mKey][t.category] = (buckets[mKey][t.category] || 0) + t.amount;
    }

    return {
      monthlyByCategory: buckets,
      months: monthsList,
      allCategories: Object.entries(totalsByCategory).sort((a, b) => b[1] - a[1]).map(([c]) => c),
    };
  }, [transactions, range]);

  // Fill in the auto-computed default (top N, one category per chart)
  // once real data is available, but only if the user hasn't customized -
  // this default is never itself saved to preferences, so it keeps
  // adjusting to whichever categories are actually top-spend until the
  // user makes their own change.
  useEffect(() => {
    if (customized || charts !== null || allCategories.length === 0) return;
    setCharts(allCategories.slice(0, DEFAULT_CHART_COUNT).map((cat) => ({ id: cat, categories: [cat] })));
  }, [customized, charts, allCategories]);

  const chartData = useMemo(
    () => months.map((m) => ({ month: monthLabel(m), ...monthlyByCategory[m] })),
    [months, monthlyByCategory]
  );

  function saveCharts(next) {
    setCharts(next);
    setCustomized(true);
    preferencesApi.update({ categoryTrendCharts: next }).catch(() => setError("Couldn't save your chart layout - your change is showing but may not persist."));
  }

  function addChart(categories) {
    saveCharts([...(charts || []), { id: uid(), categories }]);
    setShowAddChart(false);
  }

  function removeChart(id) {
    saveCharts((charts || []).filter((c) => c.id !== id));
  }

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Category trends" />

      <div className="px-5 pt-6 max-w-2xl mx-auto">
        <PageBlurb>Spending by category over time, from 3 months back to 2 years.</PageBlurb>
        <div className="flex items-center mb-2 px-1">
          <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>Spending by category over time</h3>
          <InfoBubble text="Across every account, month by month. Starts with your top 5 categories by spend, one chart each - add your own charts (combining categories if you want) or remove any of them. Your layout is saved and stays consistent everywhere you sign in." />
        </div>

        <div className="flex gap-1.5 mb-4 px-1">
          {RANGE_OPTIONS.map((opt) => {
            const active = range === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setRange(opt.key)}
                className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
                style={{
                  background: active ? colors.accent : "transparent",
                  color: active ? colors.bg : colors.textMuted,
                  border: `1px solid ${active ? colors.accent : colors.border}`,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}
        {!transactions && !error && <p className="text-sm" style={{ color: colors.textMuted }}>Loading…</p>}

        {transactions && allCategories.length === 0 && (
          <div className="rounded-2xl p-5 mb-4 text-center" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            <p style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 16, fontWeight: 600 }} className="mb-1.5">
              No spending recorded yet
            </p>
            <p className="text-sm mb-4" style={{ color: colors.textMuted }}>
              This page charts your spending by category over time - once you've logged a few expenses, trends will
              start showing up here automatically.
            </p>
            <button
              type="button"
              onClick={() => navigate("/add-expense")}
              className="rounded-lg px-4 py-2 text-sm font-medium"
              style={{ background: colors.accent, color: colors.bg }}
            >
              Add an expense
            </button>
          </div>
        )}

        {transactions && allCategories.length > 0 && (charts || []).length === 0 && (
          <div className="rounded-2xl p-5 mb-4 text-center" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            <p style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 16, fontWeight: 600 }} className="mb-1.5">
              No charts configured
            </p>
            <p className="text-sm" style={{ color: colors.textMuted }}>
              You have spending data, but nothing's set up to chart it yet - use "Add a chart" below to pick a
              category (or a few combined together) to start tracking.
            </p>
          </div>
        )}

        {transactions && chartData.length > 0 && (charts || []).map((chart) => (
          <div key={chart.id} className="mb-5">
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-sm" style={{ color: colors.text, fontWeight: 500 }}>{chart.categories.join(" + ")}</p>
              <button onClick={() => removeChart(chart.id)} aria-label="Remove chart" style={{ color: colors.textMuted }} className="transition-opacity hover:opacity-70">
                <X size={14} />
              </button>
            </div>
            <div className="rounded-2xl p-3 pt-4" style={{ background: colors.surface, border: `1px solid ${colors.border}`, height: chart.categories.length > 1 ? 210 : 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke={colors.border} vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: colors.textMuted, fontSize: 10 }}
                    axisLine={{ stroke: colors.border }}
                    tickLine={false}
                    interval={chartData.length > 8 ? Math.ceil(chartData.length / 8) - 1 : 0}
                  />
                  <YAxis tick={{ fill: colors.textMuted, fontSize: 9, fontFamily: fontMono }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => `$${Math.round(v / 100) / 10}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  {chart.categories.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: colors.textMuted }} />}
                  {chart.categories.map((cat, i) => (
                    <Line key={cat} type="monotone" dataKey={cat} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}

        {transactions && (charts || []).length > 0 && chartData.length === 0 && (
          <p className="text-sm mb-4" style={{ color: colors.textMuted }}>
            No spending in this range for your configured categories - try a wider range above, or add a chart for a
            category you've actually spent in recently.
          </p>
        )}

        {transactions && (
          showAddChart ? (
            <AddChartForm allCategories={allCategories} onCancel={() => setShowAddChart(false)} onAdd={addChart} />
          ) : (
            <button
              type="button"
              onClick={() => setShowAddChart(true)}
              className="w-full rounded-2xl py-3 mb-5 text-sm font-medium flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
              style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}
            >
              <Plus size={16} />
              Add a chart
            </button>
          )
        )}
      </div>
    </div>
  );
}
