# EdgeOne Pages 部署清单

## 已准备好的本地静态包

- 项目目录：`C:\Users\cyh\Downloads\腾讯十万\koc-engine-vercel`
- 静态构建目录：`C:\Users\cyh\Downloads\腾讯十万\koc-engine-vercel\dist`
- 可直接上传压缩包：`C:\Users\cyh\Downloads\腾讯十万\KOC-Engine_EdgeOne_dist.zip`

## 手动部署步骤

1. 登录腾讯云控制台。
2. 搜索并进入 `EdgeOne`。
3. 打开 `Pages` 静态托管功能。
4. 创建新项目，选择上传本地构建产物。
5. 直接上传：
   - `dist` 文件夹
   - 或 `KOC-Engine_EdgeOne_dist.zip`
6. 等待构建完成后，记录腾讯云分配的公开访问域名。
7. 关闭本地代理后，用手机 5G 实测首屏加载。

## 提交前核对

- 页面可在中国大陆普通网络直接打开
- 首屏 1-3 秒内完成渲染
- 点击按钮后能看到交互过程
- 地址栏替换为腾讯云静态域名
- 在 PDF / 提交表单中填写该腾讯云链接，而不是 `.vercel.app`

## 你还需要手动完成的事项

- 腾讯云登录
- EdgeOne Pages 上传
- 手机网络可访问性验证
- OBS 录屏
- 赛事系统最终提交
