"""Connect the disposable Docker browser to the local dummy Firefly fixture.

Uses the standard WebDriver HTTP protocol; no host browser or Python packages.
Leaves the session open for inspection through http://localhost:7900.
"""
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
SERVER = 'http://localhost:4444'
ELEMENT = 'element-6066-11e4-a52e-4f735466cecf'


def request(path, body=None):
    req = Request(SERVER + path, data=None if body is None else json.dumps(body).encode(),
                  headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=45) as response:
        value = json.load(response)['value']
    if isinstance(value, dict) and 'error' in value:
        raise RuntimeError(value['error'])
    return value


credentials = json.loads((ROOT / '.env.firefly-user.json').read_text())
session = request('/session', {'capabilities': {'alwaysMatch': {
    'browserName': 'chrome', 'goog:chromeOptions': {'args': ['--window-size=1440,1000']}
}}})['sessionId']
base = '/session/' + session
request(base + '/timeouts', {'implicit': 10000})
request(base + '/url', {'url': 'http://localhost:8080'})


def element(xpath):
    return request(base + '/element', {'using': 'xpath', 'value': xpath})[ELEMENT]


def click(xpath):
    request(base + '/element/' + element(xpath) + '/click', {})


def fill(xpath, value):
    target = base + '/element/' + element(xpath)
    request(target + '/clear', {})
    request(target + '/value', {'text': value})


def wait_for_notice(expected):
    for _ in range(30):
        notice = request(base + '/element/' + element('//*[@role="status"]') + '/text')
        if expected in notice:
            return
        time.sleep(0.5)
    raise RuntimeError('Expected connection confirmation did not appear.')


fill('//input[@type="url"]', 'http://localhost:8081')
fill('//input[@type="password"]', credentials['token'])
click('//button[contains(., "Connect & refresh accounts")]')
wait_for_notice('Connected. Accounts refreshed.')
click('//label[contains(., "Primary cash account")]/select/option[@value="' + credentials['cash'] + '"]')
click('//button[normalize-space(.)="Save preferences"]')
wait_for_notice('Preferences saved on this device.')
request(base + '/refresh', {})
click('//nav/button[normalize-space(.)="Settings"]')
selected = request(base + '/element/' + element('//label[contains(., "Primary cash account")]/select') + '/property/value')
assert selected == credentials['cash'], 'Cash preference did not survive reload'
secure = request(base + '/execute/sync', {'script': 'return {secure: window.isSecureContext, locks: !!navigator.locks}', 'args': []})
assert secure['secure'] and secure['locks'], 'Secure context or Web Locks unavailable'
click('//nav/button[normalize-space(.)="Cash"]')
print('Connected to local Firefly; cash preference survived reload; secure context and Web Locks verified.')
print('Browser view: http://localhost:7900 (VNC password: secret). Session expires after one idle hour.')
