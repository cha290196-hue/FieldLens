# FieldLens detection-quality improvement

## Target and acceptance criteria

The requested target is **at least 90% mAP@0.5** on a held-out, labeled detection test set. This is **not** equivalent to 90% single-image confidence, classification accuracy, or precision at an arbitrarily high confidence threshold.

The existing FieldLens production weights have **not** been replaced. Any performance claim must state the measured dataset, task, model classes, split, sample counts and model hash. A three-class specialist is not evidence for overall 28-class or 102-class accuracy.

## Existing baseline

On 2026-11-03 the original disease model scored mAP50 **0.0143** and mAP50-95 **0.0047** in a preliminary evaluation of **26 PlantDoc TEST images** covering only Maize Blight, Maize Rust and Maize Gray Leaf Spot. The test set is small and class mappings are approximate.

[Prior real baseline run](https://github.com/cha290196-hue/FieldLens/actions/runs/41631590784) · [Baseline report](PERFORMANCE.md).

## First trained candidate: verified experiment (2026-11-03)

The first [12-epoch CPU training run](https://github.com/cha290196-hue/FieldLens/actions/runs/41634530999) completed successfully on a bounded three-class PlantDoc subset. The official TEST remained 26 images (26 labeled objects). After an exact-hash overlap audit, **three source TRAIN/VAL images identical to TEST images were excluded**. Training used 226 images and internal validation used 48.

| Metric (fixed 26-image maize TEST) | Original disease model (28 classes) | Specialist candidate (3 classes) |
| --- | ---: | ---: |
| mAP@0.5 | 1.40% | **65.77%** |
| mAP@0.5:0.95 | 0.43% | **30.03%** |
| Precision | 35.22% | 37.82% |
| Recall | 8.33% | **86.11%** |

**Not 90%.** The reduced three-class taxonomy, public small TEST set, repeated iterative inspection, lack of external unseen field data, and low precision prevent generalizing these numbers to FieldLens as a whole. The candidate's hash: `c12e6fc4e2e195bfcbd57db6ddb7a39fc86978e4370a9b4a15f8a0c7fdd48aef`.

[Download training curves, test plots, best.pt and the data manifest from GitHub Actions](https://github.com/cha290196-hue/FieldLens/actions/runs/41634530999/artifacts/13229953262).

## Implemented improvements

1. A separate `maize_experiment.py` workflow downloads **only bounded PlantDoc subsets**, not the full dataset.
2. Original official TRAIN is deterministically divided into internal TRAIN/VAL; the official TEST images remain held out.
3. Raw image SHA-256 is recorded. Identical TRAIN/TEST images are explicitly excluded from training, with the original TEST preserved. TRAIN/VAL duplicate hashes are also removed. Test download failures invalidate the evaluation.
4. Missing source files and inconsistent annotation dimensions are logged. Their handling is deterministic and explained in the dataset manifest.
5. Both the **original 28-class model** and the **trained 3-class maize candidate** are scored against exactly the same TEST images. No candidate is promoted to replace the original 28-class model solely because it improves on three classes.
6. The browser pest branch suppresses near-identical *conflicting* category boxes (IoU greater than 0.88), while preserving normal class-specific suppression for disease. Its unit tests are recorded in GitHub Actions.

## Reproduce the maize experiment

On a CPU or GPU workstation, with Python 3.11 and a recent Ultralytics/PyTorch installation:

```bash
python scripts/maize_experiment.py \
  --baseline models/disease.pt \
  --max-train 280 --epochs 12 --imgsz 512 --batch 8 --device cpu
```

Or inspect [GitHub Actions: Maize specialist benchmark](../actions/workflows/maize-benchmark.yml). Run outputs include original and candidate mAP, hashes, CSV training curves, per-class metrics, confusion matrices and candidate weights as workflow artifacts. No downloaded dataset or checkpoint from an external provider is silently substituted for the original.

The experiment may **fail the 90% target**, in which case do not claim success. A stronger result would require larger **representative** labeled external test sets for all classes, verified taxonomy, expert annotation review and reliable data splits; in general retraining or changing weights is necessary.

## Licensing

PlantDoc images: [official PlantDoc dataset (CC BY 4.0)](https://github.com/pratikkayal/PlantDoc-Object-Detection-Dataset). The experimental YOLO11 candidate uses Ultralytics' own pretrained assets and must be assessed for the applicable licensing obligations before distribution. The current live weights are not modified by this experiment.
