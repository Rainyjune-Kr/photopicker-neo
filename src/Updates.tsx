import { getVersion } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { t } from "./i18n";

type Stage = "idle" | "checking" | "latest" | "available" | "downloading" | "ready" | "waiting" | "installing";
interface Release { version: string; notes?: string }
interface Transfer { received: number; total?: number }

// Owned by App so closing Settings does not discard an in-flight download.
export function useUpdates() {
  const [stage, setStage] = useState<Stage>("idle");
  const [release, setRelease] = useState<Release | null>(null);
  const [transfer, setTransfer] = useState<Transfer>({received: 0});
  const [error, setError] = useState("");
  const busy = useRef(false);

  async function run() {
    if (busy.current) return;
    busy.current = true;
    setError("");
    try {
      if (stage === "available") {
        setStage("downloading");
        setTransfer({received: 0});
        const progress = new Channel<Transfer>();
        progress.onmessage = setTransfer;
        await invoke("download_update", {progress});
        setStage("ready");
      } else if (stage === "ready") {
        setStage("waiting");
        const installing = new Channel<null>();
        installing.onmessage = () => setStage("installing");
        await invoke("install_update", {installing});
      } else {
        setStage("checking");
        const found = await invoke<Release | null>("check_update");
        setRelease(found);
        setStage(found ? "available" : "latest");
      }
    } catch (cause) {
      setError(String(cause));
      setStage(stage === "available" ? "available" : "idle");
    } finally {
      busy.current = false;
    }
  }
  return {stage, release, transfer, error, run};
}

export default function Updates({model, dirty}: {model: ReturnType<typeof useUpdates>; dirty: boolean}) {
  const {stage, release, transfer, error, run} = model;
  const [version, setVersion] = useState("");
  useEffect(() => { void getVersion().then(setVersion).catch(() => {}); }, []);
  const downloadAction = stage === "available" || stage === "downloading";
  const installAction = ["ready", "waiting", "installing"].includes(stage);
  const action = downloadAction ? "다운로드" : installAction ? "설치하고 재시작" : "업데이트 확인";
  const active = ["checking", "downloading", "waiting", "installing"].includes(stage);
  const messages: Partial<Record<Stage, string>> = {
    checking: "업데이트 확인 중…", latest: "최신 버전입니다.", available: "새 버전 사용 가능",
    downloading: "다운로드 중…", ready: "다운로드 완료", waiting: "복사 작업 완료 대기 중…", installing: "설치 후 재시작 중…",
  };
  const percent = transfer.total ? Math.min(100, Math.floor(100 * transfer.received / transfer.total)) : undefined;
  const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
  return <fieldset className="updates"><legend>{t("앱 업데이트")}</legend>
    <div className="update-row"><span>Photo Picker neo {version}</span>
      <button type="button" disabled={active || (dirty && stage === "ready")} onClick={run}>{t(error ? "다시 시도" : action)}</button>
    </div>
    <div role="status">{messages[stage] && t(messages[stage]!)} {release && ["available","ready"].includes(stage) && release.version}</div>
    {release?.notes && stage === "available" && <details><summary>{t("변경 사항")}</summary><p>{release.notes}</p></details>}
    {stage === "downloading" && <div><progress aria-label={t("다운로드 진행률")} max={transfer.total || undefined}
      value={transfer.total ? transfer.received : undefined} /> {percent !== undefined && `${percent}% · `}{mb(transfer.received)}{transfer.total ? " / " + mb(transfer.total) : ""} MiB</div>}
    {dirty && stage === "ready" && <p>{t("설정을 저장하거나 취소한 뒤 설치하세요.")}</p>}
    {error && <p role="alert">{t("업데이트 실패")} · {error}</p>}
  </fieldset>;
}
