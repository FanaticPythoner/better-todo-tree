"""Build indexed contact sheets from retained native editor screenshots."""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import io
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def select_rows(run: Path, replacement_runs: list[Path]) -> tuple[list[dict], list[dict]]:
    """Select original flows and explicit successful reruns with matching runtime identity."""
    digest = json.loads((run / "host.json").read_text())["vsix_sha256"]
    selected: dict[str, dict] = {}
    sources = []
    for index, source_run in enumerate([run, *replacement_runs]):
        if json.loads((source_run / "host.json").read_text())["vsix_sha256"] != digest:
            raise ValueError(f"VSIX digest mismatch: {source_run}")
        receipt = source_run / "flow_results.jsonl"
        sources.append({"path": str(receipt), "sha256": hashlib.sha256(receipt.read_bytes()).hexdigest()})
        for line in receipt.read_text().splitlines():
            row = json.loads(line)["flow_result"]
            previous = selected.get(row["flow_id"])
            if index == 0 and previous is not None:
                raise ValueError(f"duplicate primary flow: {row['flow_id']}")
            if index > 0 and (previous is None or
                              row["status"] != "passed" or previous["parameters"] != row["parameters"]):
                raise ValueError(f"invalid replacement flow: {row['flow_id']}")
            row["evidence_root"] = str(source_run / "evidence" / row["flow_id"])
            selected[row["flow_id"]] = row
    return list(selected.values()), sources


def render_rulers(run: Path, rows: list[dict]) -> None:
    """Rotate native ruler canvases into labeled rows without resampling."""
    groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        groups[row["parameters"]["theme"]].append(row)
    output = run / "ruler-gallery"
    output.mkdir(exist_ok=True)
    manifest = []
    font = ImageFont.load_default(size=14)
    for theme, cases in groups.items():
        canvases = []
        for row in cases:
            source = Path(row["evidence_root"]) / "observed.json"
            observed = json.loads(source.read_text())
            prefix, payload = observed["ruler"].split(",", 1)
            if prefix != "data:image/png;base64":
                raise ValueError(f"invalid ruler encoding: {source}")
            data = base64.b64decode(payload, validate=True)
            canvas = Image.open(io.BytesIO(data)).convert("RGBA").transpose(Image.Transpose.ROTATE_90)
            canvases.append((row, source, data, canvas, observed["themeBackground"]))
        width = max(item[3].width for item in canvases) + 410
        height = max(item[3].height for item in canvases) + 10
        sheet = Image.new("RGB", (width, height * len(canvases) + 30), "white")
        draw = ImageDraw.Draw(sheet)
        draw.text((8, 6), f"{theme} | ruler top at left | 90-degree rotation | no resampling", font=font, fill="black")
        members = []
        for index, (row, source, data, canvas, background) in enumerate(canvases):
            y = 30 + index * height
            label = f"{row['parameters']['mode']} | {row['parameters']['profile']}"
            draw.text((8, y + 3), label, font=font, fill="black")
            draw.rectangle((400, y, width, y + height - 1), fill=background)
            sheet.paste(canvas, (400, y + 5), canvas)
            members.append({"flow_id": row["flow_id"], "source": str(source),
                            "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                            "png_sha256": hashlib.sha256(data).hexdigest()})
        filename = f"{theme}.png"
        sheet.save(output / filename)
        manifest.append({"sheet": filename, "members": members})
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def render(run: Path, replacement_runs: list[Path], output_root: Path) -> None:
    """Render every completed visual flow without replacing source images."""
    rows, sources = select_rows(run, replacement_runs)
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows:
        groups[(row["parameters"]["theme"], row["parameters"]["mode"])].append(row)
    output = output_root / "gallery"
    output.mkdir(parents=True, exist_ok=True)
    (output_root / "selection.json").write_text(json.dumps({
        "sources": sources,
        "flows": [{key: row[key] for key in ["flow_id", "parameters", "status", "evidence_root"]}
                  for row in rows],
    }, indent=2) + "\n")
    font = ImageFont.load_default(size=20)
    manifest = []
    links = []
    for number, ((theme, mode), cases) in enumerate(groups.items(), 1):
        sources = [(row, Path(row["evidence_root"]) / "highlights.png") for row in cases]
        images = [(row, path, Image.open(path).convert("RGB")) for row, path in sources]
        width = max(image.width for _, _, image in images)
        height = max(image.height for _, _, image in images) + 34
        sheet = Image.new("RGB", (width * 2, height * ((len(images) + 1) // 2)), "white")
        draw = ImageDraw.Draw(sheet)
        members = []
        for index, (row, path, image) in enumerate(images):
            x, y = (index % 2) * width, (index // 2) * height
            label = f"{theme} | {mode} | {row['parameters']['profile']} | {row['status']}"
            draw.text((x + 8, y + 6), label, font=font, fill="black")
            sheet.paste(image, (x, y + 34))
            members.append({"flow_id": row["flow_id"], "parameters": row["parameters"],
                            "path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        filename = f"{number:02d}-{theme}-{mode.replace(':', '-').replace(',', '-')}.png"
        sheet.save(output / filename)
        manifest.append({"sheet": filename, "members": members})
        links.append(f'<h2>{html.escape(theme)} / {html.escape(mode)}</h2>'
                     f'<a href="{filename}"><img src="{filename}" alt="Native highlight cases" loading="lazy"></a>')
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (output / "index.html").write_text(
        '<!doctype html><meta charset="utf-8"><title>Native highlight evidence</title>'
        '<style>body{font:16px sans-serif;max-width:1600px;margin:auto;padding:20px}img{width:100%}</style>'
        '<h1>Native highlight evidence</h1>' + ''.join(links)
    )
    render_rulers(output_root, rows)
    print(json.dumps({"flows": len(rows), "sheets": len(manifest), "gallery": str(output)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    parser.add_argument("--replacement-run", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    render(args.run.resolve(), [path.resolve() for path in args.replacement_run],
           (args.output or args.run).resolve())
