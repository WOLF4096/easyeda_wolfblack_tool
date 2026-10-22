/**
 * @//module/ app/working-hours/views/weeklyExport
 * @//description/ 周报导出为 PNG：把两张图表的 dataURL 与统计卡片合成到一张画布
 * @//exports/ exportWeeklyReport
 * @//dependencies/ 无
 * @//example/ await exportWeeklyReport({ barView, pieView })
 *
 * 为什么自己拼画布而不是 html2canvas：扩展页面是 blob 文档，html2canvas 拿不到
 * 跨源的样式表；而 echarts 自带 getDataURL，两张图 + 几块色条足够用。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/** 合成画布尺寸 */
const CANVAS_W = 800;
const CANVAS_H = 600;

/** 统计卡片：x, 标题, 取值元素 id */
const CARDS = [
	[30, '本周总投入', 'weekly-total-work', 20],
	[285, '日均工时', 'weekly-avg-work', 20],
	[540, '最专注工程', 'weekly-top-project', 14],
];

/**
 * 取元素文本（缺失时返回空串）
 *
 * @param {string} id 元素 id
 * @returns {string} 文本
 * @sideEffects 无
 */
function textOf(id) {
	const el = document.getElementById(id);
	return el ? el.innerText : '';
}

/**
 * 绘制统计卡片
 *
 * @param {CanvasRenderingContext2D} ctx 画布上下文
 * @returns {void}
 * @sideEffects 绘制
 */
function drawCards(ctx) {
	ctx.fillStyle = '#252526';
	for (const card of CARDS) ctx.fillRect(card[0], 110, 230, 80);

	ctx.fillStyle = '#858585';
	ctx.font = '12px Arial';
	for (const card of CARDS) ctx.fillText(card[1], card[0] + 10, 135);

	ctx.fillStyle = '#007acc';
	for (const card of CARDS) {
		ctx.font = `bold ${card[3]}px Arial`;
		ctx.fillText(textOf(card[2]), card[0] + 10, 170);
	}
}

/**
 * 导出周报 PNG
 *
 * @param {object} views 图表视图
 * @param {object} views.barView 周报柱状图视图（需实现 getDataURL）
 * @param {object} views.pieView 周报饼图视图（需实现 getDataURL）
 * @returns {Promise<void>}
 * @sideEffects 触发下载
 */
export async function exportWeeklyReport(views) {
	const barImg = views.barView.getDataURL({ type: 'png', backgroundColor: '#252526' });
	const pieImg = views.pieView.getDataURL({ type: 'png', backgroundColor: '#252526' });

	const canvas = document.createElement('canvas');
	canvas.width = CANVAS_W;
	canvas.height = CANVAS_H;
	const ctx = canvas.getContext('2d');

	ctx.fillStyle = '#1e1e1e';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.fillStyle = '#ffffff';
	ctx.font = 'bold 24px Arial';
	ctx.fillText('工程开发周报', 30, 50);

	ctx.font = '16px Arial';
	ctx.fillStyle = '#858585';
	ctx.fillText(textOf('weekly-range-text'), 30, 85);

	drawCards(ctx);

	const imgBar = new Image();
	imgBar.src = barImg;
	imgBar.onload = () => {
		ctx.drawImage(imgBar, 30, 210, 450, 360);
		const imgPie = new Image();
		imgPie.src = pieImg;
		imgPie.onload = () => {
			ctx.drawImage(imgPie, 490, 210, 280, 360);
			const a = document.createElement('a');
			a.href = canvas.toDataURL('image/png');
			a.download = `周报_${textOf('weekly-range-text')}.png`;
			a.click();
		};
	};
}
