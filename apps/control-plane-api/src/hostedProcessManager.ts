/**
 * 托管来源进程管理器。
 * 负责真正拉起/杀掉 hosted-npm 和 hosted-single-file 来源的子进程，
 * 并将 stdout/stderr 写入日志存储。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ConsoleRepository,
  HostedRuntimeState,
  LogEntry,
  Source,
} from "@mcp-agent-platform/shared";

// ── 类型 ────────────────────────────────────────────────────────────

type ManagedProcess = {
  sourceId: string;
  child: ChildProcess;
  startedAt: string;
};

// ── 工具函数（与 runtime/upstreamManager 对齐） ─────────────────────

function resolveCommand(command: string): string {
  if (command === "node" || command === "node.exe") {
    return process.execPath;
  }

  if (command === "npx" || command === "npx.cmd") {
    const nodeBinDir = path.dirname(process.execPath);
    const candidates =
      process.platform === "win32"
        ? [path.join(nodeBinDir, "npx.cmd"), path.join(nodeBinDir, "npx.exe"), path.join(nodeBinDir, "npx")]
        : [path.join(nodeBinDir, "npx")];

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }

  return command;
}

function inheritEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    env[key] = value;
  }
  // 确保 node bin 在 PATH 中
  const nodeBinDir = path.dirname(process.execPath);
  const pathKey = env.PATH !== undefined ? "PATH" : env.Path !== undefined ? "Path" : "PATH";
  const current = env[pathKey] ?? "";
  const parts = current.split(path.delimiter).filter(Boolean);
  if (!parts.includes(nodeBinDir)) {
    env[pathKey] = [nodeBinDir, ...parts].join(path.delimiter);
  }
  return env;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizePathSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "hosted";
}

function findNearestNodeModulesDir(fromFilePath: string): string | null {
  let currentDir = path.dirname(fromFilePath);
  while (true) {
    const candidate = path.join(currentDir, "node_modules");
    if (existsSync(candidate)) return candidate;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

async function ensureNodeModulesLink(workDir: string, targetNodeModulesDir: string): Promise<void> {
  const linkPath = path.join(workDir, "node_modules");
  if (existsSync(linkPath)) return;
  try {
    await symlink(targetNodeModulesDir, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

// ── 启动命令解析 ────────────────────────────────────────────────────

type LaunchConfig = {
  command: string[];
  env: Record<string, string>;
  cwd?: string;
};

async function resolveLaunchConfig(source: Source): Promise<LaunchConfig> {
  if (source.kind === "hosted-npm") {
    const config = source.config as {
      packageName: string;
      packageVersion?: string;
      binName: string;
      args: string[];
      cwd: string | null;
      env: Record<string, string>;
    };
    const packageSpec = config.packageVersion ? `${config.packageName}@${config.packageVersion}` : config.packageName;
    return {
      command: ["npx", "-y", "--package", packageSpec, config.binName, ...config.args],
      env: config.env,
      cwd: config.cwd ?? undefined,
    };
  }

  if (source.kind === "hosted-single-file") {
    const config = source.config as {
      fileName: string;
      runtime: "node" | "tsx" | "python" | "bash";
      source: string;
      args: string[];
      cwd: string | null;
      env: Record<string, string>;
    };

    // 物化单文件到临时目录
    const fileName = path.basename(config.fileName.trim()) || getDefaultFileName(config.runtime);
    const contentHash = sha256(JSON.stringify({ fileName, runtime: config.runtime, source: config.source })).slice(0, 16);
    const workDir = path.join(tmpdir(), "mcp-agent-platform-hosted", sanitizePathSegment(source.id), contentHash);
    const filePath = path.join(workDir, fileName);

    await mkdir(workDir, { recursive: true });
    await writeFile(filePath, config.source.endsWith("\n") ? config.source : `${config.source}\n`, "utf8");

    // 链接 node_modules
    if (config.runtime === "node" || config.runtime === "tsx") {
      const nodeModulesDir = findNearestNodeModulesDir(fileURLToPath(import.meta.url));
      if (nodeModulesDir) {
        await ensureNodeModulesLink(workDir, nodeModulesDir);
      }
    }

    const cmd = buildSingleFileCommand(config.runtime, filePath, config.args);
    return {
      command: cmd,
      env: config.env,
      cwd: config.cwd ?? workDir,
    };
  }

  throw new Error(`不支持的来源类型：${source.kind}`);
}

function getDefaultFileName(runtime: string): string {
  switch (runtime) {
    case "tsx": return "index.ts";
    case "python": return "main.py";
    case "bash": return "main.sh";
    default: return "index.mjs";
  }
}

function buildSingleFileCommand(runtime: string, filePath: string, args: string[]): string[] {
  switch (runtime) {
    case "tsx": return ["npx", "-y", "tsx", filePath, ...args];
    case "python": return ["python3", filePath, ...args];
    case "bash": return ["bash", filePath, ...args];
    default: return ["node", filePath, ...args];
  }
}

// ── 进程管理器 ──────────────────────────────────────────────────────

export class HostedProcessManager {
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly repo: ConsoleRepository;

  constructor(repo: ConsoleRepository) {
    this.repo = repo;
  }

  /** 启动一个 hosted 来源 */
  async start(source: Source): Promise<HostedRuntimeState> {
    // 先停掉已有进程
    if (this.processes.has(source.id)) {
      await this.stop(source.id);
    }

    const launch = await resolveLaunchConfig(source);
    const [cmd, ...args] = launch.command;
    if (!cmd) throw new Error(`无效的启动命令：${source.id}`);

    const resolvedCmd = resolveCommand(cmd);
    const env = inheritEnv(launch.env);
    const now = new Date().toISOString();

    await this.appendLog(source.id, "system", `启动进程: ${launch.command.join(" ")}`);

    const child = spawn(resolvedCmd, args, {
      env,
      cwd: launch.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    });

    const managed: ManagedProcess = {
      sourceId: source.id,
      child,
      startedAt: now,
    };
    this.processes.set(source.id, managed);

    // 捕获 stdout
    child.stdout?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString("utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        void this.appendLog(source.id, "stdout", line);
      }
    });

    // 捕获 stderr
    child.stderr?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString("utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        void this.appendLog(source.id, "stderr", line);
      }
    });

    // 监听退出
    child.on("exit", (code, signal) => {
      this.processes.delete(source.id);
      const exitMsg = signal ? `进程被信号 ${signal} 终止` : `进程退出，退出码 ${code ?? "unknown"}`;
      void this.appendLog(source.id, "system", exitMsg);
      void this.updateState(source.id, {
        status: code === 0 || signal === "SIGTERM" ? "stopped" : "error",
        stoppedAt: new Date().toISOString(),
        pid: null,
        lastExitCode: code ?? null,
        lastError: code !== 0 && code !== null ? exitMsg : null,
      });
    });

    // 监听启动错误
    child.on("error", (error) => {
      this.processes.delete(source.id);
      void this.appendLog(source.id, "system", `进程启动失败: ${error.message}`);
      void this.updateState(source.id, {
        status: "error",
        stoppedAt: new Date().toISOString(),
        pid: null,
        lastError: error.message,
      });
    });

    const state: HostedRuntimeState = {
      sourceId: source.id,
      status: "running",
      pid: child.pid ?? null,
      startedAt: now,
      stoppedAt: null,
      restartCount: ((await this.repo.getHostedState(source.id))?.restartCount ?? 0),
      autoStart: this.getAutoStart(source),
      lastExitCode: null,
      lastError: null,
    };

    await this.repo.saveHostedState(state);
    return state;
  }

  /** 停止一个 hosted 来源 */
  async stop(sourceId: string): Promise<HostedRuntimeState> {
    const managed = this.processes.get(sourceId);
    if (managed) {
      await this.appendLog(sourceId, "system", "正在停止进程...");

      // 先发 SIGTERM，等 3 秒后强杀
      managed.child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (managed.child.killed) {
            resolve();
            return;
          }
          managed.child.kill("SIGKILL");
          resolve();
        }, 3000);

        managed.child.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });

      this.processes.delete(sourceId);
    }

    const current = await this.repo.getHostedState(sourceId);
    const state: HostedRuntimeState = {
      sourceId,
      status: "stopped",
      pid: null,
      startedAt: current?.startedAt ?? null,
      stoppedAt: new Date().toISOString(),
      restartCount: current?.restartCount ?? 0,
      autoStart: current?.autoStart ?? false,
      lastExitCode: current?.lastExitCode ?? null,
      lastError: null,
    };

    await this.repo.saveHostedState(state);
    return state;
  }

  /** 重启一个 hosted 来源 */
  async restart(source: Source): Promise<HostedRuntimeState> {
    await this.stop(source.id);
    const state = await this.start(source);
    const current = await this.repo.getHostedState(source.id);
    const next: HostedRuntimeState = {
      ...state,
      restartCount: (current?.restartCount ?? 0) + 1,
    };
    await this.repo.saveHostedState(next);
    return next;
  }

  /** 检查某个来源是否有运行中的进程 */
  isRunning(sourceId: string): boolean {
    return this.processes.has(sourceId);
  }

  /** 关闭所有进程（用于服务关停时） */
  async shutdownAll(): Promise<void> {
    const ids = [...this.processes.keys()];
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  async startAutoStartSources(): Promise<{
    total: number;
    started: number;
    failed: number;
    results: Array<{ sourceId: string; status: "started" | "failed"; error?: string }>;
  }> {
    const sources = (await this.repo.listSources()).filter(
      (source) => source.enabled && this.getAutoStart(source) && (source.kind === "hosted-npm" || source.kind === "hosted-single-file"),
    );

    const results: Array<{ sourceId: string; status: "started" | "failed"; error?: string }> = [];

    for (const source of sources) {
      try {
        await this.start(source);
        results.push({ sourceId: source.id, status: "started" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ sourceId: source.id, status: "failed", error: message });
      }
    }

    return {
      total: sources.length,
      started: results.filter((item) => item.status === "started").length,
      failed: results.filter((item) => item.status === "failed").length,
      results,
    };
  }

  // ── 内部方法 ────────────────────────────────────────────────────

  private getAutoStart(source: Source): boolean {
    if (source.kind === "hosted-npm" || source.kind === "hosted-single-file") {
      return (source.config as { autoStart?: boolean }).autoStart ?? false;
    }
    return false;
  }

  private async updateState(sourceId: string, patch: Partial<HostedRuntimeState>): Promise<void> {
    const current = await this.repo.getHostedState(sourceId);
    if (!current) return;
    await this.repo.saveHostedState({ ...current, ...patch });
  }

  private async appendLog(sourceId: string, stream: "stdout" | "stderr" | "system", message: string): Promise<void> {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceId,
      timestamp: new Date().toISOString(),
      stream,
      message,
    };
    await this.repo.appendLog(entry);
  }
}
