#!/usr/bin/env python3
"""Real loopback Nginx -> production Next -> synthetic Express evidence.
The coordinator owns Next/Express. This process owns only private-prefix Nginx.
"""
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import socket
import sqlite3
import ssl
import subprocess
import sys
import tempfile
import time
from http.cookies import SimpleCookie

ROOT=Path(__file__).resolve().parents[2]
META=json.load(sys.stdin)
OUT=ROOT/'audit/execution-results/T-24-T35-real-chain-result.json'
TMP=Path(tempfile.mkdtemp(prefix='anonyproof-T24-T35-chain-'))
os.chmod(TMP,0o700)
NGINX='/opt/homebrew/bin/nginx'
OPENSSL='/opt/homebrew/opt/openssl@4/bin/openssl'
TEMPLATE=ROOT/'deploy/nginx/anonyproof.deline.top.conf'
result={'tasks':['T-24','T-35'],'scope':'real loopback Nginx -> existing production Next -> isolated formal Express; no product configuration change, browser UI or production acceptance',
 'prefix':str(TMP),'fixtureDatabase':META['databasePath'],'fixtureBackendDir':META['fixtureDir'],
 'templateSha256':hashlib.sha256(TEMPLATE.read_bytes()).hexdigest(),'buildId':META['buildId'],'buildSha256':META['buildHash'],
 'configuredTrustProxy':1,'checks':[],'requests':[],'commands':[],'sourceProbes':[],'cleanup':{}}
process=None
conf=TMP/'nginx.conf'
db=None

def check(name,actual,expected,task='T-35'):
    passed=actual==expected
    result['checks'].append({'task':task,'name':name,'actual':actual,'expected':expected,'pass':passed})
    return passed

def run(argv):
    proc=subprocess.run(argv,capture_output=True,text=True,timeout=15)
    result['commands'].append({'argv':argv,'exit':proc.returncode,'stderr':proc.stderr})
    if proc.returncode!=0:raise RuntimeError('Fixture command failed')
    return proc

def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));return sock.getsockname()[1]

def cleanup():
    global process,db
    if process and process.poll() is None:
        try:
            stop=subprocess.run([NGINX,'-s','quit','-p',str(TMP)+'/', '-c',str(conf)],capture_output=True,text=True,timeout=10)
            result['cleanup']['nginxQuitExit']=stop.returncode
            result['cleanup']['nginxMasterExit']=process.wait(timeout=10)
        except Exception:
            process.terminate()
            try:process.wait(timeout=3)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=3)
    if db:db.close();db=None
    for name,port in result.get('ports',{}).items():
        if name not in ('http','tls'):continue
        with socket.socket() as probe:
            probe.settimeout(.5);result['cleanup'][name+'SocketClosed']=probe.connect_ex(('127.0.0.1',port))!=0
    if conf.exists():result['cleanup']['nginxPidRemoved']=not (TMP/'nginx.pid').exists()
    OUT.write_text(json.dumps(result,indent=2)+'\n')

def interrupted(_sig,_frame):
    result['interrupted']=True;cleanup();sys.exit(1)
signal.signal(signal.SIGTERM,interrupted)

try:
    http_port=free_port();tls_port=META['tlsPort']
    result['ports']={'http':http_port,'tls':tls_port,'next':META['nextPort'],'backend':META['backendPort']}
    second=META['secondSource']
    sources=['127.0.0.1',second]
    for source in sources:
        family=socket.AF_INET6 if ':' in source else socket.AF_INET
        with socket.socket(family) as sock:
            try:sock.bind((source,0));result['sourceProbes'].append({'source':source,'bind':True})
            except OSError as error:result['sourceProbes'].append({'source':source,'bind':False,'errno':error.errno});raise
    cert,key=TMP/'fixture-cert.pem',TMP/'fixture-key.pem'
    run([OPENSSL,'req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=anonyproof.deline.top',
         '-addext','subjectAltName=DNS:anonyproof.deline.top,IP:127.0.0.1,IP:::1','-keyout',str(key),'-out',str(cert)])
    os.chmod(key,0o600)
    template=TEMPLATE.read_text()
    template=template.replace('    listen 80;\n    listen [::]:80;',f'    listen 127.0.0.1:{http_port};\n    listen [::1]:{http_port};')
    template=template.replace('    listen 443 ssl;\n    listen [::]:443 ssl;',f'    listen 127.0.0.1:{tls_port} ssl;\n    listen [::1]:{tls_port} ssl;')
    template=template.replace('/etc/nginx/ssl/deline.top/fullchain.pem',str(cert)).replace('/etc/nginx/ssl/deline.top/privkey.pem',str(key))
    template=template.replace('http://127.0.0.1:3000',f"http://127.0.0.1:{META['nextPort']}")
    conf.write_text(f'worker_processes 1;\npid {TMP}/nginx.pid;\nerror_log {TMP}/error.log;\nevents {{worker_connections 128;}}\nhttp {{\naccess_log {TMP}/access.log;\nclient_body_temp_path {TMP}/client_temp;\nproxy_temp_path {TMP}/proxy_temp;\nfastcgi_temp_path {TMP}/fastcgi_temp;\nuwsgi_temp_path {TMP}/uwsgi_temp;\nscgi_temp_path {TMP}/scgi_temp;\n'+template+'\n}\n')
    run([NGINX,'-t','-p',str(TMP)+'/', '-c',str(conf)])
    log=(TMP/'master-output.log').open('w')
    process=subprocess.Popen([NGINX,'-p',str(TMP)+'/', '-c',str(conf),'-g','daemon off;'],stdout=log,stderr=log)
    result['nginxPid']=process.pid
    for _ in range(100):
        if process.poll() is not None:raise RuntimeError('Owned Nginx exited')
        try:
            with socket.create_connection(('127.0.0.1',tls_port),timeout=.1):break
        except OSError:time.sleep(.05)
    else:raise RuntimeError('Owned Nginx did not listen')
    context=ssl.create_default_context(cafile=str(cert))
    db=sqlite3.connect('file:'+META['databasePath']+'?mode=ro',uri=True)
    db.execute('PRAGMA query_only=ON')
    def request(method,path,source='127.0.0.1',headers=None,body=None,cookies=None,secure=True,direct=False):
        destination='::1' if ':' in source and not direct else '127.0.0.1'
        port=META['backendPort'] if direct else tls_port if secure else http_port
        cls=http.client.HTTPSConnection if secure and not direct else http.client.HTTPConnection
        kwargs={'timeout':10,'source_address':(source,0)}
        if cls is http.client.HTTPSConnection:kwargs['context']=context
        conn=cls(destination,port,**kwargs)
        data={'Host':'anonyproof.deline.top','User-Agent':'Mozilla/5.0 Chrome/125.0 T24-T35-local-only'}
        data.update(headers or {})
        if cookies:data['Cookie']='; '.join(f'{key}={value}' for key,value in cookies.items())
        if body is not None:
            body=json.dumps(body);data['Content-Type']='application/json'
        conn.request(method,path,body=body,headers=data)
        response=conn.getresponse();text=response.read().decode();response_headers=response.getheaders();status=response.status;conn.close()
        normalized_headers={key.lower():value for key,value in response_headers}
        parsed=json.loads(text) if 'application/json' in normalized_headers.get('content-type','') else None
        fresh={};attributes=[]
        for key,value in response_headers:
            if key.lower()=='set-cookie':
                jar=SimpleCookie();jar.load(value)
                for name,cookie in jar.items():
                    fresh[name]=cookie.value
                    attributes.append({'name':name,'secure':bool(cookie['secure']),'httpOnly':bool(cookie['httponly']),'sameSite':cookie['samesite'],'path':cookie['path']})
        result['requests'].append({'method':method,'source':source,'directBackend':direct,'status':status,
          'cookieSent':bool(cookies),'setCookieAttributes':attributes,'cacheControl':normalized_headers.get('cache-control'),
          'sourceHeaderVariant':'multi' if ',' in data.get('X-Forwarded-For','') else 'single' if data.get('X-Forwarded-For') else 'none'})
        return {'status':status,'json':parsed,'text':text,'headers':normalized_headers,'cookies':fresh,'attributes':attributes}
    def max_log_id():return db.execute('SELECT COALESCE(MAX(id),0) FROM access_logs').fetchone()[0]
    def observed_ip(method,path,source,headers=None,direct=False,body=None,cookies=None):
        previous=max_log_id()
        res=request(method,path,source,headers,body,cookies,direct=direct)
        rows=[]
        for _ in range(100):
            rows=db.execute('SELECT id,ip,path,user_agent FROM access_logs WHERE id>? ORDER BY id',(previous,)).fetchall()
            if rows:break
            time.sleep(.01)
        if not rows and res['status']==429:
            result['sourceProbes'].append({'socketSource':source,'directBackend':direct,'status':429,'accessRow':False,'reason':'Limiter rejects before access recorder; quota asserted from HTTP status'})
            return res,None
        if len(rows)!=1:raise RuntimeError('Expected exactly one new isolated access row')
        identifier,ip,template,user_agent=rows[0]
        result['sourceProbes'].append({'socketSource':source,'directBackend':direct,'storedIp':ip,'routeTemplate':template,'uaClassification':user_agent,'status':res['status'],
          'forgedHeaderVariants':list((headers or {}).keys())})
        return res,ip
    def same_ip(actual,expected):
        address=ipaddress.ip_address(actual)
        return str(getattr(address,'ipv4_mapped',None) or address)==str(ipaddress.ip_address(expected))
    for source in sources:
        for forged in [None,'203.0.113.77','203.0.113.77, 198.51.100.29']:
            headers={'X-Forwarded-For':forged,'X-Real-IP':'198.51.100.30','Forwarded':'for=198.51.100.31'} if forged else {}
            res,ip=observed_ip('GET','/anonyproof/api/stats',source,headers)
            check(f'Actual source {source}, XFF {"multi" if forged and "," in forged else "single" if forged else "absent"}',same_ip(ip,source),True,'T-24')
            check('Stats rewrite reaches Express',res['status'],200)
    res,ip=observed_ip('GET','/api/stats','127.0.0.1',{'X-Forwarded-For':'203.0.113.77'},direct=True)
    check('Direct backend header does not choose an arbitrary source identity',same_ip(ip,'127.0.0.1'),True,'T-24')
    # Obtain admin Cookie once; subsequent failed login probes consume a three-request fixture quota.
    auth={'Origin':META['origin']}
    login,ip=observed_ip('POST','/anonyproof/api/admin/auth/login','127.0.0.1',auth,body={'password':META['password']})
    check('Real administrator login via both proxies',login['status'],200)
    if login['status']!=200:raise RuntimeError('Admin login unavailable')
    admin_cookie=login['cookies']
    for value,expected in [('203.0.113.17',401),('203.0.113.18, 198.51.100.19',401),('203.0.113.20',429)]:
        probe,ip=observed_ip('POST','/anonyproof/api/admin/auth/login','127.0.0.1',{'Origin':META['origin'],'X-Forwarded-For':value},body={'password':'T24-invalid-synthetic-password'})
        check('Same source changing XFF shares login quota '+str(expected),probe['status'],expected,'T-24')
    independent,ip=observed_ip('POST','/anonyproof/api/admin/auth/login',second,auth,body={'password':'T24-invalid-synthetic-password'})
    check('Second actual source has independent login quota',independent['status'],401,'T-24')
    for attrs in login['attributes']:
        check('Administrator Cookie Secure',attrs['secure'],True);check('Administrator Cookie HttpOnly',attrs['httpOnly'],True);check('Administrator Cookie SameSite',attrs['sameSite'],'Strict')
    pages=['/anonyproof','/anonyproof/foorpynona','/anonyproof/access-stats']
    assets=set()
    for page in pages:
        res=request('GET',page);check('Real Next page '+page,res['status'],200)
        assets.update(re.findall(r'(?:src|href)="([^" ]*/_next/static/[^" ]+)"',res['text']))
    check('Production pages reference static assets',bool(assets),True)
    result['staticAssets']=[]
    for asset in sorted(assets):
        if not asset.startswith('/anonyproof/_next/static/'):raise RuntimeError('Unexpected external static asset URL')
        res=request('GET',asset);check('Static asset via template '+asset,res['status'],200)
        result['staticAssets'].append({'path':asset,'status':res['status'],'cacheControl':res['headers'].get('cache-control'),'contentType':res['headers'].get('content-type')})
    identity=request('POST','/anonyproof/api/identity',headers=auth,body={})
    check('Identity POST via both proxies',identity['status'],200)
    if identity['status']!=200:raise RuntimeError('Identity unavailable')
    owner_cookie=identity['cookies'];device=identity['json']['deviceId']
    for attrs in identity['attributes']:
        check('Identity Cookie Secure',attrs['secure'],True);check('Identity Cookie HttpOnly',attrs['httpOnly'],True);check('Identity Cookie SameSite',attrs['sameSite'],'Lax')
    check('Protected identity no-store',identity['headers'].get('cache-control'),'no-store')
    submit=request('POST','/anonyproof/api/feedback',headers=auth,cookies=owner_cookie,body={'deviceId':device,'category':'report','originalContent':'T35 real chain synthetic report','encryptedContent':'synthetic-only'})
    check('Formal synthetic submission via proxy',submit['status'],200)
    if submit['status']!=200:raise RuntimeError('Submission unavailable')
    target=submit['json']['id']
    for role,cookie,path,content in [('user',owner_cookie,f'/anonyproof/api/feedback/{target}/comments','T35 synthetic user supplement'),('admin',admin_cookie,f'/anonyproof/api/admin/feedback/{target}/comments','T35 synthetic administrator reply')]:
        res=request('POST',path,headers=auth,cookies=cookie,body={'content':content});check(role+' real comment via proxy',res['status'],200)
    state=request('PUT',f'/anonyproof/api/admin/feedback/{target}/status',headers=auth,cookies=admin_cookie,body={'status':'in_progress','solution':'T35 synthetic processing explanation'})
    check('PUT status and explanation via proxy',state['status'],200)
    detail=request('GET',f'/anonyproof/api/feedback/{target}',cookies=owner_cookie)
    check('Authorized detail reads current status',detail['json']['feedback']['status'],'in_progress')
    check('Authorized detail reads explanation',detail['json']['feedback']['solution'],'T35 synthetic processing explanation')
    check('Protected detail no-store',detail['headers'].get('cache-control'),'no-store')
    missing=request('PUT',f'/anonyproof/api/admin/feedback/{target}/status',cookies=admin_cookie,body={'status':'resolved','solution':'must not apply'})
    evil=request('PUT',f'/anonyproof/api/admin/feedback/{target}/status',headers={'Origin':'https://evil.example'},cookies=admin_cookie,body={'status':'resolved','solution':'must not apply'})
    check('Missing Origin rejected through proxy',missing['status'],403);check('Evil Origin rejected through proxy',evil['status'],403)
    retained=request('GET',f'/anonyproof/api/feedback/{target}',cookies=owner_cookie)
    check('Rejected writes leave existing status unchanged',retained['json']['feedback']['status'],'in_progress')
    before={table:db.execute(f'SELECT COUNT(*) FROM {table} WHERE {"id" if table=="feedbacks" else "feedback_id"}=?',(target,)).fetchone()[0] for table in ['feedbacks','feedback_comments','notifications']}
    delete=request('DELETE',f'/anonyproof/api/admin/feedback/{target}',headers=auth,cookies=admin_cookie)
    check('DELETE business feedback through proxy',delete['status'],200)
    for table in before:
        count=db.execute(f'SELECT COUNT(*) FROM {table} WHERE {"id" if table=="feedbacks" else "feedback_id"}=?',(target,)).fetchone()[0]
        check('DELETE cascades '+table,count,0)
    check('Deleted record inaccessible',request('GET',f'/anonyproof/api/feedback/{target}',cookies=owner_cookie)['status'],404)
    marker='T33-Nginx-inherited-raw-marker-551'
    request('GET','/anonyproof/api/stats?private='+marker,headers={'User-Agent':'T35-raw-agent-'+marker})
    time.sleep(.05)
    access=(TMP/'access.log').read_text()
    result['nginxInheritedLogEvidence']={'fixtureHttpContextUsesDefaultCombinedLog':True,'productVhostDeclaresOwnAccessLog':bool(re.search(r'^\s*access_log\b',TEMPLATE.read_text(),re.M)),
      'rawQueryMarkerRetained':marker in access,'rawUaMarkerRetained':('T35-raw-agent-'+marker) in access,
      'actualLoopbackSourceRetained':'127.0.0.1' in access,'logPath':str(TMP/'access.log'),'note':'synthetic inherited logging demonstration only; production global logging not asserted; no log strategy changed'}
    result['businessCountsBeforeDelete']=before
except Exception as error:
    result['fatalType']=type(error).__name__
finally:
    cleanup()
    counts={task:{'passed':sum(check['pass'] for check in result['checks'] if check['task']==task),'failed':sum(not check['pass'] for check in result['checks'] if check['task']==task)} for task in ['T-24','T-35']}
    result['summary']=counts
    result['acceptanceComplete']=not result.get('fatalType') and all(item['pass'] for item in result['checks'])
    OUT.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'evidence':str(OUT),'summary':counts,'fatalType':result.get('fatalType'),'allAcceptancePassed':result['acceptanceComplete']}))
sys.exit(0 if result['acceptanceComplete'] else 1)
