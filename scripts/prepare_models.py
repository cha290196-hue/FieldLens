"""Prepare verified browser inference assets."""
import argparse
import hashlib
import json
import shutil
import urllib.request
from pathlib import Path

from export_models import load_detector
from onnxruntime.quantization import QuantType, quantize_dynamic
import onnxruntime as ort

DISEASE_BASE = "https://huggingface.co/rodynaemad/plant-disease-dinov2-small/resolve/main/"
PEST_BASE = "https://huggingface.co/underdogquality/yolo11s-pest-detection/resolve/main/"


def download(url, destination, minimum):
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "FieldLens-build/2.0"})
    with urllib.request.urlopen(request, timeout=150) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)
    size = destination.stat().st_size
    if size < minimum:
        raise RuntimeError(f"Unexpected download size: {url} ({size})")
    return destination


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as src:
        for chunk in iter(lambda: src.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare(output):
    output.mkdir(parents=True, exist_ok=True)
    source = output.parent.parent / "_model_build"
    source.mkdir(exist_ok=True)

    config_path = download(DISEASE_BASE + "config.json", source / "disease-config.json", 100)
    original = download(
        DISEASE_BASE + "onnx/model_with_features.onnx",
        source / "disease-fp32.onnx", 65 * 1024 * 1024)
    model = output / "disease.onnx"
    quantize_dynamic(
        str(original), str(model),
        weight_type=QuantType.QInt8,
        op_types_to_quantize=["MatMul", "Gemm"]
    )
    try:
        ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
    except Exception:
        shutil.copyfile(original, model)
        ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
    config = json.loads(config_path.read_text(encoding="utf-8"))
    label_map = config.get("id2label", {})
    if not label_map:
        raise RuntimeError("Disease model lacks label mapping")
    keys = sorted(label_map, key=int)
    labels = [label_map[k] for k in keys]
    if len(labels) != 38:
        raise RuntimeError(f"Disease class count changed: {len(labels)}")
    disease_info = {
        "kind": "classification",
        "img_size": 224,
        "crop_pct": .875,
        "mean": [.485, .456, .406],
        "std": [.229, .224, .225],
        "labels": labels,
        "sha256": sha256(model),
        "size_bytes": model.stat().st_size
    }
    (output / "disease.json").write_text(
        json.dumps(disease_info, ensure_ascii=False, indent=2), encoding="utf-8")

    pest_weights = download(PEST_BASE + "best.pt", source / "pest.pt", 20 * 1024 * 1024)
    detector = load_detector(pest_weights)
    names = detector.names
    if isinstance(names, dict):
        names = [names[k] for k in sorted(names, key=int)]
    if len(names) != 102:
        raise RuntimeError(f"Pest class count changed: {len(names)}")
    exported = Path(detector.export(format="onnx", imgsz=640, opset=17,
                                     simplify=False, dynamic=False, nms=False, device="cpu"))
    destination = output / "pest.onnx"
    shutil.copyfile(exported, destination)
    pest_info = {
        "kind": "detection",
        "img_size": 640,
        "labels": names,
        "sha256": sha256(destination),
        "size_bytes": destination.stat().st_size
    }
    (output / "pest.json").write_text(
        json.dumps(pest_info, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "disease": {"bytes": model.stat().st_size, "sha256": disease_info["sha256"]},
        "pest": {"bytes": destination.stat().st_size, "sha256": pest_info["sha256"]}
    }, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("dist/models"))
    prepare(parser.parse_args().output)
