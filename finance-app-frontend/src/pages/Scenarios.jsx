import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, X, Check, Trash2, ChevronDown } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { accountsApi, recurringApi, scenariosApi } from "../lib/apiClient";
import { colors, fontDisplay, fontBody, fontMono, formatMoney, chartCrossesZero } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import InfoBubble from "../components/InfoBubble";


function SectionHeader({ children, info }) {
  return (
    <div className="flex items-center mb-2 px-1">
      <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>{children}</h3>
      {info && <InfoBubble text={info} />}
    </div>
  );
}

function AdjustmentRow({ children, onRemove }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="flex-1 flex flex-wrap gap-2 min-w-0">{children}</div>
      <button onClick={onRemove} aria-label="Remove" style={{ color: colors.alert }}><Trash2 size={15} /></button>
    </div>
  );
}

const FREQUENCY_ABBR = { weekly: "wk", biweekly: "2wk", semimonthly: "2x/mo", monthly: "mo", annual: "yr" };
const FREQUENCY_TO_MONTHLY = { weekly: 52 / 12, biweekly: 26 / 12, semimonthly: 2, monthly: 1, annual: 1 / 12 };
const FREQUENCY_LABEL = { weekly: "week", biweekly: "2 weeks", semimonthly: "half-month", monthly: "month", annual: "year" };
// Same days-per-period approach as finance_common.planned_expenses's
// suggested_contribution, extended with the frequencies this page
// already offers elsewhere - real elapsed days divided into periods,
// not calendar months, so a goal set mid-month is still accurate.
const DAYS_PER_PERIOD = { weekly: 7, biweekly: 14, semimonthly: 365.25 / 24, monthly: 365.25 / 12, annual: 365.25 };

function monthlyEquivalent(item) {
  if (item.frequency === "custom") {
    const count = Math.max(parseInt(item.intervalCount, 10) || 1, 1);
    const unit = item.intervalUnit || "days";
    const daysPerOccurrence = unit === "weeks" ? count * 7 : unit === "months" ? count * (365.25 / 12) : count;
    return item.estimatedAmount * ((365.25 / 12) / daysPerOccurrence);
  }
  return item.estimatedAmount * (FREQUENCY_TO_MONTHLY[item.frequency] ?? 1);
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function ScenariosPage() {
  const { theme } = useTheme();
  const [savedScenarios, setSavedScenarios] = useState(null);
  const [expenseOptions, setExpenseOptions] = useState([]);
  const [incomeOptions, setIncomeOptions] = useState([]);
  const [error, setError] = useState(null);

  const [name, setName] = useState("");
  const [incomeAdjustments, setIncomeAdjustments] = useState([]);
  const [newIncome, setNewIncome] = useState([]);
  const [oneTimeExpenses, setOneTimeExpenses] = useState([]);
  const [expenseAdjustments, setExpenseAdjustments] = useState([]);
  const [newExpenses, setNewExpenses] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [goalTarget, setGoalTarget] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [goalAlreadySaved, setGoalAlreadySaved] = useState("");
  const [goalFrequency, setGoalFrequency] = useState("monthly");

  const [selectedForCompare, setSelectedForCompare] = useState([]);
  const [compareResult, setCompareResult] = useState(null);
  const [trendResult, setTrendResult] = useState(null);
  const [comparing, setComparing] = useState(false);

  function refresh() {
    scenariosApi.list().then(setSavedScenarios).catch(() => setError("Couldn't load your saved scenarios."));
    accountsApi
      .list()
      .then((accts) => Promise.all(accts.map((a) => recurringApi.list(a.accountId).catch(() => []))))
      .then((perAccount) => {
        const flat = perAccount.flat();
        setExpenseOptions(flat.filter((i) => !i.isIncome));
        setIncomeOptions(flat.filter((i) => i.isIncome));
      })
      .catch(() => {});
  }
  useEffect(refresh, []);

  function buildAdjustments() {
    return {
      name: name.trim() || undefined,
      incomeAdjustments: incomeAdjustments
        .filter((a) => a.recurringId && a.newAmount !== "")
        .map((a) => {
          const item = incomeOptions.find((i) => i.recurringId === a.recurringId);
          const current = item ? monthlyEquivalent(item) : 0;
          return { recurringId: a.recurringId, monthlyDelta: (parseFloat(a.newAmount) || 0) - current, startDate: a.startDate || undefined };
        }),
      expenseAdjustments: expenseAdjustments
        .filter((a) => a.recurringId && a.newAmount !== "")
        .map((a) => {
          const item = expenseOptions.find((i) => i.recurringId === a.recurringId);
          const current = item ? monthlyEquivalent(item) : 0;
          return { recurringId: a.recurringId, monthlyDelta: (parseFloat(a.newAmount) || 0) - current, startDate: a.startDate || undefined };
        }),
      newExpenses: newExpenses.filter((e) => e.description && e.monthlyAmount !== "").map((e) => ({ description: e.description, category: e.category || "Uncategorized", monthlyAmount: parseFloat(e.monthlyAmount) || 0, startDate: e.startDate || undefined })),
      newIncome: newIncome.filter((i) => i.description && i.monthlyAmount !== "").map((i) => ({ description: i.description, monthlyAmount: parseFloat(i.monthlyAmount) || 0, startDate: i.startDate || undefined })),
      oneTimeExpenses: oneTimeExpenses.filter((e) => e.description && e.amount !== "" && e.date).map((e) => ({ description: e.description, amount: parseFloat(e.amount) || 0, date: e.date })),
    };
  }

  async function runPreview() {
    setPreviewLoading(true);
    try {
      const result = await scenariosApi.calculateThrowaway(buildAdjustments());
      setPreview(result);
    } catch (err) {
      setError(err.message || "Couldn't calculate that scenario.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function saveScenario() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await scenariosApi.save(buildAdjustments());
      setName("");
      setIncomeAdjustments([]);
      setExpenseAdjustments([]);
      setNewExpenses([]);
      setNewIncome([]);
      setOneTimeExpenses([]);
      setPreview(null);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't save that scenario.");
    } finally {
      setSaving(false);
    }
  }

  const [confirmDeleteScenario, setConfirmDeleteScenario] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function deleteScenario() {
    if (!confirmDeleteScenario) return;
    setDeleting(true);
    setError(null);
    try {
      await scenariosApi.remove(confirmDeleteScenario.scenarioId);
      setSelectedForCompare((s) => s.filter((x) => x !== confirmDeleteScenario.scenarioId));
      setConfirmDeleteScenario(null);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't delete that scenario.");
    } finally {
      setDeleting(false);
    }
  }

  function toggleCompare(id) {
    setSelectedForCompare((sel) => {
      if (sel.includes(id)) return sel.filter((x) => x !== id);
      if (sel.length >= 6) return sel;
      return [...sel, id];
    });
  }

  async function runCompare() {
    if (selectedForCompare.length === 0) return;
    setComparing(true);
    setError(null);
    try {
      const scenarioRefs = selectedForCompare.map((id) => ({ scenarioId: id }));
      const [compareRes, trendRes] = await Promise.all([
        scenariosApi.compare({ scenarios: scenarioRefs }),
        scenariosApi.trend({ scenarios: scenarioRefs }),
      ]);
      setCompareResult(compareRes);
      setTrendResult(trendRes);
    } catch (err) {
      setError(err.message || "Couldn't compare those scenarios.");
    } finally {
      setComparing(false);
    }
  }

  const goalResult = useMemo(() => {
    const target = parseFloat(goalTarget);
    if (!target || target <= 0 || !goalDate) return null;
    const remaining = target - (parseFloat(goalAlreadySaved) || 0);
    if (remaining <= 0) return { alreadyThere: true };

    const daysRemaining = Math.max((new Date(`${goalDate}T00:00:00`) - new Date()) / 86400000, 1);
    const perMonth = remaining / Math.max(daysRemaining / DAYS_PER_PERIOD.monthly, 1);
    const perPeriod = remaining / Math.max(daysRemaining / DAYS_PER_PERIOD[goalFrequency], 1);
    return { perMonth, perPeriod, isPast: (new Date(`${goalDate}T00:00:00`) - new Date()) < 0 };
  }, [goalTarget, goalDate, goalAlreadySaved, goalFrequency]);

  const chartData = useMemo(() => {
    if (!trendResult) return [];
    return trendResult.baseline.map((point, i) => {
      const row = { date: point.date.slice(5), Baseline: Math.round(point.cumulative) };
      for (const s of trendResult.scenarios) {
        if (s.series) row[s.name] = Math.round(s.series[i]?.cumulative ?? 0);
      }
      return row;
    });
  }, [trendResult]);

  const CHART_LINE_COLORS = [colors.accentLight, "#e8a87c", "#c97b7b", "#8ba888", "#7c9ec9"];

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Scenarios" />

      <div className="px-5 pt-6 max-w-md mx-auto">
        <PageBlurb>Test what-if changes — a raise, a new bill — and compare up to 6 scenarios against your real numbers.</PageBlurb>
        {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}

        <SectionHeader info="A scenario is never frozen — it's always recalculated against your real, current income, budgets, and planned expenses, even if you saved it months ago.">
          Build a scenario
        </SectionHeader>

        <div className="rounded-2xl p-4 mb-6" data-wizard-target="wizard-scenarios-build" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. If I got a raise)" className="w-full rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }} />

          <div className="flex items-center mb-2">
            <p className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Adjust an existing income</p>
            <InfoBubble text="Change one of your real income sources' amount for this scenario only - your actual recurring template isn't touched." />
          </div>
          {incomeAdjustments.map((a) => (
            <div key={a.id} className="mb-2">
              <AdjustmentRow onRemove={() => setIncomeAdjustments((r) => r.filter((x) => x.id !== a.id))}>
                <select
                  value={a.recurringId}
                  onChange={(e) => {
                    const item = incomeOptions.find((i) => i.recurringId === e.target.value);
                    setIncomeAdjustments((r) => r.map((x) => x.id === a.id ? { ...x, recurringId: e.target.value, newAmount: item ? String(Math.round(monthlyEquivalent(item) * 100) / 100) : "" } : x));
                  }}
                  className="flex-1 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                >
                  <option value="">Choose…</option>
                  {incomeOptions.map((i) => <option key={i.recurringId} value={i.recurringId}>{i.description} ({formatMoney(i.estimatedAmount)}/{FREQUENCY_ABBR[i.frequency] || i.frequency})</option>)}
                </select>
                <input type="number" value={a.newAmount} onChange={(e) => setIncomeAdjustments((r) => r.map((x) => x.id === a.id ? { ...x, newAmount: e.target.value } : x))} placeholder="New $/mo" style={{ width: 112, background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }} className="rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
              </AdjustmentRow>
              {a.recurringId && (
                <>
                  <label className="text-xs block mt-1.5 mb-1" style={{ color: colors.textMuted }}>Starting (optional - defaults to right away)</label>
                  <div style={{ width: "100%", overflow: "hidden", borderRadius: 8 }}>
                    <input
                      type="date"
                      value={a.startDate || ""}
                      onChange={(e) => setIncomeAdjustments((r) => r.map((x) => x.id === a.id ? { ...x, startDate: e.target.value } : x))}
                      className="w-full rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
                      style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: theme, maxWidth: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                </>
              )}
            </div>
          ))}
          <button onClick={() => setIncomeAdjustments((r) => [...r, { id: uid(), recurringId: "", newAmount: "", startDate: todayISO() }])} className="text-xs mb-4 flex items-center gap-1" style={{ color: colors.accentLight }}><Plus size={12} />Adjust an income</button>

          <div className="flex items-center mb-2">
            <p className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>New recurring income</p>
            <InfoBubble text="Model an income source you don't have yet - a raise, a new job, a side gig - without creating a real recurring template. For a single non-repeating windfall, use One-time expense below with a positive amount instead." />
          </div>
          {newIncome.map((i) => (
            <div key={i.id} className="mb-2">
              <AdjustmentRow onRemove={() => setNewIncome((r) => r.filter((x) => x.id !== i.id))}>
                <input value={i.description} onChange={(e) => setNewIncome((r) => r.map((x) => x.id === i.id ? { ...x, description: e.target.value } : x))} placeholder="e.g. Side gig" className="flex-1 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }} />
                <input type="number" value={i.monthlyAmount} onChange={(e) => setNewIncome((r) => r.map((x) => x.id === i.id ? { ...x, monthlyAmount: e.target.value } : x))} placeholder="$/mo" style={{ width: 80, background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }} className="rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
              </AdjustmentRow>
              <label className="text-xs block mt-1.5 mb-1" style={{ color: colors.textMuted }}>Starting (optional - defaults to right away)</label>
              <div style={{ width: "100%", overflow: "hidden", borderRadius: 8 }}>
                <input
                  type="date"
                  value={i.startDate || ""}
                  onChange={(e) => setNewIncome((r) => r.map((x) => x.id === i.id ? { ...x, startDate: e.target.value } : x))}
                  className="w-full rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: theme, maxWidth: "100%", boxSizing: "border-box" }}
                />
              </div>
            </div>
          ))}
          <button onClick={() => setNewIncome((r) => [...r, { id: uid(), description: "", monthlyAmount: "", startDate: todayISO() }])} className="text-xs mb-4 flex items-center gap-1" style={{ color: colors.accentLight }}><Plus size={12} />Add hypothetical income</button>

          <div className="flex items-center mb-2">
            <p className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Adjust an existing expense</p>
            <InfoBubble text="Change one of your real recurring bills' amount for this scenario only - your actual recurring template isn't touched." />
          </div>
          {expenseAdjustments.map((a) => (
            <div key={a.id} className="mb-2">
              <AdjustmentRow onRemove={() => setExpenseAdjustments((r) => r.filter((x) => x.id !== a.id))}>
                <select
                  value={a.recurringId}
                  onChange={(e) => {
                    const item = expenseOptions.find((i) => i.recurringId === e.target.value);
                    setExpenseAdjustments((r) => r.map((x) => x.id === a.id ? { ...x, recurringId: e.target.value, newAmount: item ? String(Math.round(monthlyEquivalent(item) * 100) / 100) : "" } : x));
                  }}
                  className="flex-1 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                >
                  <option value="">Choose…</option>
                  {expenseOptions.map((e) => <option key={e.recurringId} value={e.recurringId}>{e.description} ({formatMoney(e.estimatedAmount)}/{FREQUENCY_ABBR[e.frequency] || e.frequency})</option>)}
                </select>
                <input type="number" value={a.newAmount} onChange={(e) => setExpenseAdjustments((r) => r.map((x) => x.id === a.id ? { ...x, newAmount: e.target.value } : x))} placeholder="New $/mo" style={{ width: 112, background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }} className="rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
              </AdjustmentRow>
              {a.recurringId && (
                <>
                  <label className="text-xs block mt-1.5 mb-1" style={{ color: colors.textMuted }}>Starting (optional - defaults to right away)</label>
                  <div style={{ width: "100%", overflow: "hidden", borderRadius: 8 }}>
                    <input
                      type="date"
                      value={a.startDate || ""}
                      onChange={(e) => setExpenseAdjustments((r) => r.map((x) => x.id === a.id ? { ...x, startDate: e.target.value } : x))}
                      className="w-full rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
                      style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: theme, maxWidth: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                </>
              )}
            </div>
          ))}
          <button onClick={() => setExpenseAdjustments((r) => [...r, { id: uid(), recurringId: "", newAmount: "", startDate: todayISO() }])} className="text-xs mb-4 flex items-center gap-1" style={{ color: colors.accentLight }}><Plus size={12} />Adjust an expense</button>

          <div className="flex items-center mb-2">
            <p className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>New recurring expense</p>
            <InfoBubble text="Model a new ongoing bill you don't have yet - a subscription, a new payment - without creating a real recurring template. For a single non-repeating cost, use One-time expense below instead." />
          </div>
          {newExpenses.map((e) => (
            <div key={e.id} className="mb-2">
              <AdjustmentRow onRemove={() => setNewExpenses((r) => r.filter((x) => x.id !== e.id))}>
                <input value={e.description} onChange={(ev) => setNewExpenses((r) => r.map((x) => x.id === e.id ? { ...x, description: ev.target.value } : x))} placeholder="e.g. Gym membership" className="flex-1 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }} />
                <input type="number" value={e.monthlyAmount} onChange={(ev) => setNewExpenses((r) => r.map((x) => x.id === e.id ? { ...x, monthlyAmount: ev.target.value } : x))} placeholder="$/mo" style={{ width: 80, background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }} className="rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
              </AdjustmentRow>
              <label className="text-xs block mt-1.5 mb-1" style={{ color: colors.textMuted }}>Starting (optional - defaults to right away)</label>
              <div style={{ width: "100%", overflow: "hidden", borderRadius: 8 }}>
                <input
                  type="date"
                  value={e.startDate || ""}
                  onChange={(ev) => setNewExpenses((r) => r.map((x) => x.id === e.id ? { ...x, startDate: ev.target.value } : x))}
                  className="w-full rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: theme, maxWidth: "100%", boxSizing: "border-box" }}
                />
              </div>
            </div>
          ))}
          <button onClick={() => setNewExpenses((r) => [...r, { id: uid(), description: "", category: "", monthlyAmount: "", startDate: todayISO() }])} className="text-xs mb-4 flex items-center gap-1" style={{ color: colors.accentLight }}><Plus size={12} />Add hypothetical expense</button>

          <div className="flex items-center mb-2" data-wizard-target="wizard-scenarios-onetime">
            <p className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>One-time expense</p>
            <InfoBubble text="A single cost on a specific date - not an ongoing monthly bill. Attributed to whichever real payday comes right before that date, since that's when you'd need the money set aside." />
          </div>
          {oneTimeExpenses.map((e) => (
            <AdjustmentRow key={e.id} onRemove={() => setOneTimeExpenses((r) => r.filter((x) => x.id !== e.id))}>
              <input value={e.description} onChange={(ev) => setOneTimeExpenses((r) => r.map((x) => x.id === e.id ? { ...x, description: ev.target.value } : x))} placeholder="e.g. Car repair" className="flex-1 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }} />
              <input type="number" value={e.amount} onChange={(ev) => setOneTimeExpenses((r) => r.map((x) => x.id === e.id ? { ...x, amount: ev.target.value } : x))} placeholder="$" style={{ width: 70, background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }} className="rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
              <input type="date" value={e.date || ""} onChange={(ev) => setOneTimeExpenses((r) => r.map((x) => x.id === e.id ? { ...x, date: ev.target.value } : x))} style={{ width: 130, maxWidth: "100%", boxSizing: "border-box", background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: theme }} className="rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
            </AdjustmentRow>
          ))}
          <button onClick={() => setOneTimeExpenses((r) => [...r, { id: uid(), description: "", amount: "", date: "" }])} className="text-xs mb-4 flex items-center gap-1" style={{ color: colors.accentLight }}><Plus size={12} />Add one-time expense</button>

          <div className="flex gap-2" data-wizard-target="wizard-scenarios-preview">
            <button onClick={runPreview} disabled={previewLoading} className="flex-1 rounded-lg py-2.5 text-sm font-medium" style={{ border: `1px solid ${colors.border}`, color: colors.text, opacity: previewLoading ? 0.6 : 1 }}>
              {previewLoading ? "Calculating…" : "Preview"}
            </button>
            <button onClick={saveScenario} disabled={!name.trim() || saving} className="flex-1 rounded-lg py-2.5 text-sm font-medium" style={{ background: name.trim() ? colors.accent : colors.surfaceRaised, color: name.trim() ? colors.bg : colors.textMuted, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {preview && (
          <div className="rounded-2xl p-4 mb-6" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs" style={{ color: colors.textMuted }}>Projected leftover</span>
              <span style={{ fontFamily: fontMono, color: colors.textMuted, fontSize: 12 }}>was {formatMoney(preview.baseline.projectedLeftover)}</span>
            </div>
            <p style={{ fontFamily: fontMono, fontSize: 22, color: preview.adjusted.projectedLeftover >= 0 ? colors.positive : colors.alert }}>
              {formatMoney(preview.adjusted.projectedLeftover)}
              <span className="text-sm ml-2" style={{ color: preview.leftoverDelta >= 0 ? colors.positive : colors.alert }}>
                ({preview.leftoverDelta >= 0 ? "+" : ""}{formatMoney(preview.leftoverDelta)})
              </span>
            </p>
          </div>
        )}

        <SectionHeader info="Splits the remaining amount evenly across the real days between now and your target date - the same math Planned Expenses uses for its own suggested contribution. This is a quick calculator only; it doesn't create a real Planned Expense or move any money.">
          Savings goal
        </SectionHeader>
        <div className="rounded-2xl p-4 mb-6" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
          <div className="flex gap-2 mb-3">
            <div className="flex-1 min-w-0">
              <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Target amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: colors.textMuted, fontFamily: fontMono }}>$</span>
                <input type="number" inputMode="decimal" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} placeholder="0.00" className="w-full rounded-lg pl-6 pr-3 py-2 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }} />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>By when</label>
              <div style={{ width: "100%", overflow: "hidden", borderRadius: 8 }}>
                <input type="date" value={goalDate} onChange={(e) => setGoalDate(e.target.value)} className="w-full rounded-lg px-2.5 py-2 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: theme, maxWidth: "100%", boxSizing: "border-box" }} />
              </div>
            </div>
          </div>
          <div className="flex gap-2 mb-4">
            <div className="flex-1">
              <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Already saved <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: colors.textMuted, fontFamily: fontMono }}>$</span>
                <input type="number" inputMode="decimal" value={goalAlreadySaved} onChange={(e) => setGoalAlreadySaved(e.target.value)} placeholder="0.00" className="w-full rounded-lg pl-6 pr-3 py-2 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }} />
              </div>
            </div>
            <div className="flex-1">
              <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Show per</label>
              <div className="relative">
                <select value={goalFrequency} onChange={(e) => setGoalFrequency(e.target.value)} className="w-full appearance-none rounded-lg px-2.5 py-2 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}>
                  {Object.keys(DAYS_PER_PERIOD).map((f) => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
              </div>
            </div>
          </div>

          {goalResult && (
            <div className="rounded-xl p-3" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.border}` }}>
              {goalResult.alreadyThere ? (
                <p className="text-sm" style={{ color: colors.positive }}>You've already saved enough for this goal.</p>
              ) : (
                <>
                  {goalResult.isPast && (
                    <p className="text-xs mb-2" style={{ color: colors.alert }}>That date has already passed - showing what you'd need to set aside right away.</p>
                  )}
                  <p style={{ fontFamily: fontMono, fontSize: 20, color: colors.text }}>{formatMoney(goalResult.perMonth)}<span className="text-sm" style={{ color: colors.textMuted }}>/month</span></p>
                  {goalFrequency !== "monthly" && (
                    <p className="text-xs mt-1" style={{ color: colors.textMuted, fontFamily: fontMono }}>{formatMoney(goalResult.perPeriod)} per {FREQUENCY_LABEL[goalFrequency]}</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <SectionHeader>Saved scenarios</SectionHeader>
        <div className="rounded-2xl mb-4 overflow-hidden" data-wizard-target="wizard-scenarios-saved" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
          {savedScenarios === null && !error ? (
            <p className="text-sm py-4 text-center" style={{ color: colors.textMuted }}>Loading…</p>
          ) : savedScenarios.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: colors.textMuted }}>Nothing saved yet.</p>
          ) : (
            savedScenarios.map((s, i) => (
              <div key={s.scenarioId} className="flex items-center justify-between px-4 py-3" style={{ borderBottom: i < savedScenarios.length - 1 ? `1px solid ${colors.border}` : "none" }}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <button onClick={() => toggleCompare(s.scenarioId)} className="flex items-center justify-center rounded-full shrink-0" style={{ width: 18, height: 18, border: `1.5px solid ${selectedForCompare.includes(s.scenarioId) ? colors.accentLight : colors.borderStrong}`, background: selectedForCompare.includes(s.scenarioId) ? colors.accentLight : "transparent" }}>
                    {selectedForCompare.includes(s.scenarioId) && <Check size={11} style={{ color: colors.bg }} />}
                  </button>
                  <span className="text-sm truncate" style={{ color: colors.text }}>{s.name}</span>
                </div>
                <button onClick={() => setConfirmDeleteScenario(s)} aria-label="Delete" style={{ color: colors.alert }}><Trash2 size={15} /></button>
              </div>
            ))
          )}
        </div>

        {savedScenarios && savedScenarios.length > 0 && (
          <button onClick={runCompare} disabled={selectedForCompare.length === 0 || comparing} data-wizard-target="wizard-scenarios-compare" className="w-full rounded-2xl py-3 mb-6 text-sm font-medium" style={{ background: selectedForCompare.length > 0 ? colors.accent : colors.surface, color: selectedForCompare.length > 0 ? colors.bg : colors.textMuted, opacity: comparing ? 0.6 : 1 }}>
            {comparing ? "Comparing…" : `Compare ${selectedForCompare.length || ""} selected`}
          </button>
        )}

        {trendResult && chartData.length > 0 && (
          <>
            <SectionHeader>Trend</SectionHeader>
            <div className="rounded-2xl p-4 mb-6" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
              <p className="text-xs mb-3" style={{ color: colors.textMuted }}>Cumulative leftover across your next {chartData.length} paychecks.</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                  <XAxis dataKey="date" tick={{ fill: colors.textMuted, fontSize: 11 }} />
                  <YAxis tick={{ fill: colors.textMuted, fontSize: 11 }} tickFormatter={(v) => `$${Math.round(v / 100) / 10}k`} />
                  <Tooltip
                    contentStyle={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}`, borderRadius: 8, fontSize: 12 }}
                    formatter={(v) => formatMoney(v)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: colors.textMuted }} />
                  {chartCrossesZero(chartData, ["Baseline", ...trendResult.scenarios.filter((s) => s.series).map((s) => s.name)]) && (
                    <ReferenceLine y={0} stroke={colors.alert} strokeWidth={1.5} />
                  )}
                  <Line type="monotone" dataKey="Baseline" stroke={colors.textMuted} strokeWidth={2} dot={false} strokeDasharray="4 3" />
                  {trendResult.scenarios.map((s, i) => (
                    s.series && <Line key={s.scenarioId || s.name} type="monotone" dataKey={s.name} stroke={CHART_LINE_COLORS[i % CHART_LINE_COLORS.length]} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {compareResult && (
          <>
            <SectionHeader>Comparison</SectionHeader>
            <div className="rounded-2xl overflow-hidden mb-4" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${colors.border}`, background: colors.surfaceRaised }}>
                <span className="text-sm" style={{ color: colors.text }}>Today (baseline)</span>
                <span style={{ fontFamily: fontMono, fontSize: 14, color: colors.text }}>{formatMoney(compareResult.baseline.projectedLeftover)}</span>
              </div>
              {compareResult.scenarios.map((s, i) => {
                const breakdown = s.error ? [] : [
                  ...(s.incomeAdjustments || []).map((a) => {
                    const item = incomeOptions.find((o) => o.recurringId === a.recurringId);
                    return { label: item ? item.description : "Income", delta: a.monthlyDelta, leftoverImpact: a.monthlyDelta };
                  }),
                  ...(s.expenseAdjustments || []).map((a) => {
                    const item = expenseOptions.find((o) => o.recurringId === a.recurringId);
                    return { label: item ? item.description : "Expense", delta: a.monthlyDelta, leftoverImpact: -a.monthlyDelta };
                  }),
                  ...(s.newIncome || []).map((n) => ({ label: `${n.description} (new)`, delta: n.monthlyAmount, leftoverImpact: n.monthlyAmount })),
                  ...(s.newExpenses || []).map((n) => ({ label: `${n.description} (new)`, delta: n.monthlyAmount, leftoverImpact: -n.monthlyAmount })),
                  ...(s.oneTimeExpenses || []).map((n) => ({ label: `${n.description} (one-time, ~${n.snappedToPayday})`, delta: n.amount, leftoverImpact: -n.amount, isOneTime: true })),
                ];
                return (
                  <div key={s.scenarioId || i} className="px-4 py-3" style={{ borderBottom: i < compareResult.scenarios.length - 1 ? `1px solid ${colors.border}` : "none" }}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm truncate pr-2" style={{ color: colors.text }}>{s.name}</span>
                      {s.error ? (
                        <span className="text-xs" style={{ color: colors.alert }}>{s.error}</span>
                      ) : (
                        <span className="flex items-center gap-2 shrink-0">
                          <span style={{ fontFamily: fontMono, fontSize: 14, color: s.adjusted.projectedLeftover >= 0 ? colors.positive : colors.alert }}>{formatMoney(s.adjusted.projectedLeftover)}</span>
                          <span className="text-xs" style={{ color: s.leftoverDelta >= 0 ? colors.positive : colors.alert }}>({s.leftoverDelta >= 0 ? "+" : ""}{formatMoney(s.leftoverDelta)})</span>
                        </span>
                      )}
                    </div>
                    {breakdown.length > 0 && (
                      <div className="mt-1.5">
                        {breakdown.map((b, bi) => (
                          <div key={bi} className="flex items-center justify-between">
                            <span className="text-xs truncate pr-2" style={{ color: colors.textMuted }}>{b.label}</span>
                            <span className="text-xs shrink-0" style={{ fontFamily: fontMono, color: b.leftoverImpact >= 0 ? colors.positive : colors.alert }}>{b.delta >= 0 ? "+" : ""}{formatMoney(b.delta)}{b.isOneTime ? "" : "/mo"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <ConfirmDeleteDialog
        open={!!confirmDeleteScenario}
        title={`Delete "${confirmDeleteScenario?.name}"?`}
        body="This can't be undone."
        busy={deleting}
        error={error}
        onCancel={() => { setConfirmDeleteScenario(null); setError(null); }}
        onConfirm={deleteScenario}
      />
    </div>
  );
}
