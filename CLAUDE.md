# SmartNotes - 全离线 iPhone 备忘录 PWA

## 项目概述
为用户李翔宇（STIEE EMC检测工程师）定制的智能备忘录 App，
部署在 GitHub Pages，iPhone 添加到主屏幕后完全离线运行，不依赖 PC。

**线上地址**：https://13012884552.github.io/smartnotes/

## 技术栈
- 纯前端 PWA（HTML + CSS + JS），无后端
- IndexedDB 本地存储所有数据
- Service Worker 离线缓存
- Tesseract.js CDN（拍照 OCR 识别手写文字）
- SheetJS CDN（Excel 排班表导入解析）

## 文件结构
```
smartnotes/
├── index.html      # iOS 风格主界面（5个标签页）
├── app.js          # 核心逻辑 + 数据库操作
├── sw.js           # Service Worker（缓存版本 smartnotes-v6）
├── manifest.json   # PWA 配置
├── icon-192.png    # App 图标（金色星光）
├── server.py       # 本地开发服务器（端口8765）
├── launch.bat      # 桌面启动脚本
└── CLAUDE.md       # 本文件
```

## 功能模块

### 📒 笔记
- 文件夹层级管理（新建/删除/进入子文件夹）
- 笔记 CRUD（标题+正文+多张图片）
- 分类标签（预设：工作笔记/个人笔记/会议记录/EMC检测/项目文件）
- 笔记详情页内联编辑（类似 Apple 备忘录）
- 按分类筛选笔记

### 📷 拍照OCR
- 调用手机摄像头或相册
- Tesseract.js 识别中英文（首次需加载 chi_sim+eng 语言包）
- 识别结果一键保存到当前文件夹

### ✅ 打卡签退
- 实时时钟显示
- 上班打卡 + 下班签退
- 计算工时（小时+分钟）
- 准时/迟到标记
- 7天打卡历史记录

### ⏰ 提醒
- 添加提醒（标题+时间+每天/工作日/一次性）
- 开关控制
- 手机通知推送（需授权）

### 📥 排班导入
- 导入 Excel 排班表
- 关键词筛选（按人名/地点筛选）
- 今日排班显示在打卡页

### ⚙️ 设置
- 分类管理（增删）
- 上班时间设置
- 数据导出/清除

## 数据库结构（IndexedDB v4）
表：notes, categories, reminders, checkins, schedule, settings, folders

## GitHub 部署
- 仓库：https://github.com/13012884552/smartnotes
- Pages 分支：main
- 推送命令：`cd smartnotes && git push`

## 本地测试
```bash
cd C:\Users\57215\smartnotes
python server.py
# 打开 http://127.0.0.1:8765
```

## 用户信息
- 姓名：李翔宇
- 工作：STIEE（上海电器设备检测所）EMC 检测工程师
- 排班：三班倒（白班8:00-17:00，中班17:30-00:30，夜班）
- 电脑：Windows 11 Home China，C盘120GB SSD，D盘339GB SSD
