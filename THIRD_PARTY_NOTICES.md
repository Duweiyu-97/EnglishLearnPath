# 第三方组件、模型与版权

English Learning Path 的项目代码遵循根目录 LICENSE（AGPL-3.0）。下列第三方组件保留各自的版权和许可证，不因打包而改为项目原创或统一改成 AGPL。

## whisper.cpp（本地语音推理引擎）

- 版权所有：Copyright (c) 2023-2026 The ggml authors。
- 许可证：MIT；完整包保留 `whisper/LICENSE-whisper.cpp.txt` 原文。
- 来源：https://github.com/ggml-org/whisper.cpp
- 固定源代码版本：`371b5a7561823ab2bb32142d2751e35e7534727b`（b4938 / v1.9.3）。
- 构建时不修改上游源代码；使用静态 CPU 构建选项。精确上游源码及其中嵌入的第三方许可保留在 `whisper/whisper.cpp-source.zip`。

## Whisper small.en（英语语音识别模型）

- 原始模型：OpenAI Whisper；Copyright (c) 2022 OpenAI。
- 许可证：MIT，原文见 `third-party/LICENSE-Whisper.txt`，完整包也在 `whisper/` 保留副本。
- 模型及权重许可来源：https://github.com/openai/whisper#license
- ggml 格式转换分发来源：https://huggingface.co/ggerganov/whisper.cpp （该仓库标注 MIT）。
- 文件：`ggml-small.en.bin`；SHA256：`c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d`。
- 本项目不训练该模型，也不主张其模型版权；模型为独立进程加载的数据文件。

## Markdown 显示组件

Marked 和 DOMPurify 的版本及许可证原文保留在 `app/vendor/`；请随程序一同分发，不移除原作者声明。

## 分发与边界

GitHub 源码仓库只提交集成代码、构建脚本和许可说明；引擎、权重由可复现构建流程打进完整 Release ZIP，不提交个人数据、录音、凭据或模型缓存。用户无需另外安装 Python、FFmpeg 或下载模型。需要 Windows 10/11 x64 和支持录音的现代浏览器。

本项目与 OpenAI、ggml 作者及其他组件作者无隶属或背书关系。第三方软件和模型按各自许可证“按原样”提供，转写可能出错，不能作为官方考试评分依据。
