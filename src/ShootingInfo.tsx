import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { t, backendMessage } from "./i18n";

import type { PreviewState } from "./usePreviews";
import IconButton from "./IconButton";

interface Metadata { rows: [string, string][]; gps: [number, number] | null }
interface Props {
  generation: number;
  index: number;
  previewState: PreviewState;
  onClose?: () => void;
}

export default function ShootingInfo({ generation, index, previewState, onClose }: Props) {
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [error, setError] = useState("");
  const settled = previewState !== "loading";
  useEffect(() => {
    if (!settled || metadata || error) return;
    let active = true;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(async () => {
        try {
          const result = await invoke<Metadata>("photo_info", { generation, index });
          if (active) setMetadata(result);
        } catch (cause) {
          if (active) setError(t("촬영 정보를 읽을 수 없습니다.") + " " + backendMessage(cause));
        }
      });
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [settled, generation, index, metadata, error]);
  return <aside id="shooting-info" aria-label={t("촬영 정보")}>
    <div className="info-heading"><h2>{t("촬영 정보")}</h2>{onClose && <IconButton icon="close" label={t("촬영 정보 닫기")} onClick={onClose} />}</div>
    {metadata ? <>
      <dl>{metadata.rows.map(([label,value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}
        {metadata.gps && <div><dt>GPS</dt><dd><a href={`https://www.google.com/maps?q=${metadata.gps.join(",")}`} target="_blank" rel="noreferrer">{metadata.gps.map(v => v.toFixed(5)).join(", ")}</a></dd></div>}
      </dl>
      {!metadata.rows.length && !metadata.gps && <p>{t("기록된 촬영 정보가 없습니다.")}</p>}
    </> : <p role="status">{error || (settled ? t("촬영 정보 읽는 중…") : t("미리보기 대기 중…"))}</p>}
  </aside>;
}
