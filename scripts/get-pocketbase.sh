#!/bin/sh
# Fetches the pinned PocketBase release into server/ (Linux and macOS, amd64 and arm64).
# On Windows use scripts/get-pocketbase.ps1.
#
# Upgrades are a deliberate change, never automatic: bump PB_VERSION and every checksum below together
# (copy them from checksums.txt on the release page; get-pocketbase.ps1 has its own pair), commit, then
# run this script again. Never use `pocketbase update`.
#
# Safe to re-run: it does nothing when server/pocketbase already reports PB_VERSION, and it replaces the
# binary when the version differs. The download is checked against the SHA-256 below before anything is
# extracted, and only the pocketbase binary is taken from the archive.
set -eu

PB_VERSION=0.40.5

# SHA-256 of pocketbase_<version>_<os>_<arch>.zip
pinned_sha256() {
  case "$1" in
    darwin_amd64) echo 3640f0c4d9e0e5a47e321f10ddf6698508d4f20721bcf5dfb7c4192835e5105f ;;
    darwin_arm64) echo d9a176e0491bc825fff88c2a4edffb07307f785ac2bd9710e82c5d223669fc17 ;;
    linux_amd64) echo 1dbea1b01eb3dfe64953513859d01e759c96650c4e3264fa4eecd54b769382e4 ;;
    linux_arm64) echo 570baa1c45d2fb92fc0073582b945ca0ece03cbf9837ccabf49a222f99dd02e3 ;;
  esac
}

die() {
  echo "get-pocketbase: $*" >&2
  exit 1
}

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) die "unsupported OS '$(uname -s)'. On Windows run scripts/get-pocketbase.ps1." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) die "unsupported CPU '$(uname -m)' (need amd64 or arm64)." ;;
esac
expected=$(pinned_sha256 "${os}_${arch}")
[ -n "$expected" ] || die "no pinned checksum for ${os}_${arch}."

server_dir=$(cd "$(dirname "$0")/.." && pwd)/server
bin=$server_dir/pocketbase

if [ -x "$bin" ] && [ "$("$bin" --version 2>/dev/null | awk '{print $NF}')" = "$PB_VERSION" ]; then
  echo "PocketBase $PB_VERSION is already installed: $bin"
  exit 0
fi

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    die "need sha256sum, shasum or openssl to verify the download."
  fi
}

# Extracts only the named file. Not every machine has unzip, so fall back to bsdtar, then python3.
extract_one() {
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$1" "$3" -d "$2"
  elif command -v bsdtar >/dev/null 2>&1; then
    bsdtar -xf "$1" -C "$2" "$3"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -I -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extract(sys.argv[3], sys.argv[2])' "$1" "$2" "$3"
  else
    die "need unzip, bsdtar or python3 to extract the download. Install one of them and run this again."
  fi
}

# Work inside server/ so the final move stays on one filesystem (and /tmp may be mounted noexec).
mkdir -p "$server_dir"
tmp=$(mktemp -d "$server_dir/.get-pocketbase.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' INT TERM

url="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${os}_${arch}.zip"
zip=$tmp/pocketbase.zip
echo "Downloading $url"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --retry 3 -o "$zip" "$url" || die "download failed."
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "$zip" "$url" || die "download failed."
else
  die "need curl or wget to download PocketBase."
fi

actual=$(sha256_of "$zip")
if [ "$actual" != "$expected" ]; then
  die "checksum mismatch for $url
  expected $expected
  got      $actual
Refusing to install. If you are upgrading, update the pinned checksums to match PB_VERSION."
fi
echo "Checksum OK"

extract_one "$zip" "$tmp" pocketbase || die "could not extract the pocketbase binary from the archive."
chmod +x "$tmp/pocketbase"
[ "$("$tmp/pocketbase" --version 2>/dev/null | awk '{print $NF}')" = "$PB_VERSION" ] || die "the downloaded binary does not run on this machine or reports a different version."
mv -f "$tmp/pocketbase" "$bin"
echo "Installed PocketBase $PB_VERSION: $bin"
