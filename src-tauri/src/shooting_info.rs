use exif::{In, Tag, Value};
use serde::Serialize;
use std::{fs::File, io::BufReader, path::Path};

#[derive(Default, Serialize, Debug)]
pub struct ShootingInfo {
    rows: Vec<(&'static str, String)>,
    gps: Option<[f64; 2]>,
}

fn coordinate(
    exif: &exif::Exif,
    tag: Tag,
    reference: Tag,
    positive: &str,
    negative: &str,
    limit: f64,
) -> Option<f64> {
    let Value::Rational(parts) = &exif.get_field(tag, In::PRIMARY)?.value else {
        return None;
    };
    let [deg, min, sec] = parts.as_slice() else {
        return None;
    };
    let result = deg.to_f64() + min.to_f64() / 60.0 + sec.to_f64() / 3600.0;
    if !(0.0..=limit).contains(&result) {
        return None;
    }
    let Value::Ascii(names) = &exif.get_field(reference, In::PRIMARY)?.value else {
        return None;
    };
    let name = std::str::from_utf8(names.first()?).ok()?;
    if name == positive {
        Some(result)
    } else if name == negative {
        Some(-result)
    } else {
        None
    }
}

pub fn read(path: &Path) -> Result<ShootingInfo, String> {
    if crate::library::raw_format(path).is_some() {
        let raw = libopenraw::rawfile_from_file(path, None).map_err(|e| e.to_string())?;
        let main = raw.main_ifd().ok();
        let exposure = raw.exif_ifd().ok();
        let rows = shooting_rows(|tag| {
            let dir = if matches!(tag, Tag::Make | Tag::Model) {
                main?
            } else {
                exposure?
            };
            raw_field(dir, tag).and_then(|field| field_text(&field))
        });
        return Ok(ShootingInfo { rows, gps: None });
    }
    let mut reader = BufReader::new(File::open(path).map_err(|e| e.to_string())?);
    let metadata = match exif::Reader::new().read_from_container(&mut reader) {
        Ok(data) => data,
        Err(exif::Error::NotFound(_)) => return Ok(ShootingInfo::default()),
        Err(e) => return Err(e.to_string()),
    };
    let rows = shooting_rows(|tag| field_text(metadata.get_field(tag, In::PRIMARY)?));
    let gps = coordinate(
        &metadata,
        Tag::GPSLatitude,
        Tag::GPSLatitudeRef,
        "N",
        "S",
        90.0,
    )
    .zip(coordinate(
        &metadata,
        Tag::GPSLongitude,
        Tag::GPSLongitudeRef,
        "E",
        "W",
        180.0,
    ))
    .map(|(lat, lon)| [lat, lon]);
    Ok(ShootingInfo { rows, gps })
}

fn field_text(field: &exif::Field) -> Option<String> {
    let text = match &field.value {
        Value::Ascii(values) => String::from_utf8_lossy(values.first()?)
            .trim_end_matches('\0')
            .trim()
            .to_owned(),
        _ => field.display_value().to_string(),
    };
    (!text.is_empty()).then_some(text)
}

fn raw_field(dir: &impl libopenraw::Ifd, tag: Tag) -> Option<exif::Field> {
    use libopenraw::tiff::exif as raw;
    let id = tag.number();
    let value = match tag {
        Tag::Make | Tag::Model | Tag::LensModel | Tag::DateTimeOriginal => {
            Value::Ascii(vec![dir.entry(id).ok()?.string_value().ok()?.into_bytes()])
        }
        Tag::FNumber | Tag::ExposureTime | Tag::FocalLength => {
            let r = dir.value::<raw::Rational>(id).ok()?;
            if r.denom == 0 {
                return None;
            }
            Value::Rational(vec![(r.num, r.denom).into()])
        }
        Tag::ExposureBiasValue => {
            let r = dir.value::<raw::SRational>(id).ok()?;
            if r.denom == 0 {
                return None;
            }
            Value::SRational(vec![(r.num, r.denom).into()])
        }
        _ => Value::Long(vec![
            dir.value::<u32>(id)
                .or_else(|_| dir.value::<u16>(id).map(u32::from))
                .ok()?,
        ]),
    };
    Some(exif::Field {
        tag,
        ifd_num: In::PRIMARY,
        value,
    })
}

// The two containers use different readers but share the panel's labels, units and formatting.
fn shooting_rows(text: impl Fn(Tag) -> Option<String>) -> Vec<(&'static str, String)> {
    let camera = [text(Tag::Make), text(Tag::Model)]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    let size = text(Tag::PixelXDimension)
        .zip(text(Tag::PixelYDimension))
        .map(|(w, h)| format!("{w} × {h}"));
    [
        ("촬영일시", text(Tag::DateTimeOriginal)),
        ("카메라", (!camera.is_empty()).then_some(camera)),
        ("렌즈", text(Tag::LensModel)),
        (
            "초점거리",
            text(Tag::FocalLength).map(|v| format!("{v} mm")),
        ),
        ("조리개", text(Tag::FNumber).map(|v| format!("f/{v}"))),
        (
            "셔터속도",
            text(Tag::ExposureTime).map(|v| format!("{v} s")),
        ),
        (
            "ISO",
            text(Tag::ISOSpeed).or_else(|| text(Tag::PhotographicSensitivity)),
        ),
        (
            "노출보정",
            text(Tag::ExposureBiasValue).map(|v| format!("{v} EV")),
        ),
        ("해상도", size),
    ]
    .into_iter()
    .filter_map(|(label, value)| Some((label, value?)))
    .collect()
}
