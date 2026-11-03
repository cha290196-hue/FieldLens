"""Measure model inference time using a single local image."""

import argparse
import json
import statistics
from pathlib import Path

from export_models import load_detector


def main():
    parser = argparse.ArgumentParser(description="Measure local inference time")
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--runs", type=int, default=30)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--output", type=Path, default=Path("benchmark.json"))
    args = parser.parse_args()
    if not args.model.is_file() or not args.image.is_file():
        raise FileNotFoundError("The model and image must exist")
    if args.runs < 1 or args.warmup < 0:
        parser.error("runs must be positive and warmup cannot be negative")

    model = load_detector(args.model.resolve())
    timings = []
    for i in range(args.runs + args.warmup):
        result = model.predict(source=str(args.image), device=args.device,
                               imgsz=640, verbose=False)[0]
        if i >= args.warmup:
            timings.append(float(result.speed["inference"]))

    ordered = sorted(timings)
    report = {
        "device": args.device,
        "input_size": 640,
        "warmup_runs": args.warmup,
        "measured_runs": args.runs,
        "mean_inference_ms": round(statistics.mean(timings), 2),
        "median_inference_ms": round(statistics.median(timings), 2),
        "p95_inference_ms": round(ordered[max(0, (95 * len(ordered) + 99) // 100 - 1)], 2),
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
