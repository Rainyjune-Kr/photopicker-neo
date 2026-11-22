use exif::{In, Tag};
use jpeg_decoder::{Decoder, PixelFormat};
use jpeg_encoder::{ColorType, Encoder};
use std::{
    fs::File,
    io::{BufReader, Seek},
    path::Path,
};

#[path = "mpf.rs"]
mod mpf;

pub fn render(path: &Path, edge: u16, thumbnail: bool) -> Result<Vec<u8>, String> {
    if matches!(crate::library::image_format(path), Some("HEIC" | "HEIF")) {
        return crate::heif::render(path, edge, thumbnail);
    }
    if crate::library::raw_format(path).is_some() {
        return raw_preview(path, edge, thumbnail);
    }
    let mut file = BufReader::new(File::open(path).map_err(|e| e.to_string())?);
    let metadata = exif::Reader::new().read_from_container(&mut file).ok();
    let field = |tag, section| {
        metadata
            .as_ref()?
            .get_field(tag, section)?
            .value
            .get_uint(0)
    };
    let orientation = field(Tag::Orientation, In::PRIMARY).unwrap_or(1);
    if thumbnail {
        if let (Some(exif), Some(offset), Some(len)) = (
            &metadata,
            field(Tag::JPEGInterchangeFormat, In::THUMBNAIL),
            field(Tag::JPEGInterchangeFormatLength, In::THUMBNAIL),
        ) {
            if let Some(bytes) = exif
                .buf()
                .get(offset as usize..)
                .and_then(|b| b.get(..len as usize))
            {
                let orient = field(Tag::Orientation, In::THUMBNAIL).unwrap_or(orientation);
                if bytes.starts_with(&[0xff, 0xd8]) && bytes.ends_with(&[0xff, 0xd9]) {
                    return Ok(oriented(bytes.to_vec(), orient));
                }
            }
        }
    }
    if !thumbnail {
        if let Some(bytes) = mpf::large_preview(&mut file) {
            return Ok(oriented(bytes, orientation));
        }
    }
    file.rewind().map_err(|e| e.to_string())?;
    reduced(file, edge, orientation)
}

fn raw_preview(path: &Path, edge: u16, thumbnail: bool) -> Result<Vec<u8>, String> {
    use libopenraw::{Bitmap, DataType};
    let raw =
        libopenraw::rawfile_from_file(path, None).map_err(|e| format!("RAW 열기 실패 · {e}"))?;
    let target = if thumbnail { u32::from(edge) } else { 1616 };
    let mut sizes = raw.thumbnail_sizes().unwrap_or_default().to_vec();
    sizes.sort_by_key(|size| size.abs_diff(target));
    for size in sizes {
        let Ok(image) = raw.thumbnail(size) else {
            continue;
        };
        let Some(bytes) = image.data8() else {
            continue;
        };
        let orientation = raw.orientation() as u32;
        let jpeg = match image.data_type() {
            DataType::Jpeg if bytes.starts_with(&[0xff, 0xd8]) => bytes.to_vec(),
            DataType::PixmapRgb8 => {
                let (Ok(w), Ok(h)) = (u16::try_from(image.width()), u16::try_from(image.height()))
                else {
                    continue;
                };
                let mut encoded = Vec::new();
                if Encoder::new(&mut encoded, 85)
                    .encode(bytes, w, h, ColorType::Rgb)
                    .is_err()
                {
                    continue;
                }
                encoded
            }
            _ => continue,
        };
        if size > u32::from(edge) * 2 {
            if let Ok(data) = reduced(jpeg.as_slice(), edge, orientation) {
                return Ok(data);
            }
            continue;
        }
        return Ok(oriented(jpeg, orientation));
    }
    Err("이 RAW에서 표시할 내장 미리보기를 찾지 못했습니다.".into())
}

// Preserve the compressed scan. Some embedded JPEGs omit the parent's orientation.
fn oriented(mut bytes: Vec<u8>, orientation: u32) -> Vec<u8> {
    if (2..=8).contains(&orientation) {
        let own = exif::Reader::new()
            .read_from_container(&mut std::io::Cursor::new(&bytes))
            .ok();
        if own
            .as_ref()
            .and_then(|m| m.get_field(Tag::Orientation, In::PRIMARY))
            .is_none()
        {
            let mut segment = *b"\xff\xe1\x00\x22Exif\x00\x00MM\x00\x2a\x00\x00\x00\x08\x00\x01\x01\x12\x00\x03\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00\x00\x00";
            segment[29] = orientation as u8;
            bytes.splice(2..2, segment);
        }
    }
    bytes
}

fn reduced(input: impl std::io::Read, edge: u16, orientation: u32) -> Result<Vec<u8>, String> {
    let mut decoder = Decoder::new(input);
    decoder.set_max_decoding_buffer_size(64 * 1024 * 1024);
    decoder.read_info().map_err(|e| e.to_string())?;
    let info = decoder.info().ok_or("JPEG 정보를 읽을 수 없습니다.")?;
    let longest = info.width.max(info.height) as u32;
    let edge = u32::from(edge).min(longest);
    let fit = |v: u16| (u32::from(v) * edge / longest).max(1) as u16;
    let (w, h) = (fit(info.width), fit(info.height));
    let (sw, sh) = decoder.scale(w, h).map_err(|e| e.to_string())?;
    let (channels, color) = match info.pixel_format {
        PixelFormat::RGB24 => (3, ColorType::Rgb),
        PixelFormat::L8 => (1, ColorType::Luma),
        _ => return Err("지원하지 않는 JPEG 색상 형식입니다.".into()),
    };
    let decoded = decoder.decode().map_err(|e| e.to_string())?;
    let (dw, dh) = if (5..=8).contains(&orientation) {
        (h, w)
    } else {
        (w, h)
    };
    let mut output = Vec::with_capacity(dw as usize * dh as usize * channels);
    for y in 0..dh {
        for x in 0..dw {
            let (sx, sy) = match orientation {
                2 => (w - 1 - x, y),
                3 => (w - 1 - x, h - 1 - y),
                4 => (x, h - 1 - y),
                5 => (y, x),
                6 => (y, h - 1 - x),
                7 => (w - 1 - y, h - 1 - x),
                8 => (w - 1 - y, x),
                _ => (x, y),
            };
            let row = sy as usize * sh as usize / h as usize;
            let col = sx as usize * sw as usize / w as usize;
            let i = (row * sw as usize + col) * channels;
            output.extend_from_slice(&decoded[i..i + channels]);
        }
    }
    let mut jpg = Vec::new();
    Encoder::new(&mut jpg, 85)
        .encode(&output, dw, dh, color)
        .map_err(|e| e.to_string())?;
    Ok(jpg)
}
