# 完整离线语音版

下载 **EnglishLearnPath-Windows-x64-Full-*.zip**，全部解压到有写入权限的普通文件夹，双击“启动学习中心.exe”。不要只下载 GitHub 的 Source code ZIP。Windows 10/11 x64；使用系统自带 Edge 或现代 Chrome；无需安装 Python、FFmpeg、VC 运行库或另外下载语音模型。

整包包含学习中心、CPU 版 whisper.cpp、Whisper small.en 英语模型。默认本地转写：录音结束后离线识别，音频不上传，不需要语音 API Key。深度批改仍按需使用用户自己的 DeepSeek 等文字接口。速度取决于电脑，建议至少 4 GB 内存；单段支持 8 分钟以内。请回听核对，模型可能产生误识别。

## 第三方版权

- whisper.cpp：Copyright (c) 2023-2026 The ggml authors，MIT。
- Whisper 模型：Copyright (c) 2022 OpenAI，MIT；ggml 转换模型来自 ggerganov/whisper.cpp。
- 详情及来源：根目录 THIRD_PARTY_NOTICES.md；完整许可原文、上游源码归档保留在包内 whisper/ 和 third-party/。
- 学习中心项目代码仍按根目录 AGPL-3.0 LICENSE 分发。第三方组件不属于本项目原创，与作者无隶属或背书关系。

包内不包含题库、个人练习、录音、API Key 或数据目录绑定。首次启动自行选择数据文件夹；学习数据保存在本地，升级时不要删除自己的数据目录。
