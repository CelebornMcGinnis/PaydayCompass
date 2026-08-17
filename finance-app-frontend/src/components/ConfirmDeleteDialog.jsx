import React from "react";
import { colors, fontDisplay } from "../lib/theme";

export default function ConfirmDeleteDialog({ open, title, body, confirmLabel = "Delete", busy, error, onCancel, onConfirm }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-5"
        style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <p style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 17, fontWeight: 600 }} className="mb-2">{title}</p>
        {body && <p className="text-sm mb-3" style={{ color: colors.textMuted }}>{body}</p>}
        {error && <p className="text-sm mb-3" style={{ color: colors.alert }}>{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg py-2.5 text-sm font-medium"
            style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-lg py-2.5 text-sm font-medium"
            style={{ background: colors.alert, color: colors.bg, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
