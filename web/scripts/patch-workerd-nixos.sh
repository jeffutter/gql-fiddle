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
# a pnpm lifecycle script), so no store path needs to be hardcoded here.
#
# No-op anywhere the standard loader already exists (i.e. not NixOS).

if [ -e /lib64/ld-linux-x86-64.so.2 ]; then
  exit 0
fi

command -v patchelf >/dev/null 2>&1 || exit 0

interpreter=$(patchelf --print-interpreter "$(command -v node)")
rpath=$(dirname "$interpreter")

shopt -s nullglob
for bin in node_modules/.pnpm/@cloudflare+workerd-*/node_modules/@cloudflare/workerd-*/bin/workerd; do
  [ -f "$bin" ] || continue

  current=$(patchelf --print-interpreter "$bin" 2>/dev/null || true)
  [ "$current" = "$interpreter" ] && continue

  # Break the hardlink into pnpm's content-addressable store before patching,
  # so this doesn't mutate a file shared with other pnpm-managed projects.
  cp "$bin" "$bin.tmp" && mv "$bin.tmp" "$bin"
  chmod 755 "$bin"
  patchelf --set-interpreter "$interpreter" --set-rpath "$rpath" "$bin"
  echo "patch-workerd-nixos: patched $bin"
done
