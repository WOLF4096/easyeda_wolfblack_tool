/**
 * @//module/ app/working-hours/backupFormat
 * @//description/ 全量备份的紧凑结构：工程 uuid 只存一份、时间戳换成「日期 + 槽位下标」，去掉全部派生字段
 * @//exports/ BACKUP_FORMAT, BACKUP_VERSION, SLOT_MAX_SECONDS, normalizeUser, buildBackupBody, expandBackupBody
 * @//dependencies/ 无
 * @//example/ const body = buildBackupBody({ data, user, exportedAt: Date.now() })
 *            const restored = expandBackupBody(body) // { user, exportedAt, projectMeta, days, stats }
 *
 * 为什么不再直接导出 `timeline`：
 *   1. 时间轴是「每天 96 格 × 每个工程一行」，32 位 uuid 在里面重复上千次；
 *   2. 每格都写一个毫秒时间戳，而这些时间戳完全由「日期 + 格序」决定；
 *   3. `stats`（每工程总工时 / 起止时间）只是 timeline 的汇总，导入时能重算。
 * 这里三件事都砍掉：`p` 是 uuid 字典（只出现一次），`d` 是「日期 → [槽位下标, 记录]」，
 * 槽位里只存工程下标；`stats` 一律不写。空槽不导出。
 *
 * 可逆性由 `expandBackupBody` 保证 —— 它是 `buildBackupBody` 的逆函数，
 * 还原出的 `{ meta, slots }` 写回 `STATS_*` 后，聚合结果与导出前逐格一致。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/** 备份格式标识（出现在信封与数据体里，防止别的 JSON 被误导入） */
export const BACKUP_FORMAT = 'wolfblack-working-hours';

/** 备份格式版本（结构一改就要 +1，旧文件会被明确拒绝而不是解析出一半） */
export const BACKUP_VERSION = 2;

/** 单个 15 分钟槽位的秒数上限（与记录端 `MAX_SLICE` 一致） */
export const SLOT_MAX_SECONDS = 15 * 60;

/** 每天 96 格 */
const SLOTS_PER_DAY = 96;

/** 单格毫秒数 */
const SLOT_MS = SLOT_MAX_SECONDS * 1000;

/** 日期键形如 `2026_10_23` */
const DATE_KEY_PATTERN = /^\d{4}_\d{2}_\d{2}$/;

/**
 * 抛出一个带中文说明的错误（这些问题都会被原样提示给用户）
 *
 * @param {string} message 说明
 * @returns {never} 不返回
 * @sideEffects 抛异常
 */
function fail(message) {
	throw new Error(message);
}

/**
 * 宽松取字符串
 *
 * @param {*} value 任意值
 * @returns {string} 字符串或空串
 * @sideEffects 无（纯函数）
 */
function text(value) {
	return typeof value === 'string' ? value : '';
}

/**
 * 宽松取有限数字
 *
 * @param {*} value 任意值
 * @returns {number} 有限数字或 0
 * @sideEffects 无（纯函数）
 */
function toNumber(value) {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * 把秒数夹到 `[0, 900]` 并取整
 *
 * @param {number} value 秒数
 * @returns {number} 合法秒数
 * @sideEffects 无（纯函数）
 */
function clampSeconds(value) {
	return Math.max(0, Math.min(SLOT_MAX_SECONDS, Math.round(toNumber(value))));
}

/**
 * 归一用户信息（导出与校验两侧共用同一份字段）
 *
 * @param {object|null} user `eda.sys_Environment.getUserInfo()` 的返回值
 * @returns {{username: string, nickname: string, uuid: string, customerCode: string, avatar: string}} 用户信息
 * @sideEffects 无（纯函数）
 */
export function normalizeUser(user) {
	const src = user || {};
	return {
		username: text(src.username),
		nickname: text(src.nickname),
		uuid: text(src.uuid),
		customerCode: text(src.customerCode),
		avatar: text(src.avatar),
	};
}

/**
 * 时间戳 → `2026_10_23`（与记录端 `STATS_` 键同构，本地时区）
 *
 * @param {number} ts 时间戳
 * @returns {string} 日期键
 * @sideEffects 无（纯函数）
 */
function dateKeyOf(ts) {
	const d = new Date(ts);
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${d.getFullYear()}_${month}_${day}`;
}

/**
 * 时间戳 → 当天 0 点
 *
 * @param {number} ts 时间戳
 * @returns {number} 当天 0 点时间戳
 * @sideEffects 无（纯函数）
 */
function dayStartOf(ts) {
	const d = new Date(ts);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * 时间戳 → 0~95 的槽位下标
 *
 * @param {number} ts 时间戳
 * @returns {number} 槽位下标
 * @sideEffects 无（纯函数）
 */
function slotIndexOf(ts) {
	return Math.round((ts - dayStartOf(ts)) / SLOT_MS);
}

/**
 * 取一格里的有效记录（空记录不导出）
 *
 * @param {object} cell 时间轴一格 `{ ts, work, rest }`
 * @param {(uuid: string) => number} indexOf 取工程下标
 * @returns {Array<[number, number, number]>} `[工程下标, 工作秒, 空闲秒]`
 * @sideEffects 无（纯函数，但会通过 indexOf 登记字典）
 */
function cellEntries(cell, indexOf) {
	if (!cell || typeof cell !== 'object') return [];
	const work = cell.work || {};
	const rest = cell.rest || {};
	const uuids = new Set([...Object.keys(work), ...Object.keys(rest)]);

	const out = [];
	for (const uuid of uuids) {
		// 与还原侧用同一条夹取规则，保证「导出 → 导入」逐格一致（总时长不超过一格）
		const w = clampSeconds(work[uuid]);
		const r = clampSeconds(rest[uuid]);
		const pair = clampPair(w, r);
		if (pair.work === 0 && pair.rest === 0) continue;
		out.push([indexOf(uuid), pair.work, pair.rest]);
	}
	return out;
}

/**
 * 组装紧凑备份数据体（纯结构，不含压缩与签名）
 *
 * @param {object} options 选项
 * @param {object} options.data 聚合数据集（读 timeline / projectMeta / projectStats）
 * @param {object} options.user 当前用户信息
 * @param {number} options.exportedAt 导出时间戳（毫秒）
 * @returns {{f: string, v: number, u: object, t: number, p: Array, d: Array}} 备份数据体
 * @sideEffects 无（纯函数）
 */
export function buildBackupBody(options) {
	const opts = options || {};
	const data = opts.data || {};
	const projectMeta = data.projectMeta || {};
	const projectStats = data.projectStats || {};
	const projectIndex = new Map();
	const projects = [];

	/**
	 * 取工程在字典里的下标（首次出现时登记，名字取聚合层的结果）
	 *
	 * @param {string} uuid 工程 id
	 * @returns {number} 下标
	 * @sideEffects 改写 projects / projectIndex
	 */
	function indexOf(uuid) {
		const hit = projectIndex.get(uuid);
		if (hit !== undefined) return hit;
		const name = text(projectMeta[uuid]) || text((projectStats[uuid] || {}).name);
		projectIndex.set(uuid, projects.length);
		projects.push([uuid, name]);
		return projects.length - 1;
	}

	// 先把「有名字但没数据」的工程也登记进去，保证工程列表不丢
	for (const uuid of Object.keys(projectMeta)) indexOf(uuid);

	const days = new Map();
	for (const cell of data.timeline || []) {
		const entries = cellEntries(cell, indexOf);
		if (entries.length === 0) continue;
		const key = dateKeyOf(cell.ts);
		if (!days.has(key)) days.set(key, []);
		days.get(key).push([slotIndexOf(cell.ts), entries]);
	}

	return {
		f: BACKUP_FORMAT,
		v: BACKUP_VERSION,
		u: normalizeUser(opts.user),
		t: toNumber(opts.exportedAt),
		p: projects,
		d: Array.from(days.entries()),
	};
}

/**
 * 校验数据体头部（形状不对就直接说明原因，不返回半个结果）
 *
 * @param {object} body 备份数据体
 * @returns {void}
 * @sideEffects 可能抛异常
 */
function assertBodyHeader(body) {
	if (!body || typeof body !== 'object') fail('备份内容为空或不是对象');
	if (body.f !== BACKUP_FORMAT) fail('这不是「狼黑工具」的工时备份文件');
	if (body.v !== BACKUP_VERSION) fail(`备份格式版本不支持（${body.v}）`);
	if (!body.u || typeof body.u !== 'object') fail('备份缺少用户信息，无法校验归属');
	if (!Array.isArray(body.p)) fail('备份缺少工程字典');
	if (!Array.isArray(body.d)) fail('备份缺少工时数据');
	if (!Number.isFinite(body.t)) fail('备份缺少导出时间');
}

/**
 * 校验并归一「[工作秒, 空闲秒]」
 *
 * @param {number} work 工作秒
 * @param {number} rest 空闲秒
 * @returns {{work: number, rest: number}} 合法值
 * @sideEffects 可能抛异常
 */
function clampPair(work, rest) {
	if (!Number.isFinite(work) || !Number.isFinite(rest)) fail('备份里有非数字的时长');
	if (work < 0 || rest < 0) fail('备份里有负数时长');
	const w = clampSeconds(work);
	const r = Math.max(0, Math.min(SLOT_MAX_SECONDS - w, Math.round(rest)));
	return { work: w, rest: r };
}

/**
 * 把一条记录并进当天某一格（同日同槽同工程重复出现时取最大值，天然去重）
 *
 * @param {Array} triple `[工程下标, 工作秒, 空闲秒]`
 * @param {object} day 当天 `{ dateKey, meta, slots }`
 * @param {string} slotKey 槽位键
 * @param {Array} projects 工程字典
 * @param {object} projectMeta 工程名表
 * @returns {void}
 * @sideEffects 改写 day
 */
function mergeTriple(triple, day, slotKey, projects, projectMeta) {
	if (!Array.isArray(triple) || triple.length < 3) fail('备份的工时记录格式不正确');
	const pIdx = triple[0];
	if (!Number.isInteger(pIdx) || pIdx < 0 || pIdx >= projects.length) fail(`备份引用了不存在的工程下标：${pIdx}`);

	const uuid = projects[pIdx][0];
	const pair = clampPair(triple[1], triple[2]);
	const cell = day.slots[slotKey];
	const current = cell[uuid] || [0, 0];
	cell[uuid] = [Math.max(current[0], pair.work), Math.max(current[1], pair.rest)];
	day.meta[uuid] = projectMeta[uuid] || '';
}

/**
 * 校验「[日期键, 槽位数组]」的外层形状
 *
 * @param {Array} entry 日期条目
 * @returns {string} 日期键
 * @sideEffects 可能抛异常
 */
function assertDayEntry(entry) {
	if (!Array.isArray(entry) || typeof entry[0] !== 'string') fail('备份的日期条目格式不正确');
	if (!DATE_KEY_PATTERN.test(entry[0])) fail(`备份里的日期不合法：${entry[0]}`);
	if (!Array.isArray(entry[1])) fail(`备份里 ${entry[0]} 的槽位不是数组`);
	return entry[0];
}

/**
 * 还原一天里的一个槽位
 *
 * @param {Array} slotEntry `[槽位下标, 记录数组]`
 * @param {object} day 当天配置（就地写入）
 * @param {Array} projects 工程字典
 * @param {object} projectMeta 工程名表
 * @returns {void}
 * @sideEffects 改写 day；可能抛异常
 */
function expandSlot(slotEntry, day, projects, projectMeta) {
	if (!Array.isArray(slotEntry) || !Array.isArray(slotEntry[1])) fail('备份的槽位条目格式不正确');
	const slotIdx = slotEntry[0];
	if (!Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx >= SLOTS_PER_DAY) fail(`备份里的槽位下标越界：${slotIdx}`);

	const slotKey = String(slotIdx);
	if (!day.slots[slotKey]) day.slots[slotKey] = {};
	for (const triple of slotEntry[1]) mergeTriple(triple, day, slotKey, projects, projectMeta);
}

/**
 * 还原一天
 *
 * @param {Array} entry `[日期键, 槽位数组]`
 * @param {Array} projects 工程字典
 * @param {object} projectMeta 工程名表
 * @returns {{dateKey: string, meta: object, slots: object}} 单日配置
 * @sideEffects 可能抛异常
 */
function expandDay(entry, projects, projectMeta) {
	const dateKey = assertDayEntry(entry);
	const day = { dateKey: dateKey, meta: {}, slots: {} };
	for (const slotEntry of entry[1]) expandSlot(slotEntry, day, projects, projectMeta);
	return day;
}

/**
 * 汇总还原结果的规模（用于导入预览，不写进备份文件）
 *
 * @param {Array<{slots: object}>} days 单日配置
 * @returns {{days: number, projects: number, slots: number, workSeconds: number}} 规模
 * @sideEffects 无（纯函数）
 */
function summarize(days) {
	const uuids = new Set();
	let slots = 0;
	let workSeconds = 0;

	for (const day of days) {
		for (const cell of Object.values(day.slots)) {
			for (const uuid of Object.keys(cell)) {
				uuids.add(uuid);
				slots += 1;
				workSeconds += cell[uuid][0];
			}
		}
	}
	return { days: days.length, projects: uuids.size, slots: slots, workSeconds: workSeconds };
}

/**
 * 还原紧凑备份数据体（`buildBackupBody` 的逆函数）
 *
 * @param {object} body 备份数据体
 * @returns {{user: object, exportedAt: number, projectMeta: object, days: Array, stats: object}} 还原结果
 * @sideEffects 可能抛异常（错误信息可直接提示给用户）
 */
export function expandBackupBody(body) {
	assertBodyHeader(body);

	const projects = body.p;
	const projectMeta = {};
	for (const item of projects) {
		if (!Array.isArray(item) || typeof item[0] !== 'string') fail('备份的工程字典格式不正确');
		projectMeta[item[0]] = text(item[1]);
	}

	const days = body.d.map((entry) => expandDay(entry, projects, projectMeta));

	return {
		user: normalizeUser(body.u),
		exportedAt: body.t,
		projectMeta: projectMeta,
		days: days,
		stats: summarize(days),
	};
}
