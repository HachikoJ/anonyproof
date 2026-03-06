#!/bin/bash
# 修复匿证项目的 Nginx 配置

echo "正在配置 Nginx..."

# 创建新的配置文件
cat > /etc/nginx/conf.d/deline.top.conf << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name deline.top www.deline.top;

    # 费曼读书法项目（反向代理）
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-ForwardedFor $proxy_add_x_forwarded_for;
        proxy_set_header X-ForwardedProto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        proxy_send_timeout 300s;
    }

    # 培训项目（静态文件）
    location /training {
        alias /usr/share/nginx/html/training;
        index index.html;
    }

    # 匿证项目（反向代理到 3000）
    location /anonyproof {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-ForwardedFor $proxy_add_x_forwarded_for;
        proxy_set_header X-ForwardedProto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        proxy_send_timeout 300s;
    }

    # 静态资源缓存
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|woff|woff2|ttf|eot|svg|webp)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 禁止访问敏感文件
    location ~* \.(env|git|svn|htaccess|htpasswd|log|bak|backup|sql|conf|ini)$ {
        deny all;
        access_log off;
        log_not_found off;
    }
}
EOF

# 测试并重载
/usr/sbin/nginx -t
/usr/sbin/nginx -s reload

echo ""
echo "✅ Nginx 配置完成！"
echo ""
echo "测试结果："
curl -I http://www.deline.top
curl -I http://www.deline.top/training
curl -I http://www.deline.top/anonyproof
