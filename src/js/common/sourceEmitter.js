/**
 * 原理图源码发射器（纯函数）
 *
 * 背景：`PcbToSch`（PCB转原理图）与 `autoWire`（从 PCB/网表创建导线）各自写了一份
 * 「一根导线 = WIRE + LINE + NET 属性」的源码拼装。两边的字段名、ticket 规则、行尾 `|`
 * 一旦漂移，就会出现「某个版本写进去打不开」这种最难查的问题。这里收敛成唯一实现。
 *
 * --- 模块边界 ---
 * 只做字符串拼装，不碰 `eda`、不读源码、不分配 id —— id/ticket 由调用方通过 `nextRow()`
 * 提供，因为两个调用方的编号策略不同：
 *   - `PcbToSch`：id 与 ticket 共用一个自增计数器；
 *   - `autoWire`：id 用 `maxId+1` 起、ticket 用 `maxTicket+1` 起，两个独立计数器。
 *
 * 格式（V2 数组 / V3-V4 日志）来自 测试样本/ 的真实工程文件，改动前请先跑 `npm run test:samples`。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */

/**
 * 生成一根导线的源码行
 *
 * 输出（V2）：
 *   ["WIRE","e12",[[x1,y1,x2,y2]],"st1",0]
 *   ["ATTR","e13","e12","NET","GND",0,1,cx,cy,rot,"st2",0]
 *
 * 输出（V3 / V4，同构）：
 *   {"type":"WIRE","ticket":12,"id":"e12"}||{"zIndex":1}|
 *   {"type":"LINE","ticket":13,"id":"e13"}||{"lineGroup":"e12","startX":…,"startY":…,"endX":…,"endY":…}|
 *   {"type":"ATTR","ticket":14,"id":"e14"}||{"parentId":"e12","key":"NET","value":"…","x":…,"y":…,"rotation":rot,"keyVisible":false,"valueVisible":true}|
 *
 * @param {object} o - 参数
 * @param {string} o.net - 网络名
 * @param {number} o.startX - 起点 X
 * @param {number} o.startY - 起点 Y
 * @param {number} o.endX - 终点 X
 * @param {number} o.endY - 终点 Y
 * @param {boolean} o.isModern - true = V3/V4 日志格式；false = V2 数组格式
 * @param {() => {id: number, ticket: number}} o.nextRow - 分配一行所需的 id / ticket（V2 只用 id）
 * @param {number} [o.rotation=0] - 网络名文字的旋转角（0 或 90）
 * @param {string} [o.wireStyle='st1'] - V2 里 WIRE 的样式名
 * @param {string} [o.attrStyle='st1'] - V2 里 ATTR 的样式名
 * @returns {string[]} 源码行（V3/V4 每行已带行尾 `|`）
 */
export function createSchWireLines(o) {
	const { net, startX, startY, endX, endY, isModern, nextRow } = o;
	const rotation = Number.isFinite(o.rotation) ? o.rotation : 0;
	const wireStyle = o.wireStyle || 'st1';
	const attrStyle = o.attrStyle || 'st1';

	// 网络名居中放在导线上
	const centerX = (startX + endX) / 2;
	const centerY = (startY + endY) / 2;

	if (isModern) {
		const wire = nextRow();
		const line = nextRow();
		const attr = nextRow();
		const wireId = `e${wire.id}`;
		return [
			`{"type":"WIRE","ticket":${wire.ticket},"id":"${wireId}"}||{"zIndex":1}|`,
			`{"type":"LINE","ticket":${line.ticket},"id":"e${line.id}"}||{"lineGroup":"${wireId}","startX":${startX},"startY":${startY},"endX":${endX},"endY":${endY}}|`,
			`{"type":"ATTR","ticket":${attr.ticket},"id":"e${attr.id}"}||{"parentId":"${wireId}","key":"NET","value":"${net}","x":${centerX},"y":${centerY},"rotation":${rotation},"keyVisible":false,"valueVisible":true}|`,
		];
	}

	const wire = nextRow();
	const attr = nextRow();
	const wireId = `e${wire.id}`;
	return [
		`["WIRE","${wireId}",[[${startX},${startY},${endX},${endY}]],"${wireStyle}",0]`,
		`["ATTR","e${attr.id}","${wireId}","NET","${net}",0,1,${centerX},${centerY},${rotation},"${attrStyle}",0]`,
	];
}
