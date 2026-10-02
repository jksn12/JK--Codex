# 即客-Codex 合并说明

源码仓库：`https://github.com/jksn12/JK--Codex`。


本分支把 Codex-X 0.3.25 与用户提供的“即客破 3.1.0-preview.1”重新整合为一个名为“即客-Codex”的 Tauri 应用。

- Codex-X 保持原 MIT 许可证与完整功能。
- 即客破的工作台、席位包、工作流、中转适配、IDA 工具箱及安装/回滚逻辑作为内置模块保留。
- 即客破后端通过应用内置的 Node.js 运行时启动，前端通过受控 IPC 桥接，不向页面开放 Node.js 权限。
- 构建前会把当前平台的 `process.execPath` 复制到应用资源目录，并把即客破后端资源归档为单个 ZIP；生成安装包后不依赖用户另装 Node.js。
- Node.js 按其许可证分发；发布安装包前应同时附带 Node.js LICENSE 与本仓库 THIRD_PARTY_NOTICES。

## 本地开发

```bash
pnpm install
pnpm --dir apps/desktop typecheck
pnpm --dir apps/desktop tauri dev
```

## 构建

```bash
pnpm build
```

`build:renderer` 会先执行 `prepare:jikepo-runtime`，将当前平台 Node.js 复制进应用资源。请在目标平台或对应构建服务器上分别构建 Windows、macOS 与 Linux 安装包。
