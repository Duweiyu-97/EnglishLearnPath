//go:build windows

package main

import (
	"errors"
	"runtime"
	"syscall"
	"unsafe"
)

type credentialBlob struct {
	size uint32
	data *byte
}

var credentialCrypt32 = syscall.NewLazyDLL("crypt32.dll")
var credentialProtect = credentialCrypt32.NewProc("CryptProtectData")
var credentialUnprotect = credentialCrypt32.NewProc("CryptUnprotectData")
var credentialFree = syscall.NewLazyDLL("kernel32.dll").NewProc("LocalFree")

func cryptCredential(data []byte, decrypt bool) ([]byte, error) {
	if len(data) == 0 {
		return nil, errors.New("empty credential data")
	}
	input := credentialBlob{size: uint32(len(data)), data: &data[0]}
	var output credentialBlob
	proc := credentialProtect
	if decrypt {
		proc = credentialUnprotect
	}
	// Current-user scope only. UI is forbidden; no machine-wide scope flag.
	ok, _, err := proc.Call(uintptr(unsafe.Pointer(&input)), 0, 0, 0, 0, 1, uintptr(unsafe.Pointer(&output)))
	runtime.KeepAlive(data)
	if ok == 0 {
		return nil, err
	}
	defer credentialFree.Call(uintptr(unsafe.Pointer(output.data)))
	result := append([]byte(nil), unsafe.Slice(output.data, int(output.size))...)
	if decrypt {
		clear(unsafe.Slice(output.data, int(output.size)))
	}
	return result, nil
}

func protectCredential(data []byte) ([]byte, error)   { return cryptCredential(data, false) }
func unprotectCredential(data []byte) ([]byte, error) { return cryptCredential(data, true) }
