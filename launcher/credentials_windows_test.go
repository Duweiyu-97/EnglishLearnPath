//go:build windows

package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCredentialsPersistEncryptedAndRestore(t *testing.T) {
	file := filepath.Join(t.TempDir(), "ai-credentials.dpapi")
	cfg := aiConfig{BaseURL: "https://api.deepseek.com", Model: "deepseek-v4-flash", APIKey: "synthetic-secret-persist-test", Connected: true}
	first := &configStore{path: file}
	if err := first.persist(cfg); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(cfg.APIKey)) || bytes.Contains(raw, []byte(cfg.BaseURL)) {
		t.Fatal("credential file contains plaintext")
	}
	second := &configStore{path: file}
	second.restore()
	if second.value != cfg || !second.restored || !second.saved {
		t.Fatal("restart did not restore configuration")
	}
	// A replacement must also survive restart, without writing plaintext backups.
	cfg.APIKey = "synthetic-replacement"
	if err := second.persist(cfg); err != nil {
		t.Fatal(err)
	}
	second.restore()
	if second.value.APIKey != cfg.APIKey {
		t.Fatal("replacement was not persisted")
	}
	entries, _ := os.ReadDir(filepath.Dir(file))
	if len(entries) != 1 {
		t.Fatal("unexpected temporary or backup credential file")
	}
	previous := settings
	settings = second
	t.Cleanup(func() { settings = previous })
	status := httptest.NewRecorder()
	handleAIStatus(status, httptest.NewRequest(http.MethodGet, "/api/ai/status", nil))
	if strings.Contains(status.Body.String(), cfg.APIKey) || strings.Contains(status.Body.String(), "apiKey") {
		t.Fatal("status exposed key")
	}
	deleted := httptest.NewRecorder()
	handleAIDisconnect(deleted, httptest.NewRequest(http.MethodPost, "/api/ai/disconnect", nil))
	if deleted.Code != 200 {
		t.Fatal("failed to remove saved configuration")
	}
	third := &configStore{path: file}
	third.restore()
	if third.saved || third.value.Connected || third.value.APIKey != "" {
		t.Fatal("deleted key returned after restart")
	}
}

func TestCorruptCredentialsFailClosed(t *testing.T) {
	file := filepath.Join(t.TempDir(), "ai-credentials.dpapi")
	if err := os.WriteFile(file, []byte("not encrypted"), 0600); err != nil {
		t.Fatal(err)
	}
	s := &configStore{path: file}
	s.restore()
	if s.value.Connected || s.saved || s.loadError == "" {
		t.Fatal("invalid ciphertext must not restore")
	}
}

func TestBlankKeyReusesOnlySameEndpoint(t *testing.T) {
	previous := settings
	settings = &configStore{path: filepath.Join(t.TempDir(), "ai-credentials.dpapi"), value: aiConfig{BaseURL: "https://api.deepseek.com", Model: "deepseek-v4-flash", APIKey: "synthetic-reuse", Connected: true}}
	t.Cleanup(func() { settings = previous })
	var authorization string
	oldClient := client
	client = &http.Client{Transport: testTransport(func(r *http.Request) (*http.Response, error) {
		authorization = r.Header.Get("Authorization")
		return &http.Response{StatusCode: 200, Body: http.NoBody, Header: make(http.Header)}, nil
	})}
	t.Cleanup(func() { client = oldClient })
	for _, test := range []struct {
		base   string
		expect bool
	}{{"https://api.deepseek.com", true}, {"https://another.example", false}} {
		request := httptest.NewRequest(http.MethodPost, "/api/ai/config", strings.NewReader(`{"baseUrl":"`+test.base+`","model":"test","apiKey":""}`))
		handleAIConfig(httptest.NewRecorder(), request)
		if (authorization != "") != test.expect {
			t.Fatal("saved key reuse crossed endpoint boundary")
		}
	}
}
