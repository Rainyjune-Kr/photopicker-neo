"""Regenerate bundled third-party notices after npm ci. Requires Cargo and Python 3."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tomllib
from urllib.request import urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
NOTICE = ROOT / "src-tauri/third-party/NOTICES.txt"
texts = {}
entries = []
upstream = {}


def license_file(path):
    return path.name.lower().startswith(("license", "licence", "copying", "copyright",
                                         "notice", "unlicense", "mpl-2.0", "authors"))


def upstream_license(pkg, directory):
    if pkg["license"] == "MPL-2.0":
        url = "https://www.mozilla.org/media/MPL/2.0/index.815ca599c9df.txt"
        with urlopen(url, timeout=30) as response:
            return url, response.read().decode()
    repo = pkg["repository"].removesuffix(".git").removeprefix("https://github.com/")
    commit = json.loads((directory / ".cargo_vcs_info.json").read_text())["git"]["sha1"]
    key = (repo, commit)
    if key not in upstream:
        for name in ("LICENSE-MIT", "LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "LICENSE-MIT.md", "LICENSE-APACHE"):
            url = f"https://raw.githubusercontent.com/{repo}/{commit}/{name}"
            try:
                with urlopen(url, timeout=30) as response:
                    upstream[key] = (url, response.read().decode())
                break
            except HTTPError as exc:
                if exc.code != 404:
                    raise
        else:
            raise ValueError(f"No upstream license found for {key}")
    return upstream[key]


def add(name, version, source, license_id, files):
    refs = []
    for filename, body in sorted(files):
        body = body.replace("\r\n", "\n").strip()
        digest = hashlib.sha256(body.encode()).hexdigest()[:16]
        texts[digest] = body
        refs.append(f"  {filename} [{digest}]")
    entries.append("\n".join([f"{name} {version} | {license_id}", source, *refs]))


packages = {}
for target in ("aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-pc-windows-msvc"):
    metadata = subprocess.check_output(["cargo", "metadata", "--locked", "--format-version", "1",
                                        "--filter-platform", target], cwd=ROOT / "src-tauri")
    packages.update({p["id"]: p for p in json.loads(metadata)["packages"] if p["source"]})

for pkg in packages.values():
    directory = Path(pkg["manifest_path"]).parent
    files = [(f.relative_to(directory).as_posix(), f.read_text(encoding="utf-8", errors="replace"))
             for f in directory.rglob("*") if f.is_file() and license_file(f)
             and f.suffix.lower() not in (".rs", ".png", ".js", ".json", ".toml")]
    if pkg["name"] == "libopenraw":
        for name in ("src/decompress/ljpeg.rs", "src/decompress/bit_reader.rs"):
            header = []
            for line in (directory / name).read_text().splitlines():
                if line.strip() and not line.lstrip().startswith(("//", "/*", "*")):
                    break
                header.append(line)
            files.append((name + " (copyright and distribution terms)", "\n".join(header)))
    if not any("/" not in name and not name.lower().startswith("authors") for name, _ in files):
        files.append(upstream_license(pkg, directory))
    add(pkg["name"], pkg["version"], f'https://crates.io/crates/{pkg["name"]}/{pkg["version"]}',
        pkg["license"] or pkg["license_file"], files)

for path, pkg in json.loads((ROOT / "package-lock.json").read_text())["packages"].items():
    if not path or pkg.get("dev"):
        continue
    directory = ROOT / path
    files = [(f.name, f.read_text()) for f in directory.iterdir() if f.is_file() and license_file(f)]
    if not files:
        raise ValueError(f"Missing npm notices for {path}")
    add(path.split("node_modules/")[-1], pkg["version"], pkg["resolved"], pkg["license"], files)

NOTICE.write_text("Photo Picker neo — Third-party notices\n"
                  "This software is based in part on the work of the Independent JPEG Group.\n"
                  "Includes libopenraw under LGPL-3.0-or-later. Source and release build instructions: "
                  "https://github.com/Rainyjune-Kr/photopicker-neo\n\n"
                  + "\n\n".join(sorted(entries)) + "\n\n"
                  + "\n\n".join(f"[{k}]\n{v}" for k, v in sorted(texts.items())) + "\n")
print(f"{len(entries)} packages, {len(texts)} distinct notice texts")

# Keep the exact copyleft source archives beside the binaries in each release.
if "--source-archive" in sys.argv:
    checksums = {(p["name"], p["version"]): p.get("checksum")
                 for p in tomllib.loads((ROOT / "src-tauri/Cargo.lock").read_text())["package"]}
    with tarfile.open("third-party-sources.tar", "w") as archive:
        for pkg in sorted(packages.values(), key=lambda p: p["id"]):
            if not any(term in (pkg["license"] or "") for term in ("GPL", "MPL")):
                continue
            directory = Path(pkg["manifest_path"]).parent
            crate = directory.parents[2] / "cache" / directory.parent.name / (directory.name + ".crate")
            if hashlib.sha256(crate.read_bytes()).hexdigest() != checksums[pkg["name"], pkg["version"]]:
                raise ValueError(f"Source checksum mismatch for {crate.name}")
            archive.add(crate, arcname=crate.name)
