"""Run one forward pass through each published ONNX model."""
import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort


def verify(name, classes, size):
    base = Path("dist/models")
    meta = json.loads((base / (name + ".json")).read_text(encoding="utf-8"))
    model_path = base / (name + ".onnx")
    assert len(meta["labels"]) == classes
    assert hashlib.sha256(model_path.read_bytes()).hexdigest() == meta["sha256"]
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    input_spec = session.get_inputs()[0]
    assert input_spec.shape == [1, 3, size, size], (name, input_spec.shape)
    value = np.zeros((1, 3, size, size), dtype=np.float32)
    outputs = dict(zip([x.name for x in session.get_outputs()], session.run(None, {input_spec.name: value})))
    if name == "disease":
        logits = outputs.get("logits")
        assert logits is not None and logits.shape == (1, classes), tuple((k, v.shape) for k, v in outputs.items())
        assert np.isfinite(logits).all()
    else:
        detection = next((v for v in outputs.values() if v.ndim == 3 and classes + 4 in v.shape), None)
        assert detection is not None, tuple((k, v.shape) for k, v in outputs.items())
        assert np.isfinite(detection).all()
    print(f"{name}: input={input_spec.shape} output={[(k, v.shape) for k, v in outputs.items()]}")


if __name__ == "__main__":
    verify("disease", 38, 224)
    verify("pest", 102, 640)
