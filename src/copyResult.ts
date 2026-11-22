import { t } from "./i18n";

export interface CopyResult {
  format: string;
  status: "copied" | "missing" | "exists" | "failed";
  detail: string | null;
}

export type CopyBadge = "complete" | "partial";

export function summarizeCopy(results: CopyResult[]): CopyBadge | undefined {
  const copied = results.filter(result => result.status === "copied").length;
  if (!copied) return undefined;
  return copied === results.length ? "complete" : "partial";
}

export function describeCopy(result: CopyResult) {
  const labels = { copied: "{format} 복사됨", missing: "짝이 되는 {format} 없음",
    exists: "{format} 동명 파일 있음", failed: "{format} 복사 실패" };
  const message = t(labels[result.status]).replace("{format}", result.format);
  return result.detail ? message + " · " + result.detail : message;
}
