#!/usr/bin/env python3
"""Install the pinned CLI and Pi skill without touching the inference service."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request

from rank import CACHE_KEY, CACHE_SHA, VERSION, profile_config, require


def permission_patch(config, defaults, port, skill_root):
    result = json.loads(json.dumps(config))
    for mode in ("default", "plan", "build"):
        sandbox = result.setdefault("modes", {}).setdefault(mode, {}).setdefault("sandbox", {})
        inside = sandbox.setdefault("insideRoots", list(defaults["modes"][mode]["sandbox"].get("insideRoots", [])))
        if skill_root not in inside:
            inside.append(skill_root)
        network = sandbox.setdefault("network", {})
        allowed = network.setdefault("allowedDomains", list(defaults["modes"][mode]["sandbox"]["network"]["allowedDomains"]))
        domain = f"localhost:{port}"
        if domain not in allowed:
            allowed.append(domain)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, help="Explicit served model ID, not a Pi provider/model shorthand")
    parser.add_argument("--port", type=int, default=18888, help="Existing device-local inference forward")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    home = Path.home()
    install = home / ".local/share/pi-siftrank"
    profile = home / ".config/siftrank/pi-local.json"
    permission = home / ".pi/agent/permission-mode/permission-mode.json"
    skill = home / ".pi/agent/skills/siftrank"
    require(not (skill.exists() or skill.is_symlink()) or skill.resolve() == root, f"{skill} already exists elsewhere")
    config = {"profiles": {"pi-local": {"provider": "openai", "base_url": f"http://localhost.:{args.port}/v1",
                                        "model": args.model, "effort": "none"}}}
    if profile.exists():
        require(profile_config(profile) == config, "Existing pi-local profile differs. It was not overwritten")
    original = permission.read_text() if permission.exists() else "{}"
    defaults = json.loads((root.parent / "pi-permission-modes/permission-mode.defaults.json").read_text())
    patched = permission_patch(json.loads(original), defaults, args.port, str(root))
    backup = permission.with_name("permission-mode.before-siftrank.json")
    if patched != json.loads(original) and permission.exists():
        require(not backup.exists(), f"Backup already exists: {backup}. Configuration was not overwritten")
    with tempfile.TemporaryDirectory(prefix="pi-siftrank-install-") as temp:
        temp = Path(temp)
        (temp / "profile.json").write_text(json.dumps(config))
        profile_config(temp / "profile.json")
        env = dict(os.environ, GOBIN=str(temp))
        subprocess.run(["go", "install", f"github.com/noperator/siftrank/cmd/siftrank@{VERSION}"], env=env, check=True)
        cache_source = Path(os.environ.get("TIKTOKEN_CACHE_DIR", str(install / "tokenizer-cache"))) / CACHE_KEY
        if cache_source.exists():
            tokenizer = cache_source.read_bytes()
        else:
            with urllib.request.urlopen("https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken", timeout=60) as response:
                tokenizer = response.read()
        require(hashlib.sha256(tokenizer).hexdigest() == CACHE_SHA, "Tokenizer checksum mismatch")
        # Finish downloads and validation before changing the user's setup.
        require((permission.read_text() if permission.exists() else "{}") == original, "Permission configuration changed during setup. Retry")
        (install / "bin").mkdir(parents=True, exist_ok=True)
        (install / "tokenizer-cache").mkdir(exist_ok=True)
        shutil.copy2(temp / "siftrank", install / "bin/siftrank.new")
        (install / "bin/siftrank.new").replace(install / "bin/siftrank")
        (install / "tokenizer-cache" / CACHE_KEY).write_bytes(tokenizer)
        (install / "install.json").write_text(json.dumps({"version": VERSION,
            "sha256": hashlib.sha256((install / "bin/siftrank").read_bytes()).hexdigest()}, indent=2) + "\n")
        profile.parent.mkdir(parents=True, exist_ok=True)
        if not profile.exists():
            profile.write_text(json.dumps(config, indent=2) + "\n")
        permission.parent.mkdir(parents=True, exist_ok=True)
        if patched != json.loads(original):
            if permission.exists():
                backup.write_text(original)
            staging = permission.with_suffix(".json.new")
            staging.write_text(json.dumps(patched, indent=2) + "\n")
            staging.replace(permission)
        skill.parent.mkdir(parents=True, exist_ok=True)
        if not skill.is_symlink():
            skill.symlink_to(root, target_is_directory=True)
    print(f"Installed SiftRank {VERSION} for {args.model} through localhost:{args.port}.")
    print("Start a new Pi session to load the skill and permission change. No service was started or stopped.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit(f"Setup failed: {error}")
