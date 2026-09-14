//go:build darwin

package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

const (
	credentialFilename        = "ai-credentials.secure"
	credentialKeychainService = "io.github.duweiyu97.EnglishLearnPath.credentials"
	credentialKeychainAccount = "local-encryption-key"
	credentialFormatVersion   = byte(1)
)

var readCredentialKey = func() ([]byte, error) {
	output, err := exec.Command(
		"/usr/bin/security", "find-generic-password",
		"-a", credentialKeychainAccount,
		"-s", credentialKeychainService,
		"-w",
	).Output()
	if err != nil {
		return nil, err
	}
	return base64.StdEncoding.DecodeString(strings.TrimSpace(string(output)))
}

var writeCredentialKey = func(key []byte) error {
	encoded := base64.StdEncoding.EncodeToString(key)
	return exec.Command(
		"/usr/bin/security", "add-generic-password", "-U",
		"-a", credentialKeychainAccount,
		"-s", credentialKeychainService,
		"-w", encoded,
	).Run()
}

func macOSCredentialKey() ([]byte, error) {
	key, err := readCredentialKey()
	if err == nil && len(key) == 32 {
		return key, nil
	}
	key = make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("无法生成凭据加密密钥：%w", err)
	}
	if err := writeCredentialKey(key); err != nil {
		clear(key)
		return nil, fmt.Errorf("无法将凭据加密密钥保存到 macOS 钥匙串：%w", err)
	}
	return key, nil
}

func protectCredential(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, errors.New("empty credential data")
	}
	key, err := macOSCredentialKey()
	if err != nil {
		return nil, err
	}
	defer clear(key)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	sealed := aead.Seal(nil, nonce, data, nil)
	result := make([]byte, 1, 1+len(nonce)+len(sealed))
	result[0] = credentialFormatVersion
	result = append(result, nonce...)
	result = append(result, sealed...)
	return result, nil
}

func unprotectCredential(data []byte) ([]byte, error) {
	key, err := macOSCredentialKey()
	if err != nil {
		return nil, err
	}
	defer clear(key)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(data) < 1+aead.NonceSize()+aead.Overhead() || data[0] != credentialFormatVersion {
		return nil, errors.New("invalid macOS credential payload")
	}
	nonce := data[1 : 1+aead.NonceSize()]
	return aead.Open(nil, nonce, data[1+aead.NonceSize():], nil)
}
