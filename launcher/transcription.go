package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const maxTranscriptionAudio = 16 << 20

var transcriptionLock sync.Mutex

func whisperPaths() (string, string, error) {
	dir, err := findResourceDir("whisper")
	if err != nil {
		return "", "", err
	}
	executable := "whisper-cli"
	if runtime.GOOS == "windows" {
		executable += ".exe"
	}
	engine, model := filepath.Join(dir, executable), filepath.Join(dir, "ggml-small.en.bin")
	for _, path := range []string{engine, model} {
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			return "", "", fmt.Errorf("本地转写组件不完整，请重新解压完整包")
		}
	}
	return engine, model, nil
}

func handleTranscriptionStatus(w http.ResponseWriter, r *http.Request) {
	_, _, err := whisperPaths()
	writeJSON(w, http.StatusOK, map[string]any{"ready": err == nil, "engine": "whisper.cpp", "model": "small.en", "local": true, "maxSeconds": 480})
}

func validateTranscriptionWAV(data []byte) error {
	// The browser emits this strict canonical PCM format. Never pass arbitrary
	// media/container bytes or user-controlled command-line options to the CLI.
	if len(data) < 46 || len(data) > maxTranscriptionAudio || string(data[:4]) != "RIFF" || string(data[8:16]) != "WAVEfmt " || binary.LittleEndian.Uint32(data[16:20]) != 16 || binary.LittleEndian.Uint16(data[20:22]) != 1 || binary.LittleEndian.Uint16(data[22:24]) != 1 || binary.LittleEndian.Uint32(data[24:28]) != 16000 || binary.LittleEndian.Uint32(data[28:32]) != 32000 || binary.LittleEndian.Uint16(data[32:34]) != 2 || binary.LittleEndian.Uint16(data[34:36]) != 16 || string(data[36:40]) != "data" || int(binary.LittleEndian.Uint32(data[40:44])) != len(data)-44 || int(binary.LittleEndian.Uint32(data[4:8])) != len(data)-8 || (len(data)-44)%2 != 0 || len(data)-44 > 480*32000 {
		return fmt.Errorf("需要不超过 8 分钟的 16kHz 单声道 PCM16 WAV")
	}
	return nil
}

func transcribeWAV(ctx context.Context, engine, model string, data []byte) (string, error) {
	if err := validateTranscriptionWAV(data); err != nil {
		return "", err
	}
	scratch, err := os.MkdirTemp("", "elp-whisper-")
	if err != nil {
		return "", err
	}
	// Only this operation's newly created temporary directory is removed.
	defer os.RemoveAll(scratch)
	input, output := filepath.Join(scratch, "recording.wav"), filepath.Join(scratch, "transcript")
	if err := os.WriteFile(input, data, 0600); err != nil {
		return "", err
	}
	threads := runtime.NumCPU() / 2
	if threads < 1 {
		threads = 1
	}
	if threads > 4 {
		threads = 4
	}
	command := exec.CommandContext(ctx, engine, "-m", model, "-f", input, "-l", "en", "-t", fmt.Sprint(threads), "-otxt", "-of", output, "-nt", "-np")
	hideTranscriptionWindow(command)
	command.Stdout, command.Stderr = io.Discard, io.Discard
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("本地转写已取消或超时，录音仍保留")
		}
		return "", fmt.Errorf("本地语音引擎运行失败，请确认使用完整包且电脑有足够可用内存")
	}
	file, err := os.Open(output + ".txt")
	if err != nil {
		return "", fmt.Errorf("语音引擎没有生成文字稿")
	}
	defer file.Close()
	text, err := io.ReadAll(io.LimitReader(file, 256*1024+1))
	if err != nil || len(text) > 256*1024 {
		return "", fmt.Errorf("转写结果异常")
	}
	result := strings.TrimSpace(string(text))
	if result == "" {
		return "", fmt.Errorf("没有识别出清晰语音，请回听录音后重试")
	}
	return result, nil
}

func handleTranscription(w http.ResponseWriter, r *http.Request) {
	if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host {
		writeError(w, http.StatusForbidden, "只允许学习中心本地页面发起转写")
		return
	}
	if !transcriptionLock.TryLock() {
		writeError(w, http.StatusConflict, "已有本地转写正在进行，请等待完成")
		return
	}
	defer transcriptionLock.Unlock()
	engine, model, err := whisperPaths()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "本地语音组件缺失，请使用包含 Whisper 的完整包")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxTranscriptionAudio)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "录音过大，请分段录制")
		return
	}
	if err := validateTranscriptionWAV(data); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Minute)
	defer cancel()
	text, err := transcribeWAV(ctx, engine, model, data)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"text": text, "engine": "whisper.cpp", "model": "small.en", "local": true})
}
