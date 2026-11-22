mod heif;
mod language;
mod library;
mod picking;
mod preview;
mod shooting_info;
mod updates;

use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Library {
    generation: u64,
    photos: Vec<library::Photo>,
    pick: PathBuf,
}

#[derive(Serialize)]
struct Folder {
    generation: u64,
    path: String,
    photos: Vec<library::Photo>,
    pick: PathBuf,
}

#[tauri::command]
async fn choose_folder(app: AppHandle) -> Result<Option<Folder>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(folder) = app
            .dialog()
            .file()
            .set_title(if language::ui_language() == "ko" {
                "폴더 열기"
            } else {
                "open"
            })
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let path = folder.into_path().map_err(|e| e.to_string())?;
        let (photos, pick) = library::scan(&path)?;
        let state = app.state::<Mutex<Library>>();
        let mut lib = state.lock().map_err(|e| e.to_string())?;
        lib.photos = photos.clone();
        lib.pick = pick.clone();
        lib.generation += 1;
        Ok(Some(Folder {
            generation: lib.generation,
            path: path.display().to_string(),
            photos,
            pick,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn selected_source(app: &AppHandle, generation: u64, index: usize) -> Result<PathBuf, String> {
    let state = app.state::<Mutex<Library>>();
    let lib = state.lock().map_err(|e| e.to_string())?;
    if lib.generation != generation {
        return Err("폴더가 변경되었습니다.".into());
    }
    lib.photos
        .get(index)
        .map(|p| p.source().to_owned())
        .ok_or_else(|| "사진을 찾을 수 없습니다.".into())
}

#[tauri::command]
async fn photo_info(
    app: AppHandle,
    generation: u64,
    index: usize,
) -> Result<shooting_info::ShootingInfo, String> {
    let path = selected_source(&app, generation, index)?;
    tauri::async_runtime::spawn_blocking(move || shooting_info::read(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn preview(
    app: AppHandle,
    generation: u64,
    index: usize,
    edge: u16,
    thumbnail: bool,
) -> Result<tauri::ipc::Response, String> {
    let path = selected_source(&app, generation, index)?;
    tauri::async_runtime::spawn_blocking(move || {
        preview::render(&path, edge.clamp(64, 1920), thumbnail).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn copy_preview_image(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let dimension = |name: &str| {
        request
            .headers()
            .get(name)?
            .to_str()
            .ok()?
            .parse::<usize>()
            .ok()
    };
    let (Some(width), Some(height)) = (dimension("x-width"), dimension("x-height")) else {
        return Err("Invalid preview dimensions".into());
    };
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected preview pixels".into());
    };
    if bytes.is_empty()
        || width.checked_mul(height).and_then(|n| n.checked_mul(4)) != Some(bytes.len())
    {
        return Err("Invalid preview pixels".into());
    }
    arboard::Clipboard::new()
        .and_then(|mut clipboard| {
            clipboard.set_image(arboard::ImageData {
                width,
                height,
                bytes: bytes.as_slice().into(),
            })
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn reveal_original(app: AppHandle, generation: u64, index: usize) -> Result<(), String> {
    let path = selected_source(&app, generation, index)?;
    tauri::async_runtime::spawn_blocking(move || {
        if !path.is_file() {
            return Err("사진을 찾을 수 없습니다.".into());
        }
        #[cfg(target_os = "macos")]
        {
            let status = std::process::Command::new("/usr/bin/open")
                .arg("-R")
                .arg(path)
                .status()
                .map_err(|e| e.to_string())?;
            if !status.success() {
                return Err(status.to_string());
            }
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer.exe")
                .arg("/select,")
                .arg(path)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        open::that(path.parent().ok_or("Missing parent folder")?).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_original(app: AppHandle, generation: u64, index: usize) -> Result<(), String> {
    let path = selected_source(&app, generation, index)?;
    tauri::async_runtime::spawn_blocking(move || open::that(path).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn copy_pick(
    app: AppHandle,
    generation: u64,
    index: usize,
    path: String,
    mode: picking::Mode,
) -> Result<Vec<picking::Outcome>, String> {
    let copy_guard = app.state::<updates::CopyGate>().start_copy()?;
    let (photo, dest) = {
        let state = app.state::<Mutex<Library>>();
        let lib = state.lock().map_err(|e| e.to_string())?;
        if lib.generation != generation {
            return Err("폴더가 변경되었습니다.".into());
        }
        let photo = lib
            .photos
            .get(index)
            .cloned()
            .ok_or("사진을 찾을 수 없습니다.")?;
        let dest = if path.is_empty() {
            lib.pick.clone()
        } else {
            PathBuf::from(&path)
        };
        (photo, dest)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = copy_guard;
        let (image, raw) = photo.originals();
        picking::copy(image, raw, &dest, path.is_empty(), mode)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(language::menu);
    builder
        .manage(Mutex::new(Library::default()))
        .manage(updates::CopyGate::default())
        .manage(updates::PendingUpdate::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            language::ui_language,
            updates::check_update,
            updates::download_update,
            updates::install_update,
            choose_folder,
            preview,
            copy_pick,
            copy_preview_image,
            open_original,
            reveal_original,
            photo_info
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Photo Picker neo");
}
