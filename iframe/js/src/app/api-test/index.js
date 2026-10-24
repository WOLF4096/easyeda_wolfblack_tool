/**
 * @//module/ app/api-test/index
 * @//description/ 页面编排：校准API误差卡片渲染、创建/获取 5 类图元、自动校准、参数持久化
 * @//exports/ 无
 * @//dependencies/ core/eda, core/version, ui/toast, app/api-test/{projects,calibration,sourceProbe}
 * @//example/ 页面入口，由 iframe/APITest.html 加载打包产物 app/APITest.js
 *
 * HTML 里用内联 onclick 调 4 个函数（toggle / executeBatch / autoCalibrateAll / saveParams），
 * 打包成 IIFE 后必须显式挂到 `window`，否则点击直接 ReferenceError。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展
 */
import { getEda } from '../../core/eda.js';
import { getEditorVersion } from '../../core/version.js';
import { toast } from '../../ui/toast.js';
import { MULTIPLIER_MAX, MULTIPLIER_MIN, applyCal, applyCalStr, calToMultiplier, compare, ratioToCalInput } from './calibration.js';
import { PROJECTS, RAW_SOURCE } from './projects.js';
import { defaultsOf, extractFromApi, findSourceLine, normalizeFromSource } from './sourceProbe.js';

/** 存储键 */
const STORAGE_KEY = 'APITest';

/** 取某个输入框元素 */
const el = (id) => document.getElementById(id);

/**
 * 渲染 10 张测试卡片
 *
 * @returns {void}
 * @sideEffects DOM
 */
function render() {
	const list = el('main-list');
	list.innerHTML = PROJECTS.map((project) => {
		const defaults = defaultsOf(project.type, RAW_SOURCE);
		return `
            <div class="card collapsed" id="card_${project.id}">
                <div class="card-header" onclick="toggle('${project.id}')">
                    <div><strong>${project.name}</strong></div>
                    <span id="stat_${project.id}" class="status-label">待测试</span>
                </div>
                <div class="card-content">
                    <table>
                        <thead><tr><th>参数</th><th>初始</th><th>实际</th><th>校准</th><th>状态</th></tr></thead>
                        <tbody>
                            ${project.params
								.map(
									(name, i) => `
                                <tr>
                                    <td class="param-name">${name}${
										name === '圆弧角度'
											? '<div class="param-note">1 = 两侧同为角度制<br>0.017453 = 度→弧度<br>57.2958 = 弧度→度</div>'
											: ''
									}</td>
                                    <td><input class="val-input" id="set_${project.id}_${i}" value="${defaults[i] || ''}"></td>
                                    <td><input class="val-input" id="act_${project.id}_${i}" readonly></td>
                                    <td><input class="val-input" id="cal_${project.id}_${i}" placeholder="*1"></td>
                                    <td class="row-status" id="res_${project.id}_${i}">-</td>
                                </tr>
                            `,
								)
								.join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
	}).join('');
}

/**
 * 读取已保存的校准参数并回填输入框
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（读扩展配置）、DOM
 */
async function loadSavedParams() {
	const host = getEda();
	if (!host) return;
	try {
		const saved = await host.sys_Storage.getExtensionUserConfig(STORAGE_KEY);
		if (!saved) return;
		const config = JSON.parse(saved);
		for (const project of PROJECTS) {
			const savedObj = config[project.name];
			if (!savedObj) continue;
			project.params.forEach((paramName, i) => {
				const input = el(`cal_${project.id}_${i}`);
				const value = savedObj[paramName];
				if (!input || value === undefined) return;
				// 保存时没有校准的参数会被写成 1，回填时保持空着（界面更清爽）
				input.value = value !== 1 ? `*${value}` : '';
			});
		}
	} catch (e) {
		console.error('加载校准参数失败，可能数据格式有误:', e);
	}
}

/**
 * 逐行比对并刷新状态灯 / 卡片状态
 *
 * @param {object} project 项目
 * @param {Array<string|number>} actuals 实际值数组
 * @returns {void}
 * @sideEffects DOM
 */
function fillAndVerify(project, actuals) {
	let allPass = true;
	let anyCal = false;

	actuals.forEach((value, i) => {
		const actEl = el(`act_${project.id}_${i}`);
		const setVal = el(`set_${project.id}_${i}`).value;
		const calVal = el(`cal_${project.id}_${i}`).value;
		const resEl = el(`res_${project.id}_${i}`);

		actEl.value = value;
		if (calVal) anyCal = true;

		let isPass;
		if (project.act === 'get') {
			// 获取模式：验证 (实际值 × 校准值) 是否等于设定值
			isPass = compare(setVal, applyCalStr(value, calVal));
		} else {
			// 创建模式：已应用预补偿时 val 应直接等于 setVal；
			// 刚点完自动校准时 val 还是旧数据，则看 (val × 校准值) 是否等于 setVal
			isPass = compare(setVal, value) || (calVal && compare(setVal, applyCalStr(value, calVal)));
		}

		resEl.innerText = isPass ? '通过测试' : '数据异常';
		resEl.className = 'row-status ' + (isPass ? 'pass' : 'fail');
		if (!isPass) allPass = false;
	});

	const stat = el(`stat_${project.id}`);
	const card = el(`card_${project.id}`);
	if (!allPass) {
		stat.innerText = '错误';
		stat.style.color = 'var(--vscode-error)';
		card.classList.remove('collapsed');
	} else {
		stat.innerText = anyCal ? '已校准' : '通过';
		stat.style.color = anyCal ? 'var(--vscode-warning)' : 'var(--vscode-success)';
		card.classList.add('collapsed');
	}
}

/**
 * 读源码并归一成标准量
 *
 * @param {string} id 图元 id
 * @param {string} type 图元类型
 * @returns {Promise<Array<string|number>>} 标准量数组
 * @sideEffects eda API（读文档源码）
 */
async function readSourceValues(id, type) {
	const host = getEda();
	const code = await host.sys_FileManager.getDocumentSource();
	const { rawV2, rawV3 } = findSourceLine(code, id);
	return normalizeFromSource(type, rawV2, rawV3);
}

/**
 * 「获取」测试：以源码值为初始、以 API 值为实际
 *
 * @param {object} project 项目
 * @param {object} apiObj 选中的图元对象
 * @returns {Promise<void>}
 * @sideEffects eda API、DOM
 */
async function runGetTest(project, apiObj) {
	const setVals = await readSourceValues(apiObj.primitiveId, project.type);
	setVals.forEach((value, i) => (el(`set_${project.id}_${i}`).value = value));
	fillAndVerify(project, extractFromApi(project.type, apiObj));
}

/**
 * 创建图元的策略表（替代 5 个 if 分支）
 *
 * @type {Record<string, Function>}
 */
const CREATORS = {
	Via: async (host, fx, fy, innerDia, outerDia, solderMask) => {
		const r = await host.pcb_PrimitiveVia.create('', Number(fx), Number(fy), innerDia, outerDia, 0, null, {
			topSolderMask: solderMask,
			bottomSolderMask: solderMask,
			topPasteMask: 0,
			bottomPasteMask: 0,
		});
		return r.primitiveId;
	},
	Pad: async (host, fx, fy, innerDia, outerDia, solderMask) => {
		const r = await host.pcb_PrimitivePad.create(
			12,
			'1',
			Number(fx),
			Number(fy),
			0,
			['ELLIPSE', outerDia, outerDia],
			'',
			['ROUND', innerDia, innerDia],
			0,
			0,
			0,
			true,
			0,
			[],
			{ topSolderMask: solderMask, bottomSolderMask: solderMask, topPasteMask: solderMask, bottomPasteMask: solderMask },
		);
		return r.primitiveId;
	},
	Line: async (host, fx, fy, innerDia) => {
		const r = await host.pcb_PrimitiveLine.create('', 1, Number(fx), Number(fy), Number(fx) + 30, Number(fy), Number(innerDia));
		return r.primitiveId;
	},
	Arc: async (host, fx, fy, innerDia, outerDia) => {
		const r = await host.pcb_PrimitiveArc.create('', 1, Number(fx), Number(fy), Number(fx), Number(fy) - 20, Number(outerDia), Number(innerDia));
		return r.primitiveId;
	},
	Polyline: async (host, fx, fy, innerDia) => {
		const poly = host.pcb_MathPolygon.createPolygon([Number(fx), Number(fy), 'L', Number(fx) + 30, Number(fy)]);
		const r = await host.pcb_PrimitivePolyline.create('', 1, poly, Number(innerDia));
		return r.primitiveId;
	},
};

/**
 * 「创建」测试：按设定值建图元，再读源码回验
 *
 * @param {object} project 项目
 * @returns {Promise<void>}
 * @sideEffects eda API、DOM
 */
async function runCreateTest(project) {
	const host = getEda();
	// Line / Polyline 只有 2 个参数，第 3、4 个输入框不存在 —— 必须容错（原实现在这里会抛空引用）
	const readInput = (prefix, index) => {
		const node = el(`${prefix}_${project.id}_${index}`);
		return node ? node.value : '';
	};
	const getV = (index) => readInput('set', index);
	const getC = (index) => readInput('cal', index);

	const [x, y] = getV(0).split(',');
	const fx = applyCal(x, getC(0));
	const fy = applyCal(y, getC(0));
	const innerDia = Number(applyCal(getV(1), getC(1)));
	const outerDia = Number(applyCal(getV(2), getC(2)));
	const solderMask = Number(applyCal(getV(3), getC(3)));

	const creator = CREATORS[project.type];
	if (!creator) return;
	const resId = await creator(host, fx, fy, innerDia, outerDia, solderMask);
	if (!resId) return;
	fillAndVerify(project, await readSourceValues(resId, project.type));
}

/**
 * 批量执行（HTML 内联调用入口）
 *
 * @param {'get'|'create'} action 动作
 * @returns {Promise<void>}
 * @sideEffects eda API、DOM、宿主 toast
 */
async function executeBatch(action) {
	const host = getEda();
	try {
		await runBatch(action, host);
	} catch (error) {
		console.error('批量执行失败:', error);
		toast('批量执行失败: ' + (error && error.message ? error.message : error), 'error');
	}
}

/**
 * 批量执行的实现（拆出来以便统一 catch，避免内联 onclick 产生未捕获的 Promise rejection）
 *
 * @param {'get'|'create'} action 动作
 * @param {object} host 宿主对象
 * @returns {Promise<void>}
 * @sideEffects eda API、DOM、宿主 toast
 */
async function runBatch(action, host) {
	if (action === 'get') {
		const selected = await host.pcb_SelectControl.getAllSelectedPrimitives();
		if (!selected || selected.length === 0) {
			toast('请先选中画布上的元素', 'info');
			return;
		}
		for (const project of PROJECTS.filter((item) => item.act === 'get')) {
			const target = selected.find((item) => item.primitiveType === project.type);
			if (target) await runGetTest(project, target);
		}
		return;
	}
	for (const project of PROJECTS.filter((item) => item.act === 'create')) {
		await runCreateTest(project);
	}
}

/**
 * 自动推算校准系数（HTML 内联调用入口）
 *
 * @returns {void}
 * @sideEffects DOM
 */
function autoCalibrateAll() {
	for (const project of PROJECTS) {
		project.params.forEach((_, i) => {
			const setStr = el(`set_${project.id}_${i}`).value;
			const actStr = el(`act_${project.id}_${i}`).value;
			const calInput = el(`cal_${project.id}_${i}`);

			let set = parseFloat(setStr);
			let act = parseFloat(actStr);

			// 坐标：挑非 0 的那一维算比例
			if (String(setStr).includes(',')) {
				const sParts = String(setStr).split(',');
				const aParts = String(actStr).split(',');
				const aX = parseFloat(aParts[0]);
				if (aX !== 0 && !isNaN(aX)) {
					set = parseFloat(sParts[0]);
					act = aX;
				} else {
					set = parseFloat(sParts[1]);
					act = parseFloat(aParts[1]);
				}
			}

			if (isNaN(set) || isNaN(act) || act === 0) return;
			// 创建模式：实际传给 API 的是 applyCal(set, 当前校准)，所以倍率要用它去比
			const ratio = project.act === 'get' ? set / act : applyCal(set, calInput.value) / act;
			calInput.value = ratioToCalInput(ratio);
		});
		validateManual(project.id);
	}
}

/**
 * 单项重算并刷新状态（供手动改校准值后调用）
 *
 * @param {string} id 项目 id
 * @returns {void}
 * @sideEffects DOM
 */
function validateManual(id) {
	const project = PROJECTS.find((item) => item.id === id);
	const actuals = project.params.map((_, i) => el(`act_${id}_${i}`).value);
	if (actuals[0]) fillAndVerify(project, actuals);
}

/**
 * 保存校准参数为「纯乘数」JSON（HTML 内联调用入口）
 *
 * @returns {Promise<void>}
 * @sideEffects eda API（写扩展配置）、宿主 toast
 */
async function saveParams() {
	const host = getEda();
	const config = {};
	const invalid = [];

	for (const project of PROJECTS) {
		const paramsObj = {};
		project.params.forEach((paramName, i) => {
			const text = el(`cal_${project.id}_${i}`).value;
			const multiplier = calToMultiplier(text);
			if (Number.isNaN(multiplier)) {
				invalid.push(`${project.name}.${paramName}（${text}）`);
				paramsObj[paramName] = 1;
			} else {
				paramsObj[paramName] = multiplier;
			}
		});
		config[project.name] = { ...paramsObj };
	}

	// 有越界/非法值就不保存：宁可报错，也不要把错误倍率写进存储
	if (invalid.length > 0) {
		toast(`校准值不合法：${invalid.slice(0, 3).join('、')}，允许范围 ${MULTIPLIER_MIN}~${MULTIPLIER_MAX}`, 'error');
		return;
	}

	try {
		const ok = await host.sys_Storage.setExtensionUserConfig(STORAGE_KEY, JSON.stringify(config));
		toast(ok ? '保存成功' : '保存失败', ok ? 'success' : 'error');
	} catch (error) {
		toast('保存失败', 'error');
		if (String(error).includes('Cannot create property')) toast('EDA底层数据写入异常，无法保存，建议重启EDA', 'error');
	}
}

/**
 * 折叠/展开卡片（HTML 内联调用）
 *
 * @param {string} id 项目 id
 * @returns {void}
 * @sideEffects DOM
 */
function toggle(id) {
	el(`card_${id}`).classList.toggle('collapsed');
}

window.toggle = toggle;
window.executeBatch = executeBatch;
window.autoCalibrateAll = autoCalibrateAll;
window.saveParams = saveParams;

window.onload = async () => {
	const host = getEda();
	if (host) el('ver-info').innerText = `EDA版本: ${getEditorVersion()}`;
	render(); // 必须先渲染 DOM，后面才能取到输入框
	await loadSavedParams();
};
