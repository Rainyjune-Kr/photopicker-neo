import { t } from "./i18n";
import type { Theme } from "./theme";
export const modes = { jpeg: "JPEG/HEIF만", raw: "RAW만", both: "RAW와 JPEG/HEIF 모두" } as const;
export interface Destination { id: string; label: string; shortcut: string; path: string }
export interface Settings { theme: Theme; mode: keyof typeof modes; destinations: Destination[] }

const storageKey = "photopicker.settings.v1";

function defaults(): Settings {
  return { theme: "system", mode: "jpeg", destinations: ["1", "2"].map(key => ({
    id: key, label: t(key === "1" ? "기본 pick" : "보조 pick"), shortcut: key, path: "",
  })) };
}

export function loadSettings(): Settings {
  const value = localStorage.getItem(storageKey);
  if (!value) return defaults();
  const data = JSON.parse(value);
  if (!data || !Object.prototype.hasOwnProperty.call(modes, data.mode) || !Array.isArray(data.destinations) ||
      !data.destinations.every((row: Destination) => row && [row.id, row.label, row.shortcut, row.path].every(v => typeof v === "string"))) {
    throw new Error(t("저장된 설정을 읽을 수 없습니다."));
  }
  // Collapse only the untouched legacy preset. Keep customized destinations.
  if (data.destinations.length === 3 && data.destinations.every((d: Destination, i: number) =>
    d.id === String(i + 1) && d.label === "Pick " + d.id && d.path === "" && d.shortcut === d.id)) {
    data.destinations = defaults().destinations;
  }
  if (data.theme !== "dark" && data.theme !== "light") data.theme = "system";
  return data;
}

export function saveSettings(settings: Settings) {
  const keys = new Set<string>();
  const destinations = settings.destinations.map(row => {
    const label = row.label.trim();
    const shortcut = row.shortcut.trim().toLowerCase();
    if (!label) throw new Error(t("목적지 이름을 입력하세요."));
    if (/^(control|ctrl|shift|alt|option|meta|cmd|command|⌘|⇧|⌥|⌃)$/i.test(shortcut))
      throw new Error(t("조합용 기능키는 단독 단축키로 지정할 수 없습니다."));
    if (Array.from(shortcut).length !== 1) throw new Error(label + " · " + t("한 글자 단축키를 입력하세요."));
    if (keys.has(shortcut)) throw new Error(t("중복된 단축키") + " · " + shortcut);
    keys.add(shortcut);
    return { ...row, label, shortcut };
  });
  localStorage.setItem(storageKey, JSON.stringify({ ...settings, destinations }));
}
