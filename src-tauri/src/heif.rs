use std::path::Path;

const UNREADABLE: &str = "HEIF 미리보기를 읽을 수 없습니다. 원본은 복사할 수 있습니다.";

#[cfg(target_os = "macos")]
pub fn render(path: &Path, edge: u16, thumbnail: bool) -> Result<Vec<u8>, String> {
    use core_foundation::{
        base::TCFType,
        data::{CFData, CFDataRef},
    };
    use std::{
        ffi::{CString, c_char},
        os::unix::ffi::OsStrExt,
    };
    unsafe extern "C" {
        fn picker_heif_preview(path: *const c_char, edge: i32, thumbnail: bool) -> CFDataRef;
    }
    let path = CString::new(path.as_os_str().as_bytes()).map_err(|_| UNREADABLE)?;
    let data = unsafe { picker_heif_preview(path.as_ptr(), edge.into(), thumbnail) };
    if data.is_null() {
        return Err(UNREADABLE.into());
    }
    let jpeg = unsafe { CFData::wrap_under_create_rule(data) };
    Ok(jpeg.bytes().to_vec())
}

#[cfg(windows)]
mod wic;
#[cfg(windows)]
pub use wic::render;

#[cfg(not(any(windows, target_os = "macos")))]
pub fn render(_: &Path, _: u16, _: bool) -> Result<Vec<u8>, String> {
    Err(UNREADABLE.into())
}
