"""Scale native notebook screenshots for label recognition."""

import argparse
from pathlib import Path

from PIL import Image, ImageOps


def prepare(path: Path, surface: str) -> None:
    """Scale notebook colors or threshold monochrome workbench labels."""
    with Image.open(path) as source:
        projected = source
        if surface == "workbench":
            grayscale = ImageOps.invert(source.convert("RGB")).convert("L")
            histogram = grayscale.histogram()
            background = max(range(256), key=histogram.__getitem__)
            projected = grayscale.point(lambda value: 255 if value > background - 20 else 0)
        projected.resize((source.width * 2, source.height * 2)).save(path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("--surface", choices=["notebook", "workbench"], required=True)
    arguments = parser.parse_args()
    prepare(arguments.image, arguments.surface)
