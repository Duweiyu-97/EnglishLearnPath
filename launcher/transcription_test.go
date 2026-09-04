package main

import (
	"context"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testWAV() []byte {
	data := make([]byte, 44+320)
	copy(data, "RIFF")
	binary.LittleEndian.PutUint32(data[4:], uint32(len(data)-8))
	copy(data[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:], 16)
	binary.LittleEndian.PutUint16(data[20:], 1)
	binary.LittleEndian.PutUint16(data[22:], 1)
	binary.LittleEndian.PutUint32(data[24:], 16000)
	binary.LittleEndian.PutUint32(data[28:], 32000)
	binary.LittleEndian.PutUint16(data[32:], 2)
	binary.LittleEndian.PutUint16(data[34:], 16)
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:], uint32(len(data)-44))
	return data
}

// Optional release smoke check; use upstream samples/jfk.wav, never user audio.
func TestBundledWhisperPublicSample(t *testing.T) {
	bundle, fixture := os.Getenv("ELP_WHISPER_BUNDLE"), os.Getenv("ELP_WHISPER_TEST_WAV")
	if bundle == "" || fixture == "" {
		t.Skip("release smoke fixture not configured")
	}
	raw, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	// Normalize RIFF metadata chunks from the public fixture into browser format.
	var pcm []byte
	for offset := 12; offset+8 <= len(raw); {
		size := int(binary.LittleEndian.Uint32(raw[offset+4 : offset+8]))
		if offset+8+size > len(raw) {
			t.Fatal("invalid fixture")
		}
		if string(raw[offset:offset+4]) == "data" {
			pcm = raw[offset+8 : offset+8+size]
			break
		}
		offset += 8 + size + size%2
	}
	if len(pcm) == 0 {
		t.Fatal("fixture has no audio")
	}
	wav := append(testWAV()[:44], pcm...)
	binary.LittleEndian.PutUint32(wav[4:], uint32(len(wav)-8))
	binary.LittleEndian.PutUint32(wav[40:], uint32(len(pcm)))
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	result, err := transcribeWAV(ctx, filepath.Join(bundle, "whisper-cli.exe"), filepath.Join(bundle, "ggml-small.en.bin"), wav)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.ToLower(result), "ask not what your country") {
		t.Fatal("public fixture not recognized")
	}
}
func TestTranscriptionWAVValidation(t *testing.T) {
	if err := validateTranscriptionWAV(testWAV()); err != nil {
		t.Fatal(err)
	}
	for _, offset := range []int{0, 8, 16, 20, 22, 24, 28, 32, 34, 36, 40, 4} {
		data := testWAV()
		data[offset] ^= 0xff
		if validateTranscriptionWAV(data) == nil {
			t.Fatalf("accepted malformed field %d", offset)
		}
	}
	for _, data := range [][]byte{nil, make([]byte, 44), append(testWAV(), 1), make([]byte, maxTranscriptionAudio+1)} {
		if validateTranscriptionWAV(data) == nil {
			t.Fatal("invalid input accepted")
		}
	}
}
func TestTranscriptionSerializesRequests(t *testing.T) {
	transcriptionLock.Lock()
	defer transcriptionLock.Unlock()
	response := httptest.NewRecorder()
	handleTranscription(response, httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/transcription", nil))
	if response.Code != http.StatusConflict {
		t.Fatalf("got %d", response.Code)
	}
}

func TestTranscriptionRejectsForeignOrigin(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/transcription", nil)
	request.Header.Set("Origin", "https://example.com")
	response := httptest.NewRecorder()
	handleTranscription(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("got %d", response.Code)
	}
}
