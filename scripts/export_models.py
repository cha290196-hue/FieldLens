"""Export local detection weights for the browser runtime."""

import argparse
import json
import shutil
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Prepare browser models")
    parser.add_argument("--disease", required=True, type=Path)
    parser.add_argument("--pest", required=True, type=Path)
    parser.add_argument("--output", default=Path("dist/models"), type=Path)
    args = parser.parse_args()

    from ultralytics import YOLO

    args.output.mkdir(parents=True, exist_ok=True)
    for key in ("disease", "pest"):
        weight = getattr(args, key).resolve()
        if not weight.is_file():
            raise FileNotFoundError(f"Missing {key} weights: {weight}")
        model = YOLO(str(weight), task="detect")
        labels = model.names
        if isinstance(labels, dict):
            labels = [labels[k] for k in sorted(labels, key=int)]
        if not labels or not all(isinstance(x, str) for x in labels):
            raise ValueError(f"Invalid class names in {key} model")
        exported = Path(model.export(format="onnx", imgsz=640, opset=17, simplify=False, dynamic=False, nms=False, device="cpu"))
        destination = args.output / f"{key}.onnx"
        shutil.copyfile(exported, destination)
        (args.output / f"{key}.json").write_text(json.dumps({"labels": labels}, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Prepared {key}: {len(labels)} classes, {destination.stat().st_size / 1024 / 1024:.1f} MiB")


if __name__ == "__main__":
    main()
