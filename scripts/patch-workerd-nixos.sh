#!/usr/bin/env bash
set -euo pipefail

# Cloudflare's prebuilt @cloudflare/workerd-* binaries hardcode
# /lib64/ld-linux-x86-64.so.2 as their dynamic linker, which doesn't exist on
# NixOS. That makes wrangler's local dev server fail with a plain
# `spawn ... ENOENT` when it tries to exec workerd, since the kernel can't
# find the interpreter baked into the ELF header.
#
# This repoints the interpreter/rpath at the glibc that `node` itself is
# already linked against (guaranteed present, since this runs under node via
# a package-manager lifecycle script), so no store path needs to be
# hardcoded here. No-op anywhere the standard loader already exists.
#
# Shared by web/ (pnpm) and live-sync/ (npm) via their own postinstall
# hooks — invoke as `bash ../scripts/patch-workerd-nixos.sh` so it runs with
# cwd = the package directory whose node_modules should be scanned. Uses a
# broad `find` (not a fixed glob) since wrangler pulls in workerd under more
# than one package name/layout depending on package manager and version
# (e.g. both `workerd` and `@cloudflare/workerd-<platform>`).

if [ -e /lib64/ld-linux-x86-64.so.2 ]; then
  exit 0
fi

command -v patchelf >/dev/null 2>&1 || exit 0

interpreter=$(patchelf --print-interpreter "$(command -v node)")
rpath=$(dirname "$interpreter")

find node_modules -path "*/workerd*/bin/workerd" -type f 2>/dev/null | while read -r bin; do
  # Skip non-ELF binaries (e.g. macOS darwin builds)
  file_type=$(file -b "$bin" 2>/dev/null || true)
  [[ "$file_type" == *"ELF"* ]] || continue

  current=$(patchelf --print-interpreter "$bin" 2>/dev/null || true)
  [ "$current" = "$interpreter" ] && continue

  # Break any hardlink into a package manager's content-addressable store
  # (pnpm) before patching, so this doesn't mutate a file shared with other
  # pnpm-managed projects.
  cp "$bin" "$bin.tmp" && mv "$bin.tmp" "$bin"
  chmod 755 "$bin"
  patchelf --set-interpreter "$interpreter" --set-rpath "$rpath" "$bin"
  echo "patch-workerd-nixos: patched $bin"
done
