import type { ButtonHTMLAttributes } from "react";

const paths = {
  fullscreen: "M9 3H3v6 M15 3h6v6 M3 15v6h6 M21 15v6h-6",
  restore: "M3 9h6V3 M15 3v6h6 M9 21v-6H3 M21 15h-6v6",
  folder: "M3 18V5.5A1.5 1.5 0 0 1 4.5 4H9l2.5 3H19a1 1 0 0 1 1 1v2 M3 19l2.5-9H22l-2.5 9Z",
  info: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z M12 11v6 M12 7v.5",
  settings: "m10 3 .5-1h3l.5 2 2 .9 2-.6 1.9 2.2-.9 2.1.5 2 1.8 1v2.8l-2 .8-.9 1.9.6 2-2.2 1.8-2.1-.9-2 .5-1 1.5H9.9l-.8-1.9-2-.9-2 .5-1.8-2.2.9-2.1-.5-2L2 12.5V10l2-.8.9-2-.5-2L6.6 3.5l2 .8Z M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z",
  previous: "m14.5 5-7 7 7 7", next: "m9.5 5 7 7-7 7",
  copy: "M8 8h12v13H8Z M16 5V3H4v13h1",
  close: "m6 6 12 12 M18 6 6 18",
  remove: "M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
  add: "M12 4v16 M4 12h16",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> { icon: keyof typeof paths; label: string }
export default function IconButton({ icon, label, className = "", ...props }: Props) {
  return <button type="button" {...props} className={`icon-button ${className}`} title={label} aria-label={label}>
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d={paths[icon]} />
    </svg>
  </button>;
}
