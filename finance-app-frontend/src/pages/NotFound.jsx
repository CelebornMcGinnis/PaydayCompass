import React from "react";
import { useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";
import { colors, fontDisplay, fontBody } from "../lib/theme";

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: colors.bg, fontFamily: fontBody }}>
      <div className="text-center max-w-sm">
        <div
          className="inline-flex items-center justify-center rounded-full mb-5"
          style={{ width: 64, height: 64, background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}
        >
          <Compass size={26} style={{ color: colors.accentLight }} />
        </div>
        <h1 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 26, fontWeight: 600 }} className="mb-2">
          Nothing here
        </h1>
        <p className="text-sm mb-8" style={{ color: colors.textMuted }}>
          That page doesn't exist, or you may have followed a broken link.
        </p>
        <button
          onClick={() => navigate("/")}
          className="w-full rounded-xl py-3 text-sm font-medium"
          style={{ background: colors.accent, color: colors.bg }}
        >
          Back to dashboard
        </button>
      </div>
    </div>
  );
}
