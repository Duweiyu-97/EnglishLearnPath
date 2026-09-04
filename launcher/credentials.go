package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

// Caller holds the configuration lock. No plaintext key is ever written.
func (s *configStore) persist(cfg aiConfig) error {
	if s.path == "" {
		return errors.New("credential path is not initialized")
	}
	plain, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	defer clear(plain)
	encrypted, err := protectCredential(plain)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(s.path), ".ai-credential-*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if _, err := temp.Write(encrypted); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(temp.Name(), s.path)
}

func (s *configStore) restore() {
	s.Lock()
	defer s.Unlock()
	s.value = aiConfig{}
	s.saved, s.restored, s.loadError = false, false, ""
	encrypted, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return
	}
	if err != nil || len(encrypted) > 65536 {
		s.loadError = "无法读取本地加密配置，请重新填写并保存"
		return
	}
	plain, err := unprotectCredential(encrypted)
	if err != nil {
		s.loadError = "无法解密已保存的配置；更换电脑或 Windows 账户后需要重新输入 Key"
		return
	}
	defer clear(plain)
	var cfg aiConfig
	if json.Unmarshal(plain, &cfg) != nil || validateConfig(cfg) != nil || !cfg.Connected {
		s.loadError = "本地加密配置无效，请重新填写并保存"
		return
	}
	s.value = cfg
	s.saved, s.restored = true, true
}
