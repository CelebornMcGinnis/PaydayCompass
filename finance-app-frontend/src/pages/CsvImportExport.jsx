import React, { useRef, useState } from "react";
import { Download, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from "lucide-react";
import { csvApi } from "../lib/apiClient";
import { colors, fontDisplay, fontBody } from "../lib/theme";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";

function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function CsvSection({ title, description, filename, exportFn, importFn, successLabel }) {
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState(null);
  const [fileText, setFileText] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null); // { imported/created: n } | null
  const [rowErrors, setRowErrors] = useState(null); // string[] | null
  const [importError, setImportError] = useState(null); // network/auth-level error

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const csvText = await exportFn();
      downloadCsv(filename, csvText);
    } catch (err) {
      setExportError(err.message || "Couldn't download that template.");
    } finally {
      setExporting(false);
    }
  }

  function handlePickFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    setRowErrors(null);
    setImportError(null);
    setFileName(file.name);
    file.text().then(setFileText).catch(() => setImportError("Couldn't read that file."));
  }

  async function handleImport() {
    if (!fileText) return;
    setImporting(true);
    setResult(null);
    setRowErrors(null);
    setImportError(null);
    try {
      const data = await importFn(fileText);
      setResult(data);
      setFileName(null);
      setFileText(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      if (err.status === 400 && Array.isArray(err.body?.errors)) {
        setRowErrors(err.body.errors);
      } else {
        setImportError(err.message || "Couldn't import that file.");
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="rounded-2xl p-4 mb-5" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
      <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 16, fontWeight: 600 }} className="mb-1">{title}</h3>
      <p className="text-xs mb-4" style={{ color: colors.textMuted }}>{description}</p>

      <button
        type="button"
        onClick={handleExport}
        disabled={exporting}
        className="w-full rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-2 mb-2"
        style={{ border: `1px solid ${colors.border}`, color: colors.text, opacity: exporting ? 0.6 : 1 }}
      >
        <Download size={15} />
        {exporting ? "Downloading…" : "Download template"}
      </button>
      {exportError && <p className="text-xs mb-2" style={{ color: colors.alert }}>{exportError}</p>}

      <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${colors.border}` }}>
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handlePickFile} className="hidden" id={`csv-file-${title.replace(/\s+/g, "-").toLowerCase()}`} />
        <label
          htmlFor={`csv-file-${title.replace(/\s+/g, "-").toLowerCase()}`}
          className="w-full rounded-lg py-2.5 text-sm flex items-center justify-center gap-2 cursor-pointer"
          style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}
        >
          <FileSpreadsheet size={15} />
          {fileName || "Choose a filled-in CSV…"}
        </label>

        {fileName && (
          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="w-full rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-2 mt-2"
            style={{ background: colors.accent, color: colors.bg, opacity: importing ? 0.6 : 1 }}
          >
            <Upload size={15} />
            {importing ? "Importing…" : "Import"}
          </button>
        )}

        {importError && <p className="text-xs mt-2" style={{ color: colors.alert }}>{importError}</p>}

        {rowErrors && (
          <div className="rounded-lg p-3 mt-2" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.alert}` }}>
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle size={14} color={colors.alert} />
              <p className="text-xs font-medium" style={{ color: colors.text }}>
                Nothing was imported - fix {rowErrors.length === 1 ? "this" : "these"} and re-upload
              </p>
            </div>
            <ul className="text-xs" style={{ color: colors.textMuted }}>
              {rowErrors.map((e, i) => (
                <li key={i} className="py-0.5">{e}</li>
              ))}
            </ul>
          </div>
        )}

        {result && (
          <div className="rounded-lg p-3 mt-2 flex items-center gap-2" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.positive}` }}>
            <CheckCircle2 size={14} color={colors.positive} />
            <p className="text-xs" style={{ color: colors.text }}>{successLabel(result)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CsvImportExportPage() {
  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Import / export CSV" />

      <div className="px-5 pt-6 max-w-md mx-auto">
        <PageBlurb>Download a template pre-filled with your account names, fill it in, and upload it back - or export it just to keep a copy.</PageBlurb>

        <div data-wizard-target="wizard-csv-transactions">
          <CsvSection
            title="Transactions"
            description="Bulk-add one-time expenses or income. Every row needs an existing account name and an amount - negative for an expense, positive for income."
            filename="finance-app-import-template.csv"
            exportFn={csvApi.exportTemplate}
            importFn={csvApi.importCsv}
            successLabel={(r) => `Imported ${r.imported} transaction${r.imported === 1 ? "" : "s"}.`}
          />
        </div>

        <div data-wizard-target="wizard-csv-recurring">
          <CsvSection
            title="Recurring items"
            description="Bulk-create recurring bills or income. Doesn't support custom-interval or nth-weekday-of-month schedules - use the Recurring page for those."
            filename="finance-app-recurring-template.csv"
            exportFn={csvApi.exportRecurringTemplate}
            importFn={csvApi.importRecurringCsv}
            successLabel={(r) => `Created ${r.created} recurring item${r.created === 1 ? "" : "s"}.`}
          />
        </div>
      </div>
    </div>
  );
}
