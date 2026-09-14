# Contributing

欢迎提交修复、无障碍改进、导入格式增强和通用学习工具。

提交 PR 前请确认：

- 不包含商业题库、课程讲义、受版权保护的录音或范文；
- 不包含 API Key、真实个人数据或本地备份；
- 示例材料由你原创，或具有清晰且兼容的开放许可；
- 前端无需安装依赖即可作为静态页面运行；
- `go test ./...`、`go vet ./...` 和 JavaScript 语法检查通过。
- 平台相关实现应放在带构建标签的独立文件中；macOS 改动不得替换或削弱 Windows 的 DPAPI、原生目录选择器、Whisper 构建和便携包校验。

Windows 完整包使用 `build-portable.ps1` 构建；macOS 12+ 通用包使用 `build-macos.sh` 构建。仓库的 GitHub Actions 会分别在 Windows 和 macOS runner 上验证这两条发布路径。

新功能应继续遵循“本地优先、AI 可选、内容由使用者负责”的边界。
