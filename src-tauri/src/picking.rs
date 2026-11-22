use serde::{Deserialize, Serialize};
use std::{fs, io, path::Path};

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Jpeg,
    Raw,
    Both,
}

#[derive(Serialize)]
pub struct Outcome {
    pub format: &'static str,
    pub status: Status,
    pub detail: Option<String>,
}

#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Copied,
    Missing,
    Exists,
    Failed,
}

fn copy_one(source: &Path, dest: &Path) -> io::Result<()> {
    let target = dest.join(source.file_name().ok_or(io::ErrorKind::InvalidInput)?);
    if target.try_exists()? {
        return Err(io::ErrorKind::AlreadyExists.into());
    }
    let mut temp = tempfile::NamedTempFile::new_in(dest)?;
    let mut input = fs::File::open(source)?;
    io::copy(&mut input, temp.as_file_mut())?;
    temp.persist_noclobber(target).map_err(|e| e.error)?;
    Ok(())
}

pub fn copy(
    image: Option<&Path>,
    raw: Option<&Path>,
    dest: &Path,
    automatic: bool,
    mode: Mode,
) -> Result<Vec<Outcome>, String> {
    let mut sources = Vec::new();
    if matches!(mode, Mode::Both | Mode::Jpeg) {
        sources.push((
            image
                .and_then(crate::library::image_format)
                .unwrap_or("JPEG/HEIF"),
            image,
        ));
    }
    if matches!(mode, Mode::Both | Mode::Raw) {
        sources.push(("RAW", raw));
    }
    if automatic && sources.iter().any(|(_, p)| p.is_some()) {
        fs::create_dir_all(dest).map_err(|e| format!("{} · {e}", dest.display()))?;
    }
    Ok(sources
        .into_iter()
        .map(|(kind, path)| {
            let (status, detail) = match path.map(|src| copy_one(src, dest)) {
                None => (Status::Missing, None),
                Some(Ok(())) => (Status::Copied, None),
                Some(Err(e)) if e.kind() == io::ErrorKind::AlreadyExists => (Status::Exists, None),
                Some(Err(e)) => (Status::Failed, Some(e.to_string())),
            };
            Outcome {
                format: kind,
                status,
                detail,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::scan;

    #[test]
    fn partial_copy_reports_each_file_and_preserves_existing_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let image = tmp.path().join("A.HIF");
        let raw = tmp.path().join("A.ARW");
        let dest = tmp.path().join("pick");
        fs::write(&image, b"image").unwrap();
        let run = || copy(Some(&image), Some(&raw), &dest, true, Mode::Both).unwrap();
        let first = run();
        assert_eq!(first[0].format, "HEIF");
        assert_eq!(first[0].status, Status::Copied);
        assert_eq!(first[1].format, "RAW");
        assert_eq!(first[1].status, Status::Failed);
        assert!(first[1].detail.is_some());
        fs::write(&image, b"changed").unwrap();
        fs::write(&raw, b"raw").unwrap();
        let retry = run();
        assert_eq!(retry[0].status, Status::Exists);
        assert_eq!(retry[1].status, Status::Copied);
        assert_eq!(fs::read(dest.join("A.HIF")).unwrap(), b"image");
        assert_eq!(fs::read(dest.join("A.ARW")).unwrap(), b"raw");
    }

    #[test]
    fn heif_scan_and_original_copy_do_not_require_a_preview() {
        for ext in ["HEIC", "heif", "HiF"] {
            let tmp = tempfile::tempdir().unwrap();
            let images = tmp.path().join("HEIF");
            let raws = tmp.path().join("RAW");
            fs::create_dir(&images).unwrap();
            fs::create_dir(&raws).unwrap();
            let image = images.join(format!("한 컷.{ext}"));
            let raw = raws.join("한 컷.ARW");
            fs::write(&image, b"undecodable image").unwrap();
            fs::write(&raw, b"raw").unwrap();
            for selected in [tmp.path(), images.as_path(), raws.as_path()] {
                let (photos, pick) = scan(selected).unwrap();
                assert_eq!(photos.len(), 1);
                let photo = &photos[0];
                assert_eq!(photo.originals().0, Some(image.as_path()));
                assert_eq!(photo.originals().1, Some(raw.as_path()));
                assert_eq!(photo.source(), if selected == raws { &raw } else { &image });
                assert_eq!(pick, tmp.path().join("pick"));
            }
            let (photos, _) = scan(&images).unwrap();
            let photo = &photos[0];
            for (folder, mode, want_image, want_raw) in [
                ("image", Mode::Jpeg, true, false),
                ("raw-only", Mode::Raw, false, true),
                ("both", Mode::Both, true, true),
            ] {
                let dest = tmp.path().join(folder);
                let result =
                    copy(photo.originals().0, photo.originals().1, &dest, true, mode).unwrap();
                assert!(result.iter().all(|r| r.status == Status::Copied));
                let target = dest.join(image.file_name().unwrap());
                assert_eq!(target.exists(), want_image);
                if want_image {
                    assert_eq!(fs::read(target).unwrap(), b"undecodable image");
                }
                assert_eq!(dest.join(raw.file_name().unwrap()).exists(), want_raw);
            }
            fs::write(images.join("한 컷.JPG"), b"jpeg").unwrap();
            assert_eq!(scan(&images).unwrap().0.len(), 2);
            assert!(scan(&raws).unwrap().0[0].originals().0.is_none());
        }
    }

    #[test]
    fn raw_only_copy_respects_requested_format() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("001.ARW"), b"raw").unwrap();
        let (photos, pick) = scan(folder.path()).unwrap();
        let photo = &photos[0];
        assert_eq!(photo.format, "RAW (Sony ARW)");
        assert!(photo.originals().0.is_none());
        assert!(
            copy(None, photo.originals().1, &pick, true, Mode::Jpeg).unwrap()[0].status
                != Status::Copied
        );
        assert!(!pick.exists());
        let results = copy(None, photo.originals().1, &pick, true, Mode::Both).unwrap();
        assert!(results[0].status == Status::Missing && results[1].status == Status::Copied);
        assert_eq!(fs::read(pick.join("001.ARW")).unwrap(), b"raw");
    }

    #[test]
    fn split_and_mixed_destinations() {
        let temp = tempfile::tempdir().unwrap();
        for split in [true, false] {
            let base = temp.path().join(if split { "split" } else { "mixed" });
            let jpg_dir = if split {
                base.join("JPG")
            } else {
                base.clone()
            };
            let raw_dir = if split {
                base.join("RAW")
            } else {
                base.clone()
            };
            fs::create_dir_all(&jpg_dir).unwrap();
            fs::create_dir_all(&raw_dir).unwrap();
            fs::write(jpg_dir.join("001.JPG"), b"jpeg").unwrap();
            fs::write(raw_dir.join("001.ARW"), b"raw").unwrap();
            let (photos, pick) = scan(&jpg_dir).unwrap();
            assert_eq!(pick, base.join("pick"));
            assert_eq!(scan(&base).unwrap().1, pick);
            assert!(!pick.exists());
            let results = copy(
                photos[0].originals().0,
                photos[0].originals().1,
                &pick,
                true,
                Mode::Both,
            )
            .unwrap();
            assert!(results.iter().all(|r| r.status == Status::Copied));
            assert_eq!(fs::read(pick.join("001.ARW")).unwrap(), b"raw");
            fs::write(pick.join("001.JPG"), b"prior").unwrap();
            assert!(
                copy(photos[0].originals().0, None, &pick, true, Mode::Jpeg).unwrap()[0].status
                    != Status::Copied
            );
            assert_eq!(fs::read(pick.join("001.JPG")).unwrap(), b"prior");
            assert!(
                copy(
                    photos[0].originals().0,
                    None,
                    &base.join("empty"),
                    true,
                    Mode::Raw
                )
                .unwrap()[0]
                    .status
                    != Status::Copied
            );
            assert!(!base.join("empty").exists());
        }
    }
}
