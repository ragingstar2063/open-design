#!/usr/bin/env bash
set -Eeuo pipefail

mode="${1:-${OD_CI_MODE:-}}"

if [ -z "$mode" ]; then
  echo "usage: $0 <probe|setup>" >&2
  exit 2
fi

ci_root="${GITHUB_WORKSPACE:-$(pwd)}"
out_dir="$ci_root/.od/ci"
manifest="$out_dir/$mode-manifest.json"
summary="${GITHUB_STEP_SUMMARY:-}"

mkdir -p "$out_dir"

append_summary() {
  if [ -n "$summary" ]; then
    printf '%s\n' "$*" >> "$summary"
  fi
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/}"
  printf '%s' "$value"
}

capture_cmd() {
  local name="$1"
  shift
  local value
  if value="$("$@" 2>/dev/null | head -1)"; then
    printf '%s' "$value"
  else
    printf ''
  fi
}

require_mode() {
  case "$mode" in
    probe | setup) ;;
    *)
      echo "unknown CI mode: $mode" >&2
      exit 2
      ;;
  esac
}

require_mode

lane="${OD_CI_LANE:-unknown}"
allow_docker="${OD_CI_ALLOW_DOCKER:-0}"
install_timeout_seconds="${OD_CI_INSTALL_TIMEOUT_SECONDS:-1500}"
pnpm_fetch_retries="${OD_CI_PNPM_FETCH_RETRIES:-6}"
pnpm_fetch_retry_maxtimeout="${OD_CI_PNPM_FETCH_RETRY_MAXTIMEOUT:-120000}"
pnpm_fetch_retry_mintimeout="${OD_CI_PNPM_FETCH_RETRY_MINTIMEOUT:-20000}"
pnpm_install_flags="${OD_CI_PNPM_INSTALL_FLAGS:---frozen-lockfile}"
pnpm_network_timeout="${OD_CI_PNPM_NETWORK_TIMEOUT:-180000}"
pnpm_store_dir="${OD_CI_PNPM_STORE_DIR:-}"
runner_name="${RUNNER_NAME:-unknown}"
runner_os="${RUNNER_OS:-unknown}"
runner_arch="${RUNNER_ARCH:-unknown}"
github_sha="${GITHUB_SHA:-unknown}"
github_ref="${GITHUB_REF:-unknown}"
github_run_id="${GITHUB_RUN_ID:-unknown}"

echo "ci mode: $mode"
echo "ci lane: $lane"
echo "runner: $runner_name / $runner_os / $runner_arch"
echo "ref: $github_ref"
echo "sha: $github_sha"

append_summary "## CI runner"
append_summary ""
append_summary "| Field | Value |"
append_summary "| --- | --- |"
append_summary "| Lane | \`$lane\` |"
append_summary "| Mode | \`$mode\` |"
append_summary "| Runner | \`$runner_name\` |"
append_summary "| Runner OS | \`$runner_os\` |"
append_summary "| Runner arch | \`$runner_arch\` |"
append_summary "| Ref | \`$github_ref\` |"
append_summary "| SHA | \`$github_sha\` |"

node_version="$(capture_cmd node node --version)"
npm_version="$(capture_cmd npm npm --version)"
corepack_version="$(capture_cmd corepack corepack --version)"
pnpm_version="$(capture_cmd pnpm pnpm --version)"
git_version="$(capture_cmd git git --version)"
docker_version="$(capture_cmd docker docker --version)"
kernel="$(capture_cmd uname uname -a)"
disk_root="$(df -h / | awk 'NR==2 {print $4 " available of " $2}')"
workspace_disk="$(df -h "$ci_root" | awk 'NR==2 {print $4 " available of " $2}')"
pnpm_store="$(capture_cmd pnpm-store pnpm store path --silent)"

if [ -z "$node_version" ] || [ -z "$npm_version" ] || [ -z "$corepack_version" ] || [ -z "$pnpm_version" ]; then
  echo "missing required Node package-manager toolchain" >&2
  exit 1
fi

append_summary ""
append_summary "### Toolchain"
append_summary ""
append_summary "| Tool | Version |"
append_summary "| --- | --- |"
append_summary "| git | \`$git_version\` |"
append_summary "| node | \`$node_version\` |"
append_summary "| npm | \`$npm_version\` |"
append_summary "| corepack | \`$corepack_version\` |"
append_summary "| pnpm | \`$pnpm_version\` |"
append_summary "| docker | \`$docker_version\` |"

if [ -n "$pnpm_store_dir" ]; then
  mkdir -p "$pnpm_store_dir"
  export npm_config_store_dir="$pnpm_store_dir"
  pnpm_store="$(pnpm store path --silent)"
fi
export npm_config_fetch_retries="$pnpm_fetch_retries"
export npm_config_fetch_retry_maxtimeout="$pnpm_fetch_retry_maxtimeout"
export npm_config_fetch_retry_mintimeout="$pnpm_fetch_retry_mintimeout"
export npm_config_network_timeout="$pnpm_network_timeout"

append_summary ""
append_summary "### Storage"
append_summary ""
append_summary "| Path | Available |"
append_summary "| --- | --- |"
append_summary "| / | \`$disk_root\` |"
append_summary "| workspace | \`$workspace_disk\` |"
append_summary "| pnpm store | \`$pnpm_store\` |"

docker_status="skipped"
if [ "$allow_docker" = "1" ]; then
  timeout 30s docker ps >/dev/null
  docker_status="ok"
fi

append_summary ""
append_summary "### Docker"
append_summary ""
append_summary "Docker smoke: \`$docker_status\`"

install_status="skipped"
install_seconds="0"
install_exit_code="0"
node_modules_size="not-created"
pnpm_store_size="unknown"

if [ "$mode" = "setup" ]; then
  append_summary ""
  append_summary "### Install"
  append_summary ""
  append_summary "Command: \`pnpm install $pnpm_install_flags\`"
  append_summary ""

  echo "pnpm store: $pnpm_store"
  echo "pnpm install flags: $pnpm_install_flags"
  echo "install timeout seconds: $install_timeout_seconds"
  echo "pnpm fetch retries: $pnpm_fetch_retries"
  echo "pnpm fetch retry min timeout: $pnpm_fetch_retry_mintimeout"
  echo "pnpm fetch retry max timeout: $pnpm_fetch_retry_maxtimeout"
  echo "pnpm network timeout: $pnpm_network_timeout"

  install_start="$(date +%s)"
  set +e
  # shellcheck disable=SC2086
  timeout "${install_timeout_seconds}s" pnpm install $pnpm_install_flags
  install_exit_code="$?"
  set -e
  install_seconds="$(( $(date +%s) - install_start ))"
  if [ "$install_exit_code" = "0" ]; then
    install_status="ok"
  else
    install_status="failed"
  fi

  if [ -d "$ci_root/node_modules" ]; then
    node_modules_size="$(du -sh "$ci_root/node_modules" 2>/dev/null | awk '{print $1}')"
  fi
fi

if [ -n "$pnpm_store" ] && [ -d "$pnpm_store" ]; then
  pnpm_store_size="$(du -sh "$pnpm_store" 2>/dev/null | awk '{print $1}')"
fi

append_summary ""
append_summary "### Dependency setup"
append_summary ""
append_summary "| Field | Value |"
append_summary "| --- | --- |"
append_summary "| Install status | \`$install_status\` |"
append_summary "| Install exit code | \`$install_exit_code\` |"
append_summary "| Install seconds | \`$install_seconds\` |"
append_summary "| node_modules size | \`$node_modules_size\` |"
append_summary "| pnpm store size | \`$pnpm_store_size\` |"

cat > "$manifest" <<JSON
{
  "mode": "$(json_escape "$mode")",
  "lane": "$(json_escape "$lane")",
  "runnerName": "$(json_escape "$runner_name")",
  "runnerOs": "$(json_escape "$runner_os")",
  "runnerArch": "$(json_escape "$runner_arch")",
  "githubRef": "$(json_escape "$github_ref")",
  "githubSha": "$(json_escape "$github_sha")",
  "githubRunId": "$(json_escape "$github_run_id")",
  "kernel": "$(json_escape "$kernel")",
  "gitVersion": "$(json_escape "$git_version")",
  "nodeVersion": "$(json_escape "$node_version")",
  "npmVersion": "$(json_escape "$npm_version")",
  "corepackVersion": "$(json_escape "$corepack_version")",
  "pnpmVersion": "$(json_escape "$pnpm_version")",
  "pnpmStore": "$(json_escape "$pnpm_store")",
  "pnpmStoreSize": "$(json_escape "$pnpm_store_size")",
  "pnpmFetchRetries": "$(json_escape "$pnpm_fetch_retries")",
  "pnpmFetchRetryMaxTimeout": "$(json_escape "$pnpm_fetch_retry_maxtimeout")",
  "pnpmFetchRetryMinTimeout": "$(json_escape "$pnpm_fetch_retry_mintimeout")",
  "pnpmInstallFlags": "$(json_escape "$pnpm_install_flags")",
  "pnpmNetworkTimeout": "$(json_escape "$pnpm_network_timeout")",
  "installStatus": "$(json_escape "$install_status")",
  "installExitCode": "$(json_escape "$install_exit_code")",
  "installSeconds": "$(json_escape "$install_seconds")",
  "nodeModulesSize": "$(json_escape "$node_modules_size")",
  "dockerVersion": "$(json_escape "$docker_version")",
  "dockerStatus": "$(json_escape "$docker_status")",
  "rootDisk": "$(json_escape "$disk_root")",
  "workspaceDisk": "$(json_escape "$workspace_disk")"
}
JSON

echo "manifest: $manifest"

if [ "$install_exit_code" != "0" ]; then
  exit "$install_exit_code"
fi
