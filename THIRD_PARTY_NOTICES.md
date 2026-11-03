# Third-party components and licences

The repository source code licence and the licences for pretrained models and datasets are separate. Model weights are not represented as trained within this repository.

| Component | Technical source | Licence / restriction |
| --- | --- | --- |
| DINOv2-Small plant-disease classification model | https://huggingface.co/rodynaemad/plant-disease-dinov2-small | CC BY-SA 4.0 according to model card; review full distribution terms |
| DINOv2 vision architecture | https://github.com/facebookresearch/dinov2 | Apache-2.0 |
| YOLO11s IP102 pest detector | https://huggingface.co/underdogquality/yolo11s-pest-detection | Model repository states MIT; Ultralytics tooling uses AGPL-3.0 or enterprise licence as applicable |
| 59-crop, 387-class DINOv2-B classifier | https://github.com/Vatsal2008/AgriSmart-AI | Training datasets include non-commercial restrictions; research and educational use only unless separately cleared |
| PlantVillage | https://huggingface.co/datasets/mohanty/PlantVillage | Review source dataset distribution terms |
| PlantWild v1/v2 | https://github.com/tqwei05/MVPDR | Dataset record notes non-commercial / no-derivatives terms |
| IP102 | https://github.com/xpwu95/IP102 | Review dataset terms prior to redistribution |
| ONNX Runtime Web | https://github.com/microsoft/onnxruntime | MIT |
| Electron | https://github.com/electron/electron | MIT |
| electron-builder | https://github.com/electron-userland/electron-builder | MIT |

The Web build downloads already-trained model weights, exports the pest weights to ONNX, and publishes the model files with the browser app. Windows fetches disease weights from its original distribution and pest ONNX from the Web deployment, verifies SHA-256, and stores them in a local cache.

Reported training/test metrics are reproduced in the README as model-specific measurements; they do not constitute independent FieldLens testing or guarantees of field accuracy.

Separate authorization may be needed for commercial use or redistribution. Anonymous presentation does not alter any third-party licence or attribution requirement.
