// MP Index offsets are relative to the TIFF header following the APP2 MPF signature.
use std::io::{Read, Seek, SeekFrom};

fn large_entries(tiff: &[u8]) -> Option<Vec<(u32, u32)>> {
    let little = match tiff.get(..4)? {
        b"II\x2a\x00" => true,
        b"MM\x00\x2a" => false,
        _ => return None,
    };
    let short = |b: &[u8]| {
        if little {
            u16::from_le_bytes([b[0], b[1]])
        } else {
            u16::from_be_bytes([b[0], b[1]])
        }
    };
    let long = |b: &[u8]| {
        let a: [u8; 4] = b.get(..4)?.try_into().ok()?;
        Some(if little {
            u32::from_le_bytes(a)
        } else {
            u32::from_be_bytes(a)
        })
    };
    let ifd = tiff.get(long(tiff.get(4..)?)? as usize..)?;
    let count = short(ifd.get(..2)?) as usize;
    for field in ifd.get(2..2 + count * 12)?.chunks_exact(12) {
        if short(field) != 0xb002 || short(&field[2..]) != 7 {
            continue;
        }
        let len = long(&field[4..])? as usize;
        let table = tiff.get(long(&field[8..])? as usize..)?.get(..len)?;
        let mut entries = Vec::new();
        for e in table.chunks_exact(16) {
            let attr = long(e)?;
            // JPEG Large Thumbnail, VGA or Full HD. Other MP types may be depth or gain maps.
            if matches!(attr & 0x0fff_ffff, 0x010001 | 0x010002) {
                entries.push((long(&e[8..])?, long(&e[4..])?));
            }
        }
        entries.sort_by_key(|&(_, len)| std::cmp::Reverse(len));
        return Some(entries);
    }
    None
}

pub fn large_preview(file: &mut (impl Read + Seek)) -> Option<Vec<u8>> {
    file.rewind().ok()?;
    let mut pair = [0; 2];
    file.read_exact(&mut pair).ok()?;
    if pair != [0xff, 0xd8] {
        return None;
    }
    loop {
        file.read_exact(&mut pair).ok()?;
        if pair[0] != 0xff {
            return None;
        }
        while pair[1] == 0xff {
            file.read_exact(&mut pair[1..]).ok()?;
        }
        let marker = pair[1];
        if matches!(marker, 0xda | 0xd9) {
            return None;
        }
        file.read_exact(&mut pair).ok()?;
        let len = u16::from_be_bytes(pair).checked_sub(2)? as usize;
        if marker != 0xe2 || len < 4 {
            file.seek(SeekFrom::Current(len as i64)).ok()?;
            continue;
        }
        let mut signature = [0; 4];
        file.read_exact(&mut signature).ok()?;
        if &signature != b"MPF\0" {
            file.seek(SeekFrom::Current(len as i64 - 4)).ok()?;
            continue;
        }
        let base = file.stream_position().ok()?;
        let mut header = vec![0; len - 4];
        file.read_exact(&mut header).ok()?;
        let end = file.seek(SeekFrom::End(0)).ok()?;
        for (offset, size) in large_entries(&header)? {
            let start = base.checked_add(u64::from(offset))?;
            if offset == 0 || size > 16 * 1024 * 1024 || start.checked_add(u64::from(size))? > end {
                continue;
            }
            file.seek(SeekFrom::Start(start)).ok()?;
            let mut bytes = vec![0; size as usize];
            file.read_exact(&mut bytes).ok()?;
            if bytes.ends_with(&[0xff, 0xd9]) {
                let mut decoder = jpeg_decoder::Decoder::new(bytes.as_slice());
                if decoder.read_info().is_ok()
                    && decoder.info().is_some_and(|i| i.width.max(i.height) >= 640)
                {
                    return Some(bytes);
                }
            }
        }
        return None;
    }
}
