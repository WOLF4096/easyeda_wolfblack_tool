/**
 * @//module/ core/unionFind
 * @//description/ 并查集（路径压缩），用于把相接的铜箔图元合并成连通分量
 * @//exports/ UnionFind
 * @//dependencies/ 无
 * @//example/ const { UnionFind } = await import('./core/unionFind.js')
 *            const uf = new UnionFind(); uf.union('a', 'b'); uf.find('a') === uf.find('b')
 *
 * 键是字符串 id（图元 id 可能是 `e12` 也可能带后缀），所以内部用普通对象而不是数组。
 */

/** 并查集 */
export class UnionFind {
	constructor() {
		/** @type {Record<string, string>} 节点 → 父节点 */
		this.parent = {};
	}

	/**
	 * 找根（带路径压缩）
	 *
	 * @param {string} id 节点
	 * @returns {string} 根节点
	 * @sideEffects 就地压缩路径
	 */
	find(id) {
		if (this.parent[id] === undefined) this.parent[id] = id;
		if (this.parent[id] !== id) this.parent[id] = this.find(this.parent[id]);
		return this.parent[id];
	}

	/**
	 * 合并两个节点所在集合
	 *
	 * @param {string} id1 节点一
	 * @param {string} id2 节点二
	 * @returns {void}
	 * @sideEffects 修改 `parent`
	 */
	union(id1, id2) {
		const root1 = this.find(id1);
		const root2 = this.find(id2);
		if (root1 !== root2) this.parent[root1] = root2;
	}
}
