/**
 * @//module/ sch/emitter
 * @//description/ 生成一根导线的原理图源码行（WIRE + LINE + NET 属性），V2 与 V3/V4 两种格式
 * @//exports/ createSchWireLines
 * @//dependencies/ 无
 * @//example/ const { createSchWireLines } = await import('./sch/emitter.js')
 *            const rows = createSchWireLines({ net: 'NET1', startX: 0, startY: 0, endX: 100, endY: 0,
 *              isModern: true, nextRow: () => ({ id: ++n, ticket: ++t }) })
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/**
 * 生成一根导线的源码行
 *
 * 与后端 `src/js/common/sourceEmitter.js` 的同名函数**逐字节一致**：前端页面打包成 IIFE、
 * 后端是 ESM，两套 bundle 无法共享代码，所以各留一份镜像，`test/sourceEmitter.test.mjs`
 * 会逐字节比对。**改动必须两边同步**，否则会出现「某个版本写进去打不开」。
 *
 * id / ticket 由调用方通过 `nextRow()` 提供，因为两个调用方的编号策略不同。
 *
 * @param {object} o 参数对象
 * @param {string} o.net 网络名
 * @param {number} o.startX 起点 X（mil）
 * @param {number} o.startY 起点 Y（mil）
 * @param {number} o.endX 终点 X（mil）
 * @param {number} o.endY 终点 Y（mil）
 * @param {boolean} o.isModern 是否 V3/V4（日志式格式，每行带行尾 `|`）
 * @param {() => {id: number, ticket: number}} o.nextRow 取下一个 id/ticket
 * @param {number} [o.rotation=0] 网络名文本旋转角（角度制）
 * @param {string} [o.wireStyle='st1'] V2 的导线样式
 * @param {string} [o.attrStyle='st1'] V2 的属性样式
 * @returns {string[]} 源码行（V3/V4 每行已带行尾 `|`）
 * @sideEffects 调用 `nextRow()`（会推进调用方的计数器）
 */
export function createSchWireLines(o) {
	const net = o.net;
	const startX = o.startX;
	const startY = o.startY;
	const endX = o.endX;
	const endY = o.endY;
	const isModern = !!o.isModern;
	const rotation = Number.isFinite(o.rotation) ? o.rotation : 0;
	const wireStyle = o.wireStyle || 'st1';
	const attrStyle = o.attrStyle || 'st1';
	const centerX = (startX + endX) / 2;
	const centerY = (startY + endY) / 2;

	if (isModern) {
		const wire = o.nextRow();
		const line = o.nextRow();
		const attr = o.nextRow();
		const wireId = `e${wire.id}`;
		return [
			`{"type":"WIRE","ticket":${wire.ticket},"id":"${wireId}"}||{"zIndex":1}|`,
			`{"type":"LINE","ticket":${line.ticket},"id":"e${line.id}"}||{"lineGroup":"${wireId}","startX":${startX},"startY":${startY},"endX":${endX},"endY":${endY}}|`,
			`{"type":"ATTR","ticket":${attr.ticket},"id":"e${attr.id}"}||{"parentId":"${wireId}","key":"NET","value":"${net}","x":${centerX},"y":${centerY},"rotation":${rotation},"keyVisible":false,"valueVisible":true}|`,
		];
	}

	const wire = o.nextRow();
	const attr = o.nextRow();
	const wireId = `e${wire.id}`;
	return [
		`["WIRE","${wireId}",[[${startX},${startY},${endX},${endY}]],"${wireStyle}",0]`,
		`["ATTR","e${attr.id}","${wireId}","NET","${net}",0,1,${centerX},${centerY},${rotation},"${attrStyle}",0]`,
	];
}
