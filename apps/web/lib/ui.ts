// Shared inline-style tokens so every panel looks like the same app. Inline styles keep
// the v0 dependency-free (no CSS framework yet); centralising them here keeps it coherent.
import type { CSSProperties } from "react";

export const colors = {
  bg: "#0b0b0f",
  panel: "#15151c",
  panelAlt: "#1c1c26",
  border: "#2a2a38",
  text: "#e8e8ec",
  dim: "#9a9aa8",
  accent: "#a487ff",
  accentDim: "#7c5cff",
  danger: "#ff6b6b",
};

export const field: CSSProperties = {
  padding: "8px 10px",
  background: colors.panel,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export const button: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  background: colors.panelAlt,
  color: colors.text,
  cursor: "pointer",
  fontSize: 14,
};

export const buttonPrimary: CSSProperties = {
  ...button,
  background: colors.accentDim,
  borderColor: colors.accentDim,
  color: "#fff",
  fontWeight: 600,
};

export const card: CSSProperties = {
  background: colors.panel,
  border: `1px solid ${colors.border}`,
  borderRadius: 12,
  padding: 16,
};

export const label: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  color: colors.dim,
};

export const sectionTitle: CSSProperties = {
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: colors.dim,
  margin: "0 0 8px",
};
