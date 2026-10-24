/**
 * @//module/ app/modify-net/index
 * @//description/ 页面编排：加载网表 → 位号实时查引脚 → 粘贴 TSV 批量替换网络名并写回
 * @//exports/ 无
 * @//dependencies/ core/eda, core/netlist, core/version, ui/statusBar, app/modify-net/replacePlan
 * @//example/ 页面入口，由 iframe/ModifyNet.html 加载打包产物 app/ModifyNet.js
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { hasEda } from '../../core/eda.js';
import { findComponentByDesignator, getComponentsContainer, getNetlist, setNetlist } from '../../core/netlist.js';
import { getVersionFamily } from '../../core/version.js';
import { createStatusBar } from '../../ui/statusBar.js';
import { applyRenames, buildReplaceMap, listPinsOf, parseRules } from './replacePlan.js';

/* ---------- 状态 ---------- */
let cachedNetlistData = null;

/* ---------- DOM ---------- */
const resultOutput = document.getElementById('resultOutput');
const executeBtn = document.getElementById('executeBtn');
const csvInput = document.getElementById('csvInput');
const designatorInput = document.getElementById('designatorInput');
const verLabel = document.getElementById('verLabel');
// 「转大写」复选框：部分 EDA 版本对小写网络名支持不友好，默认勾选
const toUpperCheckbox = document.getElementById('toUpper');
const bar = createStatusBar({ textEl: document.getElementById('status'), baseClass: 'status' });

/**
 * 初始化：取版本族、预取网表
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（读网表）、DOM
 */
async function initNetlistData() {
	try {
		bar.text('', '');
		if (!hasEda()) {
			bar.text('⚠️ 未检测到EDA环境，请在嘉立创EDA中运行。', 'error');
			return;
		}

		try {
			verLabel.textContent = (getVersionFamily() || 'V2.2.45') + '模式';
		} catch (e) {
			verLabel.textContent = 'Error';
		}

		const { json } = await getNetlist('PCB');
		cachedNetlistData = json;
		bar.text('✅ 网表已加载，可直接输入位号查询或粘贴数据替换。', 'info');
	} catch (error) {
		console.error('初始化网表失败:', error);
		bar.text('❌ 初始化失败: ' + error.message, 'error');
	}
}

/**
 * 位号实时查询：把该器件的引脚-网络列到输出框
 *
 * @returns {void}
 * @sideEffects DOM
 */
function queryDesignator() {
	const query = designatorInput.value.trim().toUpperCase();
	if (!query) {
		resultOutput.value = '';
		return;
	}
	if (!cachedNetlistData) {
		resultOutput.value = '错误：网表数据未加载，请重新打开插件。';
		return;
	}

	const hit = findComponentByDesignator(getComponentsContainer(cachedNetlistData), query);
	if (!hit) {
		resultOutput.value = `未找到位号为 "${query}" 的器件。`;
		return;
	}
	resultOutput.value = listPinsOf(hit.comp)
		.map((item) => `${item.pin}\t${item.net}`)
		.join('\n');
}

/**
 * 执行批量替换
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（读/写网表）、DOM
 */
async function executeReplace() {
	executeBtn.disabled = true;
	executeBtn.textContent = '处理中...';
	resultOutput.value = '';
	bar.text('', '');

	try {
		const content = csvInput.value.trim();
		if (!content) throw new Error('请从 Excel 复制粘贴替换规则');

		const { json } = await getNetlist('PCB');
		cachedNetlistData = json;

		const rules = parseRules(content);
		if (rules.length === 0) throw new Error('未找到有效的替换规则 (请确保使用Tab分隔)');
		resultOutput.value += `找到 ${rules.length} 条替换规则\n\n`;

		const shouldUpperCase = toUpperCheckbox ? toUpperCheckbox.checked : true;
		const replaceMap = buildReplaceMap(rules, shouldUpperCase);
		const { count, lines } = applyRenames(getComponentsContainer(json), replaceMap);

		resultOutput.value += lines.join('\n') + `\n\n完成 ${count} 次替换`;

		await setNetlist('PCB', JSON.stringify(json, null, 2));
		cachedNetlistData = json;
		bar.text(`✅ 成功替换 ${count} 处`, 'success');
	} catch (error) {
		console.error('Error:', error);
		bar.text(`❌ 出错: ${error.message}`, 'error');
		resultOutput.value += `\n错误: ${error.message}`;
	} finally {
		executeBtn.disabled = false;
		executeBtn.textContent = '执行替换';
	}
}

designatorInput.addEventListener('input', queryDesignator);
executeBtn.addEventListener('click', executeReplace);

// 稍等一下再拉网表：页面刚打开时宿主文档可能还没就绪
setTimeout(initNetlistData, 500);
