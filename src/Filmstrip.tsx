import { useEffect, useRef, useState, type CSSProperties } from "react";
import { t } from "./i18n";
import type { Folder } from "./photos";
import type { CopyBadge } from "./copyResult";

interface Props {
  photos: Folder["photos"];
  index: number;
  select: (index: number) => void;
  badges: Readonly<Partial<Record<number, CopyBadge>>>;
  thumbnail: (index: number) => string | undefined;
  setRange: (range: [number, number]) => void;
}

export default function Filmstrip({ photos, index, select, badges, thumbnail, setRange }: Props) {
  const [scrollLeft, setScrollLeft] = useState(0);
  const [stripWidth, setStripWidth] = useState(960);
  const strip = useRef<HTMLDivElement>(null);
  const stripDrag = useRef<{id: number; startX: number; startScroll: number} | null>(null);
  const dragged = useRef(false);
  const tileWidth = 120;
  const stride = tileWidth + 6;
  const trackWidth = photos.length * stride - 6;
  const scrollRange = Math.max(0, trackWidth - stripWidth);
  const first = Math.max(0, Math.floor(scrollLeft / stride) - 1);
  const end = Math.min(photos.length, Math.ceil((scrollLeft + stripWidth) / stride) + 1);
  const visible = photos.slice(first, end);
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setStripWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const left = index * stride;
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (left + tileWidth > el.scrollLeft + el.clientWidth)
      el.scrollLeft = left + tileWidth - el.clientWidth;
  }, [index, stride, stripWidth]);
  useEffect(() => { setRange([first, end]); }, [first, end, setRange]);

  return <div className="film-shelf"><div className="film" ref={strip} aria-label={t("필름스트립")} tabIndex={0} onScroll={e => setScrollLeft(e.currentTarget.scrollLeft)}
      onPointerDown={e => {
        dragged.current = false;
        if (e.pointerType === "touch" || !e.isPrimary || e.button !== 0 ||
            !(e.target instanceof Element) || !e.target.closest(".film-track")) return;
        stripDrag.current = {id: e.pointerId, startX: e.clientX, startScroll: e.currentTarget.scrollLeft};
      }}
      onPointerMove={e => {
        const drag = stripDrag.current;
        if (!drag || drag.id !== e.pointerId) return;
        const distance = e.clientX - drag.startX;
        if (!dragged.current) {
          if (Math.abs(distance) < 5) return;
          dragged.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.classList.add("dragging");
        }
        e.currentTarget.scrollLeft = drag.startScroll - distance;
      }}
      onPointerLeave={() => { if (!dragged.current) stripDrag.current = null; }}
      onPointerUp={() => { stripDrag.current = null; }}
      onLostPointerCapture={e => {
        if (e.target === e.currentTarget) { stripDrag.current = null; e.currentTarget.classList.remove("dragging"); }
      }}
      onPointerCancel={e => { stripDrag.current = null; e.currentTarget.classList.remove("dragging"); }}
      onClickCapture={e => {
        if (dragged.current && e.detail > 0) { e.preventDefault(); e.stopPropagation(); }
        dragged.current = false;
      }}
      onWheel={e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.ctrlKey) e.currentTarget.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 16 : 1); }}>
      <div className="film-track" style={{ width: trackWidth }}>{visible.map((p, j) => {
      const i = first + j;
      const image = thumbnail(i);
      return <button key={i} style={{ width: tileWidth, left: i * stride }} aria-label={p.name} aria-current={index === i} title={p.name} onClick={() => select(i)}>
        {image ? <img src={image} alt="" draggable={false} /> : i + 1}
        {badges[i] && <span className={"copied-mark " + badges[i]} role="img"
          aria-label={t(badges[i] === "complete" ? "복사됨" : "부분 복사됨")}
          title={t(badges[i] === "complete" ? "복사됨" : "부분 복사됨")}>{badges[i] === "complete" ? "✓" : "◐"}</span>}
      </button>;
    })}</div></div>
      {scrollRange > 0 && <input className="film-scroll" type="range"
        aria-label={t("필름스트립 스크롤")} min={0} max={scrollRange} step="any"
        value={Math.min(scrollRange, Math.max(0, scrollLeft))}
        style={{ "--thumb-width": Math.min(stripWidth, Math.max(32, stripWidth * stripWidth / trackWidth)) + "px" } as CSSProperties}
        onChange={e => {
          if (strip.current) strip.current.scrollLeft = e.currentTarget.valueAsNumber;
        }} />}
    </div>;
}
