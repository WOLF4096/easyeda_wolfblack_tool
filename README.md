# 狼黑工具 - EasyEDA Pro 增强工具

## 🌟 简介
**狼黑工具** 是一款为 **嘉立创EDA专业版** 设计的实用插件集合，旨在提升PCB与原理图设计效率，提供便捷的图像、BOM、网络、器件、导线等批量处理功能。

---

## 📦 安装

### 方式一：从文件导入
1. 从以下地址下载插件文件：
   - [GitHub](https://github.com/WOLF4096/easyeda_wolfblack_tool)
   - [嘉立创EDA扩展广场](https://ext.lceda.cn/item/darksteel/wolfblack-tool)
2. 在EDA中选择：
   - **V2**：设置 → 扩展 → 扩展管理器 → 导入扩展
   - **V3**：高级 → 扩展管理器 → 导入
3. 选择下载的插件文件完成导入

### 方式二：从扩展广场安装（仅V3版本）
1. 打开嘉立创EDA专业版
2. 进入 **高级 → 扩展管理器**
3. 搜索 **“狼黑工具”**
4. 点击 **安装** 

---

## 🛠️ 已发布功能
| 功能 | 简介 | 适用于 | 演示视频 |
| :--- | :--- | :--- | :--- |
| 导入图片 | 将PNG/JPG/BMP无损导入PCB图层，支持尺寸与DPI调整 | PCB(半离线) | [打开](https://www.jlc-bbs.com/platform/a/1201795) |
| 导入二维码 | 生成/识别二维码，支持图片或矢量模式，可放置到PCB | PCB | [打开](https://www.jlc-bbs.com/platform/a/1201803) |
| 位号查重 | 快速检查并定位PCB中重复的器件位号 | PCB | [打开](https://www.jlc-bbs.com/platform/a/1201823) |
| 丝印代码转换 | 将R/C/L元件编码转换为实际值（如“104” → “100nF”） | PCB & SCH | [打开](https://www.jlc-bbs.com/platform/a/1201843) |
| 清空多余属性 | 自动清理供应商为空的元件属性，保持设计整洁 | PCB & SCH | [打开](https://www.jlc-bbs.com/platform/a/1201892) |
| 导入BOM | 从Excel复制BOM，批量更新器件属性 | PCB & SCH | [打开](https://www.jlc-bbs.com/platform/a/1201941) |
| 批量替换器件 | 通过C编号批量替换器件，统一物料规格，需备份网表 | PCB | [打开](https://www.jlc-bbs.com/platform/a/1201978) |
| 从网表恢复3D模型 | 使用批量替换器件会丢失3D模型，使用此方法恢复 | PCB | [打开](https://www.jlc-bbs.com/platform/a/1201995) |
| 批量修改网络 | 批量更改引脚网络名称，支持Excel规则粘贴 | PCB | [打开](https://www.jlc-bbs.com/platform/a/1202044) |
| 放置器件 | 从PCB或网表导入器件并自动放置到原理图 | SCH | [打开](https://www.jlc-bbs.com/platform/a/1202071) |
| 放置导线 | 根据PCB/网表网络差异，自动为未连接引脚放置导线 | SCH | [打开](https://www.jlc-bbs.com/platform/a/1202119) |
| 过孔焊盘互转 | 快速在焊盘和过孔之间进行转换 | PCB | [打开](https://www.jlc-bbs.com/platform/a/1202426) |
| 线条导线互转 | 快速在导线和轮廓对象之间进行转换 | PCB | [打开](https://www.jlc-bbs.com/platform/a/1204103) |

## 🚧 待发布功能
| **功能** | **简介** | **适用于** | **状态** |
| :--- | :--- | :--- | :--- |
| 批量修改封装名 | 批量修改封装名 | PCB & SCH | 测试中 |
| 导入Gerber | 导入Gerber至PCB画布 | PCB | 开发中 |
| 创建封装 | 在PCB画布将离散图元组成封装 | PCB | 开发中 |
| 生成网表 | 将没有网络的板子生成网络表 | PCB | 测试中 |
| 原理图显示飞线 | 相同网络的引脚使用飞线相连 | SCH | 开发中 |
| 导出资料 | 一键导出所有资料交付 | 全局 | 测试中 |
| 工作时间统计 | 统计每天使用时间 | 全局 | 测试中 |

---

## ℹ️ 关于

### 插件信息
- **插件名称**：狼黑工具 (WolfBlack Tool)
- **插件作者**：WOLF4096
- **开发平台**：嘉立创EDA专业版 V2.2.43（兼容V2/V3）
- **使用方法**：[使用文档 - Github](https://github.com/WOLF4096/easyeda_wolfblack_tool/blob/main/UserManual.md)
- **更新日志**：[更新日志 - Github](https://github.com/WOLF4096/easyeda_wolfblack_tool/blob/main/CHANGELOG.md)

### ⚠️ 免责声明
1. **使用前请务必备份设计文件**
2. 建议在测试环境中验证功能后再用于正式项目
3. 作者不对因使用本工具造成的任何数据丢失或设计错误负责

---

> 让设计更高效，让工具更顺手。🐺