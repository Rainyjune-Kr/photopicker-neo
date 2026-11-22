import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import { invoke, isTauri } from "@tauri-apps/api/core";
import { setLanguage } from "./i18n";
import { applyTheme } from "./theme";
import { loadSettings } from "./settings";

async function start() {
  const locale = isTauri() ? await invoke<string>("ui_language").catch(() => navigator.language) : navigator.language;
  setLanguage(locale);
  try { applyTheme(loadSettings().theme); } catch { applyTheme("system"); }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
}
void start();
