"""Optionally fine-tune a supported model with a local labeled dataset."""

import argparse
from pathlib import Path

from export_models import load_detector


def main():
    parser = argparse.ArgumentParser(description="Fine-tune a detection model")
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--output", type=Path, default=Path("training"))
    args = parser.parse_args()
    if not args.model.is_file() or not args.data.is_file():
        raise FileNotFoundError("The model and dataset configuration must exist")
    if args.epochs < 1 or args.batch < 1:
        parser.error("epochs and batch must be positive")

    model = load_detector(args.model.resolve())
    model.train(data=str(args.data.resolve()), epochs=args.epochs, batch=args.batch,
                imgsz=640, device=args.device, project=str(args.output), name="detect",
                exist_ok=False)


if __name__ == "__main__":
    main()
