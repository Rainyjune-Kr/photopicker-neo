import { setTheme } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
export const themeLabels = { system: "시스템 설정 따르기", light: "라이트", dark: "다크" } as const;
export type Theme = keyof typeof themeLabels;

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  if (isTauri()) void setTheme(theme === "system" ? null : theme).catch(console.error);
}
