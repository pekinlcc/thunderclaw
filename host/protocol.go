package main

// Native messaging wire protocol：每条消息前 4 字节 little-endian 长度，紧跟 UTF-8 JSON。
// Mozilla doc: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging
//
// 跟原 Node 版（native-host/protocol.mjs）严格兼容——扩展端不需要任何改动。

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
)

// 消息上限：Mozilla 规范 1MB；我们的 prompt 偶尔接近这个量级，留余量
const maxMessageBytes = 4 * 1024 * 1024

// stdout 写入要串行——多 goroutine 同时写会让 length-prefix 错位
var writeMu sync.Mutex

func readMessage(r io.Reader) (json.RawMessage, error) {
	var lenBuf [4]byte
	if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
		return nil, err
	}
	n := binary.LittleEndian.Uint32(lenBuf[:])
	if n == 0 || n > maxMessageBytes {
		return nil, fmt.Errorf("message length out of range: %d", n)
	}
	body := make([]byte, n)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	return body, nil
}

func writeMessage(w io.Writer, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	if len(body) > maxMessageBytes {
		return errors.New("response exceeds max message size")
	}
	writeMu.Lock()
	defer writeMu.Unlock()
	var lenBuf [4]byte
	binary.LittleEndian.PutUint32(lenBuf[:], uint32(len(body)))
	if _, err := w.Write(lenBuf[:]); err != nil {
		return err
	}
	if _, err := w.Write(body); err != nil {
		return err
	}
	return nil
}
