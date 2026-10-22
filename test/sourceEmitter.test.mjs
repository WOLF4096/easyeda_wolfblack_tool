/**
 * 原理图源码发射器测试
 *
 * 被测：`src/js/common/sourceEmitter.js`（后端 ESM）
 *      + `iframe/js/src/sch/emitter.js` 里同名的镜像实现（前端 ESM）
 *
 * 注：前端那份原先在 `iframe/js/common.js`（IIFE 门面）里，B7 删门面后搬到 `src/sch/emitter.js`，
 * 断言语义不变 —— 仍然是「两份实现逐字节一致」。
 *
 * 重点不是"格式好看"，而是**两条实现逐字节一致** —— 两套 bundle 无法共享代码，
 * 一旦漂移就会出现"某个版本写进去打不开"这类最难查的问题。
 *
 * 运行：npm test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSchWireLines } from '../src/js/common/sourceEmitter.js';
import { createSchWireLines as createSchWireLinesFrontend } from '../iframe/js/src/sch/emitter.js';

/**
 * 取前端实现
 *
 * @returns {Function} 前端 `createSchWireLines`
 * @sideEffects 无
 */
function loadFrontendEmitter() {
	return createSchWireLinesFrontend;
}

/** 顺序分配器（id 与 ticket 各自递增） */
function counterAllocator() {
	let id = 10;
	let ticket = 100;
	return () => ({ id: id++, ticket: ticket++ });
}

const sample = {
	net: 'GND',
	startX: 10,
	startY: 20,
	endX: 110,
	endY: 20,
	rotation: 0,
};

describe('createSchWireLines - V2 数组格式', () => {
	it('输出 2 行：WIRE + ATTR，坐标与中心点正确', () => {
		const lines = createSchWireLines({ ...sample, isModern: false, nextRow: counterAllocator() });
		assert.equal(lines.length, 2);
		assert.equal(lines[0], '["WIRE","e10",[[10,20,110,20]],"st1",0]');
		assert.equal(lines[1], '["ATTR","e11","e10","NET","GND",0,1,60,20,0,"st1",0]');
	});

	it('样式名可覆盖（autoWire 的 ATTR 用 st2）', () => {
		const lines = createSchWireLines({ ...sample, isModern: false, attrStyle: 'st2', nextRow: counterAllocator() });
		assert.ok(lines[1].includes('"st2"'));
		assert.ok(lines[0].includes('"st1"'), 'WIRE 样式不受 attrStyle 影响');
	});

	it('rotation 透传到 ATTR（竖向导线的网络名旋转 90）', () => {
		const lines = createSchWireLines({ ...sample, rotation: 90, isModern: false, nextRow: counterAllocator() });
		assert.ok(lines[1].includes(',60,20,90,"st1"'), '中心点 (60,20)、rotation=90');
	});
});

describe('createSchWireLines - V3/V4 日志格式', () => {
	it('输出 3 行：WIRE + LINE + ATTR，每行带行尾 |', () => {
		const lines = createSchWireLines({ ...sample, isModern: true, nextRow: counterAllocator() });
		assert.equal(lines.length, 3);
		assert.equal(lines[0], '{"type":"WIRE","ticket":100,"id":"e10"}||{"zIndex":1}|');
		assert.equal(
			lines[1],
			'{"type":"LINE","ticket":101,"id":"e11"}||{"lineGroup":"e10","startX":10,"startY":20,"endX":110,"endY":20}|',
		);
		assert.equal(
			lines[2],
			'{"type":"ATTR","ticket":102,"id":"e12"}||{"parentId":"e10","key":"NET","value":"GND","x":60,"y":20,"rotation":0,"keyVisible":false,"valueVisible":true}|',
		);
		lines.forEach((l) => assert.ok(l.endsWith('|'), '日志行必须以 | 结尾'));
	});

	it('id 与 ticket 由调用方决定（PcbToSch 共用一个计数器）', () => {
		let n = 5;
		const lines = createSchWireLines({
			...sample,
			isModern: true,
			nextRow: () => ({ id: n, ticket: n++ }),
		});
		assert.ok(lines[0].includes('"ticket":5,"id":"e5"'));
		assert.ok(lines[1].includes('"ticket":6,"id":"e6"'));
		assert.ok(lines[2].includes('"ticket":7,"id":"e7"'));
	});
});

describe('前后端两份实现逐字节一致', () => {
	it('V2 / V3 各跑一遍，输出完全相同', () => {
		const frontend = loadFrontendEmitter();
		assert.equal(typeof frontend, 'function', '前端应暴露 WolfCommon.createSchWireLines');

		for (const isModern of [false, true]) {
			for (const rotation of [0, 90]) {
				for (const attrStyle of ['st1', 'st2']) {
					const args = () => ({ ...sample, rotation, isModern, attrStyle, nextRow: counterAllocator() });
					assert.deepEqual(frontend(args()), createSchWireLines(args()), `isModern=${isModern} rotation=${rotation} attrStyle=${attrStyle}`);
				}
			}
		}
	});
});
