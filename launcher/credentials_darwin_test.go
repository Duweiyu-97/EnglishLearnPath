//go:build darwin

package main

import (
	"bytes"
	"errors"
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	testKey := bytes.Repeat([]byte{3}, 32)
	readCredentialKey = func() ([]byte, error) { return append([]byte(nil), testKey...), nil }
	writeCredentialKey = func([]byte) error { return nil }
	os.Exit(m.Run())
}

func TestMacOSCredentialRoundTripUsesKeychainBackedKey(t *testing.T) {
	originalRead, originalWrite := readCredentialKey, writeCredentialKey
	t.Cleanup(func() { readCredentialKey, writeCredentialKey = originalRead, originalWrite })
	var saved []byte
	readCredentialKey = func() ([]byte, error) {
		if len(saved) == 0 {
			return nil, errors.New("not found")
		}
		return append([]byte(nil), saved...), nil
	}
	writeCredentialKey = func(key []byte) error {
		saved = append([]byte(nil), key...)
		return nil
	}

	plain := []byte(`{"apiKey":"synthetic-macos-secret"}`)
	encrypted, err := protectCredential(plain)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encrypted, []byte("synthetic-macos-secret")) {
		t.Fatal("credential payload contains plaintext")
	}
	restored, err := unprotectCredential(encrypted)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(restored, plain) {
		t.Fatalf("credential round trip mismatch: %q", restored)
	}
}

func TestMacOSCredentialRejectsTampering(t *testing.T) {
	originalRead, originalWrite := readCredentialKey, writeCredentialKey
	t.Cleanup(func() { readCredentialKey, writeCredentialKey = originalRead, originalWrite })
	key := bytes.Repeat([]byte{7}, 32)
	readCredentialKey = func() ([]byte, error) { return append([]byte(nil), key...), nil }
	writeCredentialKey = func([]byte) error { return nil }

	encrypted, err := protectCredential([]byte("synthetic"))
	if err != nil {
		t.Fatal(err)
	}
	encrypted[len(encrypted)-1] ^= 0xff
	if _, err := unprotectCredential(encrypted); err == nil {
		t.Fatal("tampered credential payload was accepted")
	}
}
