use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Image,
    Raw,
}

#[derive(Clone, Serialize)]
pub struct Photo {
    pub name: String,
    pub format: &'static str,
    pub pair_format: Option<&'static str>,
    #[serde(skip)]
    source: PathBuf,
    #[serde(skip)]
    kind: Kind,
    #[serde(skip)]
    companion: Option<PathBuf>,
}

impl Photo {
    pub fn source(&self) -> &Path {
        &self.source
    }

    pub fn originals(&self) -> (Option<&Path>, Option<&Path>) {
        match self.kind {
            Kind::Image => (Some(&self.source), self.companion.as_deref()),
            Kind::Raw => (self.companion.as_deref(), Some(&self.source)),
        }
    }
}

fn files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut result = Vec::new();
    for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = item.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_file() {
            result.push(entry.path());
        }
    }
    Ok(result)
}

fn ext(path: &Path) -> String {
    path.extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase()
}

pub fn image_format(path: &Path) -> Option<&'static str> {
    match ext(path).as_str() {
        "jpg" | "jpeg" => Some("JPEG"),
        "heic" => Some("HEIC"),
        "heif" | "hif" => Some("HEIF"),
        _ => None,
    }
}

pub fn raw_format(path: &Path) -> Option<&'static str> {
    Some(match ext(path).as_str() {
        "arw" => "RAW (Sony ARW)",
        "nef" => "RAW (Nikon NEF)",
        "nrw" => "RAW (Nikon NRW)",
        "cr2" => "RAW (Canon CR2)",
        "cr3" => "RAW (Canon CR3)",
        "raf" => "RAW (Fujifilm RAF)",
        "rw2" => "RAW (Panasonic RW2)",
        "orf" => "RAW (Olympus ORF)",
        "pef" => "RAW (Pentax PEF)",
        "dng" => "RAW (DNG)",
        _ => return None,
    })
}

const IMAGE_DIRS: [&str; 5] = ["JPG", "JPEG", "HEIF", "HEIC", "HIF"];

fn directory_kind(path: &Path) -> Option<Kind> {
    let name = path.file_name()?;
    if name.eq_ignore_ascii_case("RAW") {
        Some(Kind::Raw)
    } else if IMAGE_DIRS
        .iter()
        .any(|label| name.eq_ignore_ascii_case(label))
    {
        Some(Kind::Image)
    } else {
        None
    }
}

#[derive(Default)]
struct Candidates {
    images: Vec<usize>,
    raws: Vec<usize>,
}

impl Candidates {
    fn add(&mut self, index: usize, kind: Kind) {
        match kind {
            Kind::Image => self.images.push(index),
            Kind::Raw => self.raws.push(index),
        }
    }
    fn match_unique(&self, pairs: &mut [Option<usize>]) {
        if let ([image], [raw]) = (self.images.as_slice(), self.raws.as_slice()) {
            pairs[*image] = Some(*raw);
            pairs[*raw] = Some(*image);
        }
    }
}

// Within-directory candidates take precedence, even when ambiguous. Only
// unclaimed files in the designated format folders can match across siblings.
fn pair_originals(photos: &[Photo], root: &Path) -> Vec<Option<usize>> {
    let mut local = HashMap::<_, Candidates>::new();
    for (i, photo) in photos.iter().enumerate() {
        local
            .entry((photo.source.parent(), photo.source.file_stem()))
            .or_default()
            .add(i, photo.kind);
    }
    let mut pairs = vec![None; photos.len()];
    let mut siblings = HashMap::<_, Candidates>::new();
    for ((dir, stem), group) in local {
        if !group.images.is_empty() && !group.raws.is_empty() {
            group.match_unique(&mut pairs);
            continue;
        }
        let Some(dir) = dir else { continue };
        if dir.parent() != Some(root) {
            continue;
        }
        for i in group.images.into_iter().chain(group.raws) {
            let kind = photos[i].kind;
            if directory_kind(dir) == Some(kind) {
                siblings.entry(stem).or_default().add(i, kind);
            }
        }
    }
    for group in siblings.values() {
        group.match_unique(&mut pairs);
    }
    pairs
}

pub fn scan(selected: &Path) -> Result<(Vec<Photo>, PathBuf), String> {
    let selected_kind = directory_kind(selected);
    let root = if selected_kind.is_some() {
        selected.parent().unwrap_or(selected)
    } else {
        selected
    };
    let mut dirs = Vec::new();
    let mut raw_folder = false;
    let mut image_folder = false;
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let Some(kind) = directory_kind(&path) else {
            continue;
        };
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        raw_folder |= kind == Kind::Raw;
        image_folder |= kind == Kind::Image;
        dirs.push(path);
    }
    let split = raw_folder && image_folder;
    if selected_kind.is_none() {
        dirs.push(selected.to_owned());
    } else if !split {
        dirs = vec![selected.to_owned()];
    }

    let mut photos = Vec::new();
    for dir in dirs {
        for source in files(&dir)? {
            let (kind, format) = if let Some(f) = image_format(&source) {
                (Kind::Image, f)
            } else if let Some(f) = raw_format(&source) {
                (Kind::Raw, f)
            } else {
                continue;
            };
            photos.push(Photo {
                name: source.file_name().unwrap().to_string_lossy().into_owned(),
                format,
                source,
                kind,
                companion: None,
                pair_format: None,
            });
        }
    }
    let pairs = pair_originals(&photos, root);
    for (i, other) in pairs.into_iter().enumerate() {
        if let Some(j) = other {
            photos[i].companion = Some(photos[j].source.clone());
            photos[i].pair_format = Some(if photos[j].kind == Kind::Raw {
                "Raw"
            } else {
                photos[j].format
            });
        }
    }
    photos.retain(|p| {
        if selected_kind.is_some() && p.source.parent() != Some(selected) {
            return false;
        }
        if selected_kind == Some(Kind::Raw) {
            return p.kind == Kind::Raw || (!split && p.companion.is_none());
        }
        p.kind == Kind::Image || p.companion.is_none()
    });
    photos.sort_by(|a, b| a.name.cmp(&b.name).then(a.source.cmp(&b.source)));
    Ok((photos, if split { root } else { selected }.join("pick")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_scope_is_the_same_from_parent_and_children() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        for dir in ["JPG", "RAW", "HEIF"] {
            fs::create_dir(root.join(dir)).unwrap();
        }
        for file in ["A.HEIC", "JPG/A.JPG", "RAW/A.ARW", "RAW/B.ARW"] {
            fs::write(root.join(file), file).unwrap();
        }
        let listing = |dir: &Path| {
            scan(dir)
                .unwrap()
                .0
                .into_iter()
                .map(|p| (p.source.clone(), p.companion))
                .collect::<HashMap<_, _>>()
        };
        let all = listing(root);
        assert_eq!(all[&root.join("A.HEIC")], None);
        assert_eq!(all[&root.join("RAW/B.ARW")], None);
        assert_eq!(all[&root.join("JPG/A.JPG")], Some(root.join("RAW/A.ARW")));
        assert_eq!(
            listing(&root.join("JPG"))[&root.join("JPG/A.JPG")],
            Some(root.join("RAW/A.ARW"))
        );
        assert_eq!(
            listing(&root.join("RAW"))[&root.join("RAW/A.ARW")],
            Some(root.join("JPG/A.JPG"))
        );

        fs::write(root.join("HEIF/A.HIF"), b"second candidate").unwrap();
        for dir in [
            root.to_owned(),
            root.join("JPG"),
            root.join("HEIF"),
            root.join("RAW"),
        ] {
            assert!(listing(&dir).values().all(Option::is_none));
        }
        fs::write(root.join("A.DNG"), b"same-directory raw").unwrap();
        assert_eq!(
            listing(root)[&root.join("A.HEIC")],
            Some(root.join("A.DNG"))
        );
    }
}
