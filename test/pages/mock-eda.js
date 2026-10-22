/**
 * 浏览器冒烟测试用的 eda mock
 *
 * 用法：由 test/pages/run.mjs 注入到每个 iframe 页面的 <head> 最前面
 * （必须在页面脚本之前执行），页面照常加载自己的 JS，从而验证：
 *   1. 页面初始化是否抛错（同步异常 / 未捕获 Promise）
 *   2. 是否出现 console.error
 *   3. 调用了哪些「未 mock 的 eda API」（说明测试覆盖缺口，不算失败）
 *
 * 结果写在页面末尾的 <pre id="smoke-result"> 里，由 headless Chrome 的 --dump-dom 读回。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
(function () {
	const smoke = { errors: [], unhandled: [], missing: [], dialogs: [], actions: [], calls: 0 };
	window.__smoke = smoke;

	window.addEventListener('error', (e) => {
		smoke.errors.push({ type: 'error', msg: e.message, at: (e.filename || '') + ':' + e.lineno });
	});
	window.addEventListener('unhandledrejection', (e) => {
		const r = e.reason;
		smoke.unhandled.push({ type: 'unhandledrejection', msg: String((r && (r.stack || r.message)) || r) });
	});
	const origError = console.error.bind(console);
	console.error = function (...args) {
		smoke.errors.push({
			type: 'console.error',
			msg: args.map((a) => (a && (a.message || a.stack)) || (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
		});
		origError(...args);
	};

	/* ---------------- 测试数据 ---------------- */

	// V3 网表结构：{ components: { <uuid>: { props, pinInfoMap } } }
	const components = {};
	const designs = [
		{ d: 'R1', name: '1kΩ', fp: 'R0603', mfr: 'UniOhm', sup: 'C21190', mfrPart: '0603WAF1001T5E', uid: 'u1' },
		{ d: 'R2', name: '10kΩ', fp: 'R0603', mfr: 'UniOhm', sup: 'C25804', mfrPart: '0603WAF1002T5E', uid: 'u2' },
		{ d: 'C1', name: '100nF', fp: 'C0603', mfr: 'Samsung', sup: 'C14663', mfrPart: 'CL10B104KB8NNNC', uid: 'u3' },
		// 故意留空供应商，覆盖「空属性清理」类功能
		{ d: 'U1', name: 'STM32F103', fp: 'LQFP48', mfr: '', sup: '', mfrPart: '', uid: 'u4' },
		// 没有封装的器件，覆盖「3D 模型更新」的边界
		{ d: 'TP1', name: 'TestPoint', fp: '', mfr: '', sup: '', mfrPart: '', uid: 'u5' },
	];
	for (const item of designs) {
		components[item.uid] = {
			props: {
				'Unique ID': item.uid,
				Designator: item.d,
				Name: item.name,
				FootprintName: item.fp,
				Manufacturer: item.mfr,
				Supplier: item.sup,
				'Manufacturer Part': item.mfrPart,
				DeviceName: item.name,
				SymbolName: item.name,
			},
			pinInfoMap: {
				'1': { net: 'VCC', name: 'VCC' },
				'2': { net: 'GND', name: 'GND' },
			},
		};
	}
	const netlistJson = { components };

	/* ---------------- 存储 mock ---------------- */
	const storage = new Map();

	/* ---------------- 浏览器能力 mock（headless 下会因权限失败，属环境噪声） ---------------- */
	try {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				readText: async () => '',
				writeText: async () => undefined,
			},
		});
	} catch (e) {
		/* 忽略 */
	}

	/**
	 * 接管阻塞式对话框
	 *
	 * headless Chrome 里 alert() 会**真的阻塞 JS 执行**且没有人点确定，页面从此不再响应，
	 * 表现为「测试超时」而不是「产品 bug」。这里改成记录 + 直接返回：
	 *   - alert 记进 smoke 日志，用于人工判断文案是否合理；
	 *   - confirm 默认返回 true（继续走主流程，能测到后面的代码）；
	 *   - prompt 返回空串。
	 */
	for (const name of ['alert', 'confirm', 'prompt']) {
		const original = window[name];
		window[name] = function (msg) {
			try {
				smoke.dialogs.push({ kind: name, msg: String(msg).slice(0, 200) });
			} catch (e) {
				/* 忽略 */
			}
			if (name === 'confirm') return true;
			if (name === 'prompt') return '';
			return undefined;
		};
		window[name].__original = original;
	}

	/* ---------------- 宿主 API ---------------- */

	// 每个 primitive create 都返回一个带 primitiveId 的对象
	let seq = 1000;
	const created = () => ({ primitiveId: 'e' + ++seq, toAsync: () => created(), reset: () => undefined });

	const ok = () => Promise.resolve(true);
	const known = {
		sys_Environment: {
			getEditorCurrentVersion: () => '3.2.149',
			getLanguage: () => 'zh-Hans',
			getTheme: () => 'dark',
		},
		sys_Message: {
			showToastMessage: ok,
			showInformationMessage: ok,
			showWarnMessage: ok,
			showErrorMessage: ok,
		},
		sys_Dialog: { showConfirmationMessage: ok },
		sys_IFrame: { openIFrame: ok, closeIFrame: ok },
		sys_Log: { add: ok, clear: ok },
		sys_PanelControl: { openBottomPanel: ok, openRightPanel: ok },
		sys_FileManager: {
			getDocumentSource: async () => '',
			setDocumentSource: async () => true,
			openReadFileDialog: async () => [],
			saveFile: ok,
		},
		sys_FileSystem: { openReadFileDialog: async () => [], saveFile: ok, writeFile: ok },
		sys_Storage: {
			getExtensionAllUserConfigs: async () => Object.fromEntries(storage),
			setExtensionAllUserConfigs: async (obj) => {
				storage.clear();
				for (const [k, v] of Object.entries(obj || {})) storage.set(k, v);
				return true;
			},
			getExtensionUserConfig: async (k) => storage.get(k),
			setExtensionUserConfig: async (k, v) => {
				storage.set(k, v);
				return true;
			},
			deleteExtensionUserConfig: async (k) => storage.delete(k),
		},
		sys_ShortcutKey: { registerShortcutKey: ok, unregisterShortcutKey: ok },
		sys_Clipboard: { writeText: ok, readText: async () => '' },
		pcb_ManufactureData: { getNetlistFile: async () => ({ text: async () => JSON.stringify(netlistJson) }) },
		sch_ManufactureData: { getNetlistFile: async () => ({ text: async () => JSON.stringify(netlistJson) }) },
		// getAllNets 是 OutPinNet「导出网络长度」用的：缺失时该按钮必然抛错，
		// 冒烟会把它记成 console.error（重构前就是这样，属于 mock 缺口而非产品缺陷）
		pcb_Net: {
			setNetlist: ok,
			getAllNets: async () => [
				{ net: 'GND', length: 123.45 },
				{ net: 'VCC', length: 67.8 },
				{ net: 'Net1', length: 0 },
			],
		},
		sch_Netlist: { setNetlist: ok },
		pcb_SelectControl: { getAllSelectedPrimitives: async () => [], getSelectedPrimitives: async () => [] },
		sch_SelectControl: { getAllSelectedPrimitives: async () => [], getSelectedPrimitives_PrimitiveId: async () => [] },
		pcb_Layers: { getAllLayers: async () => [], getCurrentLayer: async () => 1 },
		dmt_EditorControl: { activateDocument: ok },
		dmt_SelectControl: { getCurrentDocumentInfo: async () => ({ documentType: 1, uuid: 'doc-1', parentProjectUuid: 'proj-1' }) },
	};

	// 已 mock 的 primitive / library 命名空间统一返回「可创建对象」
	for (const ns of ['pcb_PrimitiveVia', 'pcb_PrimitivePad', 'pcb_PrimitiveLine', 'pcb_PrimitiveArc', 'pcb_PrimitivePolyline', 'pcb_PrimitiveRegion', 'pcb_PrimitiveFill', 'pcb_PrimitiveText', 'pcb_PrimitiveImage', 'pcb_PrimitiveComponent', 'sch_PrimitiveComponent', 'sch_PrimitiveWire', 'sch_PrimitiveLine', 'sch_PrimitiveText']) {
		known[ns] = {
			create: async () => created(),
			delete: ok,
			get: async () => created(),
			getAll: async () => [],
			update: ok,
		};
	}
	for (const ns of ['lib_LibrariesList', 'lib_Device', 'lib_Footprint', 'lib_Symbol', 'dmt_Project', 'dmt_Folder', 'sch_Netlist', 'pcb_Document', 'sch_Document']) {
		known[ns] = known[ns] || { getAll: async () => [], get: async () => null, create: async () => created(), delete: ok };
	}

	/** 未 mock 的命名空间：返回可链式调用、可 await 的空实现，并记录到 missing */
	function namespaceStub(name) {
		const handler = {
			get(_t, prop) {
				if (prop === 'then') return undefined; // 避免被当成 thenable
				const key = name + '.' + String(prop);
				smoke.missing.push(key);
				return function stub() {
					smoke.calls++;
					return Promise.resolve([]);
				};
			},
		};
		return new Proxy(function () {}, handler);
	}

	window.eda = new Proxy(known, {
		get(target, prop) {
			if (prop in target) return target[prop];
			if (typeof prop === 'symbol') return undefined;
			smoke.missing.push(String(prop) + '.*');
			return namespaceStub(String(prop));
		},
	});

	/* ---------------- 结果回写 ---------------- */

	function flush(sendToServer = true) {
		const payload = {
			page: location.pathname,
			errors: smoke.errors,
			unhandled: smoke.unhandled,
			missing: [...new Set(smoke.missing)].slice(0, 20),
			calls: smoke.calls,
			actions: smoke.actions || [],
			dialogs: smoke.dialogs || [],
		};
		// 主动回传给测试服务：不依赖 Chrome 自行退出（部分页面有常驻定时器）
		if (sendToServer) {
			try {
				fetch('/__smoke', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
			} catch (e) {
				/* 忽略 */
			}
		}
		// 同时写进 DOM，便于人工用 --dump-dom 排查
		try {
			const pre = document.createElement('pre');
			pre.id = 'smoke-result';
			pre.style.display = 'none';
			pre.textContent = JSON.stringify(payload);
			document.body.appendChild(pre);
		} catch (e) {
			/* body 还没建好时忽略 */
		}
	}
	/**
	 * 自动驱动交互
	 *
	 * 只加载页面只能发现「顶层空引用」；真正的逻辑都在按钮回调里。
	 * 这里按通用规则驱动一遍：填空 → 勾选 → 依次点击可用按钮，全程收集错误。
	 * 目的是把「一点就崩」的路径离线跑出来，而不是替代人工验收。
	 */
	function drive() {
		const actions = [];
		try {
			// 1) 文本类输入：给一个通用值，触发 input/change
			//    textarea 多为「位号 + 制表符 + 内容」的批量粘贴格式，这里按该格式填，避免只触发格式校验分支
			document.querySelectorAll('input[type="text"], input[type="search"], textarea').forEach((el) => {
				if (el.value) return;
				el.value = el.tagName === 'TEXTAREA' ? 'R1\tC100' : 'R1';
				el.dispatchEvent(new Event('input', { bubbles: true }));
				el.dispatchEvent(new Event('change', { bubbles: true }));
				actions.push('fill:' + (el.id || el.className || el.tagName));
			});
			// 2) 复选框：全部打开，触发配置类分支
			document.querySelectorAll('input[type="checkbox"]').forEach((el) => {
				if (el.checked) return;
				el.checked = true;
				el.dispatchEvent(new Event('change', { bubbles: true }));
			});
			// 3) 按钮：依次点击（最多 12 个，避免长时间停留）
			const buttons = [...document.querySelectorAll('button')].filter((b) => !b.disabled).slice(0, 12);
			let i = 0;
			const next = () => {
				if (i >= buttons.length) {
					smoke.actions = actions;
					flush();
					return;
				}
				const btn = buttons[i++];
				try {
					btn.click();
					actions.push('click:' + (btn.id || String(btn.textContent || '').trim().slice(0, 8)));
				} catch (e) {
					smoke.errors.push({ type: 'click-error', msg: String((e && e.message) || e) });
				}
				setTimeout(next, 120);
			};
			next();
		} catch (e) {
			smoke.errors.push({ type: 'drive-error', msg: String((e && e.message) || e) });
			flush();
		}
	}

	window.addEventListener('load', () => {
		flush(false); // 先写 DOM 快照（不回传），便于人工排查
		setTimeout(drive, 600);
		// 兜底：drive 卡住时也要有结果回来
		setTimeout(() => flush(true), 7000);
	});
})();
