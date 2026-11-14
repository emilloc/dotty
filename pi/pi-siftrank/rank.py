#!/usr/bin/env python3
"""Run the pinned SiftRank CLI against one explicitly configured local endpoint."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request

VERSION = "v0.0.0-20260920050305-03e7afe3289a"
CACHE_KEY = "fb374d419588a4632f3f557e76b4b70aebbca790"
CACHE_SHA = "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d"
TEMPLATE = "ID: {{.id}}\nSource: {{.source}}\n\n{{.text}}\n"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(path.read_text(), parse_constant=lambda x: require(False, f"Invalid JSON: {x}"))


def profile_config(path):
    config = read_json(path)
    require(set(config) == {"profiles"} and set(config["profiles"]) == {"pi-local"},
            "Expected only the explicit pi-local profile")
    p = config["profiles"]["pi-local"]
    require(set(p) == {"provider", "base_url", "model", "effort"},
            "Profile must contain only provider, base_url, model, effort. Commands and credentials are forbidden")
    require(p["provider"] == "openai" and p["effort"] == "none", "Expected openai-compatible provider and effort none")
    match = re.fullmatch(r"http://localhost\.:([0-9]+)/v1", p["base_url"])
    require(match and 1 <= int(match[1]) <= 65535, "Endpoint must be http://localhost.:PORT/v1")
    require(isinstance(p["model"], str) and re.fullmatch(r"[A-Za-z0-9_.:/-]{1,160}", p["model"]), "Invalid explicit model")
    return config


def candidates(path):
    require(path.stat().st_size <= 8 * 1024 * 1024, "Input exceeds 8 MiB")
    docs = read_json(path)
    require(isinstance(docs, list) and 2 <= len(docs) <= 256, "Provide 2 to 256 candidates per run")
    ids = set()
    for d in docs:
        require(isinstance(d, dict), "Each candidate must be an object")
        for field, limit in (("id", 160), ("source", 1024), ("text", 6000)):
            require(isinstance(d.get(field), str) and 0 < len(d[field]) <= limit,
                    f"Each {field} must be a nonempty string of at most {limit} characters. Split oversized items with parent IDs and source locations")
        require(d["id"] not in ids, "Duplicate candidate ID")
        ids.add(d["id"])
    return docs


def validate_output(rows, docs):
    require(isinstance(rows, list) and len(rows) == len(docs), "Incomplete candidate coverage")
    seen, keys, previous = set(), set(), float("-inf")
    for rank, row in enumerate(rows, 1):
        index = row.get("input_index")
        require(type(index) is int and 0 <= index < len(docs) and index not in seen, "Invalid or duplicate input_index")
        require(row.get("document") == docs[index], "Candidate identity or content changed")
        require(row.get("rank") == rank, "Invalid rank sequence")
        key = row.get("key")
        require(isinstance(key, str) and key and key not in keys, "Invalid or duplicate ranking key")
        for field in ("score", "exposure"):
            value = row.get(field)
            require(type(value) in (int, float) and math.isfinite(value), f"Invalid {field}")
        require(0 < row["exposure"] <= 1, "Candidate was not compared")
        require(row["score"] >= previous, "Scores are not ascending")
        previous = row["score"]
        seen.add(index)
        keys.add(key)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Backend redirect refused")


def run(args):
    home = Path.home()
    install = home / ".local/share/pi-siftrank"
    config = profile_config(home / ".config/siftrank/pi-local.json")
    profile = config["profiles"]["pi-local"]
    docs = candidates(args.input)
    criterion = args.criterion.read_text()
    require(0 < len(criterion.strip()) <= 8000, "Criterion must contain 1 to 8000 characters")
    cache = install / "tokenizer-cache"
    require(hashlib.sha256((cache / CACHE_KEY).read_bytes()).hexdigest() == CACHE_SHA, "Tokenizer cache missing or corrupt. Rerun setup.py")
    binary = install / "bin/siftrank"
    manifest = read_json(install / "install.json")
    require(manifest["version"] == VERSION and hashlib.sha256(binary.read_bytes()).hexdigest() == manifest["sha256"], "Pinned binary missing or changed. Rerun setup.py")
    # Preserve Pi's authenticated proxy, but never inherit provider selection or credentials.
    env = {k: v for k, v in os.environ.items() if not k.startswith("OPENAI_") and k not in
           {"TYPESAFE_API_KEY", "DATA_GYM_CACHE_DIR", "ALL_PROXY", "all_proxy"}}
    env.update(TIKTOKEN_CACHE_DIR=str(cache), NO_PROXY="", no_proxy="")
    proxy = env.get("HTTP_PROXY") or env.get("http_proxy", "")
    proxy_url = urllib.parse.urlsplit(proxy)
    require(proxy_url.scheme == "http" and proxy_url.hostname in ("localhost", "127.0.0.1", "::1") and proxy_url.port,
            "Pi's local filtered HTTP proxy is required. Run through Pi bash, without an unsandboxed fallback")
    env.update(HTTP_PROXY=proxy, http_proxy=proxy)
    args.output.mkdir(parents=True, exist_ok=False, mode=0o700)
    out = args.output.resolve()
    for name, value in (("input.json", docs), ("config.json", config)):
        (out / name).write_text(json.dumps(value, indent=2) + "\n")
    (out / "criterion.txt").write_text(criterion)
    (out / "candidate.tmpl").write_text(TEMPLATE)
    command = [str(binary), "--config-file", str(out / "config.json"), "--profile", "pi-local",
               "--file", str(out / "input.json"), "--json", "--template", "@" + str(out / "candidate.tmpl"),
               "--prompt", "@" + str(out / "criterion.txt"), "--output", str(out / "ranked.raw.json"),
               "--trace", str(out / "trace.jsonl"), "--log", str(out / "siftrank.log"), "--debug",
               "--concurrency", "1", "--batch-size", "16", "--tokens", "16000", "--max-trials", str(args.trials),
               "--no-converge", "--ratio", "0"]
    (out / "command.txt").write_text(shlex.join(command) + "\n")
    summary = {"status": "failed", "endpoint": profile["base_url"], "model": profile["model"],
               "siftrank_version": VERSION, "candidates": len(docs), "trials": args.trials, "artifacts": str(out)}
    start = time.monotonic()
    child = None
    old_handlers = {}

    def cancel(signum, frame):
        raise InterruptedError(f"Cancelled by signal {signum}")

    try:
        for sig in (signal.SIGTERM, signal.SIGINT):
            old_handlers[sig] = signal.signal(sig, cancel)
        # Use the same proxy route as the Go subprocess. Do not log proxy credentials.
        proxies = {scheme: value for scheme in ("http", "https")
                   if (value := env.get(scheme.upper() + "_PROXY") or env.get(scheme + "_proxy"))}
        old_no_proxy = {k: os.environ.get(k) for k in ("NO_PROXY", "no_proxy")}
        try:
            os.environ.update(NO_PROXY="", no_proxy="")
            opener = urllib.request.build_opener(urllib.request.ProxyHandler(proxies), NoRedirect())
            with opener.open(profile["base_url"] + "/models", timeout=5) as response:
                models = json.loads(response.read(1024 * 1024))
        finally:
            for k, v in old_no_proxy.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        (out / "models.json").write_text(json.dumps(models, indent=2) + "\n")
        require([m["id"] for m in models["data"]] == [profile["model"]], "Loaded model differs from the explicit profile. No fallback attempted")
        with (out / "stdout.log").open("w") as stdout, (out / "stderr.log").open("w") as stderr:
            # Stay in Pi's process group so bash cancellation also reaches the Go process.
            child = subprocess.Popen(command, env=env, stdout=stdout, stderr=stderr)
            require(child.wait(timeout=args.timeout) == 0, "SiftRank failed. Inspect stderr.log and siftrank.log")
        rows = read_json(out / "ranked.raw.json")
        validate_output(rows, docs)
        trace = [json.loads(line) for line in (out / "trace.jsonl").read_text().splitlines()]
        require(trace and trace[-1]["trials_completed"] == args.trials, "Incomplete trial trace")
        log = (out / "siftrank.log").read_text()
        models_used = re.findall(r'OpenAI call successful.*?model=([^\s]+)', log)
        require(models_used and all(m.strip('"') == profile["model"] for m in models_used), "Missing or unexpected model in completion evidence")
        # shortcut: stock CLI does not expose every HTTP attempt. Report logged successes, not an attempt cap.
        summary.update(status="ok", successful_calls=len(models_used),
                       input_tokens=trace[-1]["total_input_tokens"], output_tokens=trace[-1]["total_output_tokens"],
                       top=[{"id": r["document"]["id"], "source": r["document"]["source"][:240]} for r in rows[:10]])
        (out / "ranked.raw.json").rename(out / "ranked.json")
    except Exception as error:
        summary["error"] = str(error)
        raise
    finally:
        if child is not None and child.poll() is None:
            child.kill()
            child.wait()
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
        summary["wall_seconds"] = round(time.monotonic() - start, 3)
        (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--criterion", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="New artifact directory")
    parser.add_argument("--trials", type=int, choices=range(1, 6), default=2)
    parser.add_argument("--timeout", type=int, choices=range(10, 601), default=180, metavar="10..600")
    args = parser.parse_args()
    try:
        run(args)
    except Exception as error:
        print(f"SiftRank failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
