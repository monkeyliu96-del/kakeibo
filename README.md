# 记账本 kakeibo

日本生活用的个人记账 PWA:离线可用、多设备同步、可选端到端加密,支持乐天卡明细导入、Apple Pay / 邮件 / 截图自动记账,中 / 英 / 日三语。

**技术栈**:Vite · TypeScript · Supabase(Auth / Postgres / RLS / RPC)· GitHub Actions · GitHub Pages · Service Worker · Web Crypto

**工程要点**
- 无自建服务器:前端静态托管,后端用 Supabase,数据按行级权限隔离
- 三方合并同步 + 乐观锁:多设备同时修改不丢数据
- PBKDF2 + AES-GCM 端到端加密,云端只存密文
- 核心逻辑拆成纯函数,配单元测试(75 个)和与旧代码的对拍验证
- CI:类型检查 → 测试 → 构建,通过后自动发布

详细设计见 [docs/architecture.md](docs/architecture.md)(架构图、数据库、同步与加密流程)。


## 开发

```
npm install
npm run dev        # 本地开发(热更新)
npm run build      # 类型检查 + 构建到 dist/
npm run preview    # 预览构建结果
npm test           # 运行单元测试
```

代码结构(重构进行中,逐步从 `src/app.ts` 里拆出模块):

| 路径 | 内容 |
|---|---|
| `src/main.ts` | 入口 |
| `src/styles.css` | 全部样式 |
| `src/i18n/translate.ts` | 中 / 英 / 日 翻译词典和翻译引擎 |
| `src/core/` | 纯函数核心:资产计算 `ledger`、重复检测 `dedupe`、乐天 PDF 解析 `rakuten` |
| `src/sync/` | 三方合并 `merge`、加密 `crypto` |
| `src/app.ts` | UI 与状态(待拆分,暂时不做类型检查) |
| `tests/` | 单元测试(`npm test`) |
| `public/` | `sw.js`、manifest、图标,原样复制到发布目录 |

## 程序分布

| 部分 | 在哪里 | 作用 |
|---|---|---|
| 前端 App | 本仓库 `index.html` + `sw.js`,用 GitHub Pages 发布 | 记账、明细、统计、资产;离线可用 |
| 后端 | Supabase(结构见 `supabase/schema.sql`) | 账号登录、多设备同步、每日云端备份、自动记账收件箱、截图识别 |
| iPhone 快捷指令 | 各人手机 | Apple Pay「取引」自动化;截图 → 识别文字 → 发到后端(背面轻点触发) |
| Gmail 脚本 | 各人 Google Apps Script | 读取 PayPay 卡「利用速報」邮件,发到后端 |

快捷指令和 Gmail 脚本的设置步骤在 App 的「我的 → 自动记账」页面,里面会显示每个人自己的密钥。

## 给别人用

- **共用这一套**:把网址发给对方,对方在 App 里用邮箱注册即可。数据按账号隔开(行级权限),但后端管理员能看到所有数据。
- **独立部署一套**:
  1. Fork 本仓库,开启 GitHub Pages。
  2. 新建 Supabase 项目,在 SQL Editor 运行 `supabase/schema.sql`。
  3. 把 `index.html` 里的 `SUPA_URL`、`SUPA_KEY` 换成新项目的 URL 和 publishable key。
  4. Supabase → Authentication → URL Configuration 里,把 Site URL 设成自己的 Pages 网址。

## 改了数据库之后

线上数据库函数有改动时,记得同步更新 `supabase/schema.sql`,保持仓库里的是最新版。
