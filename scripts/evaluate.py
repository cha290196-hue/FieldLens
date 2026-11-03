"""Evaluate a detection model against a labeled dataset."""

import argparse
import json
from pathlib import Path

from export_models import load_detector


def main():
    parser = argparse.ArgumentParser(description="Evaluate object detection")
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--split", choices=["test", "val"], default="test")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--output", type=Path, default=Path("evaluation.json"))
    args = parser.parse_args()

    model = load_detector(args.model.resolve())
    metrics = model.val(data=str(args.data), split=args.split, device=args.device, imgsz=640, verbose=False)
    report = {
        "split": args.split,
        "map_50": float(metrics.box.map50),
        "map_50_95": float(metrics.box.map),
        "precision": float(metrics.box.mp),
        "recall": float(metrics.box.mr),
        "speed_ms_per_image": {str(k): float(v) for k, v in metrics.speed.items()},
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
