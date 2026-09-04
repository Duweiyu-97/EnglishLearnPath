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
