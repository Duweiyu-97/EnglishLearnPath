package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

type testTransport func(*http.Request) (*http.Response, error)

func (f testTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func mockAI(t *testing.T, response string, inspect func(map[string]any)) {
	t.Helper()
	previous := client
	client = &http.Client{Transport: testTransport(func(r *http.Request) (*http.Response, error) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if inspect != nil {
			inspect(body)
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(response))}, nil
	})}
	t.Cleanup(func() { client = previous })
}

func TestDeepSeekConnectionProbeDisablesThinking(t *testing.T) {
	previous := settings
	settings = &configStore{path: filepath.Join(t.TempDir(), "ai-credentials.dpapi")}
	t.Cleanup(func() { settings = previous })
	mockAI(t, `{"choices":[{"finish_reason":"stop","message":{"content":"CONNECTED"}}]}`, func(body map[string]any) {
		if body["max_tokens"] != float64(256) {
			t.Errorf("test token budget: %v", body["max_tokens"])
		}
		thinking, ok := body["thinking"].(map[string]any)
		if !ok || thinking["type"] != "disabled" {
			t.Errorf("thinking not disabled: %v", body["thinking"])
		}
	})
	request := httptest.NewRequest(http.MethodPost, "/api/ai/config", strings.NewReader(`{"baseUrl":"https://api.deepseek.com","model":"deepseek-v4-flash","apiKey":"synthetic-test-key"}`))
	response := httptest.NewRecorder()
	handleAIConfig(response, request)
	if response.Code != http.StatusOK || !settings.value.Connected {
		t.Fatalf("connection failed: %d %s", response.Code, response.Body.String())
	}
}

func TestThinkingParameterDoesNotLeakToOtherProviders(t *testing.T) {
	mockAI(t, `{"choices":[{"message":{"content":"ok"}}]}`, func(body map[string]any) {
		if _, exists := body["thinking"]; exists {
			t.Error("unexpected provider-specific option")
		}
	})
	for _, item := range []struct {
		base  string
		probe bool
	}{{"https://example.test/v1", true}, {"https://api.deepseek.com.evil.test", false}} {
		if _, err := callChat(context.Background(), aiConfig{BaseURL: item.base, Model: "deepseek-v4-flash"}, nil, 0, 256, item.probe); err != nil {
			t.Fatal(err)
		}
	}
}

func TestDeepSeekReviewProducesFinalAnswerWithoutThinking(t *testing.T) {
	mockAI(t, `{"choices":[{"message":{"content":"Useful feedback"},"finish_reason":"stop"}]}`, func(body map[string]any) {
		thinking, ok := body["thinking"].(map[string]any)
		if !ok || thinking["type"] != "disabled" {
			t.Errorf("review still uses default thinking: %v", body["thinking"])
		}
	})
	content, err := callChat(context.Background(), aiConfig{BaseURL: "https://api.deepseek.com", Model: "deepseek-v4-flash"}, nil, 0.25, 6000, false)
	if err != nil || content != "Useful feedback" {
		t.Fatalf("review failed: %v", err)
	}
}

func TestDeepSeekVisionRequestSwitchesModelAndPreservesImage(t *testing.T) {
	previous := settings
	settings = &configStore{value: aiConfig{BaseURL: "https://api.deepseek.com", APIKey: "synthetic", Model: "deepseek-v4-flash", Connected: true}}
	t.Cleanup(func() { settings = previous })
	mockAI(t, `{"choices":[{"message":{"content":"image understood"},"finish_reason":"stop"}]}`, func(body map[string]any) {
		if body["model"] != "deepseek-v4-flash-vision-exp" {
			t.Errorf("vision model was not selected: %v", body["model"])
		}
		messages := body["messages"].([]any)
		content := messages[0].(map[string]any)["content"].([]any)
		image := content[1].(map[string]any)["image_url"].(map[string]any)
		if image["url"] != "data:image/webp;base64,AAAA" || image["detail"] != "original" {
			t.Errorf("image content changed: %v", image)
		}
	})
	request := httptest.NewRequest(http.MethodPost, "/api/ai/chat", strings.NewReader(`{"messages":[{"role":"user","content":[{"type":"text","text":"Read the chart"},{"type":"image_url","image_url":{"url":"data:image/webp;base64,AAAA","detail":"original"}}]}]}`))
	response := httptest.NewRecorder()
	handleAIChat(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "image understood") {
		t.Fatalf("vision request failed: %d %s", response.Code, response.Body.String())
	}
}

func TestImagesAreRejectedOutsideUserMessages(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/ai/chat", strings.NewReader(`{"messages":[{"role":"system","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,AAAA"}}]}]}`))
	response := httptest.NewRecorder()
	handleAIChat(response, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "只有用户消息") {
		t.Fatalf("unsafe image role was not rejected: %d %s", response.Code, response.Body.String())
	}
}

func TestVisionRequestDoesNotRewriteOtherProviderModel(t *testing.T) {
	previous := settings
	settings = &configStore{value: aiConfig{BaseURL: "https://example.test/v1", APIKey: "synthetic", Model: "provider-vision-model", Connected: true}}
	t.Cleanup(func() { settings = previous })
	mockAI(t, `{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}`, func(body map[string]any) {
		if body["model"] != "provider-vision-model" {
			t.Errorf("custom provider model was rewritten: %v", body["model"])
		}
	})
	request := httptest.NewRequest(http.MethodPost, "/api/ai/chat", strings.NewReader(`{"messages":[{"role":"user","content":[{"type":"text","text":"Read"},{"type":"image_url","image_url":{"url":"https://example.test/chart.png"}}]}]}`))
	response := httptest.NewRecorder()
	handleAIChat(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("custom vision request failed: %d %s", response.Code, response.Body.String())
	}
}

func TestReasoningOnlyIsNotReturnedAsFinalAnswer(t *testing.T) {
	for _, finish := range []string{"length", "stop"} {
		t.Run(finish, func(t *testing.T) {
			mockAI(t, `{"choices":[{"finish_reason":"`+finish+`","message":{"content":"","reasoning_content":"private synthetic reasoning"}}]}`, nil)
			content, err := callChat(context.Background(), aiConfig{BaseURL: "https://example.test", Model: "test"}, nil, 0, 256, true)
			if err == nil || content != "" || strings.Contains(err.Error(), "private synthetic") {
				t.Fatalf("unexpected result: %q %v", content, err)
			}
			if finish == "length" && !strings.Contains(err.Error(), "长度上限") {
				t.Fatalf("missing truncation diagnosis: %v", err)
			}
		})
	}
}
