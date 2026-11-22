import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Viewer from "./Viewer";
import type { Folder } from "./photos";
import SettingsDialog from "./SettingsDialog";
import { loadSettings, type Settings } from "./settings";
import { t, backendMessage } from "./i18n";
import IconButton from "./IconButton";
import { useUpdates } from "./Updates";
import "./App.css";

export default function App() {
  const updates = useUpdates();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [infoOpen, setInfoOpen] = useState(() => localStorage.getItem("photopicker.showExif") === "true");
  const [settings, setSettings] = useState<Settings | null>(null);

  const [focusMode, setFocusMode] = useState(false);
  const wasFullscreen = useRef(false);
  const switching = useRef(false);
  const focusKey = /Mac/i.test(navigator.platform) ? "⌘ Return" : "Alt + Enter";

  const toggleFocus = useCallback(async () => {
    if (switching.current) return;
    switching.current = true;
    try {
      const win = getCurrentWindow();
      if (!focusMode) wasFullscreen.current = await win.isFullscreen();
      if (!wasFullscreen.current) await win.setFullscreen(!focusMode);
      setFocusMode(!focusMode);
    } catch (cause) {
      setError(t("전체 화면을 전환할 수 없습니다.") + " " + backendMessage(cause));
    } finally {
      switching.current = false;
    }
  }, [focusMode]);

  useEffect(() => {
    if (!focusMode) return;
    // The system can leave fullscreen through its own window controls.
    let active = true;
    let timer: number;
    function resized() {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        try {
          const full = await getCurrentWindow().isFullscreen();
          if (active && !switching.current && !full) setFocusMode(false);
        } catch { /* The window may already be closing. */ }
      }, 400);
    }
    window.addEventListener("resize", resized);
    return () => { active = false; window.clearTimeout(timer); window.removeEventListener("resize", resized); };
  }, [focusMode]);

  async function chooseFolder() {
    setBusy(true);
    setError("");
    try {
      const selected = await invoke<Folder | null>("choose_folder");
      if (selected) setFolder(selected);
    } catch (cause) {
      setError(t("폴더를 열 수 없습니다.") + " " + backendMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return <main className={folder ? "workspace" : "welcome"}>
    {!focusMode && <header>
      {!folder && <h1>Photo Picker neo</h1>}
      {folder && <span className="path" title={folder.path}>{folder.path.split(/[\\/]/).filter(Boolean).pop() || folder.path}</span>}
      <IconButton icon="folder" label={t("폴더 열기")} className="folder-open" disabled={busy} aria-busy={busy} onClick={chooseFolder} />
      {!!folder?.photos.length && <IconButton icon="info" label={t("촬영 정보")} aria-expanded={infoOpen} aria-controls="shooting-info" onClick={() => {
        localStorage.setItem("photopicker.showExif", String(!infoOpen));
        setInfoOpen(!infoOpen);
      }} />}
      {!!folder?.photos.length && <IconButton icon="fullscreen" label={t("집중 모드") + " (" + focusKey + ")"} onClick={toggleFocus} />}
      <IconButton icon="settings" label={t("설정")} className="open-settings" onClick={() => {
        try { setSettings(loadSettings()); setError(""); }
        catch { setError(t("저장된 설정을 읽을 수 없습니다.")); }
      }} />
    </header>}
    {settings && <SettingsDialog updates={updates} initial={settings} pick={folder?.pick} onClose={() => setSettings(null)} />}
    {error && <p role="alert">{error}</p>}
    {folder && (folder.photos.length ? <Viewer key={folder.generation} folder={folder} infoOpen={infoOpen} focusMode={focusMode} toggleFocus={toggleFocus} focusKey={focusKey} /> :
      <p className="empty">{t("이 폴더에는 탐색할 JPEG, HEIF 또는 RAW가 없습니다.")}</p>)}
  </main>;
}
