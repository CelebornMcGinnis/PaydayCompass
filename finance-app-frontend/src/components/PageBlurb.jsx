import React from "react";
import { colors } from "../lib/theme";

export default function PageBlurb({ children }) {
  return (
    <p className="text-sm mb-5" style={{ color: colors.textMuted }}>
      {children}
    </p>
  );
}
