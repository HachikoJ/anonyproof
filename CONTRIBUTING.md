# Contributing to AnonyProof

感谢您考虑为 AnonyProof 做出贡献！

## 如何贡献

### 报告 Bug

1. 在 [Issues](https://github.com/yourusername/anonyproof/issues) 中搜索是否已有相关问题
2. 如果没有，创建新的 Issue，包含：
   - 清晰的标题
   - 详细的复现步骤
   - 预期行为 vs 实际行为
   - 截图（如果适用）
   - 环境信息（操作系统、浏览器、Node.js 版本）

### 提交新功能

1. 先在 [Discussions](https://github.com/yourusername/anonyproof/discussions) 中讨论
2. 创建 Feature Request Issue
3. 等待维护者确认
4. Fork 项目并创建分支
5. 提交 Pull Request

### Pull Request 流程

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m 'Add some feature'`
4. 推送到分支：`git push origin feature/your-feature`
5. 创建 Pull Request

### 代码规范

- 使用 TypeScript
- 遵循 ESLint 配置
- 添加单元测试
- 更新相关文档
- 遵循 Conventional Commits 规范

### Commit Message 格式

```
feat: 添加新功能
fix: 修复 Bug
docs: 更新文档
style: 代码格式调整
refactor: 重构代码
test: 添加测试
chore: 构建/工具变动
```

### 开发环境设置

```bash
# 克隆项目
git clone https://github.com/yourusername/anonyproof.git
cd anonyproof

# 安装依赖
npm install
cd server && npm install

# 运行开发服务器
npm run dev
```

### 测试

```bash
# 运行所有测试
npm test

# 运行特定测试
npm test -- --testNamePattern="your test"

# 生成覆盖率报告
npm run test:coverage
```

## 代码审查

所有 Pull Request 都需要：
- 至少一位维护者批准
- 通过所有 CI 检查
- 无合并冲突

## 行为准则

- 尊重所有贡献者
- 欢迎不同观点
- 专注于项目本身
- 建设性讨论

有任何问题，请随时联系维护者！
