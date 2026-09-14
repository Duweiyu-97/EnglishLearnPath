//go:build !windows && !darwin

package main

import "errors"

func selectDirectory() (string, bool, error) {
	return "", false, errors.New("当前版本只支持 Windows 文件夹选择器")
}
