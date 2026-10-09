#!/usr/bin/env python3
"""Synthetic loopback proof for preserving the live ACME webroot in T-35.
No production access, system service, real certificate, secret or asset deletion.
"""
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'deploy/nginx/anonyproof.deline.top.conf'
OUT = ROOT / 'audit/execution-results/T-35-acme-template-result.json'
TMP = Path(tempfile.mkdtemp(prefix='anonyproof-T35-acme-'))
os.chmod(TMP, 0o700)
NGINX = shutil.which('nginx') or '/opt/homebrew/bin/nginx'
OPENSSL = '/opt/homebrew/opt/openssl@4/bin/openssl'
result = {'task': 'T-35', 'syntheticOnly': True, 'templateSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'checks': []}
process = None

def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

def check(name, condition):
    result['checks'].append({'name': name, 'pass': bool(condition)})
    if not condition:
        raise AssertionError(name)

try:
    http_port, tls_port = free_port(), free_port()
    cert, key, include, conf = [TMP / name for name in ['cert.pem', 'key.pem', 'proxy.conf', 'nginx.conf']]
    subprocess.run([OPENSSL, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
                    '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', str(key), '-out', str(cert)], capture_output=True, check=True, timeout=20)
    os.chmod(key, 0o600)
    include.write_text('proxy_set_header X-AnonyProof-Proxy-Auth "synthetic-only";\n')
    os.chmod(include, 0o600)
    webroot = TMP / 'webroot'
    challenge = webroot / '.well-known/acme-challenge/fixed-token'
    challenge.parent.mkdir(parents=True)
    challenge.write_text('T35-synthetic-renewal-token')
    template = SOURCE.read_text().replace('    listen 80;\n    listen [::]:80;', f'    listen 127.0.0.1:{http_port};')
    template = template.replace('    listen 443 ssl;\n    listen [::]:443 ssl;', f'    listen 127.0.0.1:{tls_port} ssl;')
    for old, new in [('/etc/nginx/ssl/deline.top/fullchain.pem', cert), ('/etc/nginx/ssl/deline.top/privkey.pem', key),
                     ('/etc/nginx/private/anonyproof-proxy-auth.conf', include), ('/var/www/_acme-challenge', webroot)]:
        template = template.replace(old, str(new))
    conf.write_text(f'worker_processes 1;\npid {TMP}/nginx.pid;\nerror_log {TMP}/error.log;\nevents {{ worker_connections 64; }}\nhttp {{\n{template}\n}}\n')
    subprocess.run([NGINX, '-t', '-p', str(TMP) + '/', '-c', str(conf)], capture_output=True, check=True, timeout=15)
    check('nginx syntax', True)
    with (TMP / 'process.log').open('wb') as output:
        process = subprocess.Popen([NGINX, '-p', str(TMP) + '/', '-c', str(conf), '-g', 'daemon off;'], stdout=output, stderr=output)
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError('Owned Nginx exited')
        try:
            with socket.create_connection(('127.0.0.1', http_port), timeout=.1):
                break
        except OSError:
            time.sleep(.05)
    else:
        raise RuntimeError('Owned Nginx not ready')
    for secure in [False, True]:
        def request(path, method='GET', host='anonyproof.deline.top'):
            conn = (http.client.HTTPSConnection('127.0.0.1', tls_port, context=ssl.create_default_context(cafile=str(cert)), timeout=5)
                    if secure else http.client.HTTPConnection('127.0.0.1', http_port, timeout=5))
            conn.request(method, path, headers={'Host': host})
            response = conn.getresponse()
            value = response.status, response.read(), response.getheader('Location')
            conn.close()
            return value
        code, body, _ = request('/.well-known/acme-challenge/fixed-token')
        check(f'ACME existing token {secure}', code == 200 and body == b'T35-synthetic-renewal-token')
        check(f'ACME missing token {secure}', request('/.well-known/acme-challenge/missing')[0] == 404)
        check(f'ACME unknown Host rejected {secure}', request('/.well-known/acme-challenge/fixed-token', host='unrelated.example')[0] == 404)
        if not secure:
            code, _, location = request('/anonyproof/api/feedback?q=synthetic', method='POST')
            check('HTTP business method-preserving redirect', code == 308 and location == 'https://anonyproof.deline.top/anonyproof/api/feedback?q=synthetic')
        else:
            check('HTTPS root redirect unchanged', request('/')[2] == 'https://anonyproof.deline.top/anonyproof')
    result['passed'] = True
finally:
    if process is not None and process.poll() is None:
        process.terminate()
        process.wait(timeout=10)
    result['ownedProcessStopped'] = process is None or process.poll() is not None
    OUT.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'passed': result.get('passed', False), 'checks': len(result['checks']), 'evidence': str(OUT)}))
