#!/usr/bin/env bash
set -euo pipefail

# ── 颜色 ─────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

# ── 环境检测 ──────────────────────────────────────────────────────────
check_env() {
  echo -e "\n${BOLD}环境检测${NC}\n"
  local ok_count=0
  local total=3

  # Node.js
  if command -v node &>/dev/null; then
    ok "Node.js $(node -v)"
    ((ok_count++))
  else
    fail "Node.js 未找到"
  fi

  # pnpm
  if command -v pnpm &>/dev/null; then
    ok "pnpm $(pnpm -v)"
    ((ok_count++))
  else
    fail "pnpm 未找到"
  fi

  # 依赖安装
  if [ -d "node_modules" ]; then
    ok "依赖已安装"
    ((ok_count++))
  else
    warn "依赖未安装，正在安装..."
    pnpm install
    if [ $? -eq 0 ]; then
      ok "依赖安装完成"
      ((ok_count++))
    else
      fail "依赖安装失败"
    fi
  fi

  echo ""
  if [ $ok_count -eq $total ]; then
    ok "环境检测通过 ($ok_count/$total)"
  else
    fail "环境检测未通过 ($ok_count/$total)"
    return 1
  fi
}

# ── 本地运行 ──────────────────────────────────────────────────────────
run_dev() {
  echo -e "\n${BOLD}启动本地开发${NC}\n"
  check_env || return 1

  echo ""
  info "构建共享包..."
  pnpm -r --filter ./packages/shared --filter ./packages/runtime build 2>/dev/null || true

  echo ""
  info "启动控制面 API + Web..."
  pnpm dev:api &
  local api_pid=$!
  sleep 1
  pnpm dev:web &
  local web_pid=$!

  echo ""
  ok "API 和 Web 已启动"
  info "按 Ctrl+C 停止"

  trap "kill $api_pid $web_pid 2>/dev/null; exit 0" INT TERM
  wait
}

# ── 打包 ──────────────────────────────────────────────────────────────
run_build() {
  echo -e "\n${BOLD}执行打包${NC}\n"
  check_env || return 1

  echo ""
  info "构建全部包..."
  pnpm build

  echo ""
  ok "打包完成"
}

# ── 参数分发 ──────────────────────────────────────────────────────────
case "${1:-}" in
  --check)
    check_env
    ;;
  --run)
    run_dev
    ;;
  --build)
    run_build
    ;;
  *)
    echo -e "\n${BOLD}mcp-hub${NC}\n"
    echo "  1) 环境检测"
    echo "  2) 本地运行"
    echo "  3) 执行打包"
    echo ""
    read -rp "  请选择 [1-3]: " choice
    case "$choice" in
      1) check_env ;;
      2) run_dev ;;
      3) run_build ;;
      *) echo "  无效选择"; exit 1 ;;
    esac
    ;;
esac
