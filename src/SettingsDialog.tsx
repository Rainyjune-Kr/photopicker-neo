import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { modes, saveSettings, type Destination, type Settings } from "./settings";

import IconButton from "./IconButton";
import { t } from "./i18n";
import { applyTheme, themeLabels, type Theme } from "./theme";

interface Props { initial: Settings; pick?: string; onClose: () => void }

export default function SettingsDialog({ initial, pick, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);

  function cancel() {
    applyTheme(initial.theme);
    onClose();
  }

  function update(id: string, patch: Partial<Destination>) {
    setDraft(old => ({ ...old, destinations: old.destinations.map(d => d.id === id ? { ...d, ...patch } : d) }));
    setError("");
  }

  async function choose(row: Destination) {
    setChoosing(true);
    try {
      const path = await open({ directory: true, multiple: false, title: t("복사 목적지 선택"), defaultPath: row.path || undefined });
      if (path) update(row.id, { path });
    } catch { setError(t("폴더 선택 창을 열 수 없습니다.")); }
    finally { setChoosing(false); }
  }

  function add() {
    const key = [..."1234567890abcdefghijklmnopqrstuvwxyz"].find(k => !draft.destinations.some(d => d.shortcut.toLowerCase() === k)) ?? "";
    setDraft({ ...draft, destinations: [...draft.destinations, { id: crypto.randomUUID(), label: "Pick " + (key || draft.destinations.length + 1), shortcut: key, path: "" }] });
  }

  return <dialog className="preferences" aria-labelledby="settings-title" ref={dialog}
    onCancel={e => { e.preventDefault(); if (!choosing) cancel(); }}>
    <form onSubmit={e => {
      e.preventDefault();
      try { saveSettings(draft); onClose(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : t("설정을 저장할 수 없습니다.")); }
    }}>
      <h2 id="settings-title">{t("설정")}</h2>
      <div className="preferences-body">
        <fieldset><legend>{t("테마")}</legend><div className="mode-options">
          {(Object.keys(themeLabels) as Theme[]).map(theme => <label key={theme}>
            <input type="radio" name="theme" checked={draft.theme === theme} onChange={() => {
              applyTheme(theme); setDraft({ ...draft, theme });
            }} />{t(themeLabels[theme])}
          </label>)}
        </div></fieldset>
        <fieldset>
          <legend>{t("선별 시 복사할 파일")}</legend>
          <div className="mode-options">{(Object.keys(modes) as (keyof typeof modes)[]).map(mode =>
            <label key={mode}><input type="radio" name="copy-mode" checked={draft.mode === mode}
              onChange={() => setDraft({ ...draft, mode })} />{t(modes[mode])}</label>
          )}</div>
        </fieldset>
        <fieldset><legend>{t("복사 목적지")}</legend>
          <p className="pick-hint">{t("자동 목적지")} · {pick ?? t("촬영 폴더의 pick")}</p>
          {draft.destinations.map((d, i) => <div className="destination" key={d.id}>
            <label>{t("단축키")}<input value={d.shortcut} aria-label={`${t("목적지")} ${i + 1} · ${t("단축키")}`} onChange={e => update(d.id, { shortcut: e.target.value })} /></label>
            <label>{t("이름")}<input value={d.label} aria-label={`${t("목적지")} ${i + 1} · ${t("이름")}`} onChange={e => update(d.id, { label: e.target.value })} /></label>
            <button className="folder-path" type="button" disabled={choosing} title={d.path || pick || t("자동 pick 폴더")}
              aria-label={d.label + " · " + t("폴더 선택")} onClick={() => choose(d)}>{d.path || t("자동 · pick")}</button>
            <IconButton icon="remove" label={d.label + " · " + t("삭제")} onClick={() => {
              setDraft({ ...draft, destinations: draft.destinations.filter(row => row.id !== d.id) }); setError("");
            }} />
            {d.path && <button className="reset-path" type="button" onClick={() => update(d.id, { path: "" })}>{t("자동 경로로 복원")}</button>}
          </div>)}
          <IconButton icon="add" label={t("+ 목적지 추가")} onClick={add} />
        </fieldset>
      </div>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" onClick={cancel}>{t("취소")}</button><button className="save" disabled={choosing}>{t("저장")}</button></footer>
    </form>
  </dialog>;
}
