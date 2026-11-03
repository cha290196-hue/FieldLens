"""Export local detection weights for the browser runtime."""

import argparse
import importlib
import json
import shutil
from unittest.mock import patch
from pathlib import Path


def load_detector(weight):
    """Restrict checkpoint deserialization to the model's known framework types."""
    import numpy as np
    import torch
    from ultralytics import YOLO

    # PyTorch's restricted loader rejects unknown globals. These classes are
    # the standard building blocks used by the supported detection models.
    safe_types = {
        "torch.nn.modules.activation": ["SiLU"],
        "torch.nn.modules.batchnorm": ["BatchNorm2d"],
        "torch.nn.modules.container": ["ModuleList", "Sequential"],
        "torch.nn.modules.conv": ["Conv2d"],
        "torch.nn.modules.linear": ["Identity"],
        "torch.nn.modules.loss": ["BCEWithLogitsLoss"],
        "torch.nn.modules.pooling": ["MaxPool2d"],
        "torch.nn.modules.upsampling": ["Upsample"],
        "ultralytics.nn.tasks": ["DetectionModel"],
        "ultralytics.nn.modules.block": ["Attention", "Bottleneck", "C2f", "C2PSA", "C3k", "C3k2", "DFL", "PSABlock", "SPPF"],
        "ultralytics.nn.modules.conv": ["Concat", "Conv", "DWConv"],
        "ultralytics.nn.modules.head": ["Detect"],
        "ultralytics.utils": ["IterableSimpleNamespace"],
        "ultralytics.utils.loss": ["BboxLoss", "DFLoss", "v8DetectionLoss"],
        "ultralytics.utils.tal": ["TaskAlignedAssigner"],
    }
    allowlist = [getattr(importlib.import_module(module), name)
                 for module, names in safe_types.items() for name in names]
    allowlist.extend([np.dtype, type(np.dtype("float64")), type(np.dtype("float32"))])
    # NumPy 1 and 2 expose this function through different module names.
    allowlist.append(np.core.multiarray.scalar)
    original_load = torch.load

    def restricted_load(*args, **kwargs):
        kwargs["weights_only"] = True
        return original_load(*args, **kwargs)

    with torch.serialization.safe_globals(allowlist), patch.object(torch, "load", restricted_load):
        return YOLO(str(weight), task="detect")


def main():
    parser = argparse.ArgumentParser(description="Prepare browser models")
    parser.add_argument("--disease", required=True, type=Path)
    parser.add_argument("--pest", required=True, type=Path)
    parser.add_argument("--output", default=Path("dist/models"), type=Path)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    for key in ("disease", "pest"):
        weight = getattr(args, key).resolve()
        if not weight.is_file():
            raise FileNotFoundError(f"Missing {key} weights: {weight}")
        model = load_detector(weight)
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
