# 构建与文件校验

| 项目 | 记录 |
| --- | --- |
| Web 模型构建 | https://github.com/cha290196-hue/FieldLens/actions/runs/41656328192 |
| Windows 安装器构建 | https://github.com/cha290196-hue/FieldLens/actions/runs/41656328278 |
| 主分支 Web 部署 | https://github.com/cha290196-hue/FieldLens/actions/runs/41657343076 |
| 主分支 Windows 发布 | https://github.com/cha290196-hue/FieldLens/actions/runs/41657342960 |

验证项目：单元测试、ONNX 模型类别清单、ONNX 权重 SHA-256、Windows x64 NSIS 安装器构建、GitHub Pages 部署。

| 权重 | 类别 | 构建产物大小 |
| --- | ---: | ---: |
| Web 病害 ONNX | 38 | 以当前构建结果为准 |
| Web 害虫 ONNX | 102 | 38,047,184 bytes |
| Windows 病害 ONNX 4-bit | 387 | 57,576,210 bytes |

Windows 安装程序：FieldLens-Setup-2.0.0-x64.exe，103,776,216 bytes。安装程序文件具有 Windows PE 标识。正式发布地址见仓库 Releases。

这些构建及推理格式检查不等于实际田间准确率验证；模型指标与数据来源见根目录 README。
