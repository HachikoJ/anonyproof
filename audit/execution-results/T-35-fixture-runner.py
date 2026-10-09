#!/usr/bin/env python3
"""T-35 isolated direct-ingress fixture, never a production activation command."""
import hashlib
import http.client
import http.server
import json
import os
import secrets
import base64
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'audit/execution-results/T-24-template-echo-result.json'
NGINX = shutil.which('nginx') or '/opt/homebrew/bin/nginx'
OPENSSL = '/opt/homebrew/opt/openssl@3/bin/openssl'
TMP = Path(tempfile.mkdtemp(prefix='anonyproof-T35-nginx-'))
os.chmod(TMP, 0o700)
result = {'task': 'T-35', 'scope': 'Loopback synthetic echo upstream only; no real Next/API, database, UI, production TLS or external port acceptance', 'prefix': str(TMP), 'nginx': NGINX, 'commands': [], 'checks': [], 'templateSha256': hashlib.sha256((ROOT / 'deploy/nginx/anonyproof.deline.top.conf').read_bytes()).hexdigest()}

def run(argv):
    proc = subprocess.run(argv, capture_output=True, text=True)
    result['commands'].append({'argv': argv, 'exit': proc.returncode, 'stdout': proc.stdout, 'stderr': proc.stderr})
    assert proc.returncode == 0, (argv, proc.stderr)
    return proc

def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

class Echo(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_):
        pass
    def respond(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        payload = json.dumps({'method': self.command, 'path': self.path, 'body': body.decode(), 'headers': dict(self.headers)}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Set-Cookie', 'fixture_identity=synthetic; Secure; HttpOnly; SameSite=Lax; Path=/anonyproof')
        self.send_header('Set-Cookie', 'fixture_admin=synthetic; Secure; HttpOnly; SameSite=Strict; Path=/anonyproof')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(payload)
    do_GET = respond
    do_POST = respond
    do_PUT = respond
    do_DELETE = respond
    do_OPTIONS = respond
    do_HEAD = respond

backend = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Echo)
thread = threading.Thread(target=backend.serve_forever, daemon=True)
thread.start()
http_port, https_port = port(), port()
result['ports'] = {'http': http_port, 'https': https_port, 'upstream': backend.server_port}
cert, key = TMP / 'fixture-cert.pem', TMP / 'fixture-key.pem'
conf = TMP / 'nginx.conf'
process = None
try:
    run([NGINX, '-V'])
    run([OPENSSL, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=anonyproof.deline.top', '-addext', 'subjectAltName=DNS:anonyproof.deline.top,IP:127.0.0.1', '-keyout', str(key), '-out', str(cert)])
    os.chmod(key, 0o600)
    template = (ROOT / 'deploy/nginx/anonyproof.deline.top.conf').read_text()
    template = template.replace('    listen 80;\n    listen [::]:80;', f'    listen 127.0.0.1:{http_port};')
    template = template.replace('    listen 443 ssl;\n    listen [::]:443 ssl;', f'    listen 127.0.0.1:{https_port} ssl;')
    template = template.replace('/etc/nginx/ssl/deline.top/fullchain.pem', str(cert)).replace('/etc/nginx/ssl/deline.top/privkey.pem', str(key))
    template = template.replace('http://127.0.0.1:3000', f'http://127.0.0.1:{backend.server_port}')
    proxy_auth = base64.b64encode(secrets.token_bytes(32)).decode()
    private_include=TMP/'proxy-auth.conf'
    private_include.write_text('proxy_set_header X-AnonyProof-Proxy-Auth '+json.dumps(proxy_auth)+';\n')
    os.chmod(private_include,0o600)
    template=template.replace('/etc/nginx/private/anonyproof-proxy-auth.conf',str(private_include))
    # All prefix, temporary and PID paths stay within this private fixture.
    conf.write_text(f'worker_processes 1;\npid {TMP}/nginx.pid;\nerror_log {TMP}/error.log;\nevents {{ worker_connections 128; }}\nhttp {{\naccess_log {TMP}/access.log;\nclient_body_temp_path {TMP}/client_temp;\nproxy_temp_path {TMP}/proxy_temp;\nfastcgi_temp_path {TMP}/fastcgi_temp;\nuwsgi_temp_path {TMP}/uwsgi_temp;\nscgi_temp_path {TMP}/scgi_temp;\n' + template + '\n}\n')
    run([NGINX, '-t', '-p', str(TMP) + '/', '-c', str(conf)])
    argv = [NGINX, '-p', str(TMP) + '/', '-c', str(conf), '-g', 'daemon off;']
    log = (TMP / 'master-output.log').open('w')
    process = subprocess.Popen(argv, stdout=log, stderr=log)
    result['start'] = {'argv': argv, 'pid': process.pid}
    for _ in range(100):
        assert process.poll() is None, 'Fixture process stopped before listening'
        try:
            with socket.create_connection(('127.0.0.1', http_port), timeout=0.1):
                break
        except OSError:
            time.sleep(0.05)
    else:
        raise AssertionError('Fixture did not listen')
    context = ssl.create_default_context(cafile=str(cert))

    def request(method, path, secure=True, host='anonyproof.deline.top', body=None, headers=None):
        conn = http.client.HTTPSConnection('127.0.0.1', https_port, context=context, timeout=5) if secure else http.client.HTTPConnection('127.0.0.1', http_port, timeout=5)
        data = dict(headers or {})
        data['Host'] = host
        conn.request(method, path, body=body, headers=data)
        response = conn.getresponse()
        res = {'status': response.status, 'headers': response.getheaders(), 'body': response.read().decode()}
        conn.close()
        return res

    def check(name, actual, expected):
        assert actual == expected, (name, actual, expected)
        result['checks'].append({'name': name, 'actual': actual, 'expected': expected, 'pass': True})

    for method in ('GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'):
        redirect = request(method, '/anonyproof/api/fixture?value=a%2Fb&n=2', secure=False, body='synthetic' if method in ('POST', 'PUT', 'DELETE') else None)
        check(method + ' HTTP redirect', redirect['status'], 308)
        check(method + ' redirect exact URI', dict(redirect['headers'])['Location'], 'https://anonyproof.deline.top/anonyproof/api/fixture?value=a%2Fb&n=2')
    res = request('GET', '/?synthetic=1')
    check('TLS root redirect', res['status'], 301)
    check('TLS root query retained', dict(res['headers'])['Location'], 'https://anonyproof.deline.top/anonyproof?synthetic=1')
    for secure in (False, True):
        check('Unknown Host rejected ' + str(secure), request('GET', '/anonyproof', secure=secure, host='unrelated.example')['status'], 404)
    for path in ('/other', '/anonyproofevil', '/api/fixture'):
        check('Outside basePath ' + path, request('GET', path)['status'], 404)
    for path in ('/anonyproof', '/anonyproof/', '/anonyproof/_next/static/fixture.js'):
        res = request('GET', path)
        check('basePath passthrough ' + path, res['status'], 200)
        check('basePath preserved ' + path, json.loads(res['body'])['path'], path)
    for method in ('GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'):
        res = request(method, '/anonyproof/api/fixture?value=a%2Fb&n=2', body='synthetic' if method in ('POST', 'PUT', 'DELETE') else None, headers={'X-Forwarded-For':'203.0.113.17', 'X-Forwarded-Proto':'http', 'Forwarded':'for=203.0.113.17', 'X-ForwardedFor':'203.0.113.18', 'X-ForwardedProto':'http','X-AnonyProof-Proxy-Auth':'forged-visitor'})
        payload = json.loads(res['body'])
        check(method + ' upstream status', res['status'], 200)
        check(method + ' method preserved', payload['method'], method)
        check(method + ' body preserved', payload['body'], 'synthetic' if method in ('POST', 'PUT', 'DELETE') else '')
        check(method + ' query preserved', payload['path'], '/anonyproof/api/fixture?value=a%2Fb&n=2')
        sent = {k.lower():v for k,v in payload['headers'].items()}
        for name,value in [('host','anonyproof.deline.top'),('x-forwarded-host','anonyproof.deline.top'),('x-forwarded-port','443'),('x-forwarded-proto','https'),('x-real-ip','127.0.0.1'),('x-forwarded-for','127.0.0.1')]:
            check(method + ' canonical ' + name, sent.get(name), value)
        check(method + ' private proxy header overwrites visitor value', sent.get('x-anonyproof-proxy-auth') == proxy_auth, True)
        for name in ('forwarded','x-forwardedfor','x-forwardedproto'):
            check(method + ' cleared ' + name, name in sent, False)
        check(method + ' Cache-Control unchanged', dict(res['headers']).get('Cache-Control'), 'no-store')
        check(method + ' two Cookies unchanged', [v for k,v in res['headers'] if k.lower()=='set-cookie'], ['fixture_identity=synthetic; Secure; HttpOnly; SameSite=Lax; Path=/anonyproof','fixture_admin=synthetic; Secure; HttpOnly; SameSite=Strict; Path=/anonyproof'])
    for version in (ssl.TLSVersion.TLSv1_2, ssl.TLSVersion.TLSv1_3):
        exact_tls = ssl.create_default_context(cafile=str(cert))
        exact_tls.minimum_version = exact_tls.maximum_version = version
        tls_conn = http.client.HTTPSConnection('127.0.0.1', https_port, context=exact_tls, timeout=5)
        tls_conn.request('GET', '/anonyproof', headers={'Host': 'anonyproof.deline.top'})
        tls_res = tls_conn.getresponse()
        check(version.name + ' allowed', tls_res.status, 200)
        check(version.name + ' negotiated', tls_conn.sock.version(), 'TLSv1.2' if version == ssl.TLSVersion.TLSv1_2 else 'TLSv1.3')
        tls_res.read(); tls_conn.close()
    head = request('HEAD', '/anonyproof/api/fixture')
    check('TLS HEAD forwarded', head['status'], 200)
    check('TLS HEAD has no body', head['body'], '')
    conn = http.client.HTTPConnection('127.0.0.1', http_port, timeout=5)
    conn.putrequest('GET', '/anonyproof', skip_host=True)
    conn.endheaders()
    res = conn.getresponse()
    check('Missing Host rejected', res.status, 400)
    res.read(); conn.close()
    run([NGINX, '-s', 'quit', '-p', str(TMP) + '/', '-c', str(conf)])
    check('Fixture master graceful exit', process.wait(timeout=10), 0)
    check('Fixture pid removed', (TMP / 'nginx.pid').exists(), False)
    for name, number in [('HTTP', http_port), ('TLS', https_port)]:
        with socket.socket() as probe:
            probe.settimeout(1)
            check(name + ' fixture socket closed', probe.connect_ex(('127.0.0.1', number)) != 0, True)
    log.close()
    result['pass'] = True
except BaseException as exc:
    result['pass'] = False
    result['failure'] = repr(exc)
    raise
finally:
    if process is not None and process.poll() is None:
        # Signal only the master we created, never a system service.
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait(timeout=10)
    backend.shutdown(); backend.server_close()
    result['stopped'] = process is None or process.poll() is not None
    OUT.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'pass': result['pass'], 'checks': len(result['checks']), 'prefix': str(TMP), 'stopped': result['stopped']}))
