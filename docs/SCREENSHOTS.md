# 项目截图

欢迎来到 AnonyProof 项目截图展示区！

## 📸 如何添加截图

1. 在此目录创建以下截图：
   - `user-home.png` - 用户端主页（反馈提交页面）
   - `user-feedbacks.png` - 我的反馈列表
   - `user-detail.png` - 单条反馈详情
   - `admin-dashboard.png` - 管理端仪表板
   - `admin-feedbacks.png` - 管理端反馈列表
   - `notification-center.png` - 通知中心
   - `mobile-view.png` - 移动端视图

2. 推荐截图尺寸：
   - 宽度：1200px 或更多
   - 格式：PNG（推荐）或 JPG
   - 文件大小：< 2MB

3. 添加截图到 README.md：
   在 README.md 的"界面预览"部分添加：
   ```markdown
   ### 用户端主页
   ![用户端主页](screenshots/user-home.png)
   ```

## 🎨 截图工具推荐

- **macOS**: Cmd+Shift+4（系统自带）
- **Windows**: Win+Shift+S（系统自带）
- **Linux**: 
  - Ubuntu: PrtSc 或 gnome-screenshot
  - 安装：`sudo apt install gnome-screenshot`
- **浏览器插件**: Awesome Screenshot
- **在线工具**: 
  - [screenshot.guru](https://screenshot.guru/)
  - [screely.com](https://www.screely.com/)

## 📱 在线截图

如果是生产环境，可以使用在线截图服务：

```bash
# 使用截图服务
curl "https://api.apiflash.com/v1/urltoimage?access_key=YOUR_KEY&url=http://your-domain.com/anonyproof&fresh=true" -o screenshot.png
```

或使用 GitHub Pages 部署后截图。

## 🔗 相关链接

- [项目 README](../README.md)
- [在线 Demo](#) (待部署)
- [部署文档](../docs/DEPLOYMENT.md)
