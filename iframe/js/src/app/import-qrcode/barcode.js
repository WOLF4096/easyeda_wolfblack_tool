/**
 * @//module/ app/import-qrcode/barcode
 * @//description/ 码型清单与 bwip-js 选项构建（纯数据 + 纯函数，不碰 DOM）
 * @//exports/ COMMON_CODES, UNCOMMON_CODES, QR_CODES_WITH_ECL, TWO_D_CODES_NO_TEXT, buildOptions, computeDpi
 * @//dependencies/ 无
 * @//example/ const { buildOptions } = await import('./barcode.js')
 *            buildOptions({ bcid: 'qrcode', text: 'A1', scale: 4, padding: 2, outputType: 'image',
 *              inverted: false, fore: '000000', back: 'ffffff', eclevel: 'M', includeText: false })
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */

/** 常用码型 */
export const COMMON_CODES = [
            { id: 'qrcode', name: 'QR Code', cn: '二维码' },
            { id: 'datamatrix', name: 'Data Matrix', cn: '数据矩阵码' },
            { id: 'microqrcode', name: 'Micro QR Code', cn: '微型二维码' },
            { id: 'azteccode', name: 'Aztec Code', cn: '阿兹特克码' },
            { id: 'code128', name: 'Code 128', cn: '128码' },
            { id: 'code39', name: 'Code 39', cn: '39码' },
            { id: 'pdf417', name: 'PDF417', cn: '便携式数据文件' }
        ];;

/** 不常用码型（渲染前按名称排序） */
export const UNCOMMON_CODES = [
            { id: 'auspost', name: 'AusPost', cn: '澳大利亚邮政码' },
            { id: 'aztecrune', name: 'Aztec Runes', cn: '阿兹特克符文' },
            { id: 'bc412', name: 'BC412', cn: 'BC412码' },
            { id: 'channelcode', name: 'Channel Code', cn: '通道码' },
            { id: 'codablockf', name: 'Codablock F', cn: 'F区段码' },
            { id: 'codabar', name: 'Codabar', cn: '库德巴码' },
            { id: 'code11', name: 'Code 11', cn: '11码' },
            { id: 'code16k', name: 'Code 16K', cn: '16K码' },
            { id: 'code2of5', name: 'Code 2 of 5', cn: '25码' },
            { id: 'code32', name: 'Code 32', cn: '意大利药监码' },
            { id: 'code93', name: 'Code 93', cn: '93码' },
            { id: 'codeone', name: 'Code One', cn: '一号码' },
            { id: 'coop2of5', name: 'COOP 2 of 5', cn: 'COOP25码' },
            { id: 'daft', name: 'DAFT Code', cn: 'DAFT码' },
            { id: 'datalogic2of5', name: 'Datalogic 2 of 5', cn: 'Datalogic 25码' },
            { id: 'dotcode', name: 'DotCode', cn: '点阵码' },
            { id: 'ean13', name: 'EAN-13', cn: '欧洲商品条码13' },
            { id: 'ean14', name: 'EAN-14', cn: '欧洲商品条码14' },
            { id: 'ean8', name: 'EAN-8', cn: '欧洲商品条码8' },
            { id: 'flattermarken', name: 'Flattermarken', cn: 'Flattermarken码' },
            { id: 'gs1-128', name: 'GS1-128', cn: 'GS1-128码' },
            { id: 'gs1datamatrix', name: 'GS1 Data Matrix', cn: 'GS1数据矩阵码' },
            { id: 'gs1qrcode', name: 'GS1 QR Code', cn: 'GS1二维码' },
            { id: 'hanxin', name: 'Han Xin Code', cn: '汉信码' },
            { id: 'hibcazteccode', name: 'HIBC Aztec Code', cn: 'HIBC阿兹特克码' },
            { id: 'hibccodablockf', name: 'HIBC Codablock F', cn: 'HIBC F区段码' },
            { id: 'hibccode128', name: 'HIBC Code 128', cn: 'HIBC 128码' },
            { id: 'hibccode39', name: 'HIBC Code 39', cn: 'HIBC 39码' },
            { id: 'hibcdatamatrix', name: 'HIBC Data Matrix', cn: 'HIBC数据矩阵码' },
            { id: 'hibcmicropdf417', name: 'HIBC MicroPDF417', cn: 'HIBC微型PDF417' },
            { id: 'hibcpdf417', name: 'HIBC PDF417', cn: 'HIBC PDF417' },
            { id: 'hibcqrcode', name: 'HIBC QR Code', cn: 'HIBC二维码' },
            { id: 'iata2of5', name: 'IATA 2 of 5', cn: 'IATA 25码' },
            { id: 'identcode', name: 'Deutsche Post Identcode', cn: '德国邮政识别码' },
            { id: 'industrial2of5', name: 'Industrial 2 of 5', cn: '工业25码' },
            { id: 'interleaved2of5', name: 'Interleaved 2 of 5', cn: '交叉25码' },
            { id: 'isbn', name: 'ISBN', cn: '国际标准书号' },
            { id: 'ismn', name: 'ISMN', cn: '国际标准音乐出版物号' },
            { id: 'issn', name: 'ISSN', cn: '国际标准连续出版物号' },
            { id: 'itf14', name: 'ITF-14', cn: 'ITF-14码' },
            { id: 'japanpost', name: 'Japan Post', cn: '日本邮政码' },
            { id: 'kix', name: 'KIX', cn: '荷兰KIX码' },
            { id: 'leitcode', name: 'Deutsche Post Leitcode', cn: '德国邮政路由码' },
            { id: 'matrix2of5', name: 'Matrix 2 of 5', cn: '矩阵25码' },
            { id: 'maxicode', name: 'MaxiCode', cn: 'MaxiCode码' },
            { id: 'micropdf417', name: 'MicroPDF417', cn: '微型PDF417' },
            { id: 'msi', name: 'MSI', cn: 'MSI普莱西码' },
            { id: 'onecode', name: 'USPS Intelligent Mail', cn: 'USPS智能邮件码' },
            { id: 'pharmacode', name: 'Pharmacode', cn: '制药码' },
            { id: 'pharmacode2', name: 'Two-track Pharmacode', cn: '双轨制药码' },
            { id: 'planet', name: 'PLANET', cn: 'PLANET码' },
            { id: 'plessey', name: 'Plessey', cn: '普莱西码' },
            { id: 'posicode', name: 'PosiCode', cn: 'PosiCode码' },
            { id: 'postnet', name: 'POSTNET', cn: 'POSTNET码' },
            { id: 'pzn', name: 'PZN', cn: '德国药品中心码' },
            { id: 'rationalizedCodabar', name: 'Rationalized Codabar', cn: '合理化库德巴码' },
            { id: 'raw', name: 'Raw', cn: '原始数据码' },
            { id: 'royalmail', name: 'Royal Mail', cn: '英国皇家邮政码' },
            { id: 'sscc18', name: 'SSCC-18', cn: 'SSCC-18码' },
            { id: 'symbol', name: 'Symbol', cn: '符号码' },
            { id: 'telepen', name: 'Telepen', cn: 'Telepen码' },
            { id: 'telepennumeric', name: 'Telepen Numeric', cn: '数字Telepen码' },
            { id: 'ultracode', name: 'Ultracode', cn: '超码' },
            { id: 'upca', name: 'UPC-A', cn: '通用产品代码A' },
            { id: 'upce', name: 'UPC-E', cn: '通用产品代码E' }
        ];;

/** 需要「纠错级别」选项的码型 */
export const QR_CODES_WITH_ECL = ['qrcode', 'microqrcode', 'gs1qrcode', 'hibcqrcode'];

/** 二维矩阵码：不提供「包含文本」选项 */
export const TWO_D_CODES_NO_TEXT = ['datamatrix', 'qrcode', 'microqrcode', 'azteccode', 'pdf417', 'micropdf417', 'maxicode', 'dotcode', 'hanxin', 'gs1datamatrix', 'gs1qrcode', 'hibcazteccode', 'hibcdatamatrix', 'hibcmicropdf417', 'hibcpdf417', 'hibcqrcode', 'codeone', 'aztecrune', 'flattermarken', 'ultracode'];

/**
 * 构建 bwip-js 的选项对象
 *
 * 颜色口径与原实现一致：图片模式用取色器（去掉 `#`）；矢量模式只在勾选「反转」时反色。
 *
 * @param {bcid: string, text: string, scale: number, padding: number, outputType: 'image'|'vector',
 *          inverted: boolean, fore: string, back: string, eclevel: string, includeText: boolean} input 输入
 * @returns <class 'object'> bwip-js options
 * @sideEffects 无（纯函数）
 */
export function buildOptions(input) {
	let barcolor = '000000';
	let bgcolor = 'ffffff';
	if (input.outputType === 'image') {
		barcolor = String(input.fore || '').replace(/^#/, '') || '000000';
		bgcolor = String(input.back || '').replace(/^#/, '') || 'ffffff';
	} else if (input.outputType === 'vector' && input.inverted) {
		barcolor = 'ffffff';
		bgcolor = '000000';
	}

	const options = {
		bcid: input.bcid,
		text: input.text,
		scale: input.scale,
		padding: input.padding,
		textxalign: 'center',
		barcolor: barcolor,
		textcolor: barcolor,
		backgroundcolor: bgcolor,
	};
	if (QR_CODES_WITH_ECL.includes(input.bcid)) options.eclevel = input.eclevel;
	if (!TWO_D_CODES_NO_TEXT.includes(input.bcid)) options.includetext = input.includeText;
	return options;
}

/**
 * 由像素长边与物理尺寸反算 DPI
 *
 * @param {number} maxPixels 长边像素数
 * @param {number} physSize 物理尺寸（当前单位）
 * @param {'mm'|'mil'} unit 单位
 * @returns {number} DPI（取整）；参数非法时为 0
 * @sideEffects 无（纯函数）
 */
export function computeDpi(maxPixels, physSize, unit) {
	const pixels = Number(maxPixels);
	const size = Number(physSize);
	if (!Number.isFinite(pixels) || !Number.isFinite(size) || size <= 0) return 0;
	if (unit === 'mm') return Math.round((pixels * 25.4) / size);
	if (unit === 'mil') return Math.round((pixels * 1000) / size);
	return 0;
}
