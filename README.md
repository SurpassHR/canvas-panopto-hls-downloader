# Canvas / Panopto HLS 视频与字幕下载器

一个无第三方运行时依赖的 Tampermonkey 用户脚本，用于捕获 Canvas 内嵌 Panopto 播放器加载的 HLS，并把分片合成为本地视频，同时下载播放器提供的字幕。

- 用户脚本：`canvas-panopto-hls-downloader.user.js`（由 TypeScript 构建生成）
- TypeScript 源码：`src/`
- 支持站点：`*.panopto.eu`、`*.panopto.com`、`*.panoptocloud.com`
- 视频输出：fMP4 → `.mp4`；MPEG-TS → `.ts`
- 字幕输出：SRT、WebVTT、纯文本 TXT

## 安装

1. 安装 Node.js 20 或更高版本。
2. 在项目目录安装依赖并构建用户脚本：

   ```bash
   npm install
   npm run build
   ```

3. 安装 Tampermonkey（或兼容的用户脚本管理器）。
4. 打开 Tampermonkey 管理面板，新建脚本。
5. 用构建后的 `canvas-panopto-hls-downloader.user.js` 全部内容替换编辑器内容并保存。
6. 首次运行时允许脚本访问 Panopto 域名。

脚本会匹配 Panopto 播放器 iframe，因此无需给 Canvas 域名单独授权。

## 使用

1. 打开 Canvas 课程页面，让视频开始播放 2–5 秒。
2. 在视频区域右下角点击紫色下载按钮。
3. 脚本会自动捕获 `master.m3u8`；选择画质后点击“下载视频”。
4. 字幕会自动从当前 Panopto 播放会话读取。选择语言和格式后点击“下载字幕”；视频与字幕分别保存。
5. 如果没有检测到字幕，先播放几秒或打开播放器的字幕/CC 菜单，再点击“重新扫描”。

如果捕获到的签名链接返回 403，刷新页面并重新播放视频，以取得新的 m3u8 地址。

## 字幕说明

- 优先读取 Panopto 当前播放会话的 `DeliveryInfo.aspx` 字幕轨道，因此权限和会话校验与播放器一致。
- 支持从主播放列表的 `EXT-X-MEDIA:TYPE=SUBTITLES` 读取 WebVTT 字幕轨，也支持页面中直接加载的 `.vtt` / `.srt` 文件。
- 可导出为 SRT（推荐）、WebVTT 或纯文本。SRT/VTT 会保留时间轴；TXT 只保留文字稿。
- 多语言课程可在字幕下拉框中选择对应语言。

## 视频特性

- Hook `fetch`、XHR、`HTMLMediaElement.src`，并扫描 Resource Timing，自动发现 m3u8。
- 解析主播放列表、码率/分辨率、`EXTINF`、`EXT-X-BYTERANGE`、`EXT-X-MAP`、`EXT-X-KEY`。
- 支持 AES-128 分片解密。
- 对连续的 byte-range fMP4 自动使用单文件 Range 下载，减少请求数量。
- 支持 File System Access API 流式写入；浏览器不允许文件选择器时自动回退为内存合成下载。
- 支持取消下载、进度显示和 3 次分片重试。

## 限制

- 不支持 DRM、Widevine、FairPlay、SAMPLE-AES 或 CENC 加密。
- 若主播放列表把音频放在独立 `AUDIO` 组中，当前版本不会自动混流，只保存所选视频轨。
- Panopto 是否提供字幕取决于课程本身和账号权限；自动生成字幕也可能被教师关闭。
- TS 输出可直接用 VLC 播放；若需要 MP4，可无损封装：

  ```bash
  ffmpeg -i lecture.ts -c copy lecture.mp4
  ```

- 请仅下载你有权访问和保存的课程资料。

## 开发

```bash
# 类型检查
npm run typecheck

# 构建 Tampermonkey 用户脚本
npm run build

# 本地集成测试：视频、Range 下载、AES-128、Panopto 字幕、SRT/VTT 转换
npm test

# 使用一个仍有效的真实 Panopto master.m3u8 验证 CORS 与真实播放列表解析
REAL_MASTER_URL='https://…/master.m3u8?…' npm run test:real
```

源码结构：

```text
src/index.ts      页面状态、UI 交互与下载流程
src/hls.ts        HLS 主/媒体播放列表解析
src/subtitles.ts  Panopto 字幕读取、WebVTT/SRT 解析与序列化
src/capture.ts    fetch/XHR/媒体元素/Resource Timing 捕获
src/ui.ts         Shadow DOM 面板
src/utils.ts      通用工具
src/types.ts      公共类型
```

脚本在真实 Panopto 页面声明的域名下执行，因此 HLS CDN 的 CORS 检查与播放器本身一致。
