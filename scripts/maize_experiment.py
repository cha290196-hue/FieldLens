"""Bounded, split-safe PlantDoc maize experiment; original 28/102-class models remain untouched."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import random
import statistics
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

from PIL import Image
import yaml

ROOT_URL = "https://raw.githubusercontent.com/pratikkayal/PlantDoc-Object-Detection-Dataset/master"
SOURCE_LABELS = (
    "Corn leaf blight",
    "Corn rust leaf",
    "Corn Gray leaf spot",
)
OUTPUT_NAMES = {0: "Maize Blight", 1: "Maize Rust", 2: "Maize Gray Leaf Spot"}
LABEL_ID = {name: i for i, name in enumerate(SOURCE_LABELS)}
EXPECTED_ORIGINAL_WEIGHTS = "d507f693b2ff1b8e0036f9b84fa9c6068d5931b40da720abf5d62d8833dd7281"


def fetch(url: str) -> bytes:
    error = None
    for retry in range(4):
        try:
            req = Request(url, headers={"User-Agent": "FieldLens-Research/1.0"})
            with urlopen(req, timeout=45) as response:
                return response.read()
        except Exception as exc:
            error = exc
            time.sleep(min(8, 1.5 * (retry + 1)))
    raise RuntimeError(f"Could not fetch {url}: {error}")


def read_split(split: str):
    content = fetch(f"{ROOT_URL}/{split.lower()}_labels.csv")
    rows = list(csv.DictReader(io.StringIO(content.decode("utf-8-sig"))))
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["filename"]].append(row)
    # Do not silently drop other labels within an image; those would become false negatives.
    eligible = [(name, boxes) for name, boxes in grouped.items()
                if all(r["class"] in LABEL_ID for r in boxes)]
    return eligible, hashlib.sha256(content).hexdigest(), len(grouped)


def prepare_one(record, source_split, output_split, root: Path):
    filename, rows = record
    raw = fetch(f"{ROOT_URL}/{source_split}/{quote(filename, safe='')}")
    digest = hashlib.sha256(raw).hexdigest()
    with Image.open(io.BytesIO(raw)) as image:
        image.verify()
    with Image.open(io.BytesIO(raw)) as image:
        width, height = image.size
    if min(width, height) < 16:
        raise ValueError(f"Image too small: {filename}")
    target = hashlib.sha256(f"{source_split}/{filename}".encode()).hexdigest()[:20]
    image_path = root / "images" / output_split / (target + ".jpg")
    label_path = root / "labels" / output_split / (target + ".txt")
    labels = []
    # PlantDoc sometimes records different original dimensions for boxes of one image.
    # Normalize each box using its own annotation coordinate system rather than
    # deleting a valid sample or treating pixel coordinates as image coordinates.
    inconsistent_size = len({(r["width"], r["height"]) for r in rows}) > 1
    for row in rows:
        source_w, source_h = float(row["width"]), float(row["height"])
        if min(source_w, source_h) <= 0:
            raise ValueError(f"Invalid annotation dimensions: {filename}")
        x0 = max(0., min(source_w, float(row["xmin"])))
        y0 = max(0., min(source_h, float(row["ymin"])))
        x1 = max(0., min(source_w, float(row["xmax"])))
        y1 = max(0., min(source_h, float(row["ymax"])))
        if x1 <= x0 or y1 <= y0:
            raise ValueError(f"Invalid bounding box: {filename}")
        labels.append(f'{LABEL_ID[row["class"]]} {(x0+x1)/(2*source_w):.7f} {(y0+y1)/(2*source_h):.7f} {(x1-x0)/source_w:.7f} {(y1-y0)/source_h:.7f}')
    # PIL conversion ensures files always match .jpg even if the source was PNG.
    with Image.open(io.BytesIO(raw)) as image:
        image.convert("RGB").save(image_path, quality=94, subsampling=0)
    label_path.write_text("\n".join(labels) + "\n", encoding="utf-8")
    return {"filename": filename, "partition": output_split, "raw_sha256": digest,
            "image_sha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
            "boxes": len(labels),
            "class_ids": sorted({LABEL_ID[r["class"]] for r in rows}),
            "width": width, "height": height,
            "annotation_dimensions_inconsistent": inconsistent_size}


def make_dataset(root: Path, max_train: int, seed: int, workers: int):
    train, train_hash, train_total = read_split("train")
    test, test_hash, test_total = read_split("test")
    rng = random.Random(seed)
    rng.shuffle(train)
    train = train[:max_train]
    rng.shuffle(test)  # Fixed order, but retain all eligible TEST files.
    # Partition exclusively within the official TRAIN set; never train or select on TEST.
    per_class = defaultdict(list)
    for item in train:
        per_class[LABEL_ID[item[1][0]["class"]]].append(item)
    assignments = []
    for kind, items in per_class.items():
        rng.shuffle(items)
        n_val = max(3, round(len(items) * .18))
        assignments.extend([(item, "val") for item in items[:n_val]])
        assignments.extend([(item, "train") for item in items[n_val:]])
    assignments.extend([(item, "test") for item in test])
    for folder in ["train", "val", "test"]:
        (root / "images" / folder).mkdir(parents=True, exist_ok=True)
        (root / "labels" / folder).mkdir(parents=True, exist_ok=True)
    done, errors = [], []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(prepare_one, record, "TEST" if split == "test" else "TRAIN", split, root):
                   (record[0], split) for record, split in assignments}
        for future in as_completed(futures):
            name, split = futures[future]
            try:
                done.append(future.result())
            except Exception as exc:
                errors.append({"file": name, "partition": split, "error": repr(exc)})
    # Missing source TRAIN files may be excluded only if explicitly recorded;
    # any missing TEST file invalidates the benchmark and must fail closed.
    (root / "download-errors.json").write_text(json.dumps(errors, indent=2), encoding="utf-8")
    errors_on_test = [x for x in errors if x["partition"] == "test"]
    if errors_on_test or len(errors) > max(2, int(len(train) * .02)):
        raise RuntimeError(f"Dataset integrity failure: {len(errors)} failed files, {len(errors_on_test)} in TEST")
    train_files = [item for item in done if item["partition"] in ("train", "val")]
    test_files = [item for item in done if item["partition"] == "test"]
    test_sha = {item["raw_sha256"] for item in test_files}
    leaked = [item for item in train_files if item["raw_sha256"] in test_sha]
    removed = []
    # Keep the full official TEST set. Remove offending TRAIN/VAL copies only.
    # Also ensure exact images cannot occur on both internal TRAIN and VAL.
    seen_internal = {}
    for item in sorted(train_files, key=lambda x: (x["partition"] != "val", x["filename"])):
        sha = item["raw_sha256"]
        if sha in test_sha or sha in seen_internal:
            removed.append({"filename": item["filename"], "partition": item["partition"],
                            "sha256": sha, "reason": "official_test_overlap" if sha in test_sha else "train_val_duplicate"})
            target = hashlib.sha256(f'TRAIN/{item["filename"]}'.encode()).hexdigest()[:20]
            (root / "images" / item["partition"] / (target + ".jpg")).unlink(missing_ok=True)
            (root / "labels" / item["partition"] / (target + ".txt")).unlink(missing_ok=True)
        else:
            seen_internal[sha] = item["partition"]
    excluded = {(item["partition"], item["filename"]) for item in removed}
    done = [item for item in done if (item["partition"], item["filename"]) not in excluded]
    train_sha = {item["raw_sha256"] for item in done if item["partition"] in ("train", "val")}
    assert not train_sha.intersection(test_sha), "TRAIN/TEST leakage after filtering"
    for folder in ["train", "val", "test"]:
        if sum(x["partition"] == folder for x in done) < 3:
            raise RuntimeError(f"Too few samples in {folder}")
    for folder in ["train", "val", "test"]:
        classes = Counter(i for x in done if x["partition"] == folder for i in x["class_ids"])
        print(f"{folder}: images={sum(x['partition']==folder for x in done)}, class coverage={dict(classes)}", flush=True)
    report = {"source": ROOT_URL, "source_license": "PlantDoc CC BY 4.0",
              "official_train_csv_sha256": train_hash,
              "official_test_csv_sha256": test_hash,
              "official_train_image_count": train_total,
              "official_test_image_count": test_total,
              "seed": seed, "max_train": max_train, "classes": OUTPUT_NAMES,
              "partitions": dict(Counter(x["partition"] for x in done)),
              "failed_non_test_files": errors,
              "excluded_leakage_files": removed,
              "exact_duplicate_train_test_exclusions": sum(x["reason"]=="official_test_overlap" for x in removed),
              "annotation_size_inconsistencies": sum(x["annotation_dimensions_inconsistent"] for x in done),
              "images": sorted(done, key=lambda x: (x["partition"], x["filename"])),
              "exact_duplicate_train_test_count_after_filter": len(train_sha & test_sha)}
    (root / "dataset-manifest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    config = {"path": str(root.resolve()), "train": "images/train",
              "val": "images/val", "test": "images/test", "names": OUTPUT_NAMES}
    config_path = root / "maize.yaml"
    config_path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    return config_path, report


def metrics_record(model, yaml_file: Path, destination: Path, device: str, kind: str):
    results = model.val(data=str(yaml_file), split="test", device=device,
                        imgsz=640, batch=4, workers=0, conf=0.001,
                        verbose=False, plots=True, save_json=False,
                        project=str(destination), name=kind, exist_ok=True)
    record = {"mAP50": float(results.box.map50), "mAP50_95": float(results.box.map),
              "precision": float(results.box.mp), "recall": float(results.box.mr),
              "per_class_mAP50_95": [float(x) for x in results.box.maps]}
    print(kind, json.dumps(record), flush=True)
    return record


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--baseline", type=Path, required=True)
    p.add_argument("--max-train", type=int, default=280)
    p.add_argument("--epochs", type=int, default=12)
    p.add_argument("--initial-model", type=Path, default=None,
                   help="Optional previously trained specialist checkpoint; must have same 3-class taxonomy")
    p.add_argument("--imgsz", type=int, default=512)
    p.add_argument("--batch", type=int, default=8)
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--seed", type=int, default=20261103)
    p.add_argument("--device", default="cpu")
    p.add_argument("--output", type=Path, default=Path("evaluation/maize-experiment"))
    args = p.parse_args()
    if args.epochs < 1 or args.max_train < 30:
        p.error("epochs must be positive and max-train >= 30")
    out = args.output
    out.mkdir(parents=True, exist_ok=True)
    weight_hash = hashlib.sha256(args.baseline.read_bytes()).hexdigest()
    if weight_hash != EXPECTED_ORIGINAL_WEIGHTS:
        raise RuntimeError("Baseline weights checksum mismatch")
    config, manifest = make_dataset(out / "dataset", args.max_train, args.seed, args.workers)

    # The 28-class baseline has the same class IDs 0,1,2 as the maize subset.
    from ultralytics import YOLO
    from export_models import load_detector
    baseline = load_detector(args.baseline.resolve())
    if [baseline.names[i] for i in range(3)] != list(OUTPUT_NAMES.values()):
        raise RuntimeError("Baseline maize class IDs changed; refuse invalid evaluation")
    baseline_config = out / "dataset" / "baseline-28.yaml"
    baseline_config.write_text(yaml.safe_dump({
        "path": str((out / "dataset").resolve()), "train": "images/train",
        "val": "images/val", "test": "images/test",
        "names": {int(k):str(v) for k,v in baseline.names.items()}},sort_keys=False), encoding="utf-8")

    summary = {"created_utc": datetime.now(timezone.utc).isoformat(),
               "model": "YOLO11n specialist, 3 maize classes",
               "initial_weight": str(args.initial_model) if args.initial_model else "yolo11n.pt",
               "epochs": args.epochs, "imgsz": args.imgsz, "batch": args.batch,
               "seed": args.seed, "baseline_sha256": weight_hash,
               "dataset_train_images": manifest["partitions"].get("train", 0),
               "dataset_validation_images": manifest["partitions"].get("val", 0),
               "dataset_test_images": manifest["partitions"].get("test", 0),
               "critical_limitations": [
                    "Only maize blight/rust/gray leaf spot; not a drop-in replacement for 28 classes.",
                    "TEST set is a small publicly known benchmark; cannot establish 90% general-field accuracy.",
                    "Class names and some annotations may be ambiguous; perform agronomist validation.",
                    "Duplicate official TRAIN photos are removed when their exact bytes match TEST photos.",
                    "The original public dataset may contain near duplicates; exact-hash check is not a perceptual dedup."]}
    summary["baseline"] = metrics_record(baseline, baseline_config, out, args.device, "baseline")
    del baseline

    if args.initial_model is not None:
        if not args.initial_model.is_file():
            raise FileNotFoundError(args.initial_model)
        summary["initial_weight_sha256"] = hashlib.sha256(args.initial_model.read_bytes()).hexdigest()
        candidate = YOLO(str(args.initial_model.resolve()))
        if [candidate.names[i] for i in range(3)] != list(OUTPUT_NAMES.values()) or len(candidate.names) != 3:
            raise RuntimeError("Initial specialist weight class taxonomy mismatch")
    else:
        candidate = YOLO("yolo11n.pt")
    candidate.train(data=str(config), epochs=args.epochs, imgsz=args.imgsz,
                    batch=args.batch, workers=2, device=args.device,
                    seed=args.seed, deterministic=True, patience=8,
                    mosaic=.5, mixup=0.0, degrees=8.0,
                    flipud=0.0, fliplr=0.5, optimizer="auto",
                    project=str(out), name="maize-train", exist_ok=True,
                    verbose=False, plots=True, amp=False)
    best = out / "maize-train" / "weights" / "best.pt"
    if not best.exists():
        raise RuntimeError("Training completed without best.pt")
    candidate = YOLO(str(best))
    summary["candidate"] = metrics_record(candidate, config, out, args.device, "candidate")
    summary["candidate_sha256"] = hashlib.sha256(best.read_bytes()).hexdigest()
    summary["delta_mAP50"] = summary["candidate"]["mAP50"] - summary["baseline"]["mAP50"]
    summary["target_90_met_on_external_test"] = summary["candidate"]["mAP50"] >= .90
    (out / "results.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    lines = ["# FieldLens maize specialist candidate", "",
             f'Test images: {summary["dataset_test_images"]} (official PlantDoc TEST, three maize classes).',
             f'Baseline 28-class mAP50: {summary["baseline"]["mAP50"]:.2%}.',
             f'Candidate 3-class mAP50: {summary["candidate"]["mAP50"]:.2%}.',
             f'Candidate mAP50-95: {summary["candidate"]["mAP50_95"]:.2%}.',
             f'Candidate precision: {summary["candidate"]["precision"]:.2%}.',
             f'Candidate recall: {summary["candidate"]["recall"]:.2%}.', "",
             "**Candidate is NOT deployed to the live 28-class system.**",
             "Do not advertise this test as whole-system accuracy or field diagnosis readiness.",
             "See results.json and dataset/dataset-manifest.json for provenance, splits and per-image SHA-256."]
    (out / "README.md").write_text("\n".join(lines)+"\n", encoding="utf-8")
    print("\n".join(lines), flush=True)


if __name__ == "__main__":
    main()
