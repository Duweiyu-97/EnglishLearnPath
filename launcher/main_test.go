package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestDiskStorePersistsAndKeepsBackup(t *testing.T) {
	root := t.TempDir()
	store := &diskStore{directory: root, configPath: filepath.Join(root, "config.json")}
	first := json.RawMessage(`{"writings":[{"id":"one"}],"speaking":[],"activityDates":[]}`)
	second := json.RawMessage(`{"writings":[],"speaking":[],"activityDates":[]}`)

	if err := store.save(first); err != nil {
		t.Fatalf("first save: %v", err)
	}
	if err := store.save(second); err != nil {
		t.Fatalf("second save: %v", err)
	}
	loaded, err := store.load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	var loadedObject, expectedObject map[string]any
	if err := json.Unmarshal(loaded, &loadedObject); err != nil {
		t.Fatalf("decode loaded data: %v", err)
	}
	if err := json.Unmarshal(second, &expectedObject); err != nil {
		t.Fatalf("decode expected data: %v", err)
	}
	if !reflect.DeepEqual(loadedObject, expectedObject) {
		t.Fatalf("loaded data mismatch: %s", loaded)
	}
	if _, err := os.Stat(filepath.Join(root, backupName)); err != nil {
		t.Fatalf("rolling backup missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "backups", "EnglishLearnPath-data-"+todayForTest()+".json")); err != nil {
		t.Fatalf("daily backup missing: %v", err)
	}
}

func TestUnboundDiskStoreDoesNotWrite(t *testing.T) {
	store := &diskStore{configPath: filepath.Join(t.TempDir(), "config.json")}
	if err := store.save(json.RawMessage(`{"writings":[]}`)); err == nil {
		t.Fatal("unbound store should reject writes")
	}
	loaded, err := store.load()
	if err != nil || string(loaded) != "{}" {
		t.Fatalf("unbound load should be empty: %s, %v", loaded, err)
	}
}

func TestNewDiskStoreUsesIsolatedConfigAndStartsUnbound(t *testing.T) {
	configRoot := t.TempDir()
	t.Setenv("ENGLISH_LEARN_PATH_CONFIG_DIR", configRoot)

	store, err := newDiskStore()
	if err != nil {
		t.Fatal(err)
	}
	if store.configPath != filepath.Join(configRoot, "config.json") {
		t.Fatalf("unexpected config path: %s", store.configPath)
	}
	if store.directoryPath() != "" {
		t.Fatalf("fresh portable config should be unbound: %s", store.directoryPath())
	}
}

func TestNewDiskStoreDoesNotRecreateStaleDirectory(t *testing.T) {
	configRoot := t.TempDir()
	missingDirectory := filepath.Join(t.TempDir(), "old-computer", "userdata")
	payload, err := json.Marshal(launcherConfig{DataDirectory: missingDirectory})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(configRoot, "config.json"), payload, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ENGLISH_LEARN_PATH_CONFIG_DIR", configRoot)

	store, err := newDiskStore()
	if err != nil {
		t.Fatal(err)
	}
	if store.directoryPath() != "" {
		t.Fatalf("stale directory should not be loaded: %s", store.directoryPath())
	}
	if _, err := os.Stat(missingDirectory); !os.IsNotExist(err) {
		t.Fatalf("stale directory must not be recreated: %v", err)
	}
}

func TestSelectedDirectoryPersistsAcrossRestarts(t *testing.T) {
	configRoot := t.TempDir()
	dataRoot := t.TempDir()
	t.Setenv("ENGLISH_LEARN_PATH_CONFIG_DIR", configRoot)

	first, err := newDiskStore()
	if err != nil {
		t.Fatal(err)
	}
	if loadedExisting, err := first.switchDirectory(dataRoot); err != nil {
		t.Fatal(err)
	} else if loadedExisting {
		t.Fatal("fresh directory should not be reported as existing data")
	}

	second, err := newDiskStore()
	if err != nil {
		t.Fatal(err)
	}
	if second.directoryPath() != dataRoot {
		t.Fatalf("selected directory was not restored: %s", second.directoryPath())
	}
	if _, err := os.Stat(filepath.Join(dataRoot, dataFilename)); err != nil {
		t.Fatalf("data file was not created: %v", err)
	}
}

func TestSecurityHeadersAllowLocalImagePreviewBlobs(t *testing.T) {
	handler := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	policy := response.Header().Get("Content-Security-Policy")
	if !strings.Contains(policy, "img-src 'self' data: blob:") {
		t.Fatalf("image previews created from local files need blob CSP support: %s", policy)
	}
}

func todayForTest() string {
	return timeNow().Format("2006-01-02")
}

func TestBindingDoesNotCreateResourceDirectories(t *testing.T) {
	root := t.TempDir()
	store := &diskStore{configPath: filepath.Join(t.TempDir(), "config.json")}
	if _, err := store.switchDirectory(root); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "resources")); !os.IsNotExist(err) {
		t.Fatalf("unexpected resources directory: %v", err)
	}
}

func TestRetiredResourceAPIsAreUnavailable(t *testing.T) {
	mux := http.NewServeMux()
	registerAPI(mux)
	for _, path := range []string{"/api/resources", "/api/resources/rescan", "/api/resources/import", "/api/resources/open", "/api/resources/open-directory"} {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, httptest.NewRequest(method, path, nil))
			if response.Code != http.StatusNotFound {
				t.Fatalf("retired API %s %s returned %d", method, path, response.Code)
			}
		}
	}
}

func TestAppInfoUsesInjectedBuildVersion(t *testing.T) {
	previous := appVersion
	appVersion = "v-test-build"
	t.Cleanup(func() { appVersion = previous })
	mux := http.NewServeMux()
	registerAPI(mux)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/app/info", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"version":"v-test-build"`) {
		t.Fatalf("build version missing from app info: %d %s", response.Code, response.Body.String())
	}
}

var timeNow = func() time.Time { return time.Now() }
