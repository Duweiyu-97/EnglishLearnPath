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
	address       = "127.0.0.1:17860"
	appURL        = "http://127.0.0.1:17860"
	maxRequest    = 1 << 20
	maxAIResponse = 4 << 20
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
	settings = &configStore{}
	client   = &http.Client{Timeout: 90 * time.Second}
)

func main() {
	appDir, err := findResourceDir("app")
	if err != nil {
		writeStartupError(err)
		return
	}
	docsDir, _ := findResourceDir("docs")

	listener, err := net.Listen("tcp", address)
	if err != nil {
		if existingAppIsRunning() {
			_ = openBrowser(appURL)
			return
		}
		writeStartupError(fmt.Errorf("无法启动本地服务：%w", err))
		return
	}

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
		writeJSON(w, http.StatusOK, map[string]any{"name": "EnglishLearnPath", "version": "0.1.0", "local": true})
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
	mux.HandleFunc("GET /api/ai/status", handleAIStatus)
	mux.HandleFunc("POST /api/ai/config", handleAIConfig)
	mux.HandleFunc("POST /api/ai/disconnect", handleAIDisconnect)
	mux.HandleFunc("POST /api/ai/chat", handleAIChat)
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
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
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

func existingAppIsRunning() bool {
	probe := &http.Client{Timeout: 800 * time.Millisecond}
	response, err := probe.Get(appURL + "/api/health")
	if err != nil {
		return false
	}
	defer response.Body.Close()
	var data map[string]any
	return response.StatusCode == http.StatusOK && json.NewDecoder(response.Body).Decode(&data) == nil && data["app"] == "EnglishLearnPath"
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
