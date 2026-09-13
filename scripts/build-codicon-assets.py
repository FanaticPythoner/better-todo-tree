"""Compile verified Codicon SVGs and documented product aliases."""

import argparse
import base64
import hashlib
import json
import tarfile
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path


class ProductTable(HTMLParser):
    """Collect the identifier and default-glyph columns from product icon tables."""

    def __init__(self):
        super().__init__()
        self.row = None
        self.cell = None
        self.rows = []

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag == "td":
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == "td" and self.row is not None:
            self.row.append("".join(self.cell).strip())
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def compile_assets(source: Path, root: Path) -> None:
    """Verify archive integrity and emit deduplicated SVG templates and aliases."""
    metadata = json.loads((source / "metadata.json").read_text())
    archive = source / "package.tgz"
    digest = base64.b64encode(hashlib.sha512(archive.read_bytes()).digest()).decode()
    if metadata["dist"]["integrity"] != "sha512-" + digest:
        raise ValueError("Codicon archive integrity mismatch")
    glyphs, aliases = {}, {}
    attribution = root / "resources/codicons"
    attribution.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as package:
        manifest = json.load(package.extractfile("package/package.json"))
        if manifest["version"] != metadata["version"]:
            raise ValueError("Codicon package version mismatch")
        mapping = json.load(package.extractfile("package/src/template/mapping.json"))
        members = set(package.getnames())
        for names in mapping.values():
            canonical = next((name for name in names if "package/src/icons/" + name + ".svg" in members), None)
            if canonical is None:
                raise ValueError(f"Codicon glyph absent: {names}")
            svg = package.extractfile("package/src/icons/" + canonical + ".svg").read().decode().strip()
            document = ET.fromstring(svg)
            if document.tag != "{http://www.w3.org/2000/svg}svg" or "currentColor" not in svg:
                raise ValueError(f"invalid Codicon SVG contract: {canonical}")
            glyphs[canonical] = svg
            for name in names:
                if name in aliases:
                    raise ValueError(f"duplicate Codicon alias: {name}")
                aliases[name] = canonical
        for name in ["LICENSE", "LICENSE-CODE"]:
            (attribution / name).write_bytes(package.extractfile("package/" + name).read())
    reference = (source / "product-icons.html").read_bytes()
    table = ProductTable()
    table.feed(reference.decode())
    products = {row[1]: row[2] for row in table.rows if len(row) == 4 and row[1] and row[2]}
    if not products:
        raise ValueError("product icon mapping is empty")
    for name, glyph in products.items():
        if glyph not in aliases:
            raise ValueError(f"unresolved product icon: {name} -> {glyph}")
        aliases[name] = aliases[glyph]
    for name, value in [("codiconAliases.json", aliases), ("codiconGlyphs.json", glyphs)]:
        (root / "src" / name).write_text(json.dumps(value, sort_keys=True, indent=2) + "\n")
    provenance = {"package": manifest["name"], "version": manifest["version"],
                  "tarball": metadata["dist"]["tarball"], "integrity": metadata["dist"]["integrity"],
                  "product_reference": "https://code.visualstudio.com/api/references/icons-in-labels",
                  "product_reference_sha256": hashlib.sha256(reference).hexdigest(),
                  "aliases": len(aliases), "glyphs": len(glyphs), "product_aliases": len(products)}
    (attribution / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(json.dumps(provenance))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    args = parser.parse_args()
    compile_assets(args.source_dir, Path(__file__).resolve().parents[1])
