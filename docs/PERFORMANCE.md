# FieldLens · 性能与精度实测

> 2026-11-03 · 真实模型权重、真实样本、可复现实验。**本页不是模型整体准确率声明。**

## 测试结论

在 PlantDoc 官方 TEST 划分中的 26 张玉米病害图片（26 个标注框，3 个对应类别）上，病害模型的 **mAP@0.5 为 1.43%，mAP@0.5:0.95 为 0.47%**。这是外部小样本评估，表现偏弱，不能等同于全部 28 类病害的性能，更不能用训练集或合成示意图代替验证集。

| 测试项目 | 病害模型 | 虫害模型 |
| --- | ---: | ---: |
| 模型类别数 | 28 | 102 |
| 推理是否执行成功 | 是 | 是 |
| PlantDoc 小样本 | 26 张 / 3 类 | 不适用 |
| Precision | 35.30% | 未测定 |
| Recall | 8.33% | 未测定 |
| mAP@0.5 | **1.43%** | 未测定 |
| mAP@0.5:0.95 | **0.47%** | 未测定 |
| GitHub 云端 CPU 单张推理，第三次运行均值 | 61.89 ms | 150.43 ms |

### CPU 推理速度的重复运行

输入均为 640×640；每套模型每轮先预热 3 次，再计时 25 次；以下是 **Ultralytics 报告的模型推理阶段**耗时，不包括图像加载、后处理、模型下载、网页渲染或网络延迟。

| 运行 | 病害模型平均推理 | 虫害模型平均推理 | 说明 |
| --- | ---: | ---: | --- |
| [第一次](https://github.com/cha290196-hue/FieldLens/actions/runs/41630717620) | 24.25 ms | 80.01 ms | 未匹配到 PlantDoc 类别，精度未测成 |
| [第二次](https://github.com/cha290196-hue/FieldLens/actions/runs/41631141784) | 47.13 ms | 110.91 ms | 匹配到 26 张样本，评估配置失败 |
| [第三次](https://github.com/cha290196-hue/FieldLens/actions/runs/41631590784) | 61.89 ms | 150.43 ms | 26 张样本，评估成功 |

云端 CPU 的性能在不同运行间明显波动，不宜当作固定的 FPS，更不能直接代表用户设备的 GPU/WebGPU 性能。

## 测试来源、类别映射

数据： [PlantDoc Object Detection 官方仓库 TEST 集](https://github.com/pratikkayal/PlantDoc-Object-Detection-Dataset)；标注来自 [test_labels.csv](https://raw.githubusercontent.com/pratikkayal/PlantDoc-Object-Detection-Dataset/master/test_labels.csv)。仅通过 URL 获取少量对应图片；**没有下载完整数据集**。

| 外部标注类别 | 权重实际类别 |
| --- | --- |
| Corn rust leaf | Maize Rust |
| Corn leaf blight | Maize Blight |
| Corn Gray leaf spot | Maize Gray Leaf Spot |

类别名称映射有语义差异，尤其 “Corn leaf blight” 和模型中的 “Maize Blight” 不一定在更细粒度病理分类上完全等价。评估之前应由熟悉作物病害的人进一步确认；样本与权重的训练集是否重合也尚未验证。

第三次测试使用 26 张图片、26 个框。对照范围只覆盖这三个类别，不能推断其他类别的准确率或整体泛化性能。样本量小、类别不平衡、来源域变化都可能影响指标。

## 实际推理异常样例

在仓库 `examples/` 中的 4 张真实照片上执行了模型推理联调（**没有人工标注完整检测框，因此不计入 mAP**）：

- `01-rice-blast.jpg`：病害模型在默认置信度阈值 0.25 下未检测出目标
- `02-tomato-blight.jpg`：病害模型输出 `Tomato Healthy`，与样例描述不一致
- `03-rice-weevil.jpg`：虫害模型对同一附近区域产生两种类别结果（`rice water weevil` 和 `Deporaus marginatus Pascoe`）
- `04-aphid.jpg`：虫害模型输出 `Limacodidae`，与样例描述不一致

这些是具体的失败案例，不宜据此单独计算全体类别的准确率，但说明实际使用存在漏检、错检或类别冲突的风险。

## 复现

源码：[`scripts/quick_eval.py`](../scripts/quick_eval.py)；云端工作流：[`.github/workflows/quick-eval.yml`](../.github/workflows/quick-eval.yml)。GitHub 仓库中进入 **Actions → Quick evaluation → Run workflow**，可重复运行。报告文件和输出图片保存在相应运行的 Artifacts 中。

[第三次结果与图像证据（GitHub Actions Artifact）](https://github.com/cha290196-hue/FieldLens/actions/runs/41631590784/artifacts/13227834371)

- 运行环境：GitHub Actions Linux、Python 3.11、Ultralytics 8.3.120、PyTorch 2.6.0、CPU（测试日志显示 Intel Xeon Platinum 8573C）
- 病害权重 SHA-256：`d507f693b2ff1b8e0036f9b84fa9c6068d5931b40da720abf5d62d8833dd7281`
- 虫害权重 SHA-256：`810f0df179aec54f5d9762a11df4a147ff87ef79ca46649151914eeed260237f`
- 输入尺寸 640、PlantDoc 采样种子 `20261103`、样本上限 64（实际类别兼容样本 26）
- 置信度阈值 0.25 仅用于 4 张示例图的推理联调；Ultralytics `val()` 的 AP 计算使用验证器自身阈值设置

要准确评估虫害模型 102 类的检测精度，需要拿到带真实目标框的 **IP102 detection TEST** 子集，核对类别 ID、去重并排除训练集泄漏后再计算 mAP。分类图片加一个整图伪框不属于可靠的目标检测评估。

> **关键限制：** 此次结果是对现有系统的功能与小样本外部数据的实测记录，尚未构成“高准确率”“可用于农业诊断”或“全类别性能验证”的依据。
