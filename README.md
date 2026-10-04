# 401(k) 年度规划

从年初的基础工资、发薪次数与公司配比政策，计算全年普通 401(k) / After-tax 的供款比例；知识点直接放在结果下方。

## 使用

用现代浏览器打开本目录 `index.html`，保留同目录脚本和样式即可。也可使用下面的构建命令生成包含全部样式与脚本的独立 HTML。使用网页无需安装、登录或后端。

1. 选择年份。网页自动读取该年度 IRS 限额，并显示来源与读取时间。
2. 输入税前基础年薪、全年发薪次数，以及储蓄目标。
3. 填写公司的分档配比，例如“前 3% 配 100%，接下来 2% 配 50%”。可粘贴常见中英文政策识别档位，再核对字段。
4. 如果公司支持普通 After-tax，填写其独立年度上限或明确确认没有单独金额上限。
5. 查看理论比例、每次工资金额、公司 match 和年度目标。展开“工资系统可设置的保守比例”，查看按系统步长与分币舍入后的固定设置及未存满差额。

预填的 **$200,000 年薪只是演示**，没有使用个人实际年薪或年内累计供款记录。Snap 配比、2026 年 $33,100 公司上限、支持计划内 Roth 转换来自用户提供的政策摘录，属于可修改的示例，未独立核验为 Snap 当前官方完整政策。实际使用时请核对公司计划文件；更换年度后，公司 After-tax 上限必须重新确认。

## IRS 自动更新

官方来源：<https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions>

前端优先读取官方网页。如果浏览器因跨站限制无法读取，使用 `https://r.jina.ai/` 的公共文本代理读取同一个固定 IRS 页面。该代理只提供传输，规则来源仍为 IRS；页面显示此来源链。网络请求不附带工资、公司政策或供款数据。

解析器定位 401(k) 表及所选年度列，只提取普通供款、年度总供款和计薪限额；不会取用 IRA、补缴或其他年份数据。读取有超时、内容大小及完整性限制，不执行抓取页面的任何脚本。

成功在线读取后按年份缓存结果。断网时仅使用相同年度的已核验缓存，并明确标注“在线更新失败”及上次核对日期。内置已核验数据为 2025 / 2026；新年度没有已公布、可确认的数据时停止计算，绝不把旧额度当新额度。公开页面格式变化或代理不可用时也会显示失败状态。

## 计算范围

- 未满 50 岁、单一雇主、全年在职、固定基础工资，未计奖金、RSU、入离职、加薪。
- 支持目标：拿满公司配比、存满普通 401(k)、普通及 After-tax 尽量存满。
- 普通供款可任意分配给 Pre-tax 与 Roth，两者共用普通限额。
- 支持增量分档配比、逐次或年度配比、true-up 资格未知/确认/不符合。
- 计算薪酬受 IRS 薪酬上限约束，并在逐次模型中平均分配到全年发薪期。实际计划可能按不同方式处理薪酬封顶时间，需按公司计划核对。
- 普通 After-tax 在本模型中不参与 match，符合本次 Snap 政策；其他公司若配比 After-tax，此模型不适用该部分。
- 年度总供款同时受适用薪酬 100% 约束；其他公司供款另行占用总限额。
- 未确认 true-up 时，为可能的年度补差预留空间，但不把未确认补差算作保证到账。
- 逐次模式“拿满 match”按每次工资门槛规划；年度模式按受限年度薪酬计算所需总供款。
- 理论比例保留最多六位小数；循环小数显示 `≈`。工资系统实际设置使用单独的保守方案，明确显示比例取整及逐次分币舍入带来的差额，不依赖自动截停。
- 支持转换只代表计划有这个功能，不代表已经开启自动转换，更不代表已经发生转换。

## 数据与源码

填写的个人数据仅存于当前浏览器的 localStorage，不上传到 GitHub 或其他服务器；不同浏览器、设备或网站地址不会自动同步。没有分析埋点、登录或数据库。网站托管方及 IRS 内容读取服务仍会收到常规网络请求信息，如 IP 地址，但请求不包含填写的工资或公司政策。文字政策识别完全在本地进行，仅支持白名单中的常见明确句型；遇到未知、矛盾或省略条件时要求手动填写，不猜测。

- `index.html` / `styles.css` / `app.js`：页面、样式和交互。
- `annual-calculations.js`：年初计算、分档配比、舍入及额度模型。
- `irs-limits.js`：IRS 页面读取、年度定位与数据校验。
- `policy-parser.js`：本地识别公司配比句型。
- 各模块对应 `.test.cjs`：计算与解析边界测试。
- `build.cjs`：生成 Pages 用的 `dist/index.html`，或上一级目录的独立 HTML。
- `.github/workflows/test.yml`：每次 push / pull request 自动测试和构建。
- `.github/workflows/pages.yml`：`main` 分支测试通过后部署 `dist/` 到 GitHub Pages。

## 本地测试与构建

开发与 CI 使用 **Node.js 24 LTS**。没有第三方运行时或构建依赖，不需要 `npm install`，也不需要 API key。

```sh
npm test
npm run build
```

`npm run build` 只在仓库内生成 `dist/index.html`；这个单文件可以直接打开、复制分享，或上传到静态网站托管。每次构建会重建 `dist/`，不要把个人文件保存在此目录。

需要保留原先上一级目录的单文件导出方式时：

```sh
npm run build:single
# 等价于 node build.cjs，生成 ../401k-calculator.html
```

也可完全不使用 npm，直接运行：

```sh
node --test annual-calculations.test.cjs irs-limits.test.cjs policy-parser.test.cjs
node build.cjs --pages
```

可选本机服务器（也可直接打开 HTML）：

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

在仓库目录运行后访问 `http://127.0.0.1:8765`。如只需预览构建结果，可在 `dist/` 目录启动服务器。

## 部署到 GitHub Pages

此仓库已提供部署工作流；网站是否已上线，应以仓库的 Actions 运行结果和 Pages 设置为准。

1. 将本目录作为仓库根目录推送到 GitHub 的 `main` 分支。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。公开仓库可使用 GitHub Free 的 Pages；私有仓库是否可用取决于 GitHub 方案，且私有源码不代表网站仅限自己访问。
3. 在 **Actions → Deploy GitHub Pages → Run workflow** 选择 `main` 运行；之后每次向 `main` 推送会自动运行。
4. 部署成功后，从部署任务的 `github-pages` 环境或 **Settings → Pages** 打开实际网站地址。

部署会再次运行测试，只有成功后才上传 `dist/`。该目录仅包含 `index.html`；README、测试、源文件、工作流和 `.git` 不会作为网站内容发布。公开仓库的源码本身仍可被访问。

工作流仅给构建任务读取权限；部署任务单独获得 `pages: write` 和 `id-token: write`。无需配置个人访问令牌。Pages 环境的保护规则和允许部署分支可在 GitHub 仓库设置中进一步约束。

工作流依据 [GitHub 官方自定义 Pages 工作流文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)，Node 版本依据 [Node.js 官方发行状态](https://nodejs.org/en/about/previous-releases)。仓库未添加开源许可证；公开托管本身不等于授予开源许可。

已对真实浏览器的 IRS 在线读取、离线同年回退、未公布年度隔离、公司上限重新确认、薪资/目标/税务拆分、政策解析、数据保存及手机宽度进行验证。页面只提供供款测算；不执行任何工资、Fidelity、转换或交易操作。
