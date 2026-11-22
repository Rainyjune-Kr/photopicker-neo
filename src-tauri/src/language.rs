#[tauri::command]
pub fn ui_language() -> &'static str {
    let locale = sys_locale::get_locale().unwrap_or_default();
    if locale
        .split(['-', '_'])
        .next()
        .is_some_and(|s| s.eq_ignore_ascii_case("ko"))
    {
        "ko"
    } else {
        "en"
    }
}

#[cfg(target_os = "macos")]
pub fn menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, HELP_SUBMENU_ID, Menu, SubmenuBuilder, WINDOW_SUBMENU_ID};
    if ui_language() != "ko" {
        return Menu::default(app);
    }
    let name = &app.package_info().name;
    let about = AboutMetadata {
        name: Some(name.clone()),
        version: Some(app.package_info().version.to_string()),
        ..Default::default()
    };
    let application = SubmenuBuilder::new(app, name)
        .about_with_text(format!("{name} 정보"), Some(about))
        .separator()
        .services_with_text("서비스")
        .separator()
        .hide_with_text(format!("{name} 가리기"))
        .hide_others_with_text("기타 가리기")
        .separator()
        .quit_with_text(format!("{name} 종료"))
        .build()?;
    let file = SubmenuBuilder::new(app, "파일")
        .close_window_with_text("창 닫기")
        .build()?;
    let edit = SubmenuBuilder::new(app, "편집")
        .undo_with_text("실행 취소")
        .redo_with_text("다시 실행")
        .separator()
        .cut_with_text("오려두기")
        .copy_with_text("복사하기")
        .paste_with_text("붙여넣기")
        .select_all_with_text("전체 선택")
        .build()?;
    let view = SubmenuBuilder::new(app, "보기")
        .fullscreen_with_text("전체 화면 전환")
        .build()?;
    let window = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "윈도우")
        .minimize_with_text("최소화")
        .maximize_with_text("확대/축소")
        .separator()
        .close_window_with_text("창 닫기")
        .build()?;
    let help = SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, "도움말").build()?;
    Menu::with_items(app, &[&application, &file, &edit, &view, &window, &help])
}
