#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REQUIRED_NODE_MAJOR=18
MODE="menu"

usage() {
  cat <<'EOF'
用法:
  bash scripts/bootstrap.sh
  bash scripts/bootstrap.sh --check
  bash scripts/bootstrap.sh --run
  bash scripts/bootstrap.sh --build

说明:
  不带参数时会进入数字菜单，你可以输入 1 / 2 / 3 / 0 选择操作。
  本地运行时如果默认端口被占用，会自动顺延到下一个可用端口。

参数:
  --check  环境检测；如果缺少依赖会自动安装
  --run    本地运行 control-plane-api 和 control-plane-web
  --build  执行打包
  --help   显示帮助
EOF
}

log_info() {
  printf '[INFO] %s\n' "$1"
}

log_warn() {
  printf '[WARN] %s\n' "$1"
}

log_error() {
  printf '[ERROR] %s\n' "$1" >&2
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

to_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

run_in_root() {
  local description="$1"
  shift
  log_info "$description"
  (
    cd "$ROOT_DIR"
    "$@"
  )
}

required_pnpm() {
  awk -F'"' '/"packageManager"/ { print $4; exit }' "$ROOT_DIR/package.json"
}

port_usage() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
}

pick_available_port() {
  local preferred_port="$1"
  local label="$2"
  local port="$preferred_port"
  local usage=""

  while true; do
    usage="$(port_usage "$port")"
    if [[ -z "$usage" ]]; then
      if [[ "$port" != "$preferred_port" ]]; then
        printf '[WARN] %s\n' "${label} 默认端口 ${preferred_port} 已被占用，自动改用 ${port}。" >&2
      fi
      printf '%s\n' "$port"
      return 0
    fi

    port=$((port + 1))
    if [[ "$port" -gt $((preferred_port + 20)) ]]; then
      log_error "${label} 在 ${preferred_port} 到 $((preferred_port + 20)) 之间都没有可用端口。"
      printf '%s\n' "$usage"
      return 1
    fi
  done
}

run_in_dir_with_env() {
  local work_dir="$1"
  shift
  (
    cd "$work_dir"
    env "$@"
  )
}

print_environment_summary() {
  local os_name arch_name
  os_name="$(uname -s)"
  arch_name="$(uname -m)"

  log_info "项目目录: ${ROOT_DIR}"
  log_info "操作系统: ${os_name}"
  log_info "机器架构: ${arch_name}"
}

check_node() {
  local version major

  if ! command_exists node; then
    log_error "未检测到 Node.js，请先安装 Node.js >= ${REQUIRED_NODE_MAJOR}。"
    return 1
  fi

  version="$(node -v)"
  major="$(printf '%s' "$version" | sed -E 's/^v([0-9]+).*/\1/')"

  if [[ -z "$major" || "$major" -lt "$REQUIRED_NODE_MAJOR" ]]; then
    log_error "当前 Node.js 版本为 ${version}，需要 >= v${REQUIRED_NODE_MAJOR}。"
    return 1
  fi

  log_info "Node.js 版本: ${version}"
}

ensure_pnpm() {
  local wanted current
  wanted="$(required_pnpm)"

  if command_exists pnpm; then
    current="$(pnpm --version)"
    log_info "pnpm 版本: v${current}"
    return 0
  fi

  if ! command_exists corepack; then
    log_error "未检测到 pnpm，且当前环境没有 corepack，无法自动安装。"
    return 1
  fi

  run_in_root "正在通过 corepack 激活 ${wanted}" corepack prepare "$wanted" --activate
  log_info "pnpm 已通过 corepack 激活。"
}

ensure_dependencies() {
  if [[ -d "$ROOT_DIR/node_modules" ]]; then
    log_info "依赖已就绪。"
    return 0
  fi

  log_warn "未检测到 node_modules，开始自动安装依赖。"
  run_in_root "安装依赖中..." pnpm install
}

prepare_environment() {
  print_environment_summary
  check_node
  ensure_pnpm
  ensure_dependencies
}

run_check_mode() {
  prepare_environment
  log_info "环境已就绪。"
}

run_build_mode() {
  prepare_environment
  run_in_root "执行打包中..." pnpm build
  log_info "打包完成。"
}

run_local_mode() {
  local api_pid web_pid status=0 interrupted=0 api_port web_port api_base_url web_origin

  prepare_environment
  api_port="$(pick_available_port 3100 "API")"
  web_port="$(pick_available_port 5173 "Web")"
  api_base_url="http://127.0.0.1:${api_port}"
  web_origin="http://127.0.0.1:${web_port}"

  log_info "本地运行启动中..."
  log_info "API: ${api_base_url}"
  log_info "Web: ${web_origin}"
  log_info "按 Ctrl-C 可同时停止两个进程。"

  (
    cd "$ROOT_DIR/apps/control-plane-api"
    pnpm exec tsx watch src/cli.ts --host 127.0.0.1 --port "$api_port"
  ) &
  api_pid=$!
  (
    cd "$ROOT_DIR/apps/control-plane-web"
    MCP_CONTROL_PLANE_WEB_PORT="$web_port" \
    MCP_CONTROL_PLANE_API_BASE_URL="$api_base_url" \
    VITE_LOCAL_API_BASE_URL="$api_base_url" \
      pnpm exec vite --host 127.0.0.1 --port "$web_port"
  ) &
  web_pid=$!

  cleanup() {
    kill "$api_pid" "$web_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
    wait "$web_pid" 2>/dev/null || true
  }

  on_interrupt() {
    interrupted=1
    cleanup
  }

  trap on_interrupt INT TERM
  trap cleanup EXIT

  wait "$api_pid" || status=$?
  if [[ "$interrupted" -eq 0 ]]; then
    wait "$web_pid" || status=$?
  fi

  trap - INT TERM EXIT
  cleanup
  log_info "本地运行已停止。"

  if [[ "$interrupted" -eq 1 || "$status" -eq 130 || "$status" -eq 143 ]]; then
    return 0
  fi

  return "$status"
}

print_menu() {
  cat <<'EOF'

================ MCP Agent Platform ================
1. 环境检测
2. 本地运行
3. 执行打包
0. 退出
===================================================
EOF
}

run_menu() {
  local choice

  while true; do
    print_menu
    printf '请输入编号: '
    read -r choice || true

    case "$(to_lower "${choice:-}")" in
      1)
        run_check_mode
        ;;
      2)
        run_local_mode
        ;;
      3)
        run_build_mode
        ;;
      0|q|quit|exit)
        log_info "已退出。"
        return 0
        ;;
      *)
        log_warn "无效编号，请输入 0 到 3。"
        ;;
    esac
  done
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --check)
        MODE="check"
        ;;
      --run)
        MODE="run"
        ;;
      --build)
        MODE="build"
        ;;
      --help)
        usage
        exit 0
        ;;
      *)
        log_error "未知参数: $1"
        usage
        exit 2
        ;;
    esac
    shift
  done
}

main() {
  parse_args "$@"

  case "$MODE" in
    menu)
      run_menu
      ;;
    check)
      run_check_mode
      ;;
    run)
      run_local_mode
      ;;
    build)
      run_build_mode
      ;;
    *)
      log_error "未知模式: $MODE"
      exit 2
      ;;
  esac
}

main "$@"
