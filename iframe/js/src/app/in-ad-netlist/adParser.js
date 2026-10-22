/**
 * @//module/ app/in-ad-netlist/adParser
 * @//description/ 解析 Altium Designer 导出的 .NET（括号分段、位号-引脚）为 位号|引脚 → 网络名 映射
 * @//exports/ parseADNetlist
 * @//dependencies/ 无
 * @//example/ const { parseADNetlist } = await import('./adParser.js')
 *            const { netMap, errors } = parseADNetlist(adText)
 *            // netMap.get('U1|3') === 'GND'
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/**
 * 解析 AD 网表文本
 *
 * 格式：每个网络一段 `( 网络名 \n 位号-引脚 \n ... )`。
 * 同一引脚出现多次以**最后一次**为准（与原实现一致）。
 *
 * @param {string} content AD 网表文本
 * @returns {{netMap: Map<string, string>, errors: string[]}} 映射表与错误说明
 * @sideEffects 无（纯函数）
 */
export function parseADNetlist(content) {
	const netMap = new Map();
	const errors = [];

	if (!content || typeof content !== 'string') {
		errors.push('网表内容为空');
		return { netMap: netMap, errors: errors };
	}

	const blocks = content.match(/\(([\s\S]*?)\)/g);
	if (!blocks || blocks.length === 0) {
		errors.push('未检测到有效的AD网表');
		return { netMap: netMap, errors: errors };
	}

	for (const block of blocks) parseBlock(block, netMap, errors);

	return { netMap: netMap, errors: errors };
}

/**
 * 解析单个网络段 `( 网络名 \n 位号-引脚 \n ... )`
 *
 * @param {string} block 含首尾括号的段
 * @param {Map<string, string>} netMap 就地写入的映射表
 * @param {string[]} errors 就地追加的错误说明
 * @returns {void}
 * @sideEffects 修改入参 netMap / errors
 */
function parseBlock(block, netMap, errors) {
	const lines = block
		.replace(/^\(|\)$/g, '')
		.trim()
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== '');
	if (lines.length < 2) return;

	const netName = lines[0];
	for (let i = 1; i < lines.length; i++) {
		const parts = lines[i].split('-');
		if (parts.length !== 2) {
			errors.push(`行格式异常: ${lines[i]} , 应为 位号-引脚`);
			continue;
		}
		const refDes = parts[0].trim();
		const pinNo = parts[1].trim();
		if (refDes && pinNo) netMap.set(`${refDes}|${pinNo}`, netName);
	}
}
