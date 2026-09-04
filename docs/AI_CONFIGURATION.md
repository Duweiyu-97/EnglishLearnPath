# AI 配置说明

English Learning Path 的基础功能不依赖 AI。写作反馈和口语文字稿反馈只有在连接测试成功后才会启用。

## DeepSeek：只有 API Key 时怎么填

在“服务商预设”选择 **DeepSeek**，页面会自动填写：

- 接口地址：`https://api.deepseek.com`
- 模型名称：`deepseek-v4-flash`
- API Key：粘贴你在 DeepSeek 开放平台创建的 Key

然后点击“保存并测试连接”。程序会在基础地址后请求 `/chat/completions`。DeepSeek 可能调整可用模型名；如果自动填写的模型失效，请以 [DeepSeek 官方 API 文档](https://api-docs.deepseek.com/) 的当前说明为准。

## 其他云端 OpenAI 兼容 API

在“AI 与数据设置”中填写：

- 接口地址，例如 `https://api.openai.com/v1`
- 你自己的 API Key
- 该服务实际支持的模型名称

保存时，启动器会发出一次极短的对话请求用于连接测试，这可能产生极少量 API 费用。

## 本地模型

先在电脑上安装并启动能提供 OpenAI 兼容 `/v1/chat/completions` 接口的模型服务，再填写它的本地地址和模型名。例如某些服务可能使用 `http://127.0.0.1:11434/v1`，实际值以你所用软件的文档为准。

本项目不捆绑用于批改的文字大模型，也不会代替你启动文字模型服务。文字模型速度和内存占用取决于你的电脑、模型大小与推理软件。完整包另行内置 Whisper small.en 语音识别模型，它只负责本机音频转写，不负责作文或口语批改，也不使用这里的 API Key。

## 隐私与 Key

- API Key 使用 Windows 当前账户加密后保存在本机 `runtime-data/ai-credentials.dpapi`，同一副本重启自动恢复。留空并测试会复用同一接口地址已保存的 Key；换地址不会发送旧 Key。
- 服务商、接口地址和模型名称会写入绑定的本地数据文件，方便下次自动恢复；这些非敏感设置不会写进发布包。
- Key 不会进入浏览器本地存储、备份文件或日志。
- “断开并删除已保存配置”会删除加密文件。换电脑或 Windows 账户需重新输入；升级时保留私人 runtime-data 目录，分享时必须排除。
- DeepSeek V4 的测试与批改请求默认关闭思考模式，避免仅返回思考内容；不会将思考内容当作最终答案展示。
- 作文或口语文字稿会发送给你配置的服务商；发送前请阅读其隐私政策。
- 口语录音不会由本项目发送给配置的文字 AI。
- 浏览器语音转写不调用这里配置的 AI；Chrome/Edge 可能依据自身规则使用浏览器厂商的语音服务。

## 接口要求

当前版本使用 OpenAI 兼容的 Chat Completions JSON 结构：

- `POST {baseUrl}/chat/completions`
- Bearer Token 鉴权（本地服务可留空 Key）
- 响应应包含 `choices[0].message.content`

如果服务只支持完全不同的专有协议，需要自行添加适配器后才能使用。
