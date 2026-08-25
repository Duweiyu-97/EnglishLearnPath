package main

import (
	"archive/zip"
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
	first := json.RawMessage(`{"listening":[],"reading":[],"writings":[{"id":"one"}],"speaking":[],"activityDates":[]}`)
	second := json.RawMessage(`{"listening":[],"reading":[],"writings":[],"speaking":[],"activityDates":[]}`)

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

func TestZipExtractionAndDiscovery(t *testing.T) {
	root := t.TempDir()
	archivePath := filepath.Join(root, "original.zip")
	createTestZip(t, archivePath, map[string]string{
		"120. P2 Original/120. P2 Original.html": "<!doctype html><title>Original</title>",
		"120. P2 Original/audio.mp3":             "fixture",
	})
	if err := extractArchiveOnce(root, archivePath); err != nil {
		t.Fatalf("extract: %v", err)
	}
	items, warnings := discoverResources(root, "listening")
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	if len(items) != 1 || items[0].Title != "120. P2 Original" {
		t.Fatalf("unexpected resources: %#v", items)
	}
}

func TestZipSlipIsRejected(t *testing.T) {
	root := t.TempDir()
	archivePath := filepath.Join(root, "unsafe.zip")
	createTestZip(t, archivePath, map[string]string{"../outside.html": "unsafe"})
	if err := extractArchiveOnce(root, archivePath); err == nil {
		t.Fatal("zip slip archive should be rejected")
	}
}

func TestResourceArchiveImportSkipsDuplicatesAndKeepsUpdates(t *testing.T) {
	dataRoot := t.TempDir()
	firstSourceRoot := t.TempDir()
	updateSourceRoot := t.TempDir()
	firstArchive := filepath.Join(firstSourceRoot, "reading-pack.zip")
	updateArchive := filepath.Join(updateSourceRoot, "reading-pack.zip")
	createTestZip(t, firstArchive, map[string]string{"July/article.pdf": "first"})
	createTestZip(t, updateArchive, map[string]string{"August/article.pdf": "updated"})

	previousDisk := disk
	disk = &diskStore{directory: dataRoot, configPath: filepath.Join(dataRoot, "config.json")}
	t.Cleanup(func() { disk = previousDisk })
	if err := ensureResourceDirectories(); err != nil {
		t.Fatalf("create resource directories: %v", err)
	}

	imported, skipped, err := importResourceArchives("reading", []string{firstArchive, firstArchive, updateArchive, updateArchive})
	if err != nil {
		t.Fatalf("import archives: %v", err)
	}
	if imported != 2 || skipped != 2 {
		t.Fatalf("unexpected import result: imported=%d skipped=%d", imported, skipped)
	}

	readingRoot, err := resourceDirectory("reading")
	if err != nil {
		t.Fatal(err)
	}
	archives, err := findArchives(readingRoot)
	if err != nil {
		t.Fatal(err)
	}
	if len(archives) != 2 {
		t.Fatalf("expected original and updated archive, got %d: %v", len(archives), archives)
	}
}

func createTestZip(t *testing.T, target string, files map[string]string) {
	t.Helper()
	file, err := os.Create(target)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func todayForTest() string {
	return timeNow().Format("2006-01-02")
}

var timeNow = func() time.Time { return time.Now() }
