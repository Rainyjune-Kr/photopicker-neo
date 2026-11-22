use jpeg_encoder::{ColorType, Encoder};
use std::{os::windows::ffi::OsStrExt, path::Path, ptr};
use windows::{
    Win32::{
        Foundation::{
            E_INVALIDARG, GENERIC_READ, RPC_E_CHANGED_MODE, WINCODEC_ERR_COMPONENTNOTFOUND,
        },
        Graphics::Imaging::*,
        System::Com::*,
    },
    core::{Interface, PCWSTR, Result as WinResult},
};

struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn pixels(path: &Path, edge: u16, thumbnail: bool) -> WinResult<(Vec<u8>, u16, u16)> {
    let filename: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        let _apartment = if hr == RPC_E_CHANGED_MODE {
            None
        } else {
            hr.ok()?;
            Some(Apartment)
        };
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
        let decoder = factory.CreateDecoderFromFilename(
            PCWSTR(filename.as_ptr()),
            None,
            GENERIC_READ,
            WICDecodeMetadataCacheOnDemand,
        )?;
        let frame = decoder.GetFrame(0)?;
        let embedded = frame
            .GetThumbnail()
            .or_else(|_| decoder.GetThumbnail())
            .ok();
        let usable = embedded.filter(|source| {
            let (mut w, mut h) = (0, 0);
            source.GetSize(&mut w, &mut h).is_ok()
                && w > 0
                && h > 0
                && (thumbnail || w.max(h) >= u32::from(edge.min(1616)))
        });
        let source: IWICBitmapSource = match usable {
            Some(image) => image,
            None => frame.cast()?,
        };
        let (mut w, mut h) = (0, 0);
        source.GetSize(&mut w, &mut h)?;
        if w == 0 || h == 0 {
            return Err(E_INVALIDARG.into());
        }
        let longest = u64::from(w.max(h));
        let limit = longest.min(u64::from(edge));
        let fit = |n| (u64::from(n) * limit / longest).max(1) as u32;
        let (width, height) = (fit(w), fit(h));
        let scaler = factory.CreateBitmapScaler()?;
        scaler.Initialize(&source, width, height, WICBitmapInterpolationModeFant)?;
        let rgb = WICConvertBitmapSource(&GUID_WICPixelFormat24bppRGB, &scaler)?;
        let mut bytes = vec![0; (width * height * 3) as usize];
        rgb.CopyPixels(ptr::null(), width * 3, &mut bytes)?;
        Ok((bytes, width as u16, height as u16))
    }
}

pub fn render(path: &Path, edge: u16, thumbnail: bool) -> Result<Vec<u8>, String> {
    let (rgb, width, height) = pixels(path, edge, thumbnail).map_err(|e| {
        if e.code() == WINCODEC_ERR_COMPONENTNOTFOUND {
            "HEIF 미리보기에 필요한 Windows 코덱을 사용할 수 없습니다. 원본은 복사할 수 있습니다."
        } else {
            super::UNREADABLE
        }
    })?;
    let mut jpeg = Vec::new();
    Encoder::new(&mut jpeg, 85)
        .encode(&rgb, width, height, ColorType::Rgb)
        .map_err(|e| e.to_string())?;
    Ok(jpeg)
}
