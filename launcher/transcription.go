package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
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
		return "", "", fmt.Errorf("[WHISPER_FOLDER_MISSING] 缺少 whisper 文件夹，请完整解压发布页的 Full 包，不要只移动启动程序")
	}
	return checkWhisperFiles(dir)
}

func checkWhisperFiles(dir string) (string, string, error) {
	executable := "whisper-cli"
	if runtime.GOOS == "windows" {
		executable += ".exe"
	}
	engine, model := filepath.Join(dir, executable), filepath.Join(dir, "ggml-small.en.bin")
	for index, path := range []string{engine, model} {
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			if index == 0 {
				return "", "", fmt.Errorf("[WHISPER_ENGINE_MISSING] 语音引擎缺失或无法读取，请重新完整解压 Full 包，并检查安全软件的隔离记录；不要关闭安全防护")
			}
			return "", "", fmt.Errorf("[WHISPER_MODEL_MISSING] 缺少 small.en 模型，请重新下载并完整解压 Full 包（不是 Source code）")
		}
		if index == 1 && info.Size() != 487614201 {
			return "", "", fmt.Errorf("[WHISPER_MODEL_INCOMPLETE] small.en 模型大小不正确，可能未完整下载或解压，请重新解压 Full 包")
		}
	}
	return engine, model, nil
}

func handleTranscriptionStatus(w http.ResponseWriter, r *http.Request) {
	_, _, err := whisperPaths()
	message := ""
	if err != nil {
		message = err.Error()
	}
	writeJSON(w, http.StatusOK, map[string]any{"ready": err == nil, "error": message, "version": appVersion, "platform": runtime.GOOS + "/" + runtime.GOARCH, "engine": "whisper.cpp", "model": "small.en", "local": true, "maxSeconds": 480})
}

func whisperRunError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return fmt.Errorf("[WHISPER_CANCELED] 本地转写已取消或超时，录音仍保留")
	}
	if errors.Is(err, os.ErrPermission) {
		return fmt.Errorf("[WHISPER_PERMISSION] 系统拒绝启动语音引擎，请检查应用运行权限或安全软件的隔离记录；不要关闭安全防护")
	}
	var failure *exec.ExitError
	if errors.As(err, &failure) {
		code := uint32(failure.ExitCode())
		if runtime.GOOS == "windows" {
			switch code {
			case 0xc000001d:
				return fmt.Errorf("[WHISPER_CPU] 语音引擎使用了电脑不支持的指令，请将此代码及系统版本反馈给开发者")
			case 0xc0000135, 0xc000007b:
				return fmt.Errorf("[WHISPER_RUNTIME] 语音引擎无法加载，请使用官方 Windows 完整包，不要从其他版本复制引擎")
			}
		}
		return fmt.Errorf("[WHISPER_EXIT_%08X] 语音引擎运行失败，录音仍保留。请关闭占用大量内存的程序后重试，并反馈此代码", code)
	}
	return fmt.Errorf("[WHISPER_START_FAILED] 无法启动语音引擎，请重新完整解压对应系统的 Full 包，并检查运行权限")
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
	if runtime.GOOS == "windows" {
		return transcribePipedWAV(ctx, engine, model, data)
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
		return "", whisperRunError(ctx, err)
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

// Windows argv uses the system code page, but Whisper interprets the model
// argument as UTF-8. Use an ASCII model basename under a Unicode-safe working
// directory, and pipes for audio/text so neither TEMP nor output paths enter argv.
func transcribePipedWAV(ctx context.Context, engine, model string, data []byte) (string, error) {
	engine, err := filepath.Abs(engine)
	if err != nil {
		return "", err
	}
	model, err = filepath.Abs(model)
	if err != nil {
		return "", err
	}
	threads := runtime.NumCPU() / 2
	if threads < 1 {
		threads = 1
	}
	if threads > 4 {
		threads = 4
	}
	// A non-dash output basename keeps CLI segment callbacks enabled for stdin.
	// No output format flag is set, so this does not create a transcript file.
	command := exec.CommandContext(ctx, engine, "-m", filepath.Base(model), "-f", "-", "-of", "transcript", "-l", "en", "-t", fmt.Sprint(threads), "-nt", "-np")
	command.Dir = filepath.Dir(model)
	command.Stdin = bytes.NewReader(data)
	output := &transcriptBuffer{}
	command.Stdout, command.Stderr = output, io.Discard
	hideTranscriptionWindow(command)
	if err := command.Run(); err != nil {
		return "", whisperRunError(ctx, err)
	}
	result := strings.TrimSpace(output.buffer.String())
	if result == "" {
		return "", fmt.Errorf("没有识别出清晰语音，请回听录音后重试")
	}
	return result, nil
}

type transcriptBuffer struct{ buffer bytes.Buffer }

func (b *transcriptBuffer) Write(p []byte) (int, error) {
	if b.buffer.Len()+len(p) > 256*1024 {
		return 0, fmt.Errorf("转写结果异常：超过长度限制")
	}
	return b.buffer.Write(p)
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
		writeError(w, http.StatusServiceUnavailable, err.Error())
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
