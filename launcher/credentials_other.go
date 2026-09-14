//go:build !windows && !darwin

package main

import "errors"

const credentialFilename = "ai-credentials.secure"

func protectCredential([]byte) ([]byte, error) {
	return nil, errors.New("secure credential storage requires Windows")
}
func unprotectCredential([]byte) ([]byte, error) {
	return nil, errors.New("secure credential storage requires Windows")
}
