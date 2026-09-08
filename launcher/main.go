package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	maxRequest    = 1 << 20
	maxAIRequest  = 48 << 20
	maxAIResponse = 4 << 20
	maxDataFile   = 128 << 20
	dataFilename  = "EnglishLearnPath-data.json"
	backupName    = "EnglishLearnPath-data.backup.json"
	configDirname = "runtime-data"
)

type aiConfig struct {
	BaseURL   string `json:"baseUrl"`
	APIKey    string `json:"apiKey"`
	Model     string `json:"model"`
	Connected bool   `json:"connected"`
}

type configStore struct {
	sync.RWMutex
	value     aiConfig
	path      string
	saved     bool
	restored  bool
	loadError string
}

type diskDataEnvelope struct {
	Version   int             `json:"version"`
	UpdatedAt string          `json:"updatedAt"`
	Data      json.RawMessage `json:"data"`
}

type launcherConfig struct {
	DataDirectory string `json:"dataDirectory"`
}

type diskStore struct {
	sync.RWMutex
	directory  string
	configPath string
	lastWrite  string
}

type chatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type chatRequest struct {
	Messages       []chatMessage `json:"messages"`
	Temperature    float64       `json:"temperature,omitempty"`
	MaxTokens      int           `json:"max_tokens,omitempty"`
	OutputContract string        `json:"output_contract,omitempty"`
}

type upstreamResponse struct {
	Choices []struct {
		FinishReason string `json:"finish_reason"`
		Message      struct {
			Content          any    `json:"content"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

var (
	settings   = &configStore{}
	client     = &http.Client{Timeout: 90 * time.Second}
	disk       *diskStore
	appVersion = "dev"
)

func main() {
	appDir, err := findResourceDir("app")
	if err != nil {
		writeStartupError(err)
		return
	}
	docsDir, _ := findResourceDir("docs")
	disk, err = newDiskStore()
	if err != nil {
		writeStartupError(fmt.Errorf("无法初始化永久数据目录：%w", err))
		return
	}
	settings.path = filepath.Join(filepath.Dir(disk.configPath), "ai-credentials.dpapi")
	settings.restore()

	// Let Windows assign a free loopback port. A fixed port can make a newly
	// extracted copy open an older copy that is already running, which would
	// expose that copy's local settings in the browser.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		writeStartupError(fmt.Errorf("无法启动本地服务：%w", err))
		return
	}
	appURL := "http://" + listener.Addr().String()

	mux := http.NewServeMux()
	registerAPI(mux)
	if docsDir != "" {
		mux.Handle("/docs/", http.StripPrefix("/docs/", http.FileServer(http.Dir(docsDir))))
	}
	mux.Handle("/", secureStaticServer(appDir))

	server := &http.Server{
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		time.Sleep(350 * time.Millisecond)
		_ = openBrowser(appURL)
	}()

	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		writeStartupError(fmt.Errorf("本地服务意外停止：%w", err))
	}
}

func registerAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/app/info", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"name": "English Learning Path", "version": appVersion, "local": true})
	})
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "app": "EnglishLearnPath"})
	})
	mux.HandleFunc("POST /api/app/shutdown", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		go func() {
			time.Sleep(250 * time.Millisecond)
			os.Exit(0)
		}()
	})
	mux.HandleFunc("GET /api/data/status", handleDataStatus)
	mux.HandleFunc("GET /api/data", handleDataLoad)
	mux.HandleFunc("PUT /api/data", handleDataSave)
	mux.HandleFunc("POST /api/data/select-directory", handleDataSelectDirectory)
	mux.HandleFunc("POST /api/data/open-directory", handleDataOpenDirectory)
	mux.HandleFunc("GET /api/ai/status", handleAIStatus)
	mux.HandleFunc("POST /api/ai/config", handleAIConfig)
	mux.HandleFunc("POST /api/ai/disconnect", handleAIDisconnect)
	mux.HandleFunc("POST /api/ai/chat", handleAIChat)
	mux.HandleFunc("GET /api/transcription/status", handleTranscriptionStatus)
	mux.HandleFunc("POST /api/transcription", handleTranscription)
}

func handleDataStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, disk.status())
}

func handleDataLoad(w http.ResponseWriter, _ *http.Request) {
	data, err := disk.load()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取本地数据失败："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data, "storage": disk.status()})
}

func handleDataSave(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxDataFile)
	var payload struct {
		Data json.RawMessage `json:"data"`
	}
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&payload); err != nil || len(payload.Data) == 0 {
		writeError(w, http.StatusBadRequest, "学习数据格式无效")
		return
	}
	if err := disk.save(payload.Data); err != nil {
		writeError(w, http.StatusInternalServerError, "写入本地文件失败："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"saved": true, "storage": disk.status()})
}

func handleDataSelectDirectory(w http.ResponseWriter, _ *http.Request) {
	selected, canceled, err := selectDirectory()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "打开文件夹选择器失败："+err.Error())
		return
	}
	if canceled {
		writeJSON(w, http.StatusOK, map[string]any{"canceled": true, "storage": disk.status()})
		return
	}
	loadedExisting, err := disk.switchDirectory(selected)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "绑定数据文件夹失败："+err.Error())
		return
	}
	data, err := disk.load()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取新数据文件夹失败："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"canceled":       false,
		"loadedExisting": loadedExisting,
		"data":           data,
		"storage":        disk.status(),
	})
}

func handleDataOpenDirectory(w http.ResponseWriter, _ *http.Request) {
	directory := disk.directoryPath()
	if directory == "" {
		writeError(w, http.StatusPreconditionFailed, "请先选择或创建永久数据文件夹")
		return
	}
	if runtime.GOOS != "windows" {
		writeError(w, http.StatusNotImplemented, "当前系统暂不支持从程序打开文件夹")
		return
	}
	if err := exec.Command("explorer.exe", directory).Start(); err != nil {
		writeError(w, http.StatusInternalServerError, "无法打开数据文件夹："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"opened": true})
}

func handleAIStatus(w http.ResponseWriter, _ *http.Request) {
	settings.RLock()
	defer settings.RUnlock()
	cfg := settings.value
	writeJSON(w, http.StatusOK, map[string]any{"connected": cfg.Connected, "model": cfg.Model, "baseUrl": cfg.BaseURL, "saved": settings.saved, "restored": settings.restored, "storageError": settings.loadError})
}

func handleAIConfig(w http.ResponseWriter, r *http.Request) {
	var proposed aiConfig
	if err := decodeJSON(w, r, &proposed); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	proposed.BaseURL = strings.TrimRight(strings.TrimSpace(proposed.BaseURL), "/")
	proposed.Model = strings.TrimSpace(proposed.Model)
	// Blank fields can reuse a saved key only for the exact same endpoint.
	settings.RLock()
	if proposed.APIKey == "" && proposed.BaseURL == settings.value.BaseURL {
		proposed.APIKey = settings.value.APIKey
	}
	settings.RUnlock()
	if err := validateConfig(proposed); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	testMessages := []chatMessage{
		{Role: "system", Content: "Reply with exactly: CONNECTED"},
		{Role: "user", Content: "Connection test"},
	}
	if _, err := callChat(r.Context(), proposed, testMessages, 0, 256, true); err != nil {
		writeError(w, http.StatusBadGateway, "模型连接测试失败："+err.Error())
		return
	}
	proposed.Connected = true
	settings.Lock()
	defer settings.Unlock()
	if err := settings.persist(proposed); err != nil {
		writeError(w, http.StatusInternalServerError, "连接测试成功，但无法加密保存到本地，请检查程序目录写入权限")
		return
	}
	settings.value = proposed
	settings.saved, settings.restored, settings.loadError = true, false, ""
	writeJSON(w, http.StatusOK, map[string]any{"connected": true, "model": proposed.Model, "saved": true})
}

func handleAIDisconnect(w http.ResponseWriter, _ *http.Request) {
	settings.Lock()
	defer settings.Unlock()
	if settings.path != "" {
		if err := os.Remove(settings.path); err != nil && !errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusInternalServerError, "无法删除本地保存的接口配置，请检查文件权限")
			return
		}
	}
	settings.value = aiConfig{}
	settings.saved, settings.restored, settings.loadError = false, false, ""
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func handleAIChat(w http.ResponseWriter, r *http.Request) {
	var input chatRequest
	if err := decodeJSONLimit(w, r, &input, maxAIRequest); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(input.Messages) == 0 || len(input.Messages) > 30 {
		writeError(w, http.StatusBadRequest, "messages 数量无效")
		return
	}
	hasImages := false
	for _, message := range input.Messages {
		if message.Role != "system" && message.Role != "user" && message.Role != "assistant" {
			writeError(w, http.StatusBadRequest, "消息角色无效")
			return
		}
		messageHasImages, err := validateChatContent(message)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		hasImages = hasImages || messageHasImages
	}
	settings.RLock()
	cfg := settings.value
	settings.RUnlock()
	if !cfg.Connected {
		writeError(w, http.StatusPreconditionFailed, "请先在设置页配置并测试 AI")
		return
	}
	if hasImages {
		base, _ := url.Parse(cfg.BaseURL)
		if base != nil && strings.EqualFold(base.Hostname(), "api.deepseek.com") {
			// DeepSeek accepts image content only on its dedicated vision model.
			// Switch just this request so saved text-model settings and keys keep
			// working for ordinary feedback.
			cfg.Model = "deepseek-v4-flash-vision-exp"
		}
	}
	maxTokens := input.MaxTokens
	if maxTokens <= 0 || maxTokens > 8000 {
		maxTokens = 6000
	}
	content, err := callChat(r.Context(), cfg, input.Messages, input.Temperature, maxTokens, false)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if err := validateOutputContract(content, input.OutputContract); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"content": content, "model": cfg.Model})
}

func validateOutputContract(content, contract string) error {
	if contract == "" || contract == "text" {
		return nil
	}
	trimmed := strings.TrimSpace(content)
	switch contract {
	case "study-plan-json-v1", "personal-language-bank-json-v1":
		trimmed = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(trimmed, "```json"), "```"))
		trimmed = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(trimmed, "```"), "```"))
		start, end := strings.Index(trimmed, "{"), strings.LastIndex(trimmed, "}")
		if start < 0 || end <= start {
			return errors.New("模型没有遵循网页所需的 JSON 输出格式，请重试或更换兼容模型")
		}
		var value map[string]any
		if err := json.Unmarshal([]byte(trimmed[start:end+1]), &value); err != nil {
			return errors.New("模型返回的 JSON 格式无效，请重试或更换兼容模型")
		}
		required := []string{"summary"}
		if contract == "study-plan-json-v1" {
			required = append(required, "priorities", "phases")
		} else {
			required = append(required, "speaking", "writing")
		}
		for _, key := range required {
			if _, ok := value[key]; !ok {
				return fmt.Errorf("模型返回的 JSON 缺少网页必需字段 %q，请重试或更换兼容模型", key)
			}
		}
		if _, ok := value["summary"].(string); !ok {
			return errors.New("模型返回的 JSON 字段 \"summary\" 必须是文字")
		}
		arrayKeys := []string{"speaking", "writing"}
		if contract == "study-plan-json-v1" {
			arrayKeys = []string{"priorities", "phases"}
		}
		for _, key := range arrayKeys {
			if _, ok := value[key].([]any); !ok {
				return fmt.Errorf("模型返回的 JSON 字段 %q 必须是数组", key)
			}
		}
		return nil
	case "review-markdown-v1-writing", "review-markdown-v1-speaking":
		required := []string{"### 评分与小分", "### 总体评价", "### 确定语法错误", "### 原文优化建议", "### 目标水平范文", "### 最终值得记忆的语料"}
		if contract == "review-markdown-v1-speaking" {
			required = append(required[:2], append([]string{"### 转写整理稿"}, required[2:]...)...)
		}
		if !strings.HasPrefix(trimmed, "主题：") {
			return errors.New("模型没有遵循网页报告格式，第一行必须是“主题：具体主题”")
		}
		position := -1
		for _, heading := range required {
			if strings.Count(content, heading) != 1 {
				return fmt.Errorf("模型没有遵循网页报告格式，缺少 %q；请重试或更换兼容模型", strings.TrimPrefix(heading, "### "))
			}
			next := strings.Index(content, heading)
			if next <= position {
				return errors.New("模型没有按网页所需顺序返回报告章节，请重试或更换兼容模型")
			}
			position = next
		}
		return nil
	default:
		return errors.New("不支持的 AI 输出格式约束")
	}
}

func validateChatContent(message chatMessage) (bool, error) {
	switch content := message.Content.(type) {
	case string:
		if len(content) > 120000 {
			return false, errors.New("单条消息过长")
		}
		return false, nil
	case []any:
		if message.Role != "user" {
			return false, errors.New("只有用户消息可以包含图片")
		}
		textLength, imageCount := 0, 0
		for _, rawPart := range content {
			part, ok := rawPart.(map[string]any)
			if !ok {
				return false, errors.New("消息内容块无效")
			}
			switch partType, _ := part["type"].(string); partType {
			case "text":
				text, ok := part["text"].(string)
				if !ok {
					return false, errors.New("文字内容块无效")
				}
				textLength += len(text)
			case "image_url":
				image, ok := part["image_url"].(map[string]any)
				imageURL, urlOK := image["url"].(string)
				if !ok || !urlOK || !validImageURL(imageURL) {
					return false, errors.New("图片内容块无效")
				}
				imageCount++
			default:
				return false, errors.New("不支持的消息内容块")
			}
		}
		if textLength > 120000 || imageCount > 6 {
			return false, errors.New("多模态消息内容过长或图片过多")
		}
		return imageCount > 0, nil
	default:
		return false, errors.New("消息内容无效")
	}
}

func validImageURL(value string) bool {
	lower := strings.ToLower(value)
	for _, prefix := range []string{"data:image/png;base64,", "data:image/jpeg;base64,", "data:image/jpg;base64,", "data:image/gif;base64,", "data:image/webp;base64,"} {
		if strings.HasPrefix(lower, prefix) {
			return len(value) > len(prefix)
		}
	}
	parsed, err := url.Parse(value)
	return err == nil && (strings.EqualFold(parsed.Scheme, "http") || strings.EqualFold(parsed.Scheme, "https")) && parsed.Host != ""
}

func callChat(ctx context.Context, cfg aiConfig, messages []chatMessage, temperature float64, maxTokens int, connectionTest bool) (string, error) {
	payload := map[string]any{
		"model":       cfg.Model,
		"messages":    messages,
		"temperature": temperature,
		"max_tokens":  maxTokens,
	}
	// DeepSeek V4 defaults to thinking mode. This text-feedback app uses chat
	// mode for both probes and reviews so the output budget reaches the answer.
	// Never send this provider-specific option to unrelated services.
	base, _ := url.Parse(cfg.BaseURL)
	if base != nil && strings.EqualFold(base.Hostname(), "api.deepseek.com") && strings.HasPrefix(strings.ToLower(cfg.Model), "deepseek-v4-") {
		payload["thinking"] = map[string]string{"type": "disabled"}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json")
	if cfg.APIKey != "" {
		request.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxAIResponse))
	if err != nil {
		return "", err
	}
	var parsed upstreamResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", fmt.Errorf("模型返回了无法解析的响应（HTTP %d）", response.StatusCode)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if parsed.Error != nil && parsed.Error.Message != "" {
			return "", fmt.Errorf("%s", parsed.Error.Message)
		}
		return "", fmt.Errorf("模型服务返回 HTTP %d", response.StatusCode)
	}
	if len(parsed.Choices) == 0 {
		return "", errors.New("模型响应中没有 choices")
	}
	content := extractContent(parsed.Choices[0].Message.Content)
	if strings.TrimSpace(content) == "" {
		if parsed.Choices[0].FinishReason == "length" {
			return "", errors.New("模型输出达到长度上限，尚未生成最终答案；这不是 API Key 无效的提示")
		}
		if strings.TrimSpace(parsed.Choices[0].Message.ReasoningContent) != "" {
			return "", errors.New("模型只返回了思考内容，没有最终答案；请检查模型的思考模式和输出限制")
		}
		return "", errors.New("模型没有返回文字内容")
	}
	return content, nil
}

func extractContent(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []any:
		var parts []string
		for _, item := range typed {
			if object, ok := item.(map[string]any); ok {
				if text, ok := object["text"].(string); ok {
					parts = append(parts, text)
				}
			}
		}
		return strings.Join(parts, "\n")
	default:
		return ""
	}
}

func validateConfig(cfg aiConfig) error {
	if cfg.BaseURL == "" || cfg.Model == "" {
		return errors.New("请填写接口地址和模型名称")
	}
	if len(cfg.BaseURL) > 2048 || len(cfg.APIKey) > 8192 || len(cfg.Model) > 200 {
		return errors.New("配置内容过长")
	}
	parsed, err := url.Parse(cfg.BaseURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return errors.New("接口地址必须是有效的 http 或 https 地址")
	}
	return nil
}

func newDiskStore() (*diskStore, error) {
	var configRoot string
	if override := strings.TrimSpace(os.Getenv("ENGLISH_LEARN_PATH_CONFIG_DIR")); override != "" {
		configRoot = override
	} else {
		executable, err := os.Executable()
		if err != nil {
			return nil, fmt.Errorf("无法定位启动器目录：%w", err)
		}
		configRoot = filepath.Join(filepath.Dir(executable), configDirname)
	}
	if err := os.MkdirAll(configRoot, 0700); err != nil {
		return nil, fmt.Errorf("无法创建便携配置目录 %s：%w", configRoot, err)
	}

	store := &diskStore{
		configPath: filepath.Join(configRoot, "config.json"),
	}
	if raw, readErr := os.ReadFile(store.configPath); readErr == nil {
		var saved launcherConfig
		if json.Unmarshal(raw, &saved) == nil && filepath.IsAbs(saved.DataDirectory) {
			candidate := filepath.Clean(saved.DataDirectory)
			// Never recreate a stale absolute path copied from another computer.
			// A missing directory means this portable copy starts unbound and asks
			// the current user to choose a local folder again.
			if info, statErr := os.Stat(candidate); statErr == nil && info.IsDir() {
				store.directory = candidate
			}
		}
	}
	if store.directory != "" {
		if info, statErr := os.Stat(store.dataPathLocked()); statErr == nil {
			store.lastWrite = info.ModTime().Format(time.RFC3339)
		}
	}
	return store, nil
}

func (s *diskStore) directoryPath() string {
	s.RLock()
	defer s.RUnlock()
	return s.directory
}

func (s *diskStore) dataPathLocked() string {
	if s.directory == "" {
		return ""
	}
	return filepath.Join(s.directory, dataFilename)
}

func (s *diskStore) backupPathLocked() string {
	if s.directory == "" {
		return ""
	}
	return filepath.Join(s.directory, backupName)
}

func (s *diskStore) status() map[string]any {
	s.RLock()
	defer s.RUnlock()
	dataPath := s.dataPathLocked()
	bound := s.directory != ""
	fileExists := false
	if bound {
		_, statErr := os.Stat(dataPath)
		fileExists = statErr == nil
	}
	return map[string]any{
		"ready":          bound,
		"bound":          bound,
		"directory":      s.directory,
		"dataFile":       dataPath,
		"fileExists":     fileExists,
		"lastWriteAt":    s.lastWrite,
		"browserStorage": false,
	}
}

func (s *diskStore) load() (json.RawMessage, error) {
	s.RLock()
	defer s.RUnlock()
	if s.directory == "" {
		return json.RawMessage(`{}`), nil
	}
	return loadDataFromPath(s.dataPathLocked(), s.backupPathLocked())
}

func loadDataFromPath(dataPath, fallbackPath string) (json.RawMessage, error) {
	raw, err := os.ReadFile(dataPath)
	if errors.Is(err, os.ErrNotExist) {
		return json.RawMessage(`{}`), nil
	}
	if err != nil {
		return nil, err
	}
	data, parseErr := decodeDiskEnvelope(raw)
	if parseErr == nil {
		return data, nil
	}
	backup, backupErr := os.ReadFile(fallbackPath)
	if backupErr != nil {
		return nil, fmt.Errorf("主数据文件损坏，且无法读取备份：%w", parseErr)
	}
	data, backupParseErr := decodeDiskEnvelope(backup)
	if backupParseErr != nil {
		return nil, fmt.Errorf("主数据文件与备份均无法解析：%w", parseErr)
	}
	return data, nil
}

func decodeDiskEnvelope(raw []byte) (json.RawMessage, error) {
	var envelope diskDataEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, err
	}
	if len(envelope.Data) == 0 || !json.Valid(envelope.Data) {
		return nil, errors.New("数据文件缺少有效的 data 字段")
	}
	return envelope.Data, nil
}

func (s *diskStore) save(data json.RawMessage) error {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil || object == nil {
		return errors.New("学习数据必须是 JSON 对象")
	}
	s.Lock()
	defer s.Unlock()
	if s.directory == "" {
		return errors.New("请先选择或创建永久数据文件夹")
	}
	return s.writeLocked(data)
}

func (s *diskStore) writeLocked(data json.RawMessage) error {
	if err := os.MkdirAll(s.directory, 0700); err != nil {
		return err
	}
	dataPath := s.dataPathLocked()
	backupPath := s.backupPathLocked()
	previous, previousErr := os.ReadFile(dataPath)
	if previousErr == nil && json.Valid(previous) {
		if err := os.WriteFile(backupPath, previous, 0600); err != nil {
			return fmt.Errorf("创建滚动备份失败：%w", err)
		}
		backupsDir := filepath.Join(s.directory, "backups")
		if err := os.MkdirAll(backupsDir, 0700); err == nil {
			dailyPath := filepath.Join(backupsDir, "EnglishLearnPath-data-"+time.Now().Format("2006-01-02")+".json")
			if _, err := os.Stat(dailyPath); errors.Is(err, os.ErrNotExist) {
				_ = os.WriteFile(dailyPath, previous, 0600)
			}
		}
	}

	envelope := diskDataEnvelope{Version: 1, UpdatedAt: time.Now().Format(time.RFC3339), Data: data}
	encoded, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return err
	}
	temporaryPath := dataPath + ".tmp"
	if err := os.WriteFile(temporaryPath, encoded, 0600); err != nil {
		return err
	}
	if err := os.Remove(dataPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		_ = os.Remove(temporaryPath)
		return err
	}
	if err := os.Rename(temporaryPath, dataPath); err != nil {
		if previousErr == nil {
			_ = os.WriteFile(dataPath, previous, 0600)
		}
		return err
	}
	s.lastWrite = envelope.UpdatedAt
	return nil
}

func (s *diskStore) switchDirectory(selected string) (bool, error) {
	absolute, err := filepath.Abs(strings.TrimSpace(selected))
	if err != nil || !filepath.IsAbs(absolute) {
		return false, errors.New("选择的目录无效")
	}
	if err := os.MkdirAll(absolute, 0700); err != nil {
		return false, err
	}

	current, err := s.load()
	if err != nil {
		return false, err
	}
	targetPath := filepath.Join(absolute, dataFilename)
	_, statErr := os.Stat(targetPath)
	loadedExisting := statErr == nil
	if loadedExisting {
		if _, err := loadDataFromPath(targetPath, filepath.Join(absolute, backupName)); err != nil {
			return false, fmt.Errorf("所选目录中的数据文件无效：%w", err)
		}
	}

	s.Lock()
	defer s.Unlock()
	previousDirectory := s.directory
	s.directory = absolute
	if !loadedExisting {
		if err := s.writeLocked(current); err != nil {
			s.directory = previousDirectory
			return false, err
		}
	} else if info, err := os.Stat(s.dataPathLocked()); err == nil {
		s.lastWrite = info.ModTime().Format(time.RFC3339)
	}
	if err := s.persistConfigLocked(); err != nil {
		s.directory = previousDirectory
		return false, err
	}
	return loadedExisting, nil
}

func (s *diskStore) persistConfigLocked() error {
	payload, err := json.MarshalIndent(launcherConfig{DataDirectory: s.directory}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.configPath, payload, 0600)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	return decodeJSONLimit(w, r, target, maxRequest)
}

func decodeJSONLimit(w http.ResponseWriter, r *http.Request, target any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("请求内容无效：%w", err)
	}
	return nil
}

func secureStaticServer(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(filepath.Clean(r.URL.Path), "..") {
			http.NotFound(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func findResourceDir(name string) (string, error) {
	var candidates []string
	if executable, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(executable), name))
	}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(cwd, name), filepath.Join(cwd, "..", name))
	}
	for _, candidate := range candidates {
		absolute, err := filepath.Abs(candidate)
		if err == nil {
			if info, statErr := os.Stat(absolute); statErr == nil && info.IsDir() {
				return absolute, nil
			}
		}
	}
	return "", fmt.Errorf("找不到 %s 资源目录，请确认程序已完整解压", name)
}

func openBrowser(target string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
	case "darwin":
		command = exec.Command("open", target)
	default:
		command = exec.Command("xdg-open", target)
	}
	return command.Start()
}

func writeStartupError(err error) {
	log.Printf("EnglishLearnPath: %v", err)
	path := "EnglishLearnPath-启动失败.txt"
	if executable, execErr := os.Executable(); execErr == nil {
		path = filepath.Join(filepath.Dir(executable), path)
	}
	_ = os.WriteFile(path, []byte(err.Error()+"\r\n"), 0600)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
