package main

// ThunderClaw Native Messaging Host — Go 重写。
//
// 替代 native-host/index.mjs。装一个 ~6MB 的静态 binary，**用户机器上不再需要 Node**。
//
// 跨平台 build：
//   GOOS=linux   GOARCH=amd64 go build -o thunderclaw-host-linux-amd64
//   GOOS=linux   GOARCH=arm64 go build -o thunderclaw-host-linux-arm64
//   GOOS=darwin  GOARCH=amd64 go build -o thunderclaw-host-darwin-amd64
//   GOOS=darwin  GOARCH=arm64 go build -o thunderclaw-host-darwin-arm64
//   GOOS=windows GOARCH=amd64 go build -o thunderclaw-host-windows-amd64.exe
//
// VERSION 在 build 时用 -ldflags 注入，跟 src/manifest.json 严格对齐。

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
)

// 这两个变量在 release build 时被 -ldflags 覆盖：
//   go build -ldflags "-X main.Version=0.3.0 -X main.ProtocolVersion=4"
// dev build 留着 0.0.0-dev 作为兜底标识（version handshake 会 mismatch → 红条提示用户重装）
var (
	Version         = "0.0.0-dev"
	ProtocolVersion = "4"
)

type rpcRequest struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type rpcResponse struct {
	ID     string `json:"id"`
	Result any    `json:"result,omitempty"`
	Error  *rpcErrorObj `json:"error,omitempty"`
}

type rpcErrorObj struct {
	Message string `json:"message"`
}

func logErr(format string, a ...any) {
	fmt.Fprintf(os.Stderr, "[thunderclaw-host] "+format+"\n", a...)
}

func handle(req rpcRequest) (any, error) {
	switch req.Method {
	case "ping":
		return map[string]any{"ok": true, "pid": os.Getpid()}, nil

	case "host-info":
		// 跟 Node 版严格一致：返回 {version, protocolVersion}
		// protocolVersion 是 number，所以这里转 int
		var pv int
		fmt.Sscanf(ProtocolVersion, "%d", &pv)
		return map[string]any{
			"version":         Version,
			"protocolVersion": pv,
		}, nil

	case "probe-cli":
		return probeAll(), nil

	case "llm-call":
		var p llmCallParams
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return nil, fmt.Errorf("invalid llm-call params: %w", err)
		}
		text, err := callLLM(p)
		if err != nil {
			return nil, err
		}
		return map[string]string{"text": text}, nil

	case "open-calendar-ics":
		var p openCalendarICSParams
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return nil, fmt.Errorf("invalid open-calendar-ics params: %w", err)
		}
		return openCalendarICS(p)

	case "direct-calendar-create":
		// 直接 INSERT 到 TB 的本地日历 SQLite，不走导入对话框。
		// AMO unlisted 签名禁用 experiment_apis，SQLite 直写是当前唯一
		// 能做到"加日历无对话框"的路径。
		var p directCalendarParams
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return nil, fmt.Errorf("invalid direct-calendar-create params: %w", err)
		}
		return directCalendarCreate(p)

	default:
		return nil, fmt.Errorf("unknown method: %s", req.Method)
	}
}

func main() {
	logErr("started, pid %d, version %s", os.Getpid(), Version)

	// 串行处理 stdin，逐条 RPC。
	// Mozilla native-messaging 协议是请求-响应一来一回，不像 long-polling 那样需要并发。
	// 串行还顺便避免 LLM CLI 多进程同时跑（PRD §3 说"v1 假设串行"）。
	for {
		body, err := readMessage(os.Stdin)
		if err != nil {
			if errors.Is(err, io.EOF) {
				logErr("stdin EOF, exiting")
				return
			}
			logErr("read message: %v", err)
			return
		}
		var req rpcRequest
		if err := json.Unmarshal(body, &req); err != nil {
			logErr("unmarshal request: %v", err)
			continue
		}
		result, err := handle(req)
		var resp rpcResponse
		resp.ID = req.ID
		if err != nil {
			logErr("error in %s: %v", req.Method, err)
			resp.Error = &rpcErrorObj{Message: err.Error()}
		} else {
			resp.Result = result
		}
		if werr := writeMessage(os.Stdout, resp); werr != nil {
			logErr("write response: %v", werr)
			return
		}
	}
}
