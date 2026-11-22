import { useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { backendMessage, t } from "./i18n";

interface CachedImage { url: string; bytes: number }
export type PreviewState = "loading" | "ready" | "failed";

export function usePreviews(generation: number, index: number, focusMode: boolean, stage: RefObject<HTMLDivElement | null>) {
  const [[first, end], setRange] = useState<[number, number]>([0, 0]);
  const [displayed, setDisplayed] = useState("");
  const [broken, failDisplay] = useState("");
  const [, refresh] = useState(0);
  const [edge, setEdge] = useState(0);
  const cache = useRef(new Map<string, CachedImage>());
  const errors = useRef(new Map<string, string>());
  const mainWorker = useRef<Promise<void> | undefined>(undefined);
  const stripWorker = useRef<Promise<void> | undefined>(undefined);
  const thumbKey = (i: number) => `thumb/${i}`;
  const mainKey = `view/${index}/${edge}`;
  const shown = cache.current.get(mainKey) ?? Array.from(cache.current.entries())
    .find(([key]) => key.startsWith(`view/${index}/`))?.[1];

  useEffect(() => {
    const images = cache.current;
    return () => { for (const item of images.values()) URL.revokeObjectURL(item.url); images.clear(); };
  }, []);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const pixels = Math.max(element.clientWidth, element.clientHeight) * window.devicePixelRatio;
      setEdge(Math.min(1920, Math.max(640, Math.ceil(pixels / 320) * 320)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Keep one decode per lane in flight. Scrolling thumbnails never cancels the main preview.
  async function load(key: string, i: number, size: number, thumbnail: boolean, active: () => boolean) {
    const images = cache.current;
    const hit = images.get(key);
    if (hit) { images.delete(key); images.set(key, hit); return; }
    if (errors.current.has(key)) return;
    try {
      const buffer = await invoke<ArrayBuffer>("preview", { generation, index: i, edge: size, thumbnail });
      if (!active()) return;
      const url = URL.createObjectURL(new Blob([buffer], { type: "image/jpeg" }));
      images.set(key, { url, bytes: buffer.byteLength });
      let bytes = Array.from(images.values()).reduce((sum, item) => sum + item.bytes, 0);
      for (const [oldKey, item] of images) {
        if (bytes <= 32 * 1024 * 1024 && images.size <= 160) break;
        if (oldKey === currentMain.current) continue;
        bytes -= item.bytes;
        URL.revokeObjectURL(item.url);
        images.delete(oldKey);
      }
    } catch (error) {
      if (active()) errors.current.set(key, backendMessage(error));
    }
    if (active()) refresh(n => n + 1);
  }

  const currentMain = useRef(mainKey);
  useEffect(() => {
    currentMain.current = mainKey;
    let active = true;
    async function run() {
      await mainWorker.current;
      if (!active || !edge || (focusMode && shown)) return;
      mainWorker.current = load(mainKey, index, edge, false, () => active);
    }
    void run();
    return () => { active = false; };
  }, [generation, index, edge, mainKey, focusMode, shown]);

  useEffect(() => {
    let active = true;
    async function run() {
      await stripWorker.current;
      if (!active) return;
      stripWorker.current = (async () => {
        for (let i = first; active && i < end; i++) {
          await load(thumbKey(i), i, 160, true, () => active);
        }
      })();
    }
    void run();
    return () => { active = false; };
  }, [generation, first, end]);

  const displayFailed = !!shown && shown.url === broken;
  const previewError = displayFailed ? t("미리보기를 표시할 수 없습니다.") : errors.current.get(mainKey);
  const state: PreviewState = displayFailed || (!shown && previewError) ? "failed" :
    shown && shown.url === displayed ? "ready" : "loading";
  return { shown: displayFailed ? undefined : shown, state, previewError, setDisplayed, failDisplay,
    setRange, thumbnail: (i: number) => cache.current.get(thumbKey(i))?.url };
}
