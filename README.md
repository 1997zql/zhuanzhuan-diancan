# 转转点餐 🎯（福利点餐小工具 MVP）

> 转一转，决定吃什么，直接下单。基于 [MRD.md](MRD.md) 与 [开发计划.md](开发计划.md) 实现的可运行 MVP。

## 快速开始

```bash
node server/server.js
# 打开 http://localhost:8787 （建议用浏览器开发者工具切换到手机视口体验）
```

- 零第三方依赖，只需 Node.js ≥ 16。
- 局域网体验：手机访问 `http://<电脑IP>:8787`。

## 接入真实数据（高德 POI）

默认运行在演示数据模式；配置高德 Key 后自动切换为真实店铺数据：

```bash
# 1. 在 https://lbs.amap.com 注册并实名认证，创建应用获取 Web服务 Key
# 2. 带 Key 启动（Key 只保存在服务端，不会下发前端）
AMAP_KEY=你的Key node server/server.js
```
| 能力 | demo 模式 | amap 模式 |
|---|---|---|
| 店铺来源 | shops.json（北京三大商圈 27 店） | 高德周边搜索：营业中 + 3 公里内真实餐饮 POI |
| 评分 / 人均 | 内置 | POI 的 `biz_ext`（未返回时显示"—"，预算过滤不排除未知人均店铺） |
| 地址选择 | 预设 3 个办公地址 | 定位逆地理编码 + 关键字搜索全国地址 |
| 菜单 / 下单 | 站内模拟交易 | 转盘结果"复制店名"，跳转美团/饿了么完成下单 |
| 坐标系 | — | 浏览器 WGS-84 自动转换为 GCJ-02（避免国内 100~600 米偏差） |
| 接口缓存 | — | 按坐标网格缓存 10 分钟，避免打爆配额 |

联调与测试：无 Key 时可用本地 mock 高德服务验证完整通路：

```bash
node server/test/mock-amap.js                                          # 8790 模拟高德
AMAP_KEY=test AMAP_BASE=http://127.0.0.1:8790 node server/server.js    # 主服务指向 mock
```

商业化和供给的后续路线见 MRD §6.3：CPS 联盟（美团联盟 / 淘宝联盟-饿了么）→ 自有交易闭环。

## 功能总览

| 模块 | 功能 |
|---|---|
| 🎯 随机转盘 | Canvas 转盘，6–8 个扇区 = 加权随机抽取的"当前可下单"店铺；转动动画 + 音效；候选不足 6 家自动降级品类转盘 |
| 🍽️ 结果卡片 | 评分/人均/距离/配送费/送达时间；去下单、排除此店再转（上限 5 家）、换一批、生成分享卡片、拉黑 |
| 📍 定位地址 | H5 定位 + 预设办公地址（国贸CBD / 望京SOHO / 中关村）手动回退 |
| 🍜 附近店铺 | 3km 内可下单店铺：品类筛选、距离/评分/人均排序、即将打烊标注 |
| 🛒 下单闭环 | 店铺详情 → 菜单 → 购物车（起送价校验）→ 提交订单（模拟支付） |
| 🧾 订单跟踪 | 状态时间线自动推进：已下单 → 商家已接单 → 配送中 → 已送达 |
| ⚙️ 偏好设置 | 忌口标签、人均上限（过滤转盘候选池）、黑名单管理，localStorage 持久化 |

## 业务规则落地（对应 MRD §5）

- 转盘候选只含**当前可真实下单**店铺（营业中 + 配送范围内 + 满足起送价）
- **加权随机**：评分 ≥ 4.5 ×1.6、新店 ×1.5；同会话重转不重复（记忆最近 5 家）
- 手动排除上限 **5 家**，触顶引导换一批 / 调整偏好
- **即将打烊**：距打烊 < 30 分钟标注提示；含 24 小时营业店铺
- **所见即所得**：转盘结果与下单店铺强制一致（`from=wheel` 全程携带）
- 服务端校验起送价与菜品价格（不信任客户端价格）

## 商业化：CPS 跳转与转化漏斗（V1.2）

已内置 CPS 归因链路与全漏斗埋点（「我的」页可看实时漏斗卡片，数据持久化于 `server/data/events.jsonl`）：

```
转盘加载 → 转动 → 转出结果 → 点击下单 → 平台跳转（302 归因）→ 站内下单(demo)
```

- **跳转归因**：`GET /api/cps/go?platform=meituan&name=店名&shopId=..&source=wheel` 记录点击后 302 到目标平台。
- **漏斗接口**：`GET /api/stats`（今日/累计、平台分布、最近事件）；上报接口 `POST /api/track`（事件白名单）。
- **接真实联盟**（注册 [美团联盟](https://union.meituan.com) 或 [淘宝联盟-饿了么](https://pub.alimama.com) 后）：

```bash
CPS_SOURCE_ID=你的推广位ID \
CPS_MEITUAN_TEMPLATE='https://联盟跳转链接?sid={sid}&keyword={keyword}' \
CPS_ELEME_TEMPLATE='https://联盟跳转链接?sid={sid}&keyword={keyword}' \
AMAP_KEY=你的高德Key node server/server.js
```

## 待办：有手机时的一次性开通清单（约 10 分钟）

以下动作都依赖手机短信/扫码，PC 上无法完成；完成后各填一行配置即可：

1. **高德开放平台**（真实店铺数据）：
   - [lbs.amap.com](https://lbs.amap.com) 注册账号（手机号+短信）→ 控制台「应用管理」→「创建新应用」→ 添加 Key（服务平台选「Web服务」）→ 复制 Key；
   - 填入 `.env`：`AMAP_KEY=你的Key`，重启服务 → 转盘/店铺即刻变为身边 3 公里内真实营业餐馆。
2. **淘宝闪购联盟**（饿了么佣金）：
   - 手机浏览器或「淘宝联盟」App 打开 `union.ele.me`，登录后选「个人」→ 微信/支付宝扫码签约；
   - 后台生成饿了么推广短链，填入 `.env`：`CPS_ELEME_TEMPLATE=短链`（PID 已配置，无需重复备案）。
3. **美团联盟**（美团佣金，可选）：
   - [union.meituan.com](https://union.meituan.com) 注册 → 实名 → 申请外卖推广位 → 拿到联盟跳转链接；
   - 填入 `.env`：`CPS_MEITUAN_TEMPLATE=联盟链接`（用 `{keyword}` 占位店名、`{sid}` 占位推广位）。

模板中 `{keyword}` 替换为店名、`{sid}` 替换为推广位；模板未含 `{sid}` 时会自动追加 `&sid=` 归因参数。未配置时回退平台官方入口，链路照常跑通。

配置也可以写在项目根目录 **`.env`** 文件里（服务启动自动读取，已生效）：

```ini
# 淘宝联盟推广位（已备案审核通过）
CPS_SOURCE_ID=mm_xxx_xxx_xxx
# 高德 Key（填入即切换真实店铺数据）
# AMAP_KEY=
# 饿了么 CPS 推广短链（淘宝闪购联盟 union.ele.me 签约完成后填入）
# CPS_ELEME_TEMPLATE=https://s.click.ele.me/xxxx?pid={sid}
```

## 免费上线指南（获取用户）

产品对用户完全免费，收入来自跳转外卖平台后的佣金（等联盟链接配置后自动生效）。上线到公网最短路径（**无需服务器、无需备案、无需手机**）：

1. 注册 [GitHub](https://github.com)（用你的 QQ 邮箱即可，无需手机号）；
2. 新建仓库，把本项目代码上传（或让我代操作）；
3. 注册 [Render.com](https://render.com)（用 GitHub 账号登录）→ New → Web Service → 选仓库 → 配置：
   - Build Command：留空
   - Start Command：`node server/server.js`
   - 环境变量：`DATA_SOURCE=osm`、`CPS_SOURCE_ID=你的推广位PID`（其余按需）
4. 部署完成后得到 `https://你的应用.onrender.com`，把链接发到微信群/朋友圈即可获客——**HTTPS 上线后，手机用户的"当前定位"也能正常工作了**。

注意事项（免费档的诚实代价）：
- Render 免费实例 15 分钟无访问会休眠，首次访问冷启动约 30~60 秒（用户量起来后升付费档或迁国内云）；
- `onrender.com` 域名在国内可访问但速度一般；用户量验证后再走「域名 + ICP 备案 + 国内云」的正经路径；
- 内存中的订单/统计重启会丢（事件漏斗有 JSONL 持久化，但免费档无持久磁盘，跨重启统计可能清零）。

## 项目结构

```
├── MRD.md                    # 市场需求文档
├── 开发计划.md                # 开发计划与排期
├── server/
│   ├── server.js             # HTTP 服务 + 静态资源 + API 路由（零依赖）
│   ├── services/
│   │   ├── shopService.js    # 店铺筛选 · 距离 · 营业状态（demo/amap 双数据源）
│   │   ├── wheelService.js   # 候选池 · 加权随机 · 品类降级
│   │   ├── orderService.js   # 下单校验 · 订单状态时间线
│   │   └── cpsService.js     # CPS 跳转链接 · 联盟归因
│   ├── lib/geo.js            # Haversine 距离 · 营业时间 · WGS84→GCJ02
│   ├── lib/amap.js           # 高德 Web 服务客户端（POI/搜索/逆地理）
│   ├── lib/track.js          # 转化埋点 · 漏斗汇总（JSONL 持久化）
│   ├── test/mock-amap.js     # 本地 mock 高德（无 Key 联调）
│   └── data/shops.json       # 演示数据：3 商圈 27 店 + 菜单
└── web/                      # 原生 ES Modules 前端（无构建）
    ├── index.html / css/style.css
    └── js/
        ├── app.js            # 路由与启动
        ├── api.js / state.js / geo.js / ui.js / topbar.js / config.js
        ├── wheel.js          # Canvas 转盘（动画/落点/音效，rAF 不可用时 setTimeout 兜底）
        └── views/            # home(转盘) shops shop orders me
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/meta` | 地址预设、品类、忌口标签 |
| GET | `/api/shops?lat&lng&category&sort&openOnly&maxPrice` | 附近店铺（含实时距离/营业状态） |
| GET | `/api/shops/:id` | 店铺详情 + 菜单 |
| POST | `/api/wheel` | 转盘候选（加权随机 / 排除 / 偏好 / 品类降级） |
| POST | `/api/orders` | 创建订单（校验起送价，价格以服务端菜单为准） |
| GET | `/api/orders` | 订单列表（含状态时间线） |

## 已知边界与后续迭代

- 订单存内存，服务重启即清空；支付、外卖平台跳转 / CPS 分佣为模拟或未接入。
- 店铺为演示数据；接真实数据只需替换 `shopService` 的数据源。
- 转盘音效依赖浏览器手势后初始化 WebAudio，失败时静默降级。
- 后续路线见 MRD §3.3：一期跳转合作平台深链 + CPS，二期自有交易闭环、团队拼单转盘、企业福利（B 端）。
