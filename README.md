# 记账本 kakeibo

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
