"""Execute the documented navigation/input gate with fake public CDP only."""

import contextlib
import io
from pathlib import Path
import re
import sys
import types
import unittest
from unittest.mock import patch

CONTRACT = Path(__file__).resolve().parents[1] / '.pi/skills/verify-bb-plugins/references/browser-contract.md'


def navigation_source():
    section = CONTRACT.read_text().split('## Own and select the target\n', 1)[1]
    return re.search(r"browser-use <<'PY'\n(.*?)\nPY", section, re.S)[1]


class InputContractTests(unittest.TestCase):
    def execute(self, before='visible', after='visible', focused=True):
        calls = []
        navigated = False
        def cdp(method, session_id=None, _response_timeout=None, **params):
            nonlocal navigated
            calls.append((method, session_id, _response_timeout, params))
            if method == 'Target.attachToTarget':
                self.assertEqual(params['targetId'], 'owned-initial')
                return {'sessionId': 'public-owned-session'}
            self.assertEqual(session_id, 'public-owned-session')
            if method == 'Page.navigate':
                navigated = True
                return {}
            if method == 'Runtime.evaluate':
                expression = params['expression']
                if 'document.visibilityState' in expression:
                    state = after if navigated else before
                    value = {'visibility': state, 'hidden': state == 'hidden', 'focused': focused}
                elif expression == 'document.readyState':
                    value = 'complete'
                elif expression == 'location.href':
                    value = 'http://127.0.0.1:38886'
                else:
                    raise AssertionError('Unexpected evaluation')
                return {'result': {'value': value}}
            if method == 'Input.dispatchTouchEvent':
                return {}
            raise AssertionError('Unexpected CDP method ' + method)
        namespace = {'cdp': cdp, 'list_tabs': lambda: [{'targetId': 'owned-initial'}, {'targetId': 'provisioning'}, {'targetId': 'unowned'}]}
        fake_os = types.SimpleNamespace(environ={'task_target': 'owned-initial', 'bb_url': 'http://127.0.0.1:38886'})
        try:
            with patch.dict(sys.modules, {'os': fake_os}), contextlib.redirect_stdout(io.StringIO()):
                exec(compile(navigation_source(), str(CONTRACT), 'exec'), namespace)
                namespace['bound']('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': 150, 'y': 120}])
        except Exception as error:
            return calls, error
        return calls, None

    def test_visible_owned_target_reaches_native_input_with_explicit_budget(self):
        calls, error = self.execute(focused=False)
        self.assertIsNone(error)
        self.assertEqual(calls[-1][0], 'Input.dispatchTouchEvent')
        self.assertEqual(calls[-1][1:3], ('public-owned-session', 30))
        self.assertFalse(any(c[0] in ['Target.activateTarget', 'Target.createTarget'] for c in calls))

    def test_hidden_focused_target_blocks_before_navigation_or_input(self):
        calls, error = self.execute(before='hidden', focused=True)
        self.assertIsInstance(error, RuntimeError)
        self.assertFalse(any(c[0] in ['Page.navigate', 'Input.dispatchTouchEvent'] for c in calls))

    def test_target_becoming_hidden_blocks_before_input(self):
        calls, error = self.execute(after='hidden')
        self.assertIsInstance(error, RuntimeError)
        self.assertTrue(any(c[0] == 'Page.navigate' for c in calls))
        self.assertFalse(any(c[0].startswith('Input.') for c in calls))

    def test_nonvisible_state_fails_closed(self):
        calls, error = self.execute(before='prerender')
        self.assertIsInstance(error, RuntimeError)
        self.assertFalse(any(c[0].startswith('Input.') for c in calls))


if __name__ == '__main__':
    unittest.main()
