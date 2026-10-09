#!/usr/bin/env python3
"""T-33 site-only logging proof using an isolated loopback Nginx/echo fixture.
Never starts a system service, reads production assets or deletes existing logs.
"""
import base64
import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / 'deploy/nginx/anonyproof.deline.top.conf'
OUT = ROOT / 'audit/execution-results/T-33-nginx-privacy-result.json'
NGINX = shutil.which('nginx') or '/opt/homebrew/bin/nginx'
OPENSSL = '/opt/homebrew/opt/openssl@4/bin/openssl'
TMP = Path(tempfile.mkdtemp(prefix='anonyproof-T33-nginx-'))
os.chmod(TMP, 0o700)
result = {'task': 'T-33', 'scope': 'Synthetic loopback template logging only; no production or historical-log disposal acceptance',
          'prefix': str(TMP), 'templateSha256': hashlib.sha256(TEMPLATE.read_bytes()).hexdigest(),
          'commands': [], 'checks': [], 'requests': [], 'cleanup': {}}
process = None
backend = None
conf = TMP / 'nginx.conf'


def check(name, actual, expected):
    passed = actual == expected
    result['checks'].append({'name': name, 'actual': actual, 'expected': expected, 'pass': passed})
    if not passed:
        raise AssertionError(name)


def run(argv):
    proc = subprocess.run(argv, capture_output=True, text=True, timeout=15)
    result['commands'].append({'argv': argv, 'exit': proc.returncode, 'stderr': proc.stderr})
    if proc.returncode != 0:
        raise RuntimeError('Owned fixture command failed')


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class Echo(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        payload = json.dumps({'path': self.path}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


try:
    backend = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Echo)
    thread = threading.Thread(target=backend.serve_forever, daemon=True)
    thread.start()
    http_port, tls_port, control_port = port(), port(), port()
    result['ports'] = {'http': http_port, 'tls': tls_port, 'control': control_port, 'upstream': backend.server_port}
    cert, key = TMP / 'fixture-cert.pem', TMP / 'fixture-key.pem'
    run([OPENSSL, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
         '-subj', '/CN=anonyproof.deline.top', '-addext', 'subjectAltName=DNS:anonyproof.deline.top,IP:127.0.0.1',
         '-keyout', str(key), '-out', str(cert)])
    os.chmod(key, 0o600)
    private_include = TMP / 'proxy-auth.conf'
    private_include.write_text('proxy_set_header X-AnonyProof-Proxy-Auth ' +
                               json.dumps(base64.b64encode(secrets.token_bytes(32)).decode()) + ';\n')
    os.chmod(private_include, 0o600)
    template = TEMPLATE.read_text()
    template = template.replace('    listen 80;\n    listen [::]:80;', f'    listen 127.0.0.1:{http_port};')
    template = template.replace('    listen 443 ssl;\n    listen [::]:443 ssl;', f'    listen 127.0.0.1:{tls_port} ssl;')
    template = template.replace('/etc/nginx/ssl/deline.top/fullchain.pem', str(cert))
    template = template.replace('/etc/nginx/ssl/deline.top/privkey.pem', str(key))
    template = template.replace('/etc/nginx/private/anonyproof-proxy-auth.conf', str(private_include))
    template = template.replace('http://127.0.0.1:3000', f'http://127.0.0.1:{backend.server_port}')
    # A separate test vhost inherits both global logs. Its unreachable upstream
    # gives a positive control proving an error log exists and is writable.
    with socket.socket() as reserved:
        reserved.bind(('127.0.0.1', 0))
        dead_port = reserved.getsockname()[1]
    control = f'''server {{
    listen 127.0.0.1:{control_port};
    server_name control.fixture;
    location = /ok {{ return 204; }}
    location / {{ proxy_pass http://127.0.0.1:{dead_port}; }}
}}
'''
    conf.write_text(f'''worker_processes 1;
pid {TMP}/nginx.pid;
error_log {TMP}/error.log info;
events {{ worker_connections 128; }}
http {{
access_log {TMP}/access.log;
client_body_temp_path {TMP}/client_temp;
proxy_temp_path {TMP}/proxy_temp;
fastcgi_temp_path {TMP}/fastcgi_temp;
uwsgi_temp_path {TMP}/uwsgi_temp;
scgi_temp_path {TMP}/scgi_temp;
{template}
{control}
}}
''')
    run([NGINX, '-t', '-p', str(TMP) + '/', '-c', str(conf)])
    master_log = (TMP / 'master-output.log').open('w')
    process = subprocess.Popen([NGINX, '-p', str(TMP) + '/', '-c', str(conf), '-g', 'daemon off;'],
                               stdout=master_log, stderr=master_log)
    result['nginxPid'] = process.pid
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError('Owned Nginx exited')
        try:
            with socket.create_connection(('127.0.0.1', tls_port), timeout=.1):
                break
        except OSError:
            time.sleep(.05)
    else:
        raise RuntimeError('Owned Nginx failed readiness')
    context = ssl.create_default_context(cafile=str(cert))

    def request(path, secure=True, control=False, host='anonyproof.deline.top', agent='T33-local-only'):
        connection = (http.client.HTTPSConnection('127.0.0.1', tls_port, context=context, timeout=5)
                      if secure and not control else
                      http.client.HTTPConnection('127.0.0.1', control_port if control else http_port, timeout=5))
        connection.request('GET', path, headers={'Host': 'control.fixture' if control else host, 'User-Agent': agent})
        response = connection.getresponse()
        status = response.status
        response.read()
        connection.close()
        result['requests'].append({'path': path, 'tls': secure and not control, 'control': control, 'status': status})
        return status

    controls = []
    markers = []

    def positive_control(stage):
        marker = 'T33-CONTROL-' + stage + '-' + secrets.token_hex(8)
        controls.append(marker)
        check('Other vhost normal response ' + stage, request('/ok?private=' + marker, control=True), 204)
        check('Other vhost upstream fault ' + stage, request('/fault?private=' + marker, control=True), 502)
        time.sleep(.05)
        check('Other vhost inherits global access log ' + stage, marker in (TMP / 'access.log').read_text(), True)
        check('Other vhost inherits global error log ' + stage, marker in (TMP / 'error.log').read_text(), True)

    positive_control('before')
    for secure in (False, True):
        marker = 'T33-SITE-' + ('tls' if secure else 'http') + '-' + secrets.token_hex(8)
        agent = 'T33-SITE-UA-' + marker
        markers.extend([marker, agent])
        check('Site normal response ' + str(secure), request('/anonyproof/api/stats?private=' + marker, secure=secure, agent=agent), 200 if secure else 308)
        check('Site unknown path ' + str(secure), request('/outside-' + marker + '?private=' + marker, secure=secure, agent=agent), 404 if secure else 308)
        check('Site unknown host ' + str(secure), request('/anonyproof?private=' + marker, secure=secure, host='unrelated.example', agent=agent), 404)
        check('Site invalid URI ' + str(secure), request('/%ZZ?private=' + marker, secure=secure, agent=agent), 400)

    # The backend belongs to this fixture. Stopping it produces real connection
    # refusal in the unchanged site's proxy location, rather than a mocked error.
    backend.shutdown()
    backend.server_close()
    backend = None
    marker = 'T33-SITE-UPSTREAM-FAULT-' + secrets.token_hex(8)
    markers.extend([marker, 'T33-SITE-UA-' + marker])
    check('Site actual upstream connection failure', request('/anonyproof/api/fault?private=' + marker, agent='T33-SITE-UA-' + marker), 502)
    positive_control('after')
    time.sleep(.1)
    logs = {'access': (TMP / 'access.log').read_text(), 'error': (TMP / 'error.log').read_text(),
            'master': (TMP / 'master-output.log').read_text()}
    for name, content in logs.items():
        check('No site URI or UA marker in ' + name + ' log', any(marker in content for marker in markers), False)
    for name in ('access', 'error'):
        check('Both control stages retained in global ' + name + ' log', all(marker in logs[name] for marker in controls), True)
    result['logEvidence'] = {'globalAccessLogBytes': (TMP / 'access.log').stat().st_size,
                             'globalErrorLogBytes': (TMP / 'error.log').stat().st_size,
                             'siteMarkersChecked': len(markers), 'otherVhostPositiveControls': len(controls),
                             'historicalFilesTouched': False}
except Exception as error:
    result['fatalType'] = type(error).__name__
finally:
    if process is not None and process.poll() is None:
        try:
            run([NGINX, '-s', 'quit', '-p', str(TMP) + '/', '-c', str(conf)])
            result['cleanup']['nginxExit'] = process.wait(timeout=10)
        except Exception:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
    if backend:
        backend.shutdown()
        backend.server_close()
    for name, number in result.get('ports', {}).items():
        with socket.socket() as probe:
            probe.settimeout(.2)
            result['cleanup'][name + 'SocketClosed'] = probe.connect_ex(('127.0.0.1', number)) != 0
    result['cleanup']['nginxPidRemoved'] = not (TMP / 'nginx.pid').exists()
    result['summary'] = {'passed': sum(item['pass'] for item in result['checks']),
                         'failed': sum(not item['pass'] for item in result['checks'])}
    result['acceptanceComplete'] = (not result.get('fatalType') and bool(result['checks']) and
                                    all(item['pass'] for item in result['checks']) and
                                    result['cleanup'].get('nginxExit') == 0 and
                                    all(value is True for name, value in result['cleanup'].items() if name != 'nginxExit'))
    OUT.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'evidence': str(OUT), 'summary': result['summary'],
                      'fatalType': result.get('fatalType'), 'allAcceptancePassed': result['acceptanceComplete']}))
raise SystemExit(0 if result['acceptanceComplete'] else 1)
