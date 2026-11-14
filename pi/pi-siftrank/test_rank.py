import argparse
import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

import rank
import setup


class ValidationTests(unittest.TestCase):
    def test_output_identity_coverage_and_scores(self):
        docs = [{"id": "a", "source": "a:1", "text": "first", "metadata": [1]},
                {"id": "b", "source": "b:2", "text": "second"}]
        rows = [{"key": d["id"], "document": d, "input_index": i, "rank": i + 1,
                 "score": i + 1, "exposure": 1} for i, d in enumerate(docs)]
        rank.validate_output(rows, docs)
        for field, value in (("input_index", 1), ("rank", 2), ("score", float("nan")),
                             ("exposure", 0), ("key", "b"), ("document", dict(docs[0], text="changed"))):
            broken = copy.deepcopy(rows)
            broken[0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                rank.validate_output(broken, docs)
        with self.assertRaises(ValueError):
            rank.validate_output(rows[:1], docs)

    def test_profile_rejects_commands_cloud_and_missing_fields(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "profile.json"
            good = {"provider": "openai", "model": "qwen3.8-flash-next", "base_url": "http://localhost.:18888/v1", "effort": "none"}
            for profile in (dict(good, model_cmd="touch /tmp/never"), dict(good, api_key="not-a-real-key"),
                            dict(good, base_url="https://api.openai.com/v1"), dict(good, model=""), {}):
                p.write_text(json.dumps({"profiles": {"pi-local": profile}}))
                with self.subTest(profile=profile), self.assertRaises(ValueError):
                    rank.profile_config(p)
            p.write_text(json.dumps({"profiles": {"pi-local": good}}))
            rank.profile_config(p)

    def test_oversized_and_duplicate_inputs(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "input.json"
            docs = [{"id": "a", "source": "a:1", "text": "a"}, {"id": "b", "source": "b:1", "text": "b"}]
            p.write_text(json.dumps(docs))
            self.assertEqual(rank.candidates(p), docs)
            for bad in ([docs[0], docs[0]], [docs[0], dict(docs[1], text="x" * 6001)]):
                p.write_text(json.dumps(bad))
                with self.assertRaises(ValueError):
                    rank.candidates(p)

    def test_permission_merge_preserves_offline_modes_and_is_idempotent(self):
        defaults = json.loads((Path(__file__).resolve().parents[1] / "pi-permission-modes/permission-mode.defaults.json").read_text())
        original = {"defaultMode": "build", "modes": {"blind": {"sandbox": {"network": {"allowedDomains": []}}},
                    "research-developer": {"sandbox": {"network": {"allowedDomains": []}}},
                    "build": {"sandbox": {"network": {"allowedDomains": ["example.org"], "deniedDomains": ["blocked.org"]}}}}}
        result = setup.permission_patch(original, defaults, 18888, "/test/rank.py")
        for mode in ("blind", "research-developer"):
            self.assertEqual(original["modes"][mode], result["modes"][mode])
        self.assertEqual(result["modes"]["build"]["sandbox"]["network"],
                         {"allowedDomains": ["example.org", "localhost:18888"], "deniedDomains": ["blocked.org"]})
        self.assertEqual(setup.permission_patch(result, defaults, 18888, "/test/rank.py"), result)


class ProcessTests(unittest.TestCase):
    def test_timeout_and_cancellation_kill_child_and_preserve_failure(self):
        for cancel in (False, True):
            with self.subTest(cancel=cancel), tempfile.TemporaryDirectory() as temp:
                home = Path(temp)
                install = home / ".local/share/pi-siftrank"
                (install / "bin").mkdir(parents=True)
                (install / "tokenizer-cache").mkdir()
                (install / "tokenizer-cache" / rank.CACHE_KEY).write_bytes(b"test-cache")
                binary = install / "bin/siftrank"
                binary.write_text("#!/bin/sh\nexec /bin/sleep 60\n")
                binary.chmod(0o755)
                (install / "install.json").write_text(json.dumps({"version": rank.VERSION, "sha256": hashlib.sha256(binary.read_bytes()).hexdigest()}))
                profile = home / ".config/siftrank/pi-local.json"
                profile.parent.mkdir(parents=True)
                profile.write_text(json.dumps({"profiles": {"pi-local": {"provider": "openai", "model": "qwen", "base_url": "http://localhost.:18888/v1", "effort": "none"}}}))
                data = home / "input.json"
                data.write_text(json.dumps([{"id": str(i), "source": "fixture", "text": "x"} for i in range(2)]))
                criterion = home / "criterion.txt"
                criterion.write_text("relevance")
                args = argparse.Namespace(input=data, criterion=criterion, output=home / "output", trials=1, timeout=5 if cancel else .05)
                opener = unittest.mock.Mock()
                opener.open.return_value = contextlib.closing(io.BytesIO(b'{"data":[{"id":"qwen"}]}'))
                processes = []
                real_popen = subprocess.Popen

                def capture(*a, **kw):
                    self.assertNotIn("OPENAI_API_KEY", kw["env"])
                    self.assertEqual(kw["env"]["HTTP_PROXY"], "http://localhost:1234")
                    self.assertEqual(kw["env"]["NO_PROXY"], "")
                    child = real_popen(*a, **kw)
                    processes.append(child)
                    if cancel:
                        threading.Timer(.05, os.kill, args=(os.getpid(), signal.SIGTERM)).start()
                    return child

                with patch.object(Path, "home", return_value=home), patch.object(rank, "CACHE_SHA", hashlib.sha256(b"test-cache").hexdigest()), \
                     patch("rank.urllib.request.build_opener", return_value=opener), patch("rank.subprocess.Popen", side_effect=capture), \
                     patch.dict(os.environ, {"OPENAI_API_KEY": "test-secret", "HTTP_PROXY": "http://localhost:1234"}):
                    with self.assertRaises((subprocess.TimeoutExpired, InterruptedError)):
                        rank.run(args)
                self.assertIsNotNone(processes[0].poll())
                self.assertEqual(json.loads((args.output / "summary.json").read_text())["status"], "failed")
                self.assertFalse((args.output / "ranked.json").exists())


if __name__ == "__main__":
    unittest.main()
