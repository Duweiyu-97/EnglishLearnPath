package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
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
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	maxRequest    = 1 << 20
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
	value aiConfig
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

type resourceItem struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Kind         string `json:"kind"`
	Format       string `json:"format"`
	RelativePath string `json:"relativePath"`
	filePath     string
}

type resourceCatalog struct {
	sync.RWMutex
	items      map[string]resourceItem
	listening  []resourceItem
	reading    []resourceItem
	warnings   []string
	lastScanAt string
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature,omitempty"`
	MaxTokens   int           `json:"max_tokens,omitempty"`
}

type upstreamResponse struct {
	Choices []struct {
		Message struct {
			Content any `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

var (
	settings  = &configStore{}
	client    = &http.Client{Timeout: 90 * time.Second}
	disk      *diskStore
	resources = &resourceCatalog{items: make(map[string]resourceItem)}
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
		writeJSON(w, http.StatusOK, map[string]any{"name": "English Learning Path", "version": "0.3.0", "local": true})
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
	mux.HandleFunc("GET /api/resources", handleResourcesList)
	mux.HandleFunc("POST /api/resources/rescan", handleResourcesRescan)
	mux.HandleFunc("POST /api/resources/import", handleResourcesImport)
	mux.HandleFunc("POST /api/resources/open", handleResourceOpen)
	mux.HandleFunc("POST /api/resources/open-directory", handleResourceDirectoryOpen)
	mux.HandleFunc("GET /api/ai/status", handleAIStatus)
	mux.HandleFunc("POST /api/ai/config", handleAIConfig)
	mux.HandleFunc("POST /api/ai/disconnect", handleAIDisconnect)
	mux.HandleFunc("POST /api/ai/chat", handleAIChat)
}

func handleResourcesList(w http.ResponseWriter, _ *http.Request) {
	resources.RLock()
	neverScanned := resources.lastScanAt == ""
	resources.RUnlock()
	if neverScanned {
		_ = scanResourceCatalog()
	}
	writeJSON(w, http.StatusOK, resourceCatalogResponse())
}

func handleResourcesRescan(w http.ResponseWriter, _ *http.Request) {
	if err := scanResourceCatalog(); err != nil {
		writeError(w, http.StatusInternalServerError, "扫描本地资源失败："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resourceCatalogResponse())
}

func handleResourcesImport(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	if _, err := resourceDirectory(kind); err != nil {
		writeError(w, http.StatusPreconditionFailed, err.Error())
		return
	}
	selected, canceled, err := selectArchiveFiles(kind)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "打开压缩包选择器失败："+err.Error())
		return
	}
	if canceled {
		writeJSON(w, http.StatusOK, map[string]any{"canceled": true, "catalog": resourceCatalogResponse()})
		return
	}
	imported, skipped, err := importResourceArchives(kind, selected)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "导入资源失败："+err.Error())
		return
	}
	if err := scanResourceCatalog(); err != nil {
		writeError(w, http.StatusInternalServerError, "资源已复制，但扫描失败："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"canceled": false,
		"imported": imported,
		"skipped":  skipped,
		"catalog":  resourceCatalogResponse(),
	})
}

func handleResourceOpen(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID string `json:"id"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	resources.RLock()
	item, ok := resources.items[input.ID]
	resources.RUnlock()
	if !ok {
		writeError(w, http.StatusNotFound, "资源不存在，请重新扫描")
		return
	}
	if _, err := os.Stat(item.filePath); err != nil {
		writeError(w, http.StatusNotFound, "本地资源文件已移动，请重新扫描")
		return
	}
	if err := openBrowser(item.filePath); err != nil {
		writeError(w, http.StatusInternalServerError, "无法打开本地资源："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"opened": true})
}

func handleResourceDirectoryOpen(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	directory, err := resourceDirectory(kind)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if runtime.GOOS != "windows" {
		writeError(w, http.StatusNotImplemented, "当前系统暂不支持从程序打开文件夹")
		return
	}
	if err := exec.Command("explorer.exe", directory).Start(); err != nil {
		writeError(w, http.StatusInternalServerError, "无法打开资源文件夹："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"opened": true})
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
	resources.Lock()
	resources.items = make(map[string]resourceItem)
	resources.listening = nil
	resources.reading = nil
	resources.warnings = nil
	resources.lastScanAt = ""
	resources.Unlock()
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
	cfg := settings.value
	settings.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{"connected": cfg.Connected, "model": cfg.Model})
}

func handleAIConfig(w http.ResponseWriter, r *http.Request) {
	var proposed aiConfig
	if err := decodeJSON(w, r, &proposed); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	proposed.BaseURL = strings.TrimRight(strings.TrimSpace(proposed.BaseURL), "/")
	proposed.Model = strings.TrimSpace(proposed.Model)
	if err := validateConfig(proposed); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	testMessages := []chatMessage{
		{Role: "system", Content: "Reply with exactly: CONNECTED"},
		{Role: "user", Content: "Connection test"},
	}
	if _, err := callChat(r.Context(), proposed, testMessages, 0, 16); err != nil {
		writeError(w, http.StatusBadGateway, "模型连接测试失败："+err.Error())
		return
	}
	proposed.Connected = true
	settings.Lock()
	settings.value = proposed
	settings.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"connected": true, "model": proposed.Model})
}

func handleAIDisconnect(w http.ResponseWriter, _ *http.Request) {
	settings.Lock()
	settings.value = aiConfig{}
	settings.Unlock()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func handleAIChat(w http.ResponseWriter, r *http.Request) {
	var input chatRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(input.Messages) == 0 || len(input.Messages) > 30 {
		writeError(w, http.StatusBadRequest, "messages 数量无效")
		return
	}
	for _, message := range input.Messages {
		if message.Role != "system" && message.Role != "user" && message.Role != "assistant" {
			writeError(w, http.StatusBadRequest, "消息角色无效")
			return
		}
		if len(message.Content) > 120000 {
			writeError(w, http.StatusBadRequest, "单条消息过长")
			return
		}
	}
	settings.RLock()
	cfg := settings.value
	settings.RUnlock()
	if !cfg.Connected {
		writeError(w, http.StatusPreconditionFailed, "请先在设置页配置并测试 AI")
		return
	}
	maxTokens := input.MaxTokens
	if maxTokens <= 0 || maxTokens > 4000 {
		maxTokens = 1800
	}
	content, err := callChat(r.Context(), cfg, input.Messages, input.Temperature, maxTokens)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"content": content})
}

func callChat(ctx context.Context, cfg aiConfig, messages []chatMessage, temperature float64, maxTokens int) (string, error) {
	payload := map[string]any{
		"model":       cfg.Model,
		"messages":    messages,
		"temperature": temperature,
		"max_tokens":  maxTokens,
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
		for _, name := range []string{"Listening-Xiahua", "Reading-ZYZ"} {
			if err := os.MkdirAll(filepath.Join(store.directory, "resources", name), 0700); err != nil {
				return nil, err
			}
		}
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
	for _, name := range []string{"Listening-Xiahua", "Reading-ZYZ"} {
		if err := os.MkdirAll(filepath.Join(s.directory, "resources", name), 0700); err != nil {
			s.directory = previousDirectory
			return false, err
		}
	}
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

func resourceDirectory(kind string) (string, error) {
	root := disk.directoryPath()
	if root == "" {
		return "", errors.New("请先选择或创建永久数据文件夹")
	}
	var name string
	switch kind {
	case "listening":
		name = "Listening-Xiahua"
	case "reading":
		name = "Reading-ZYZ"
	default:
		return "", errors.New("资源类型无效")
	}
	directory := filepath.Join(root, "resources", name)
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	return directory, nil
}

func ensureResourceDirectories() error {
	if _, err := resourceDirectory("listening"); err != nil {
		return err
	}
	if _, err := resourceDirectory("reading"); err != nil {
		return err
	}
	return nil
}

func scanResourceCatalog() error {
	if err := ensureResourceDirectories(); err != nil {
		return err
	}
	listeningRoot, _ := resourceDirectory("listening")
	readingRoot, _ := resourceDirectory("reading")
	warnings := make([]string, 0)

	for _, root := range []string{listeningRoot, readingRoot} {
		archives, err := findArchives(root)
		if err != nil {
			warnings = append(warnings, err.Error())
			continue
		}
		for _, archive := range archives {
			if err := extractArchiveOnce(root, archive); err != nil {
				warnings = append(warnings, filepath.Base(archive)+"："+err.Error())
			}
		}
	}

	listening, listeningWarnings := discoverResources(listeningRoot, "listening")
	reading, readingWarnings := discoverResources(readingRoot, "reading")
	warnings = append(warnings, listeningWarnings...)
	warnings = append(warnings, readingWarnings...)
	sort.Slice(listening, func(i, j int) bool { return listening[i].Title < listening[j].Title })
	sort.Slice(reading, func(i, j int) bool { return reading[i].Title < reading[j].Title })

	items := make(map[string]resourceItem, len(listening)+len(reading))
	for _, item := range append(append([]resourceItem{}, listening...), reading...) {
		items[item.ID] = item
	}
	resources.Lock()
	resources.items = items
	resources.listening = listening
	resources.reading = reading
	resources.warnings = warnings
	resources.lastScanAt = time.Now().Format(time.RFC3339)
	resources.Unlock()
	return nil
}

func resourceCatalogResponse() map[string]any {
	resources.RLock()
	defer resources.RUnlock()
	listeningRoot, _ := resourceDirectory("listening")
	readingRoot, _ := resourceDirectory("reading")
	return map[string]any{
		"listening":       resources.listening,
		"reading":         resources.reading,
		"warnings":        resources.warnings,
		"lastScanAt":      resources.lastScanAt,
		"listeningFolder": listeningRoot,
		"readingFolder":   readingRoot,
	}
}

func findArchives(root string) ([]string, error) {
	archives := make([]string, 0)
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() && entry.Name() == ".EnglishLearnPath-extracted" {
			return filepath.SkipDir
		}
		if !entry.IsDir() && strings.EqualFold(filepath.Ext(entry.Name()), ".zip") {
			archives = append(archives, path)
		}
		return nil
	})
	return archives, err
}

func extractArchiveOnce(resourceRoot, archivePath string) error {
	info, err := os.Stat(archivePath)
	if err != nil {
		return err
	}
	fingerprint := fmt.Sprintf("%s|%d|%d", archivePath, info.Size(), info.ModTime().UnixNano())
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(fingerprint)))[:12]
	destination := filepath.Join(resourceRoot, ".EnglishLearnPath-extracted", digest)
	marker := filepath.Join(destination, ".complete")
	if _, err := os.Stat(marker); err == nil {
		return nil
	}

	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer reader.Close()
	if len(reader.File) > 20000 {
		return errors.New("压缩包文件数量超过安全上限")
	}
	var total uint64
	for _, file := range reader.File {
		total += file.UncompressedSize64
		if file.UncompressedSize64 > 2<<30 || total > 8<<30 {
			return errors.New("压缩包解压大小超过安全上限")
		}
	}
	if err := os.MkdirAll(destination, 0700); err != nil {
		return err
	}
	destinationPrefix := destination + string(os.PathSeparator)
	for _, file := range reader.File {
		cleanName := filepath.Clean(filepath.FromSlash(file.Name))
		if cleanName == "." || filepath.IsAbs(cleanName) || strings.HasPrefix(cleanName, ".."+string(os.PathSeparator)) {
			return errors.New("压缩包包含不安全路径")
		}
		target := filepath.Join(destination, cleanName)
		if target != destination && !strings.HasPrefix(target, destinationPrefix) {
			return errors.New("压缩包包含越界路径")
		}
		if file.FileInfo().Mode()&os.ModeSymlink != 0 {
			continue
		}
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0700); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		source, err := file.Open()
		if err != nil {
			return err
		}
		destinationFile, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
		if err != nil {
			source.Close()
			return err
		}
		_, copyErr := io.Copy(destinationFile, io.LimitReader(source, int64(file.UncompressedSize64)+1))
		closeErr := destinationFile.Close()
		source.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return os.WriteFile(marker, []byte(fingerprint), 0600)
}

func discoverResources(root, kind string) ([]resourceItem, []string) {
	result := make([]resourceItem, 0)
	warnings := make([]string, 0)
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			warnings = append(warnings, err.Error())
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		extension := strings.ToLower(filepath.Ext(entry.Name()))
		allowed := (kind == "listening" && (extension == ".html" || extension == ".htm")) ||
			(kind == "reading" && (extension == ".pdf" || extension == ".html" || extension == ".htm"))
		if !allowed {
			return nil
		}
		relative, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil
		}
		title := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		digest := fmt.Sprintf("%x", sha256.Sum256([]byte(kind+"|"+path)))
		result = append(result, resourceItem{
			ID:           digest,
			Title:        title,
			Kind:         kind,
			Format:       strings.TrimPrefix(extension, "."),
			RelativePath: relative,
			filePath:     path,
		})
		if len(result) >= 20000 {
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil {
		warnings = append(warnings, err.Error())
	}
	return result, warnings
}

func selectArchiveFiles(kind string) ([]string, bool, error) {
	if runtime.GOOS != "windows" {
		return nil, false, errors.New("当前版本只支持 Windows 文件选择器")
	}
	label := "虾滑听力"
	if kind == "reading" {
		label = "ZYZ 阅读"
	}
	script := fmt.Sprintf(`$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '选择%s ZIP，可多选'
$dialog.Filter = 'ZIP 压缩包 (*.zip)|*.zip'
$dialog.Multiselect = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  foreach ($name in $dialog.FileNames) {
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($name))
  }
} else {
  'CANCELLED'
}`, label)
	command := exec.Command("powershell.exe", "-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", script)
	output, err := command.CombinedOutput()
	if err != nil {
		return nil, false, err
	}
	lines := strings.Fields(string(output))
	if len(lines) == 0 || (len(lines) == 1 && lines[0] == "CANCELLED") {
		return nil, true, nil
	}
	paths := make([]string, 0, len(lines))
	for _, encoded := range lines {
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, false, errors.New("无法解析所选压缩包路径")
		}
		paths = append(paths, string(decoded))
	}
	return paths, false, nil
}

func importResourceArchives(kind string, selected []string) (int, int, error) {
	destination, err := resourceDirectory(kind)
	if err != nil {
		return 0, 0, err
	}
	existingArchives, err := findArchives(destination)
	if err != nil {
		return 0, 0, err
	}
	existingDigests := make(map[string]struct{}, len(existingArchives))
	for _, archivePath := range existingArchives {
		digest, digestErr := fileDigest(archivePath)
		if digestErr != nil {
			return 0, 0, digestErr
		}
		existingDigests[fmt.Sprintf("%x", digest)] = struct{}{}
	}
	imported := 0
	skipped := 0
	for _, sourcePath := range selected {
		if !strings.EqualFold(filepath.Ext(sourcePath), ".zip") {
			return imported, skipped, fmt.Errorf("只支持 ZIP：%s", filepath.Base(sourcePath))
		}
		sourceInfo, err := os.Stat(sourcePath)
		if err != nil || sourceInfo.IsDir() {
			return imported, skipped, fmt.Errorf("无法读取：%s", filepath.Base(sourcePath))
		}
		sourceDigest, err := fileDigest(sourcePath)
		if err != nil {
			return imported, skipped, err
		}
		digestKey := fmt.Sprintf("%x", sourceDigest)
		if _, exists := existingDigests[digestKey]; exists {
			skipped++
			continue
		}
		targetPath := filepath.Join(destination, filepath.Base(sourcePath))
		if targetInfo, err := os.Stat(targetPath); err == nil && !targetInfo.IsDir() {
			stem := strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath))
			base := stem + "-update-" + time.Now().Format("20060102-150405")
			targetPath = filepath.Join(destination, base+".zip")
			for suffix := 2; ; suffix++ {
				_, statErr := os.Stat(targetPath)
				if errors.Is(statErr, os.ErrNotExist) {
					break
				}
				if statErr != nil {
					return imported, skipped, statErr
				}
				targetPath = filepath.Join(destination, fmt.Sprintf("%s-%d.zip", base, suffix))
			}
		}
		if err := copyFile(sourcePath, targetPath); err != nil {
			return imported, skipped, err
		}
		existingDigests[digestKey] = struct{}{}
		imported++
	}
	return imported, skipped, nil
}

func filesHaveSameDigest(first, second string) (bool, error) {
	firstDigest, err := fileDigest(first)
	if err != nil {
		return false, err
	}
	secondDigest, err := fileDigest(second)
	if err != nil {
		return false, err
	}
	return bytes.Equal(firstDigest, secondDigest), nil
}

func fileDigest(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return nil, err
	}
	return hash.Sum(nil), nil
}

func copyFile(sourcePath, targetPath string) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()
	temporaryPath := targetPath + ".tmp"
	target, err := os.OpenFile(temporaryPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(target, source)
	closeErr := target.Close()
	if copyErr != nil {
		_ = os.Remove(temporaryPath)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(temporaryPath)
		return closeErr
	}
	if err := os.Rename(temporaryPath, targetPath); err != nil {
		_ = os.Remove(temporaryPath)
		return err
	}
	return nil
}

func selectDirectory() (string, bool, error) {
	if runtime.GOOS != "windows" {
		return "", false, errors.New("当前版本只支持 Windows 文件夹选择器")
	}
	script := `$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择 EnglishLearnPath 永久数据文件夹'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath))
} else {
  'CANCELLED'
}`
	command := exec.Command("powershell.exe", "-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", script)
	output, err := command.CombinedOutput()
	if err != nil {
		return "", false, fmt.Errorf("%w", err)
	}
	encoded := strings.TrimSpace(string(output))
	if encoded == "" || encoded == "CANCELLED" {
		return "", true, nil
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", false, errors.New("无法解析所选文件夹路径")
	}
	return string(decoded), false, nil
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequest)
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
