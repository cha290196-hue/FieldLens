"""Run local object detection on an image or video."""

import argparse
from pathlib import Path

from export_models import load_detector


def main():
    parser = argparse.ArgumentParser(description="Run local object detection")
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--confidence", type=float, default=0.25)
    parser.add_argument("--output", type=Path, default=Path("results"))
    args = parser.parse_args()

    if not args.model.is_file() or not args.input.is_file():
        raise FileNotFoundError("The model and input file must exist")
    load_detector(args.model.resolve()).predict(
        source=str(args.input), device=args.device, conf=args.confidence,
        imgsz=640, save=True, project=str(args.output), name="detect", exist_ok=True,
    )


if __name__ == "__main__":
    main()
