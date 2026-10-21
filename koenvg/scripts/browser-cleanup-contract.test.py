"""Run the documented cleanup with fake public CDP, clock and environment.

Run with python3 scripts/browser-cleanup-contract.test.py.
"""

import contextlib
import copy
import io
import json
from pathlib import Path
import re
import sys
import types
import unittest
from unittest.mock import patch


CONTRACT = (
    Path(__file__).resolve().parents[1]
    / ".pi/skills/verify-bb-plugins/references/browser-contract.md"
)
IDENTITY = {
    "name": "verify-owned-run",
    "endpoint": "http://127.0.0.1:9222",
    "daemon_pid": 101,
    "browser_pid": 202,
    "profile": "/tmp/approved-profile",
}


def cleanup_source():
    section = CONTRACT.read_text().split("## Scoped cleanup\n", 1)[1]
    return re.search(r"browser-use <<'PY'\n(.*?)\nPY", section, re.S)[1]


def environment(targets):
    return {
        "BU_NAME": IDENTITY["name"],
        "BU_CDP_URL": IDENTITY["endpoint"],
        "BH_REQUIRE_EXISTING_DAEMON": "1",
        "provisioning_target": "provisioning",
        "task_created_targets": json.dumps(targets),
        "cleanup_ownership": json.dumps({
            "recorded": IDENTITY,
            "current": IDENTITY,
        }),
    }


class Browser:
    def __init__(self, targets, delay=0, rpc_cost=0.02):
        self.targets = set(targets)
        self.delay = delay
        self.rpc_cost = rpc_cost
        self.now = 0.0
        self.closing = {}
        self.calls = []
        self.sleeps = []
        self.ack = True
        self.close_error = None
        self.last_page_list_error = False
        self.sleep_overrun = 0
        self.final_read_cost = None
        self.get_error = None
        self.concurrent_target = None

    def monotonic(self):
        return self.now

    def sleep(self, duration):
        self.sleeps.append((self.now, duration))
        self.now += duration + self.sleep_overrun

    def settle(self):
        for target, at in list(self.closing.items()):
            if self.now >= at:
                self.targets.discard(target)
                del self.closing[target]

    def cdp(self, method, session_id=None, _response_timeout=None, **params):
        self.calls.append((method, dict(params), self.now, _response_timeout, session_id))
        cost = self.rpc_cost
        if method == "Target.getTargets" and self.closing and self.final_read_cost:
            cost = self.final_read_cost
        if _response_timeout is not None and cost > _response_timeout:
            self.now += _response_timeout
            raise TimeoutError("RPC timed out")
        self.now += cost
        self.settle()
        if method == "Target.getTargets":
            if self.get_error:
                raise self.get_error
            if self.closing and self.concurrent_target:
                self.targets.add(self.concurrent_target)
            return {"targetInfos": [
                {"targetId": target, "type": "page"}
                for target in sorted(self.targets)
            ]}
        if method == "Target.closeTarget":
            if self.close_error:
                raise self.close_error
            if self.ack is True:
                self.closing[params["targetId"]] = self.now + self.delay
            return {"success": self.ack}
        raise AssertionError("Unexpected CDP method " + method)

    def list_tabs(self):
        self.now += self.rpc_cost
        self.settle()
        if self.last_page_list_error and not self.targets:
            raise RuntimeError("No live page session")
        return [
            {"targetId": target} for target in sorted(self.targets)
            if target != "provisioning"
        ]

    def close_tab(self, target):
        self.cdp("Target.closeTarget", targetId=target)

    def execute(self, env):
        output = io.StringIO()
        fake_modules = {
            "os": types.SimpleNamespace(environ=env),
            "time": types.SimpleNamespace(monotonic=self.monotonic, sleep=self.sleep),
        }
        with patch.dict(sys.modules, fake_modules), contextlib.redirect_stdout(output):
            exec(compile(cleanup_source(), str(CONTRACT), "exec"), {
                "cdp": self.cdp,
                "list_tabs": self.list_tabs,
                "close_tab": self.close_tab,
            })
        return output.getvalue()

    def closed(self):
        return [params["targetId"] for method, params, *_ in self.calls
                if method == "Target.closeTarget"]


class CleanupContractTests(unittest.TestCase):
    def assert_success(self, browser, env):
        self.assertEqual(browser.execute(env), "All recorded task-created targets absent\n")
        self.assertEqual(browser.targets, {"unowned"})
        for method, params, started, budget, session in browser.calls:
            self.assertIn(method, ("Target.getTargets", "Target.closeTarget"))
            self.assertIsNone(session)
            self.assertIsNotNone(budget)
            self.assertGreater(budget, 0)
            self.assertLessEqual(started + budget, 5.0)

    def test_delayed_closure_confirms_full_set(self):
        browser = Browser(["provisioning", "task", "unowned"], delay=0.35)
        self.assert_success(browser, environment(["provisioning", "task"]))
        self.assertEqual(sorted(browser.closed()), ["provisioning", "task"])
        self.assertGreaterEqual(browser.now, 0.39)
        self.assertLess(browser.now, 5)

    def test_last_page_absence_needs_no_page_health(self):
        browser = Browser(["provisioning", "task"])
        browser.last_page_list_error = True
        self.assertEqual(browser.execute(environment(["provisioning", "task"])),
                         "All recorded task-created targets absent\n")
        self.assertEqual(browser.targets, set())
        self.assertEqual(sorted(browser.closed()), ["provisioning", "task"])

    def test_concurrent_new_target_and_user_selected_tab_are_preserved(self):
        browser = Browser(["provisioning", "user-selected", "unowned"], delay=0.35)
        browser.concurrent_target = "concurrent"
        self.assertEqual(browser.execute(environment(["provisioning"])),
                         "All recorded task-created targets absent\n")
        self.assertEqual(browser.closed(), ["provisioning"])
        self.assertEqual(browser.targets, {"user-selected", "unowned", "concurrent"})

    def test_read_error_blocks_without_closing_or_recovery(self):
        browser = Browser(["provisioning", "unowned"])
        browser.get_error = RuntimeError("browser connection lost")
        with self.assertRaisesRegex(RuntimeError, "browser connection lost"):
            browser.execute(environment(["provisioning"]))
        self.assertEqual(browser.closed(), [])
        self.assertEqual(browser.targets, {"provisioning", "unowned"})
        self.assertEqual([call[0] for call in browser.calls], ["Target.getTargets"])

    def test_timeout_keeps_unowned_and_uses_one_total_budget(self):
        browser = Browser(["provisioning", "task", "unowned"], delay=20)
        with self.assertRaisesRegex(RuntimeError, "timed out"):
            browser.execute(environment(["provisioning", "task"]))
        self.assertLessEqual(browser.now, 5)
        self.assertEqual(browser.targets, {"provisioning", "task", "unowned"})
        self.assertEqual(sorted(browser.closed()), ["provisioning", "task"])
        for _, _, started, budget, _ in browser.calls:
            self.assertGreater(budget, 0)
            self.assertLessEqual(started + budget, 5)
        for started, duration in browser.sleeps:
            self.assertLessEqual(started + duration, 5)

    def test_slow_rpc_receives_remaining_budget(self):
        browser = Browser(["provisioning", "unowned"], rpc_cost=3)
        with self.assertRaisesRegex(RuntimeError, "timed out"):
            browser.execute(environment(["provisioning"]))
        self.assertEqual(browser.now, 5)
        self.assertEqual(browser.calls[1][:4],
                         ("Target.closeTarget", {"targetId": "provisioning"}, 3, 2))
        self.assertEqual(browser.targets, {"provisioning", "unowned"})

    def test_absence_returned_at_deadline_cannot_pass(self):
        browser = Browser(["provisioning", "unowned"], rpc_cost=1)
        browser.final_read_cost = 3
        with self.assertRaisesRegex(RuntimeError, "timed out"):
            browser.execute(environment(["provisioning"]))
        self.assertEqual(browser.now, 5)
        self.assertEqual(browser.targets, {"unowned"})

    def test_sleep_overrun_cannot_trigger_late_check_or_pass(self):
        browser = Browser(["provisioning", "unowned"], delay=1)
        browser.sleep_overrun = 5
        with self.assertRaisesRegex(RuntimeError, "timed out"):
            browser.execute(environment(["provisioning"]))
        self.assertLess(browser.calls[-1][2], 5)
        self.assertEqual(len(browser.sleeps), 1)
        self.assertEqual(browser.closed(), ["provisioning"])

    def test_uncertain_changed_or_invalid_identity_blocks_before_cdp(self):
        invalid = [None, {}, {"recorded": IDENTITY}, "uncertain"]
        for field in IDENTITY:
            proof = {"recorded": copy.deepcopy(IDENTITY), "current": copy.deepcopy(IDENTITY)}
            proof["current"][field] = 999 if field.endswith("pid") else "changed"
            invalid.append(proof)
        for field, value in [("daemon_pid", True), ("browser_pid", 0),
                             ("name", ""), ("profile", None)]:
            identity = dict(IDENTITY, **{field: value})
            invalid.append({"recorded": identity, "current": identity})
        for proof in invalid:
            with self.subTest(proof=proof):
                browser = Browser(["provisioning", "unowned"])
                env = environment(["provisioning"])
                env["cleanup_ownership"] = json.dumps(proof)
                with self.assertRaises(Exception):
                    browser.execute(env)
                self.assertEqual(browser.calls, [])
                self.assertEqual(browser.targets, {"provisioning", "unowned"})

    def test_missing_proof_wrong_route_or_non_strict_mode_blocks(self):
        for key, value in [("cleanup_ownership", None), ("BU_NAME", "other-run"),
                           ("BU_CDP_URL", "http://127.0.0.1:9333"),
                           ("BU_CDP_WS", "ws://127.0.0.1:9222/other"),
                           ("BH_REQUIRE_EXISTING_DAEMON", "0")]:
            with self.subTest(key=key):
                browser = Browser(["provisioning", "unowned"])
                env = environment(["provisioning"])
                if value is None:
                    env.pop(key)
                else:
                    env[key] = value
                with self.assertRaises(Exception):
                    browser.execute(env)
                self.assertEqual(browser.calls, [])
                self.assertEqual(browser.targets, {"provisioning", "unowned"})

    def test_invalid_target_ledger_blocks_before_mutation(self):
        invalid = [None, {}, "provisioning", [], ["provisioning", ""],
                   ["provisioning", 7], ["provisioning", True],
                   ["provisioning", "provisioning"], ["task"],
                   ["provisioning", " task "], ["provisioning", "\n"]]
        for ledger in invalid:
            with self.subTest(ledger=ledger):
                browser = Browser(["provisioning", "task", "unowned"])
                env = environment(ledger)
                with self.assertRaises(Exception):
                    browser.execute(env)
                self.assertEqual(browser.calls, [])
                self.assertEqual(browser.targets, {"provisioning", "task", "unowned"})

    def test_unavailable_or_occupied_timer_blocks_before_cdp(self):
        for timer in [types.SimpleNamespace(), types.SimpleNamespace(
            ITIMER_REAL=0, setitimer=lambda *_: None, getitimer=lambda _: (1.0, 0.0)
        )]:
            with self.subTest(timer=timer), patch.dict(sys.modules, {"signal": timer}):
                browser = Browser(["provisioning", "unowned"])
                with self.assertRaisesRegex(RuntimeError, "unused POSIX"):
                    browser.execute(environment(["provisioning"]))
                self.assertEqual(browser.calls, [])
                self.assertEqual(browser.targets, {"provisioning", "unowned"})

    def test_non_main_thread_signal_setup_blocks_before_cdp(self):
        def unavailable_handler(*_):
            raise ValueError("signal only works in main thread")

        timer = types.SimpleNamespace(
            SIGALRM=14, ITIMER_REAL=0, setitimer=lambda *_: None,
            getitimer=lambda _: (0.0, 0.0), signal=unavailable_handler,
        )
        browser = Browser(["provisioning", "unowned"])
        with patch.dict(sys.modules, {"signal": timer}):
            with self.assertRaisesRegex(ValueError, "main thread"):
                browser.execute(environment(["provisioning"]))
        self.assertEqual(browser.calls, [])
        self.assertEqual(browser.targets, {"provisioning", "unowned"})

    def test_slow_connection_is_interrupted_before_late_close_send(self):
        import signal
        import time

        if not hasattr(signal, "setitimer"):
            self.skipTest("Interruptible POSIX timer is unavailable")
        browser = Browser(["provisioning", "unowned"])
        transmitted = []

        def connecting_cdp(method, _response_timeout=None, **params):
            if method == "Target.getTargets":
                browser.now = 4
                return {"targetInfos": [{"targetId": "provisioning", "type": "page"}]}
            time.sleep(2)
            browser.now = 6
            transmitted.append(params["targetId"])
            return {"success": True}

        previous_handler = signal.getsignal(signal.SIGALRM)
        start = time.monotonic()
        with patch.dict(sys.modules, {
            "os": types.SimpleNamespace(environ=environment(["provisioning"])),
            "time": types.SimpleNamespace(monotonic=browser.monotonic, sleep=browser.sleep),
        }), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "timed out"):
                exec(compile(cleanup_source(), str(CONTRACT), "exec"), {"cdp": connecting_cdp})
        self.assertEqual(transmitted, [])
        self.assertLess(time.monotonic() - start, 1.5)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))
        self.assertEqual(signal.getsignal(signal.SIGALRM), previous_handler)

    def test_filtered_provisioning_target_is_closed(self):
        browser = Browser(["provisioning", "unowned"])
        self.assert_success(browser, environment(["provisioning"]))
        self.assertEqual(browser.closed(), ["provisioning"])

    def test_already_absent_targets_still_need_fresh_full_set_read(self):
        browser = Browser(["unowned"])
        self.assert_success(browser, environment(["provisioning", "task"]))
        self.assertEqual(browser.closed(), [])
        self.assertEqual([call[0] for call in browser.calls], ["Target.getTargets"])

    def test_false_or_invalid_ack_is_a_conflict_not_absence(self):
        for ack in [False, None, 1]:
            with self.subTest(ack=ack):
                browser = Browser(["provisioning", "unowned"])
                browser.ack = ack
                with self.assertRaisesRegex(RuntimeError, "not acknowledged"):
                    browser.execute(environment(["provisioning"]))
                self.assertEqual(browser.targets, {"provisioning", "unowned"})
                self.assertEqual(browser.closed(), ["provisioning"])

    def test_close_error_is_reported_without_retry_or_broad_close(self):
        browser = Browser(["provisioning", "task", "unowned"])
        browser.close_error = RuntimeError("connection lost")
        with self.assertRaisesRegex(RuntimeError, "connection lost"):
            browser.execute(environment(["provisioning", "task"]))
        self.assertEqual(browser.closed(), ["provisioning"])
        self.assertEqual(browser.targets, {"provisioning", "task", "unowned"})

    def test_valid_websocket_route(self):
        browser = Browser(["provisioning", "unowned"])
        env = environment(["provisioning"])
        env.pop("BU_CDP_URL")
        env["BU_CDP_WS"] = "ws://127.0.0.1:9222/devtools/browser/owned"
        identity = dict(IDENTITY, endpoint=env["BU_CDP_WS"])
        env["cleanup_ownership"] = json.dumps({"recorded": identity, "current": identity})
        self.assert_success(browser, env)
        self.assertEqual(browser.closed(), ["provisioning"])


if __name__ == "__main__":
    unittest.main()
