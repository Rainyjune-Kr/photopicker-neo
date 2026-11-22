//! Only this module installs downloaded packages. The writer guard spans both
//! installation and restart, while each file-copy worker owns a reader guard.
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Manager, ipc::Channel};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::{Mutex, OwnedRwLockReadGuard, RwLock};

#[derive(Default)]
pub struct CopyGate(Arc<RwLock<()>>);

impl CopyGate {
    pub fn start_copy(&self) -> Result<OwnedRwLockReadGuard<()>, String> {
        self.0
            .clone()
            .try_read_owned()
            .map_err(|_| "업데이트 설치를 준비 중입니다.".into())
    }
}

#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Package>>);

struct Package {
    update: Update,
    verified: Option<Vec<u8>>,
}

#[derive(Serialize)]
pub struct Release {
    version: String,
    notes: Option<String>,
}

#[derive(Serialize)]
pub struct Transfer {
    received: u64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<Release>, String> {
    let state = app.state::<PendingUpdate>();
    let mut pending = state.0.try_lock().map_err(|_| "Update busy")?;
    let found = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let release = found.as_ref().map(|u| Release {
        version: u.version.clone(),
        notes: u.body.clone(),
    });
    *pending = found.map(|mut update| {
        update.timeout = Some(std::time::Duration::from_secs(600));
        Package {
            update,
            verified: None,
        }
    });
    Ok(release)
}

#[tauri::command]
pub async fn download_update(app: AppHandle, progress: Channel<Transfer>) -> Result<(), String> {
    let state = app.state::<PendingUpdate>();
    let mut pending = state.0.try_lock().map_err(|_| "Update busy")?;
    let package = pending.as_mut().ok_or("Check for updates first")?;
    let mut received = 0;
    let mut last_report = None;
    package.verified = Some(
        package
            .update
            .download(
                |chunk, total| {
                    received += chunk as u64;
                    let now = std::time::Instant::now();
                    if total == Some(received)
                        || last_report.is_none_or(|time| now.duration_since(time).as_millis() >= 75)
                    {
                        let _ = progress.send(Transfer { received, total });
                        last_report = Some(now);
                    }
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?,
    );
    Ok(())
}

#[tauri::command]
pub async fn install_update(app: AppHandle, installing: Channel<()>) -> Result<(), String> {
    let state = app.state::<PendingUpdate>();
    let mut pending = state.0.try_lock().map_err(|_| "Update busy")?;
    let mut package = pending.take().ok_or("Check for updates first")?;
    let bytes = package.verified.take().ok_or("Download the update first")?;
    let guard = app.state::<CopyGate>().0.clone().write_owned().await;
    let _ = installing.send(());
    let restart = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        package.update.install(bytes).map_err(|e| e.to_string())?;
        restart.restart()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn install_waits_for_every_copy_and_excludes_new_copies() {
        tauri::async_runtime::block_on(async {
            let gate = CopyGate::default();
            let first = gate.start_copy().unwrap();
            let last = gate.start_copy().unwrap();
            let lock = gate.0.clone();
            let writer = tauri::async_runtime::spawn(async move { lock.write_owned().await });
            while gate.start_copy().is_ok() {
                tokio::task::yield_now().await;
            }
            drop(first);
            assert!(gate.start_copy().is_err());
            drop(last);
            let installing = writer.await.unwrap();
            assert!(gate.start_copy().is_err());
            drop(installing);
            assert!(gate.start_copy().is_ok());
        });
    }
}
