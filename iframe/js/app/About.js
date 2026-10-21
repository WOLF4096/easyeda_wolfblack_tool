// JSON 数据结构定义功能列表
	const featuresData = [
		{
			"name": "基准测试",
			"shortcut": "首次必运行",
			"shortcutType": "warning",
			"brief": "测试并校准当前版本客户端各种图元生成 API 的坐标准确性，自动推导偏移补偿系数并提供本地持久化存储，解决底层 API 位置漂移问题。",
			"scope": ["PCB"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1447593",
			"purpose": "解决不同版本 JLCEDA 底层 API 返回坐标与实际画布坐标存在偏差的问题，通过主动测试获取并校准偏差补偿值。",
			"usage": "初次安装或更新插件后，请新建并打开一个空白 PCB 文档。进入菜单“狼黑工具 -> 转换 -> 基准测试”，点击“放置”在画布生成测试图元。随后选中该图元，点击“获取”进行坐标比对，再点击“校准”自动计算补偿系数。最后保存校准参数即可。"
		},
		{
			"name": "导入图片",
			"shortcut": "Ctrl+Shift+C",
			"shortcutType": "",
			"brief": "支持导入 PNG 与 JPG 图片，可自定义尺寸、DPI 及切片导入，绕过大小限制。",
			"scope": ["PCB"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1220989",
			"purpose": "突破 JLCEDA 原生导入图片的尺寸限制，并支持批量多图导入以减少重复操作。新增 DPI 快速预设功能，能根据预处理图片的 DPI 自动计算并按 1:1 物理真实尺寸导入至 PCB 画布。",
			"usage": "在 PCB 界面中打开工具，选择单张或多张本地图片。设置目标物理尺寸或选择对应 DPI，并勾选是否需要切片导入。点击“放置”后，图片将跟随鼠标，点击画布即可放置。注：若启用切片导入，放置后需手动全选切片并进行“组合”操作。"
		},
		{
			"name": "导入二维码",
			"shortcut": "",
			"shortcutType": "",
			"brief": "基于文本生成不同类型的矢量或位图二维码。",
			"scope": ["PCB"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221020",
			"purpose": "提供一种更便捷的方式，在 PCB 上快速生成并放置高质量、无压缩失真的矢量或位图二维码。",
			"usage": "在工具面板中输入目标文本并设置二维码的相关参数（如大小、类型等），点击生成并放置在 PCB 画布的合适位置即可。"
		},
		{
			"name": "工作时间统计",
			"shortcut": "",
			"shortcutType": "",
			"brief": "后台静默记录软件使用时长与操作活跃度（区分工作与休息时间），提供本地化数据存储与可视化统计图表分析。",
			"scope": ["PCB", "原理图"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221046",
			"purpose": "自动记录每日的软件使用时长与特定工程的开发耗时，为项目工时管理、进度评估以及外包工时结算提供客观的数据参考。",
			"usage": "插件随 JLCEDA 启动并在后台静默记录您的活跃操作。如需查看统计报告，请前往菜单“狼黑工具 -> 工作时间统计”，在弹出的可视化面板中即可查阅历史工时图表。"
		},
		{
			"name": "过孔焊盘互转",
			"shortcut": "Ctrl+Shift+G",
			"shortcutType": "sch",
			"brief": "快速进行通孔焊盘与过孔的相互转换，转换过程中精确保留原有的几何尺寸与阻焊扩展参数。",
			"scope": ["PCB"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221301",
			"purpose": "弥补原生工具中“过孔无法单独设置内层铜环尺寸”及“无法应用禁止覆铜约束”的局限性，通过转换为通孔焊盘来实现更高级的规则控制。",
			"usage": "在 PCB 画布上框选或点选需要转换的过孔（或通孔焊盘）。执行本功能后，所选对象将在保持原坐标不变的情况下自动完成属性互转。"
		},
		{
			"name": "线条导线互转",
			"shortcut": "Ctrl+Shift+X",
			"shortcutType": "sch",
			"brief": "实现电气导线与无电气属性的几何线条的相互转换。",
			"scope": ["PCB"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221325",
			"purpose": "满足利用无电气属性线条绘制复杂图形的需求；同时便于修复他人设计中误用普通折线代替电气导线的错误。",
			"usage": "选中目标几何线条或电气导线对象，运行本功能，即可在原坐标原地完成电气属性与非电气属性的相互转换。"
		},
		{
			"name": "填充图片互转",
			"shortcut": "Ctrl+Shift+F",
			"shortcutType": "",
			"brief": "支持填充区域与对象的相互转换。",
			"scope": ["PCB"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1447607",
			"purpose": "赋予填充区域类似图片对象的缩放拉伸能力，方便对复杂的不规则多边形敷铜或丝印图形进行整体尺寸调整。",
			"usage": "选中目标填充区域（或插件生成的图像对象），运行本功能进行相互转换，转换后可利用图像控制柄进行自由缩放。"
		},
		{
			"name": "创建封装",
			"shortcut": "",
			"shortcutType": "",
			"brief": "选中离散图元，自动计算几何中心并编译底层源码生成封装存入个人库；同时根据引脚自动计算 BBOX 生成对应的原理图符号。",
			"scope": ["PCB"],
			"version": "V2.2",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221362",
			"purpose": "简化异形或非标元件的建库流程。当商城缺乏现成封装时，可直接在 PCB 画布用基础图元拼绘，一键打包入库，并联动生成对应的原理图符号。",
			"usage": "在 PCB 画布上利用焊盘、丝印等图元绘制好封装外形。框选所有组成部分的图元，点击“创建封装”，在弹窗中配置名称与存储路径，确认后即可生成标准封装。"
		},
		{
			"name": "位号查重",
			"shortcut": "",
			"shortcutType": "sch",
			"brief": "扫描并定位 PCB 中重复分配的器件位号，支持异常器件的快速视角跳转与排查。",
			"scope": ["PCB"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221381",
			"purpose": "弥补原生 PCB DRC（设计规则检查）工具无法自动检测重复位号的缺陷，防止因位号冲突导致的后续流程出错。",
			"usage": "直接运行“位号查重”功能，插件将扫描当前 PCB。若存在重复位号，结果将罗列在弹出的日志面板中。点击日志条目可实现视角的自动跳转与高亮，方便逐一排查修改。"
		},
		{
			"name": "生成物理网络",
			"shortcut": "",
			"shortcutType": "",
			"brief": "利用多边形碰撞、线段相交、内切圆检测等纯空间几何算法分析画布上铜箔与图元的实际接触，在无原理图状态下逆向推导并重构整个物理网络。",
			"scope": ["PCB"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221422",
			"purpose": "解决原生工具无法通过铜皮物理连接来推导电气网络的问题，实现类似 Altium Designer 的“设置物理网络”的高级功能。",
			"usage": "打开面板后，选择数据写入模式（推荐使用“网表”模式）。点击“计算拓扑”进行空间碰撞分析，完成后点击“写入”应用网络。注：纯几何计算存在一定容错率，若拓扑极其复杂导致计算异常，建议配合“导入 AD 网表”功能作为备用方案。"
		},
		{
			"name": "导入 AD 网表",
			"shortcut": "",
			"shortcutType": "",
			"brief": "解析 Altium Designer 格式（.net）的网表文件，基于位号提取并比对引脚映射关系，将外部网络结构同步注入至当前设计的网表数据中。",
			"scope": ["PCB"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1230646",
			"purpose": "修复原生工具导入部分 AD 网表时报错（如“未提取到有效元件信息”）的问题，提供更具兼容性的第三方网表解析与网络重组方案。",
			"usage": "准备工作：确保当前 PCB 无重复位号并重置元件唯一 ID，然后将其导出为 AD 格式；在 Altium Designer 中打开该文件并生成网表文件 (.net)。随后回到本插件，使用此功能载入生成的 AD 网表，即可完成网络数据的无缝注入。"
		},
		{
			"name": "导出引脚网络",
			"shortcut": "",
			"shortcutType": "",
			"brief": "快速遍历图纸并提取所有器件的引脚及网络映射状态，支持将其格式化导出为 CSV 表格。",
			"scope": ["PCB"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1447636",
			"purpose": "极大简化阵列化元件（如大量 驱动器、继电器 等）的网络分配工作。通过导出 CSV，可以方便的用 Excel 的自动填充（如 OE_1~64）等功能快速批量命名网络。",
			"usage": "框选需要提取引脚的器件或封装，运行此功能，将所选器件的引脚号与当前网络映射关系导出为外部表格文件（如 CSV），供外部编辑器处理。"
		},
		{
			"name": "批量修改网络",
			"shortcut": "",
			"shortcutType": "",
			"brief": "支持直接粘贴外部制表符（Tab）分隔的替换规则，以批量覆写网表数据结构中的网络关系。",
			"scope": ["PCB"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221464",
			"purpose": "解决大量无意义网络名（如 NET_XXX）需逐一重命名的痛点，支持借助 Excel 等外部表格工具对网络名进行批量、规则化的快速映射与替换。",
			"usage": "在 Excel 等制表软件中准备两列数据（左列：旧网络名，右列：新网络名）。选中并复制这两列数据，在插件面板中点击粘贴并执行。系统将自动遍历并替换所有匹配的网络名。"
		},
		{
			"name": "丝印代码转换",
			"shortcut": "",
			"shortcutType": "",
			"brief": "内置 E96 阻值标准对照表与单位正则引擎，一键将 R/C/L 元件的缩写丝印(如\"01C\"→\"10kΩ\")自动换算并覆写为标准物理数值。",
			"scope": ["PCB", "原理图"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221485",
			"purpose": "支持一键将难记的缩写丝印（如“01C”）批量转换为直观的标准物理数值（如“10kΩ”）。",
			"usage": "在原理图或 PCB 视图中运行“丝印代码转换”。插件将基于内置的标准 E96 映射表自动解析并覆写选中元件的 Value 属性。面板可展开查看具体的换算明细与对账记录。"
		},
		{
			"name": "清空多余属性",
			"shortcut": "",
			"shortcutType": "",
			"brief": "扫描网表并提供可交互的多选列表，一键清理冗余的器件属性（按基础、关键、更多属性分类），避免无关属性误导。",
			"scope": ["PCB", "原理图"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221495",
			"purpose": "在“借用”同封装的不同器件图元时，快速剥离原器件自带的供应商编号、供应商等无关参数。维持 BOM 表的纯净度，避免错误的属性误导采购或后续设计者。",
			"usage": "选中目标器件，运行本功能。插件将弹出一个可交互的属性白名单勾选面板，按分类展示当前附带的所有属性。确认保留项后，一键清除其余杂乱或冗余的底层字典数据。"
		},
		{
			"name": "刷新网表",
			"shortcut": "",
			"shortcutType": "",
			"brief": "获取网表数据后再写入，避免属性值中出现 `={Value}` 的字符串。",
			"scope": ["PCB", "原理图"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1447654",
			"purpose": "避免名称出现大量 `={Value}` 的情况，方便后续功能调用。",
			"usage": "运行本功能，插件将在后台重新拉取并重新写入网表数据，强制触发属性值的解析与刷新。核对预览结果无误后，点击确认应用修改。"
		},
		{
			"name": "导入BOM",
			"shortcut": "",
			"shortcutType": "",
			"brief": "支持直接粘贴含制表符的外部表格数据，自动聚类图纸内的器件，将外部供应商、立创编号等定制参数准确映射并批量写回图纸底层网表。",
			"scope": ["PCB", "原理图"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221515",
			"purpose": "方便整理元件属性值的同时，解决了接手别人的板子时，属性里没有参数的问题。实现跨工程、跨软件的标准化 BOM 参数批量回填。",
			"usage": "在外部 Excel 中整理好制表符分隔的数据（必须包含“位号”列，及对应的“立创编号”等参数列）。复制数据块，在插件中粘贴并进行列标题映射，确认无误后点击执行即可批量写入底层网表。"
		},
		{
			"name": "批量替换器件",
			"shortcut": "",
			"shortcutType": "",
			"brief": "自动对同规格图元进行聚类，输入新立创编号后并发调用商城 API 拉取最新参数，在保持原坐标与角度不变的前提下批量完成底层替换。",
			"scope": ["PCB"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221533",
			"purpose": "针对原生“器件标准化”功能在大型工程中卡顿、缓慢的问题，提供一套轻量、高速且支持保持原空间姿态的器件批量替换替代方案。",
			"usage": "使用前必须备份，必需确保位号没有重复，在Excel准备2列数据，位号|立创C编号，复制粘贴进插件，根据C编号获取元件数据与位号绑定并替换。<br/>在 V2.2 版本中，无法自动获取器件参数，需要在流程中手动选中（-10000,-10000）处的所有元件，选中后自动获取元件参数，随后自动删除，如有弹窗点击确定即可。"
		},
		{
			"name": "模型批量更新",
			"shortcut": "",
			"shortcutType": "",
			"brief": "提取元件的 3D 模型详情，支持从外部网表恢复丢失的模型，并可精细化批量调整模型的大小、旋转角度与三维偏移量。",
			"scope": ["PCB"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221572",
			"purpose": "解决因未知错误导致 3D 模型丢失的灾难性恢复问题。",
			"usage": "若用于恢复模型：请导入早期备份的 JLCEDA 网表，插件将提取其中的 3D UUID 与位姿参数进行重绑定。若用于微调：选中器件后，在面板中批量调节各向偏移与角度参数即可实时生效。"
		},
		{
			"name": "从PCB转原理图",
			"shortcut": "",
			"shortcutType": "",
			"brief": "读取工程文件，根据 PCB 数据反向匹配，并在原理图中自动生成对应符号，支持坐标翻转映射、多部件与包围盒处理。",
			"scope": ["原理图"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221620",
			"purpose": "填补当前 JLCEDA 缺乏逆向工程（由 PCB 反向生成原理图）功能的空白。",
			"usage": "创建并打开一个绑定了目标 PCB 的空白原理图。运行本工具，依次点击“获取数据”->“构建源码”->“写入文档”。程序将根据 PCB 器件的 BBOX 坐标与部件拆分规则，在原理图上还原所有的器件符号。"
		},
		{
			"name": "从PCB创建导线",
			"shortcut": "",
			"shortcutType": "",
			"brief": "对比原理图与 PCB 的引脚网络差异，通过底层源码拼接的方式，自动在原理图中为缺失网络的引脚快速生成可视化导线连接。",
			"scope": ["原理图"],
			"version": "V2.2 / V3",
			"demoUrl": "https://www.jlc-bbs.com/platform/a/1221655",
			"purpose": "配合“PCB 转原理图”功能使用，通过比对物理网络映射，自动为离散的原理图引脚生成带有网络标签的互连导线，大幅削减手工连线工作量。",
			"usage": "建议采用合并所以窗口同时打开 PCB 与原理图（左右分屏时将无法获取数据）。在原理图界面点击执行后，插件将自动读取 PCB 的引脚网络拓扑，并在原理图画布上为缺失网络的引脚自动绘制带有标签的短导线。"
		},
		{
			"name": "引脚排序",
			"shortcut": "",
			"shortcutType": "",
			"brief": "用于绘制原理图符号时给引脚排序，支持按引脚编号、引脚名称规则进行排序。",
			"scope": ["符号"],
			"version": "V2.2 / V3",
			"demoUrl": "",
			"purpose": "用于绘制原理图符号时给引脚排序，支持按引脚编号、引脚名称规则进行排序。",
			"usage": "看一眼就会"
		}
	];

    document.addEventListener('DOMContentLoaded', function() {
		const tbody = document.querySelector('#featureTable tbody');
		
		featuresData.forEach(item => {
			// 1. 处理演示链接按钮
			const linkHtml = item.demoUrl 
				? `<a href="${item.demoUrl}" target="_blank">打开</a>` 
				: `<span class="muted">暂无</span>`;

			// 2. 处理名称与快捷键/提示标签
			let nameHtml = item.name;
			if (item.shortcut) {
				const scType = item.shortcutType || "sch"; // 默认使用 sch(橙色) 样式
				nameHtml = `
					<div class="env-stack">
						<span>${item.name}</span>
						<span class="tag tag-scope ${scType}">${item.shortcut}</span>
					</div>
				`;
			}

			// 3. 处理环境(Scope)数组标签
			let scopeTagsHtml = '';
			if (Array.isArray(item.scope)) {
				const tags = item.scope.map(s => {
					let cssClass = 'pcb'; // 默认蓝色
					if (s === '原理图') cssClass = 'sch'; // 橙色
					if (s === '全局') cssClass = 'global'; // 青色
					return `<span class="tag tag-scope ${cssClass}">${s}</span>`;
				}).join('');
				
				// 如果大于1个标签，使用横向排列
				scopeTagsHtml = item.scope.length > 1 
					? `<div class="tag-row">${tags}</div>` 
					: tags;
			}

			// 4. 组合环境与版本列
			const envAndVersionHtml = `
				<div class="env-stack">
					${scopeTagsHtml}
					<span class="ver-text">${item.version}</span>
				</div>
			`;

			// 5. 创建主行
			const mainRow = document.createElement('tr');
			mainRow.className = 'main-row';
			mainRow.innerHTML = `
				<td class="name-col">${nameHtml}</td>
				<td class="brief-col">${item.brief}</td>
				<td>${envAndVersionHtml}</td>
				<td>${linkHtml}</td>
			`;

			// 6. 创建详情行
			const detailsRow = document.createElement('tr');
			detailsRow.className = 'details-row';
			detailsRow.innerHTML = `
				<td colspan="4" class="details-cell">
					<div class="details-content">
						<h4><span class="purpose-tag">开发目的</span></h4>
						<p>${item.purpose}</p>
						<h4><span class="usage-tag">使用方法</span></h4>
						<p>${item.usage}</p>
					</div>
				</td>
			`;

			// 附加到 tbody
			tbody.appendChild(mainRow);
			tbody.appendChild(detailsRow);

			// 绑定手风琴点击事件
			mainRow.addEventListener('click', function() {
				const isActive = this.classList.contains('active');
				
				document.querySelectorAll('.main-row').forEach(r => r.classList.remove('active'));
				document.querySelectorAll('.details-row').forEach(d => d.classList.remove('show'));
				
				if (!isActive) {
					this.classList.add('active');
					detailsRow.classList.add('show');
				}
			});
		});
	});

// --- 图片浮窗逻辑 ---
	const modal = document.getElementById('imageModal');
	const modalImg = document.getElementById('modalImage');
	const closeBtn = document.querySelector('.close-btn');
	const popupTriggers = document.querySelectorAll('.popup-trigger');

	// 点击带有 popup-trigger 的按钮打开弹窗
	popupTriggers.forEach(trigger => {
		trigger.addEventListener('click', function(e) {
			e.preventDefault(); // 阻止 <a> 标签默认的页面跳转/刷新行为
			
			// 读取对应的图片路径并赋值给 img 标签
			const imgSrc = this.getAttribute('data-img');
			modalImg.src = imgSrc;
			
			// 显示弹窗 (使用 flex 以保证居中对齐)
			modal.style.display = 'flex';
		});
	});

	// 点击右上角 X 关闭弹窗
	closeBtn.addEventListener('click', () => {
		modal.style.display = 'none';
		modalImg.src = ''; // 清空 src 避免下次打开闪烁旧图
	});

	// 点击遮罩层(图片外部)也可以关闭弹窗
	window.addEventListener('click', (e) => {
		if (e.target === modal) {
			modal.style.display = 'none';
			modalImg.src = '';
		}
	});
