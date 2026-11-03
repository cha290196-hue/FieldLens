<p align="center"><img src="assets/cover.svg" alt="FieldLens 病虫害识别工作台" width="100%"></p>

<p align="center"><strong>一张图片，开启一次细致的田间观察。</strong></p>
<p align="center">病害识别 · 害虫检测 · 本地推理 · 结果记录</p>

---

FieldLens 是一款面向作物健康观察的轻量视觉工作台。选择识别方向，上传图片或视频，即可查看目标的位置、类别、置信度与处理耗时。图片和识别记录保存在当前设备上。

> 当前界面为开发预览；模型文件和推理引擎准备完成后才能进行实际识别。

## 工作台预览

<p align="center"><img src="docs/01-home.jpg" alt="智能检测工作台" width="100%"></p>

<table><tr><td width="50%"><img src="docs/02-input.jpg" alt="图片输入界面"><br><strong>图片输入</strong><br>拖放上传，或载入合成示例图。</td><td width="50%"><img src="docs/03-models.jpg" alt="模型中心界面"><br><strong>模型中心</strong><br>在病害识别与害虫检测之间切换。</td></tr></table>

<p align="center"><img src="docs/04-guide.jpg" alt="使用指南" width="100%"></p>

## 功能

| 功能 | 说明 |
| --- | --- |
| 病害识别 | 对支持类别的作物叶片进行定位与识别 |
| 害虫检测 | 定位图像中的目标，显示类别与置信度 |
| 图片与视频 | 图片单次分析；视频按可处理的帧逐帧分析 |
| 本地运行 | 推理在浏览器中执行，使用可用的计算后端 |
| 识别记录 | 在当前浏览器保存最近的识别摘要 |
| 导出画面 | 下载当前带检测框的图片或视频画面 |
| 评估工具 | 对有标注的数据计算 mAP、精确率与召回率 |

示例图为合成示意图，仅用于体验操作流程；模型性能应在独立、带标注的真实样本上评估。识别结果仅供辅助观察。

## 在本地运行

需要 Node.js 20 及以上；准备或评估模型时还需要 Python 3.11。

```bash
npm install --no-package-lock
npm run prepare-runtime
```

准备两个目标检测权重后，导出浏览器使用的模型：

```bash
pip install ultralytics==8.3.120 onnx==1.17.0
python scripts/export_models.py --disease models/disease.pt --pest models/pest.pt
python -m http.server 8000 --directory dist
```

浏览器打开 `http://localhost:8000`。首次加载模型需要等待；WebGPU 不可用时会尝试使用 WebAssembly。

## 模型评估

使用带边界框标注的数据集，并在数据配置中指定测试集：

```bash
python scripts/evaluate.py --model models/disease.pt --data dataset.yaml --split test --device cpu
```

结果输出到 `evaluation.json`。对测试集样本的数量、类别和采集条件应如实记录；不同数据集上的指标不能直接比较。

## 结构

```text
FieldLens/
├── dist/                 浏览器界面与推理逻辑
├── scripts/              模型导出、评估与本地推理
├── tests/                目标框解码和后处理检查
├── docs/                 项目界面截图
├── models/               本地模型文件位置
└── .github/workflows/    演示构建流程
```

## 校验

```bash
npm test
```

---

<p align="center"><sub>FIELDLENS &nbsp; / &nbsp; OBSERVE · UNDERSTAND · GROW</sub></p>
