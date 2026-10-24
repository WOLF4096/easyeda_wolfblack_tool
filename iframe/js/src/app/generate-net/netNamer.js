/**
 * @//module/ app/generate-net/netNamer
 * @//description/ 给一个连通分量定网络名：多数票优先，真实名优先于通用 NET*，再按长度与字典序
 * @//exports/ isGenericNet, voteNets, rankNetCandidates, createNetNamer
 * @//dependencies/ 无
 * @//example/ const { createNetNamer, voteNets } = await import('./netNamer.js')
 *            const namer = createNetNamer(allUsedNetNames)
 *            const name = namer.nameFor(voteNets(cluster))
 *
 * ⚠️ 定名规则不能按「名字长短」：
 *   实测 GND 覆铜被误连进 1 个 DP 焊盘时，短名会顶掉正确的多数名 → 整块覆铜被命名成 DP。
 *   所以顺序是：① 票数多 ② 真实名优先于 NET* ③ 名字短 ④ 字典序（只为结果稳定）。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 是否是自动生成的通用网络名（`NET1` / `net12`）
 *
 * @param {string} name 网络名
 * @returns {boolean} 是否通用名
 * @sideEffects 无（纯函数）
 */
export function isGenericNet(name) {
	return /^NET\d+$/i.test(String(name));
}

/**
 * 统计分量里各网络名的票数
 *
 * 空串 / `'null'` / `'undefined'` 是「没有网络」的几种历史写法，一律不计票。
 *
 * @param {Array<object>} group 连通分量图元
 * @returns {Map<string, number>} 网络名 → 票数
 * @sideEffects 无（纯函数）
 */
export function voteNets(group) {
	const votes = new Map();
	for (const p of group) {
		const net = p.net;
		if (!net || net === 'null' || net === 'undefined') continue;
		votes.set(net, (votes.get(net) || 0) + 1);
	}
	return votes;
}

/**
 * 按定名规则给候选排序
 *
 * @param {Map<string, number>} votes 网络名 → 票数
 * @returns {string[]} 排序后的候选名（第一个就是应采用的）
 * @sideEffects 无（纯函数）
 */
export function rankNetCandidates(votes) {
	const names = Array.from(votes.keys());
	names.sort((a, b) => {
		const wa = votes.get(a) || 0;
		const wb = votes.get(b) || 0;
		if (wa !== wb) return wb - wa;

		const aGen = isGenericNet(a);
		const bGen = isGenericNet(b);
		if (!aGen && bGen) return -1;
		if (aGen && !bGen) return 1;

		if (a.length !== b.length) return a.length - b.length;
		return a.localeCompare(b);
	});
	return names;
}

/**
 * 创建定名器（内部维护 `NET<n>` 计数器，避免同一批里生成重名）
 *
 * @param {Set<string>} allUsedNetNames 已占用的网络名（新生成的名字会写回这个集合）
 * @returns {{nameFor: (votes: Map<string, number>) => string}} 定名器
 * @sideEffects 调用 `nameFor` 时会**就地修改** `allUsedNetNames`
 */
export function createNetNamer(allUsedNetNames) {
	const used = allUsedNetNames || new Set();
	let counter = 1;

	/**
	 * 给一个分量的票数表定名
	 *
	 * @param {Map<string, number>} votes 票数表
	 * @returns {string} 网络名
	 * @sideEffects 生成新名字时写入 `used`
	 */
	function nameFor(votes) {
		if (votes && votes.size > 0) return rankNetCandidates(votes)[0];

		for (;;) {
			const candidate = 'NET' + counter;
			if (!used.has(candidate)) {
				used.add(candidate);
				return candidate;
			}
			counter += 1;
		}
	}

	return { nameFor: nameFor };
}
