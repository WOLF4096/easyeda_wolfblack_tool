/**
 * @//module/ app/working-hours/backupCodec
 * @//description/ 备份文件信封：gzip 压缩 + Base64 + 用户信息 + HMAC 签名（打包与解包校验）
 * @//exports/ packBackup, unpackBackup
 * @//dependencies/ app/working-hours/backupFormat, app/working-hours/backupCrypto
 * @//example/ const envelope = await packBackup({ data, user })
 *            const backup = await unpackBackup({ envelope, currentUser: user })
 *
 * 文件长这样（JSON 明文，只是里面的数据体被压过）：
 *   { format, version, exportedAt, user, payload, signature }
 * `user` 是给人看/给 UI 快速判断的副本；真正的用户信息在 `payload` 里，随签名一起被保护。
 * 导入时两者必须一致，否则说明有人只改了信封（改信封不影响数据，但会误导提示）。
 *
 * 压缩/解压默认走页面里的 `fflate`（构建期已内联，离线可用）；
 * 测试通过 `zip` 注入 `node:zlib`，这样整条链路能脱离浏览器跑单测。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { base64ToBytes, bytesToBase64, checkSignature, createSignature } from './backupCrypto.js';
import { BACKUP_FORMAT, BACKUP_VERSION, buildBackupBody, expandBackupBody } from './backupFormat.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * 取压缩实现（默认 fflate，测试可注入）
 *
 * @param {{gzip: Function, gunzip: Function}} [zip] 注入的压缩实现
 * @returns {{gzip: Function, gunzip: Function}} 压缩实现
 * @sideEffects 无
 */
function resolveZip(zip) {
	if (zip && typeof zip.gzip === 'function' && typeof zip.gunzip === 'function') return zip;
	if (typeof fflate === 'undefined') throw new Error('压缩库未加载，无法处理备份文件');
	return {
		gzip: (bytes) => fflate.gzipSync(bytes, { level: 9 }),
		gunzip: (bytes) => fflate.gunzipSync(bytes),
	};
}

/**
 * 校验信封的必需字段（版本 / 载荷 / 签名 / 时间 / 用户）
 *
 * @param {object} envelope 信封
 * @returns {void}
 * @sideEffects 可能抛异常
 */
function assertEnvelopeFields(envelope) {
	if (envelope.version !== BACKUP_VERSION) throw new Error(`备份版本不支持（${envelope.version}）`);
	if (typeof envelope.payload !== 'string' || envelope.payload.length === 0) throw new Error('备份缺少数据载荷');
	if (typeof envelope.signature !== 'string' || envelope.signature.length === 0) throw new Error('备份缺少签名');
	if (!Number.isFinite(envelope.exportedAt)) throw new Error('备份缺少导出时间');
	if (!envelope.user || typeof envelope.user !== 'object') throw new Error('备份缺少用户信息');
}

/**
 * 校验信封形状（格式 / 版本 / 必需字段）
 *
 * @param {object} envelope 信封
 * @returns {void}
 * @sideEffects 可能抛异常
 */
function assertEnvelope(envelope) {
	if (!envelope || typeof envelope !== 'object') throw new Error('备份文件为空或不是 JSON 对象');

	if (envelope.format !== BACKUP_FORMAT) {
		// 旧版备份是「明文 timeline」，没有用户信息也没有签名 —— 无法判断归属，只能拒收
		if (envelope.timeline || envelope.stats) {
			throw new Error('这是旧版备份（不含用户信息与签名），请在原电脑升级后用新版重新导出');
		}
		throw new Error('这不是「狼黑工具」的工时备份文件');
	}
	assertEnvelopeFields(envelope);
}

/**
 * 解压并解析数据体
 *
 * @param {string} payload Base64 载荷
 * @param {{gunzip: Function}} zip 压缩实现
 * @returns {object} 数据体
 * @sideEffects 可能抛异常
 */
function decodeBody(payload, zip) {
	const bytes = base64ToBytes(payload);
	let plain;
	try {
		plain = decoder.decode(zip.gunzip(bytes));
	} catch (e) {
		throw new Error('备份数据解压失败，文件可能已损坏');
	}
	try {
		return JSON.parse(plain);
	} catch (e) {
		throw new Error('备份数据不是合法的 JSON，文件可能已损坏');
	}
}

/**
 * 信封里的用户副本必须与签名数据里的用户一致
 *
 * @param {object} envelope 信封
 * @param {object} restored `expandBackupBody` 的结果
 * @returns {void}
 * @sideEffects 可能抛异常
 */
function assertSameUser(envelope, restored) {
	const head = envelope.user;
	if (head.uuid !== restored.user.uuid || head.username !== restored.user.username) {
		throw new Error('备份文件头与数据内容不一致，文件可能被改过');
	}
	if (envelope.exportedAt !== restored.exportedAt) throw new Error('备份导出时间与数据不一致，文件可能被改过');
}

/**
 * 归属校验：只允许导入当前账号自己的备份
 *
 * @param {object} user 备份里的用户
 * @param {object} currentUser 当前登录用户
 * @returns {void}
 * @sideEffects 可能抛异常
 */
function assertOwnership(user, currentUser) {
	if (!currentUser || typeof currentUser.uuid !== 'string' || currentUser.uuid.length === 0) {
		throw new Error('未获取到当前账号信息，无法校验备份归属');
	}
	if (user.uuid !== currentUser.uuid) {
		const owner = user.nickname || user.username || '其他账号';
		throw new Error(`这是「${owner}」的备份，不能导入别人的数据`);
	}
}

/**
 * 打包备份（导出）
 *
 * @param {object} options 选项
 * @param {object} options.data 聚合数据集
 * @param {object} options.user 当前用户信息（缺 uuid 时直接失败，避免产出无法导入的文件）
 * @param {number} [options.exportedAt] 导出时间戳（测试可注入）
 * @param {{gzip: Function, gunzip: Function}} [options.zip] 压缩实现（测试可注入）
 * @returns {Promise<object>} 可 `JSON.stringify` 后下载的信封
 * @sideEffects 无（纯计算）
 */
export async function packBackup(options) {
	const opts = options || {};
	const user = opts.user || {};
	if (typeof user.uuid !== 'string' || user.uuid.length === 0) throw new Error('未获取到当前账号信息，无法生成备份');

	const exportedAt = Number.isFinite(opts.exportedAt) ? opts.exportedAt : Date.now();
	const zip = resolveZip(opts.zip);
	const body = buildBackupBody({ data: opts.data, user: user, exportedAt: exportedAt });
	const payload = bytesToBase64(zip.gzip(encoder.encode(JSON.stringify(body))));
	const signature = await createSignature({ user: body.u, exportedAt: exportedAt, payload: payload });

	return {
		format: BACKUP_FORMAT,
		version: BACKUP_VERSION,
		exportedAt: exportedAt,
		user: body.u,
		payload: payload,
		signature: signature,
	};
}

/**
 * 校验签名
 *
 * 密钥里的用户名取的是**导出时**的用户名（备份里有，且已被签名保护），uuid 必须是当前账号的。
 * 这样「当前账号改过用户名」的旧备份仍然能验过，而换了账号（uuid 变了）依旧过不了归属那一关。
 *
 * @param {object} envelope 信封
 * @param {object} currentUser 当前登录用户
 * @param {object} backupUser 备份里的用户
 * @returns {Promise<boolean>} 是否通过
 * @sideEffects 无
 */
async function checkEnvelopeSignature(envelope, currentUser, backupUser) {
	const parts = { exportedAt: envelope.exportedAt, payload: envelope.payload, signature: envelope.signature };
	if (await checkSignature({ ...parts, user: currentUser })) return true;
	return checkSignature({ ...parts, user: { username: backupUser.username, uuid: currentUser.uuid } });
}

/**
 * 解包并校验备份（导入）
 *
 * 校验顺序：信封形状 → 解压 → 数据结构 → 文件头一致 → 归属 → 签名。
 * 归属放在签名之前，是为了让「导入了别人的文件」得到一句人话，而不是笼统的「签名不对」。
 *
 * @param {object} options 选项
 * @param {object} options.envelope 已 `JSON.parse` 的文件内容
 * @param {object} options.currentUser 当前登录用户
 * @param {{gzip: Function, gunzip: Function}} [options.zip] 压缩实现（测试可注入）
 * @returns {Promise<{user: object, exportedAt: number, projectMeta: object, days: Array, stats: object}>} 还原结果
 * @sideEffects 无（纯计算）
 */
export async function unpackBackup(options) {
	const opts = options || {};
	const envelope = opts.envelope;
	assertEnvelope(envelope);

	const body = decodeBody(envelope.payload, resolveZip(opts.zip));
	const restored = expandBackupBody(body);
	assertSameUser(envelope, restored);
	assertOwnership(restored.user, opts.currentUser);

	const passed = await checkEnvelopeSignature(envelope, opts.currentUser, restored.user);
	if (!passed) throw new Error('签名校验失败：备份可能被改动过，或不是本账号导出的文件');

	return restored;
}
