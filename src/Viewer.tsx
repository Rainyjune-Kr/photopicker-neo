import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";

import ShootingInfo from "./ShootingInfo";
import { t, backendMessage } from "./i18n";
import IconButton from "./IconButton";
import { loadSettings, modes, type Destination, type Settings } from "./settings";
import Filmstrip from "./Filmstrip";
import { usePreviews } from "./usePreviews";
import { describeCopy, summarizeCopy, type CopyBadge, type CopyResult } from "./copyResult";
import type { Folder } from "./photos";

interface ViewerProps {
  folder: Folder;
  infoOpen: boolean;
  focusMode: boolean;
  toggleFocus: () => void;
  focusKey: string;
}

export default function Viewer({ folder, infoOpen, focusMode, toggleFocus, focusKey }: ViewerProps) {
  const [focusInfo, setFocusInfo] = useState(() => localStorage.getItem("photopicker.focusExif") === "true");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [mouseOverDock, setMouseOverDock] = useState(false);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<number | undefined>(undefined);
  const infoShortcut = useMemo(() => {
    if (!focusMode) return false;
    try { return !loadSettings().destinations.some(dest => dest.shortcut.toLowerCase() === "i"); }
    catch { return false; }
  }, [focusMode]);
  function setFocusExif(open: boolean) {
    setFocusInfo(open);
    localStorage.setItem("photopicker.focusExif", String(open));
  }
  useEffect(() => {
    setControlsOpen(false);
    setMouseOverDock(false);
    setNotice("");
    if (focusMode) stage.current?.focus();
    return () => window.clearTimeout(noticeTimer.current);
  }, [focusMode]);

  const [messages, setMessages] = useState<Record<number, string>>({});
  const [badges, setBadges] = useState<Partial<Record<number, CopyBadge>>>({});
  const pending = useRef(new Set<string>());
  const [index, setIndex] = useState(0);
  const mainImage = useRef<HTMLImageElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const photo = folder.photos[index];
  const pairLabel = t("{format} 짝 있음").replace("{format}", photo.pair_format ?? "");
  const previews = usePreviews(folder.generation, index, focusMode, stage);
  const { shown, previewError } = previews;
  const [pickSettings, setPickSettings] = useState<Settings | null>(null);
  const picker = useRef<HTMLDialogElement>(null);
  const swipe = useRef<{x:number; y:number} | null>(null);
  useEffect(() => {
    if (pickSettings) picker.current?.showModal();
  }, [pickSettings]);

  async function copyTo(settings: Settings, dest: Destination) {
    const report = reportPreview;
    let token: string | undefined;
    try {
      token = JSON.stringify([index, dest.path, settings.mode]);
      if (pending.current.has(token)) { token = undefined; return; }
      pending.current.add(token);
      report(dest.label + " · " + t("복사 중…"));
      const results = await invoke<CopyResult[]>("copy_pick", {
        generation: folder.generation, index, path: dest.path, mode: settings.mode,
      });
      const badge = summarizeCopy(results);
      setBadges(old => ({ ...old, [index]: badge }));
      const details = results.map(describeCopy);
      if (badge === "partial") details.unshift(t("부분 복사됨"));
      report([dest.label, ...details].join(" · "));
    } catch (cause) {
      setBadges(old => ({ ...old, [index]: undefined }));
      report(backendMessage(cause));
    } finally {
      if (token) pending.current.delete(token);
    }
  }

  const [menu, setMenu] = useState<{x: number; y: number; settings: Settings | null} | null>(null);
  const menuBox = useRef<HTMLDivElement>(null);
  const writing = useRef(false);
  function reportPreview(message: string) {
    setMessages(old => ({ ...old, [index]: message }));
    if (focusMode) {
      setNotice(message);
      window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(""), 2200);
    }
  }

  async function copyPreview() {
    const image = mainImage.current;
    if (!image?.complete || !image.naturalWidth) {
      reportPreview(t("미리보기가 아직 준비되지 않았습니다."));
      return;
    }
    if (writing.current) return;
    writing.current = true;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      await invoke("copy_preview_image", new Uint8Array(pixels.data.buffer), {
        headers: { "x-width": String(canvas.width), "x-height": String(canvas.height) },
      });
      reportPreview(t("미리보기 이미지를 복사했습니다."));
    } catch {
      reportPreview(t("미리보기 이미지를 복사할 수 없습니다."));
    } finally {
      writing.current = false;
    }
  }

  useEffect(() => {
    function handlesCopy(event: Event) {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return false;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable]:not([contenteditable=false])")) return false;
      return !window.getSelection()?.toString();
    }
    function copy(event: Event) {
      if (!handlesCopy(event)) return;
      event.preventDefault();
      void copyPreview();
    }
    function shortcut(event: KeyboardEvent) {
      const mac = /Mac/i.test(navigator.platform);
      if ((mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
          && !event.altKey && !event.shiftKey && !event.repeat && !event.isComposing
          && (event.code === "KeyC" || event.key.toLowerCase() === "c")) copy(event);
    }
    window.addEventListener("keydown", shortcut);
    document.addEventListener("copy", copy);
    return () => {
      window.removeEventListener("keydown", shortcut);
      document.removeEventListener("copy", copy);
    };
  }, [index, focusMode]);

  useEffect(() => {
    if (!menu) return;
    const box = menuBox.current!;
    const bounds = box.getBoundingClientRect();
    box.style.left = Math.max(0, Math.min(menu.x, window.innerWidth - bounds.width)) + "px";
    box.style.top = Math.max(0, Math.min(menu.y, window.innerHeight - bounds.height)) + "px";
    box.querySelector("button")?.focus();
    const dismiss = () => setMenu(null);
    const outside = (e: PointerEvent) => { if (!box.contains(e.target as Node)) dismiss(); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [menu]);

  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.defaultPrevented || menu || document.querySelector("dialog[open]") || event.isComposing) return;
      const mac = /Mac/i.test(navigator.platform);
      const enter = event.key === "Enter" && !event.ctrlKey && !event.shiftKey &&
        (mac ? event.metaKey && !event.altKey : event.altKey && !event.metaKey);
      if (enter || (focusMode && event.key === "Escape")) {
        event.preventDefault();
        if (!event.repeat) toggleFocus();
        return;
      }
      if (event.target instanceof HTMLInputElement && (event.target.type !== "range" || event.key.startsWith("Arrow"))) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        setIndex(i => Math.max(0, Math.min(folder.photos.length - 1, i + delta)));
        return;
      }
      if (event.repeat || event.isComposing || Array.from(event.key).length !== 1) return;
      try {
        const settings = loadSettings();
        const dest = settings.destinations.find(d => d.shortcut.toLowerCase() === event.key.toLowerCase());
        if (dest) { event.preventDefault(); void copyTo(settings, dest); }
        else if (focusMode && infoShortcut && (event.key.toLowerCase() === "i" || event.code === "KeyI")) {
          event.preventDefault();
          setFocusExif(!focusInfo);
        }
      } catch (cause) { setMessages(old => ({ ...old, [index]: backendMessage(cause) })); }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [folder, index, menu, focusMode, focusInfo, infoShortcut, toggleFocus]);

  return <section className={focusMode ? "viewer focus-mode" : "viewer"}>
    <div className="viewer-content">
    <div className="stage" ref={stage} tabIndex={0}
      onContextMenu={e => {
        e.preventDefault();
        let settings = null;
        try { settings = loadSettings(); } catch (cause) { reportPreview(backendMessage(cause)); }
        setMenu({x: e.clientX, y: e.clientY, settings});
      }}
      onTouchStart={e => { swipe.current = e.touches.length === 1 ? {x:e.touches[0].clientX, y:e.touches[0].clientY} : null; }}
      onTouchCancel={() => { swipe.current = null; }}
      onTouchEnd={e => {
        const from = swipe.current;
        swipe.current = null;
        if (!from || e.touches.length || !e.changedTouches.length) return;
        const dx = e.changedTouches[0].clientX - from.x;
        const dy = e.changedTouches[0].clientY - from.y;
        if (focusMode && Math.abs(dx) < 10 && Math.abs(dy) < 10) setControlsOpen(open => !open);
        if (Math.abs(dx) >= 56 && Math.abs(dx) > 1.5 * Math.abs(dy))
          setIndex(i => Math.max(0, Math.min(folder.photos.length - 1, i + (dx < 0 ? 1 : -1))));
      }}>
      {shown ? <img key={shown.url} ref={mainImage} onLoad={() => previews.setDisplayed(shown.url)} onError={() => previews.failDisplay(shown.url)} src={shown.url} alt={photo.name} /> :
        <p role="status">{previewError ?? t("미리보기 불러오는 중…")}</p>}
    </div>
    {menu && <div className="photo-menu" role="menu" ref={menuBox}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setMenu(null); }}
      onKeyDown={e => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setMenu(null); stage.current?.focus(); }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const items = Array.from(e.currentTarget.querySelectorAll("button"));
          const next = items.indexOf(document.activeElement as HTMLButtonElement) + (e.key === "ArrowDown" ? 1 : -1);
          items[(next + items.length) % items.length].focus();
        }
      }}>
      {menu.settings && menu.settings.destinations.map(dest =>
        <button key={dest.id} role="menuitem" onClick={() => {
          setMenu(null);
          stage.current?.focus();
          if (menu.settings) void copyTo(menu.settings, dest);
        }}><kbd>[{dest.shortcut}]</kbd> {t("{name}에 복사").replace("{name}", () => dest.label)}</button>
      )}
      <button role="menuitem" onClick={() => { setMenu(null); stage.current?.focus(); void copyPreview(); }}>
        {t("미리보기 이미지 복사")} <kbd>{/Mac/i.test(navigator.platform) ? "⌘C" : "Ctrl+C"}</kbd>
      </button>
      <button role="menuitem" onClick={() => {
        setMenu(null);
        stage.current?.focus();
        void invoke("open_original", { generation: folder.generation, index })
          .catch(() => reportPreview(t("외부 뷰어에서 열 수 없습니다.")));
      }}>{t("외부 뷰어에서 원본 열기")}</button>
      <button role="menuitem" onClick={() => {
        setMenu(null);
        stage.current?.focus();
        void invoke("reveal_original", { generation: folder.generation, index })
          .catch(() => reportPreview(t("원본 파일의 위치를 표시할 수 없습니다.")));
      }}>{t(/Mac/i.test(navigator.platform) ? "Finder에서 보기" : "파일 탐색기에서 보기")}</button>
    </div>}
    {(focusMode ? focusInfo : infoOpen) && <ShootingInfo onClose={focusMode ? () => setFocusExif(false) : undefined} key={index} generation={folder.generation} index={index} previewState={previews.state} />}
    </div>
    {focusMode && notice && <div className="focus-notice" role="status">{notice}</div>}
    <div className={"viewer-dock" + (focusMode && (controlsOpen || mouseOverDock) ? " dock-open" : "")}
      onPointerEnter={e => { if (focusMode && e.pointerType === "mouse") setMouseOverDock(true); }}
      onPointerLeave={e => { if (e.pointerType === "mouse") setMouseOverDock(false); }}>
    {focusMode && <button className="dock-trigger" aria-label={t("필름스트립 표시")}
      onClick={() => setControlsOpen(open => !open)} />}
    <div className="dock-content">
    <div className="status">
      <span><strong className="format-badge">{photo.format}</strong> {photo.name}
        {photo.pair_format && <span className="pair-badge" role="img" aria-label={pairLabel} title={pairLabel}>
          {photo.pair_format} ✓
        </span>}
      </span>
      <span role="status">{messages[index]}</span>
      <nav aria-label={t("사진 탐색")}>
        {focusMode && <>
          <IconButton icon="info" label={t("촬영 정보") + (infoShortcut ? " (I)" : "")}
            aria-controls="shooting-info" aria-expanded={focusInfo} onClick={() => setFocusExif(!focusInfo)} />
          <IconButton icon="restore" label={t("집중 모드 종료") + " (" + focusKey + ")"} onClick={toggleFocus} />
        </>}
        <IconButton icon="copy" label={t("선별 복사")} aria-haspopup="dialog" onClick={() => {
          try { setPickSettings(loadSettings()); } catch (cause) { setMessages(old => ({ ...old, [index]: backendMessage(cause) })); }
        }} />
        <IconButton icon="previous" label={t("이전 사진")} disabled={index === 0} onClick={() => setIndex(i => i - 1)} />
        <span>{index + 1} / {folder.photos.length}</span>
        <IconButton icon="next" label={t("다음 사진")} disabled={index + 1 === folder.photos.length} onClick={() => setIndex(i => i + 1)} />
      </nav>
    </div>
    <Filmstrip photos={folder.photos} index={index} select={setIndex} badges={badges}
      thumbnail={previews.thumbnail} setRange={previews.setRange} />
    </div></div>
    {pickSettings && <dialog className="pick-dialog" ref={picker} aria-labelledby="pick-title"
      onCancel={() => setPickSettings(null)}>
      <div className="pick-heading"><h2 id="pick-title">{t("선별 복사")}</h2><IconButton icon="close" label={t("닫기")} onClick={() => setPickSettings(null)} /></div>
      <p>{photo.name} · {t(modes[pickSettings.mode])}</p>
      {pickSettings.destinations.length === 0 && <p>{t("설정에서 복사 목적지를 추가하세요.")}</p>}
      {pickSettings.destinations.map(dest => <button className="pick-option" key={dest.id} onClick={() => {
        void copyTo(pickSettings, dest); setPickSettings(null);
      }}><span>{dest.label}</span><kbd>{dest.shortcut}</kbd></button>)}
    </dialog>}
  </section>;
}
