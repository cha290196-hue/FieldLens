"""Reproducible small-sample PlantDoc TEST evaluation and inference-only CPU timing."""
import argparse, csv, hashlib, io, json, platform, random, re, statistics, sys, time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_models import load_detector

REPO = "pratikkayal/PlantDoc-Object-Detection-Dataset"
CSV_URL = f"https://raw.githubusercontent.com/{REPO}/master/test_labels.csv"

def norm(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())

def class_id(label, names):
    inverse = {norm(value): int(index) for index, value in names.items()}
    key = norm(label)
    if key in inverse:
        return inverse[key]
    aliases = {
        "cornrustleaf": ["cornrust", "corncommonrust"],
        "cornleafblight": ["cornleafblight", "cornnorthernleafblight"],
        "corngrayleafspot": ["corngrayleafspot"],
        "tomatoearlyblightleaf": ["tomatoearlyblight"],
        "tomatoleaflateblight": ["tomatolateblight"],
        "tomatoleafbacterialspot": ["tomatobacterialspot"],
        "tomatoseptorialeafspot": ["tomatoseptorialeafspot"],
        "tomatomoldleaf": ["tomatoleafmold", "tomatomold"],
        "tomatoleafmosaicvirus": ["tomatomosaicvirus"],
    }
    values = set(inverse[k] for k in aliases.get(key, []) if k in inverse)
    return next(iter(values)) if len(values) == 1 else None

def download(url):
    last = None
    for i in range(3):
        try:
            with urlopen(url, timeout=25) as response:
                return response.read()
        except Exception as exc:
            last = exc
            time.sleep(i + 1)
    raise RuntimeError(f"{url}: {last}")

def bench(model, path, out, name, device, runs):
    results = []
    for image in path:
        try:
            result = model.predict(str(image), imgsz=640, device=device, conf=.25, verbose=False)[0]
            item = {"image": str(image), "detections": len(result.boxes),
                    "classes": [model.names[int(x)] for x in result.boxes.cls.tolist()[:15]]}
            results.append(item)
            if image == path[0]:
                result.save(filename=str(out / f"{name}_detections.jpg"))
        except Exception as exc:
            results.append({"image": str(image), "error": repr(exc)})
    if not path:
        return {"status": "no_example_images"}
    try:
        for _ in range(3):
            model.predict(str(path[0]), imgsz=640, device=device, verbose=False)
        timings = [float(model.predict(str(path[0]), imgsz=640, device=device, verbose=False)[0].speed["inference"]) for _ in range(runs)]
        return {"status": "completed", "device": device, "runs": runs, "warmup": 3,
                "mean_ms": round(statistics.mean(timings), 2),
                "median_ms": round(statistics.median(timings), 2),
                "min_ms": round(min(timings), 2), "max_ms": round(max(timings), 2),
                "examples": results}
    except Exception as exc:
        return {"status": "failed", "error": repr(exc), "examples": results}

def plantdoc_test(model, out, limit, seed, device):
    rows = list(csv.DictReader(io.StringIO(download(CSV_URL).decode("utf-8-sig"))))
    names = {int(i): str(v) for i, v in model.names.items()}
    mapping = {r["class"]: class_id(r["class"], names) for r in rows}
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["filename"]].append(row)
    candidates = [(f, group) for f, group in grouped.items()
                  if all(mapping[x["class"]] is not None for x in group)]
    random.Random(seed).shuffle(candidates)
    candidates = candidates[:limit]
    root = out / "plantdoc"
    image_dir = root / "images" / "test"
    label_dir = root / "labels" / "test"
    image_dir.mkdir(parents=True, exist_ok=True)
    label_dir.mkdir(parents=True, exist_ok=True)
    evidence, errors = [], []
    for filename, group in candidates:
        source = f"https://raw.githubusercontent.com/{REPO}/master/TEST/{quote(filename, safe='')}"
        try:
            raw = download(source)
            with Image.open(io.BytesIO(raw)) as im:
                im.verify()
            target = hashlib.sha256(filename.encode()).hexdigest()[:14] + ".jpg"
            labels = []
            for row in group:
                w, h = float(row["width"]), float(row["height"])
                x0, y0 = max(0., float(row["xmin"])), max(0., float(row["ymin"]))
                x1, y1 = min(w, float(row["xmax"])), min(h, float(row["ymax"]))
                if x1 > x0 and y1 > y0:
                    labels.append(f'{mapping[row["class"]]} {(x0+x1)/(2*w):.6f} {(y0+y1)/(2*h):.6f} {(x1-x0)/w:.6f} {(y1-y0)/h:.6f}')
            if not labels:
                continue
            (image_dir / target).write_bytes(raw)
            (label_dir / (Path(target).stem + ".txt")).write_text("\n".join(labels)+"\n",encoding="utf-8")
            evidence.append({"original_file":filename,"sha256":hashlib.sha256(raw).hexdigest(),
                             "boxes":len(labels),"classes":sorted({row["class"] for row in group})})
        except Exception as exc:
            errors.append({"file":filename,"error":repr(exc)})
    summary = {
        "source": CSV_URL, "split":"official TEST", "seed":seed, "limit":limit,
        "matched_classes":{k:{"id":v,"name":names[v]} for k,v in mapping.items() if v is not None},
        "unmatched_classes":sorted(k for k,v in mapping.items() if v is None),
        "eligible_images":len([1 for g in grouped.values() if all(mapping[x["class"]] is not None for x in g)]),
        "downloaded_images":len(evidence), "annotated_objects":sum(e["boxes"] for e in evidence),
        "sample_evidence":evidence, "download_errors":errors
    }
    if len(evidence) < 5:
        summary["status"] = "skipped_insufficient_class_matched_images"
        return summary
    import yaml
    config = root / "test.yaml"
    config.write_text(yaml.safe_dump({"path":str(root.resolve()),"test":"images/test",
        "val":"images/test","names":names},sort_keys=False), encoding="utf-8")
    try:
        metrics = model.val(data=str(config),split="test",device=device,batch=4,imgsz=640,
                            workers=0,verbose=False,plots=False,project=str(out),name="plantdoc",exist_ok=True)
        summary.update({"status":"evaluated","precision":float(metrics.box.mp),
            "recall":float(metrics.box.mr),"map50":float(metrics.box.map50),
            "map50_95":float(metrics.box.map)})
    except Exception as exc:
        summary.update({"status":"failed","error":repr(exc)})
    return summary

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--disease",required=True,type=Path)
    p.add_argument("--pest",required=True,type=Path)
    p.add_argument("--samples",type=int,default=64)
    p.add_argument("--runs",type=int,default=25)
    p.add_argument("--device",default="cpu")
    args=p.parse_args()
    out=Path("evaluation/quick")
    out.mkdir(parents=True,exist_ok=True)
    report={"date_utc":datetime.now(timezone.utc).isoformat(),
            "hardware":{"platform":platform.platform(),"processor":platform.processor(),"device":args.device},
            "notes":["Exploratory small-sample evaluation: not whole-model accuracy.",
                     "PlantDoc TEST overlap with checkpoint training data cannot be excluded.",
                     "Only class-matched PlantDoc images evaluated; other classes not assessed.",
                     "Pest mAP not evaluated without compatible independent bounding-box labels.",
                     "CPU timing is on a GitHub Actions runner, not an end-user GPU or browser."]}
    for name,weight,pattern in [("disease",args.disease,"0[12]-*.jpg"),("pest",args.pest,"0[34]-*.jpg")]:
        model=load_detector(weight.resolve())
        report[name]={"model_sha256":hashlib.sha256(weight.read_bytes()).hexdigest(),
                      "classes":len(model.names),"class_names":list(model.names.values())}
        print(name,"model_classes:",model.names,flush=True)
        report[name]["benchmark"]=bench(model,sorted(Path("examples").glob(pattern)),out,name,args.device,args.runs)
        if name=="disease":
            try:
                report[name]["plantdoc"]=plantdoc_test(model,out,args.samples,20261103,args.device)
            except Exception as exc:
                report[name]["plantdoc"]={"status":"failed","error":repr(exc)}
        (out/"metrics.json").write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding="utf-8")
    disease=report["disease"]
    pest=report["pest"]
    met=disease.get("plantdoc",{})
    fmt=lambda key: f'{met[key]:.4f}' if key in met else "not measured"
    md=["# FieldLens quick evaluation", "",
        "> Exploratory test only. This is not a full independent benchmark.", "",
        "| Model | Classes | CPU inference mean (ms) | Precision | Recall | mAP50 | mAP50-95 |",
        "|---|---:|---:|---:|---:|---:|---:|"]
    for n,m in [("Disease",disease),("Pest",pest)]:
        is_d=n=="Disease"
        md.append(f'| {n} | {m["classes"]} | {m["benchmark"].get("mean_ms","n/a")} | ' +
                  " | ".join([fmt(k) if is_d else "not measured" for k in ["precision","recall","map50","map50_95"]]) + " |")
    md+=["",f'Disease matched sample count: **{met.get("downloaded_images",0)}**',
         f'Disease evaluation status: **{met.get("status","not run")}**',"",
         "## Interpretation and limitations","",*["- "+s for s in report["notes"]],"",
         "See metrics.json for model hashes, matching classes, sample filenames, image hashes and errors.",""]
    (out/"report.md").write_text("\n".join(md),encoding="utf-8")
    print("\n".join(md),flush=True)

if __name__=="__main__":
    main()
