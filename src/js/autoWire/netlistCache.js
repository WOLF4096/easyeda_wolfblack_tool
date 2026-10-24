/**
 * 网表缓存读写（用户配置存储）
 *
 * 「创建导线 → 来自网表」不再每次弹文件框，而是读这里存的网表；
 * 「从 PCB 更新网表缓存」「从文件更新网表缓存」两个入口负责写。
 * **PCB 来源与文件来源共用同一个键，只保留最新的一份**（后写的覆盖前一份），
 * 来源、时间、文件名记在旁的元信息键里，用来提示用户「这份缓存是哪来的、什么时候的」。
 *
 * --- 模块边界 ---
 * 本模块是「存储层」：只做字符串进出 + 元信息编解码，
 * 不解析网表内容（那是 netlistParser.js）、不弹提示（那是 netlistSync.js）。
 * 除 `eda.sys_Storage` 外不做任何 EDA 调用。
 *
 * 约定：
 *   - 缓存正文**原样存储**（不包一层 JSON），避免大文本被二次转义；
 *   - 元信息读写失败不影响正文，`loadNetlistCache()` 允许 `meta` 为 null；
 *   - 删除接口在老版本可能不存在，失败时回退成写空串，保证「清空」一定能生效。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/** 网表正文的配置键（两个来源共用，只存一份） */
const CACHE_KEY = 'AUTOWIRE_NETLIST_CACHE';

/** 元信息（来源 / 时间 / 文件名 / 摘要）的配置键 */
const META_KEY = 'AUTOWIRE_NETLIST_CACHE_META';

/**
 * 元信息的默认结构
 *
 * @returns {{source: string, sourceLabel: string, fileName: string, savedAt: number, bytes: number, summary: object|null}}
 *          空元信息
 */
function emptyMeta() {
    return { source: '', sourceLabel: '', fileName: '', savedAt: 0, bytes: 0, summary: null };
}

/**
 * 写入网表缓存（覆盖此前任何来源的缓存）
 *
 * @param {string} text - 网表正文（.enet 的原文本）
 * @param {{source?: string, sourceLabel?: string, fileName?: string, summary?: object|null}} [info]
 *        来源标识（`PCB` / `FILE`）、界面显示名、文件名与统计摘要
 * @returns {Promise<{ok: boolean, meta: object}>} 是否写入成功与最终元信息
 * @sideEffects 写 `eda.sys_Storage`
 */
export async function saveNetlistCache(text, info = {}) {
    const meta = {
        ...emptyMeta(),
        source: info.source || '',
        sourceLabel: info.sourceLabel || '',
        fileName: info.fileName || '',
        summary: info.summary || null,
        savedAt: Date.now(),
        bytes: text.length,
    };
    const ok = await eda.sys_Storage.setExtensionUserConfig(CACHE_KEY, text);
    // 元信息只是辅助提示，写失败不影响缓存可用性
    try {
        await eda.sys_Storage.setExtensionUserConfig(META_KEY, JSON.stringify(meta));
    } catch (error) {
        console.warn('网表缓存元信息写入失败（正文已保存）', error);
    }
    return { ok: ok !== false, meta };
}

/**
 * 读取元信息
 *
 * @returns {Promise<object|null>} 元信息；缺失或损坏时返回 null
 * @sideEffects 读 `eda.sys_Storage`
 */
async function loadMeta() {
    try {
        const raw = await eda.sys_Storage.getExtensionUserConfig(META_KEY);
        if (!raw) return null;
        return { ...emptyMeta(), ...JSON.parse(raw) };
    } catch (error) {
        console.warn('网表缓存元信息解析失败', error);
        return null;
    }
}

/**
 * 读取网表缓存
 *
 * @returns {Promise<{text: string, meta: object|null}|null>} 正文与元信息；没有缓存时返回 null
 * @sideEffects 读 `eda.sys_Storage`
 */
export async function loadNetlistCache() {
    try {
        const text = await eda.sys_Storage.getExtensionUserConfig(CACHE_KEY);
        if (!text || typeof text !== 'string') return null;
        return { text, meta: await loadMeta() };
    } catch (error) {
        console.warn('读取网表缓存失败', error);
        return null;
    }
}

/**
 * 清空网表缓存（正文与元信息一起删）
 *
 * `deleteExtensionUserConfig` 不是所有版本都有，异常时退化成写空串 ——
 * 效果一致（读回来是空值即视为没有缓存）。
 *
 * @returns {Promise<void>}
 * @sideEffects 写 / 删 `eda.sys_Storage`
 */
export async function clearNetlistCache() {
    for (const key of [CACHE_KEY, META_KEY]) {
        try {
            await eda.sys_Storage.deleteExtensionUserConfig(key);
        } catch (error) {
            await eda.sys_Storage.setExtensionUserConfig(key, '');
        }
    }
}

export { CACHE_KEY, META_KEY, describeCacheMeta };

/**
 * 两位补零
 *
 * @param {number} value - 数值
 * @returns {string} 补零后的字符串
 */
function pad2(value) {
    return String(value).padStart(2, '0');
}

/**
 * 把时间戳格式化成 `2026-10-24 15:30`
 *
 * @param {number} timestamp - 毫秒时间戳
 * @returns {string} 展示用时间
 */
function formatSavedAt(timestamp) {
    const date = new Date(timestamp);
    const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    return `${day} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * 生成缓存来源的一句话描述（给提示 / 日志用）
 *
 * @param {object|null} meta - `loadNetlistCache()` 返回的元信息
 * @returns {string} 形如 `来自 PCB · 2026-10-24 15:30`；元信息缺失时返回 `来源未知`
 */
function describeCacheMeta(meta) {
    if (!meta) return '来源未知';
    const label = meta.sourceLabel || { PCB: 'PCB', FILE: '文件' }[meta.source] || '未知来源';
    const fileName = meta.fileName ? ` ${meta.fileName}` : '';
    const savedAt = meta.savedAt ? formatSavedAt(meta.savedAt) : '';
    return savedAt ? `来自 ${label}${fileName} · ${savedAt}` : `来自 ${label}${fileName}`;
}
