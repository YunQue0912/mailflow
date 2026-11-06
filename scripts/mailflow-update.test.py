"""Exercise the updater's deployment guards without Docker or a production connection."""

import copy
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).with_name("mailflow-update.sh").read_text(encoding="utf-8")
PREFLIGHT = re.search(r"python3 -c '\n(.*?)\n' \|\| die", SOURCE, re.S).group(1)
WAIT = re.search(r"^wait_for_health\(\) \{\n.*?^\}", SOURCE, re.S | re.M).group(0)
BASH = os.environ.get("MAILFLOW_TEST_BASH") or shutil.which("bash")


class ComposeGuards(unittest.TestCase):
    def setUp(self):
        self.config = {
            "services": {
                "backend": {"stop_grace_period": "30s"},
                "frontend": {"networks": {
                    "mailflow": {},
                    "edge_mailflow": {"aliases": ["mailflow-ingress"]},
                }},
            },
            "networks": {"edge_mailflow": {"name": "edge_mailflow", "external": True}},
        }

    def check_config(self, config):
        with patch("sys.stdin", io.StringIO(json.dumps(config))):
            exec(compile(PREFLIGHT, "mailflow-update preflight", "exec"), {})

    def test_accepts_sufficient_shutdown_durations(self):
        for duration in ("30s", "30000ms", "1m", "1m30s", "30.5s"):
            with self.subTest(duration=duration):
                self.config["services"]["backend"]["stop_grace_period"] = duration
                self.check_config(self.config)

    def test_refuses_missing_short_and_malformed_shutdown(self):
        for duration in (None, "10s", "29999ms", "30", "30s-bad", "-30s"):
            with self.subTest(duration=duration):
                config = copy.deepcopy(self.config)
                if duration is None:
                    del config["services"]["backend"]["stop_grace_period"]
                else:
                    config["services"]["backend"]["stop_grace_period"] = duration
                with self.assertRaisesRegex(SystemExit, "at least 30s"):
                    self.check_config(config)

    def test_keeps_edge_network_contract(self):
        for change in ("extra_network", "missing_alias", "not_external"):
            with self.subTest(change=change):
                config = copy.deepcopy(self.config)
                if change == "extra_network":
                    config["services"]["frontend"]["networks"]["projectflow"] = {}
                elif change == "missing_alias":
                    config["services"]["frontend"]["networks"]["edge_mailflow"]["aliases"] = []
                else:
                    config["networks"]["edge_mailflow"]["external"] = False
                with self.assertRaises(SystemExit):
                    self.check_config(config)


@unittest.skipUnless(BASH, "Bash required (set MAILFLOW_TEST_BASH if it is outside PATH)")
class StartupWait(unittest.TestCase):
    def run_wait(self, timeout=False):
        # Every mocked Docker inspect runs in the updater's command-substitution subshell.
        # A file lets successive calls model the same container recovering during migration.
        with tempfile.TemporaryDirectory(prefix="mailflow-updater-test-") as directory:
            counter = Path(directory, "inspects")
            # Bash arithmetic must not receive a Windows text-mode carriage return.
            counter.write_bytes(b"0\n")
            shell_counter = counter.as_posix().replace("'", "'\\''")
            script = "set -euo pipefail\nMAILFLOW_UPDATE_WAIT_SECONDS=30\nconfig_backup=test-backup\n"
            script += "die() { printf '%s\\n' \"$*\" >&2; exit 7; }\n"
            script += "docker() { local n; read -r n < \"$counter\"; n=$((n+1)); printf '%s\\n' \"$n\" > \"$counter\"; "
            script += "if (( n == 1 )); then echo unhealthy; elif (( n == 2 )); then echo starting; else echo healthy; fi; }\n"
            script += "sleep() { SECONDS=1000; }\n" if timeout else "sleep() { :; }\n"
            script += f"counter='{shell_counter}'\n" + WAIT + "\nwait_for_health mailflow-backend\necho recovered\n"
            return subprocess.run([BASH, "-c", script], text=True, capture_output=True, timeout=10)

    def test_initial_unhealthy_can_recover(self):
        result = self.run_wait()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("unhealthy", result.stdout)
        self.assertIn("starting", result.stdout)
        self.assertIn("recovered", result.stdout)

    def test_deadline_reports_failure_without_rollback(self):
        result = self.run_wait(timeout=True)
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertIn("Startup deadline", result.stderr)
        self.assertIn("do not roll back images automatically", result.stderr)


if __name__ == "__main__":
    unittest.main()
