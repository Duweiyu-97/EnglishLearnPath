//go:build !windows

package main

import "errors"

func protectCredential([]byte) ([]byte, error) {
	return nil, errors.New("secure credential storage requires Windows")
}
func unprotectCredential([]byte) ([]byte, error) {
	return nil, errors.New("secure credential storage requires Windows")
}
