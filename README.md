<p align="center"><img src="assets/cover.svg" alt="FieldLens" width="100%"></p>

<p align="center">
<a href="https://cha290196-hue.github.io/FieldLens/">Web Demo</a> ·
<a href="https://github.com/cha290196-hue/FieldLens/releases">Windows 安装程序</a> ·
<a href="https://github.com/cha290196-hue/FieldLens/actions">构建状态</a>
</p>

# FieldLens

作物病害分类、农业害虫检测、本地分析记录。

| 功能 | Web | Windows |
| :-- | :-- | :-- |
| 图片上传 | 支持 | 支持 |
| 视频当前帧分析 | 支持 | 支持 |
| 病害图像分类 | 14 种作物 / 38 类状态 | 59 种作物 / 387 类状态 |
| 害虫目标检测 | 102 类 | 102 类 |
| 作物类别筛选 | 支持 | 支持 |
| 类别概率与推理时间 | 支持 | 支持 |
| 检测框导出 PNG | 支持 | 支持 |
| 本地分析记录 | 浏览器 | 本机 |
| 权重下载 | 页面首次调用 | 首次调用时按需下载 |

病害模型输出整张图片的分类概率，不提供病斑检测框。害虫模型输出位置、类别与检测置信度。

## Web Demo

[打开网页](https://cha290196-hue.github.io/FieldLens/)

打开网页，选择病害分类或害虫检测，添加图片并运行。模型在浏览器本地执行；不使用图像推理服务器。首次运行需要加载模型文件；当 WebGPU 不可用时采用 WASM。

## Windows

[Windows 安装程序](https://github.com/cha290196-hue/FieldLens/releases)

下载并运行名为 **FieldLens-Setup-2.0.0-x64.exe** 的 NSIS 安装程序。支持安装目录选择、桌面快捷方式和卸载。Windows 10/11 x64。

安装程序不包含模型权重。首次调用某模型时下载对应 ONNX 文件，并检查 SHA-256；后续使用缓存。下载完成后可在离线状态使用已缓存的模型。安装程序未进行商业代码签名，Windows 可能显示 SmartScreen 提示。

## 模型与数据集

表中各项指标为对应模型的公开训练与验证记录，并非本项目独立复算的数据。不同模型的测试集和指标不可直接横向比较。

| 项目 | Web 病害分类 | Windows 病害分类 | 害虫检测 |
| --- | --- | --- | --- |
| 结构 | DINOv2 ViT-S/14 + 分类头 | DINOv2 ViT-B/14 + 分类头 | YOLO11s |
| 任务 | 图像分类 | 图像分类 | 目标检测 |
| 类别 | 38 | 387 | 102 |
| 数据集 | PlantVillage | PlantVillage、PlantWild v1/v2、多作物研究数据 | IP102 |
| 图像尺寸 | 224 × 224 | 224 × 224 | 640 × 640 |
| 推理权重 | ONNX（MatMul 动态量化，CPU 兼容） | ONNX 4-bit 权重量化 | ONNX |
| 权重体积 | 以构建输出为准 | 约 57.6 MB | 依导出文件而定 |

### Web 病害模型

**数据**：PlantVillage 彩色叶片照片约 54,305 张；训练 43,443 张、测试 10,862 张；按已识别的物理叶片组隔离重复叶片。

**训练**：DINOv2-Small 视觉特征提取器，使用 CLS token 与平均 patch token 拼接特征训练多项逻辑回归分类头。

| 测试 | Accuracy | Macro-F1 |
| --- | ---: | ---: |
| 浮点权重，PlantVillage 测试集 | 98.9% | 98.5% |
| 上游 INT8 ONNX，PlantVillage 测试集 | 98.7% | 98.1% |

当前 Web 部署采用不量化卷积算子的兼容量化版本。上述 INT8 成绩对应另一份上游导出的量化权重，不能视为当前兼容版本的独立验证结果。测试数据以干净背景的单片叶子照片为主，不代表野外复杂背景的表现。

### Windows 病害模型

**数据**：PlantVillage、PlantWild v1/v2 及多作物研究图像；训练集 238,028 张、测试集 28,328 张。公开的去近重复测试子集包含 27,900 张图像。

**训练**：DINOv2 ViT-B/14，先训练分类头再进行全模型微调，使用类别均衡采样、田间图片与图像增强。

| 测试集 | 数量 | Accuracy | Macro-F1 |
| --- | ---: | ---: | ---: |
| 去近重复测试子集 | 27,900 | 92.9% | 0.906 |
| 去近重复、已知作物 | 27,900 | 94.2% | 0.926 |
| PlantVillage 实验室照片 | 4,853 | 99.6% | 0.997 |
| 研究数据子集 | 20,144 | 94.0% | 0.926 |
| PlantWild 田间照片 | 2,983 | 74.7% | 0.744 |
| PlantWild 田间照片、已知作物 | 2,983 | — | 0.857 |

4-bit 权重量化版本在公开的 280 张抽查照片中，与 PyTorch 原始权重的 Top-1 分类结果一致比例为 99.6%。

### 害虫模型

**数据**：IP102，102 类农业害虫。模型训练说明使用约 34,000 张经过平衡处理的样本。

**训练**：YOLO11s，输入尺寸 640/896，训练 77 Epoch，训练设备 A100。

| 指标 | 训练集 | 验证集 |
| --- | ---: | ---: |
| Precision | 0.912 | 0.744 |
| Recall | 0.923 | 0.789 |
| mAP@0.5 | 0.941 | 0.815 |
| mAP@0.5:0.95 | 0.838 | 0.605 |

以上为公开权重的自报结果。不同地区、拍摄设备、光照及病害阶段可能影响实际表现。

### 数据范围

PlantVillage 主要包含受控拍摄的植物叶片；PlantWild 提供真实环境中的植物图像；IP102 面向农业害虫类别与检测。数据集类别体系与标注形式不同，不应将分类 Accuracy 与检测 mAP 比较。

关于模型许可证、模型来源和数据集授权条件，见 [第三方组件及许可](THIRD_PARTY_NOTICES.md)。

## 本地开发

Node.js 22 和 Python 3.11。

    npm install
    npm test
    npm run prepare-runtime

准备浏览器推理权重：

    python -m pip install torch==2.6.0 torchvision==0.21.0 "numpy<2.3" ultralytics==8.3.120 onnx==1.17.0
    python scripts/prepare_models.py
    python -m http.server 8000 --directory dist

浏览器打开 http://localhost:8000 。

Windows：

    python -m pip install pillow
    python scripts/make_icon.py
    npm run desktop:build

Windows 安装程序由 [Windows installer](https://github.com/cha290196-hue/FieldLens/actions/workflows/desktop.yml) 工作流在 Windows runner 上构建。Web Demo 由 [Web demo](https://github.com/cha290196-hue/FieldLens/actions/workflows/pages.yml) 构建并发布。

## 仓库结构

| 路径 | 内容 |
| --- | --- |
| `dist/` | Web UI、ONNX 推理和页面资源 |
| `desktop/` | Electron 窗口、模型缓存、文件校验 |
| `scripts/` | 模型导出、评估和构建 |
| `tests/` | 推理与分类单元测试 |
| `docs/` | 检测与验证记录 |
| `.github/workflows/` | Web 与 Windows 构建 |

历史版本与旧模型实验记录保留在 Git 提交历史中。
