/**
 * @//module/ app/api-test/projects
 * @//description/ 「基准测试」的项目清单与 V2 源码样本（10 项：5 类图元 × create/get）
 * @//exports/ RAW_SOURCE, PROJECTS
 * @//dependencies/ 无
 * @//example/ const { PROJECTS } = await import('./projects.js')
 *            PROJECTS.filter((p) => p.act === 'get').length // 5
 *
 * `RAW_SOURCE` 是各类图元的 V2 源码样本（用作默认初始值），下标含义见 calibration/probe 的字段表。
 */
export const RAW_SOURCE = {
        "Via": ["VIA","e1",0,"","",105,110,12,24,0,10,5,0,[]],
        "Pad": ["PAD","e2",0,"",12,"1",50,110,0,["ROUND",12,12],["ELLIPSE",24,24],[],0,0,0,1,0,10,5,0,0,0,null,null,null,null,[]],
        "Line": ["LINE","e3",0,"",1,57,75,87,75,10,0],
        "Arc": ["ARC","e4",0,"",1,45,75,45,55,180,10,0],
        "Polyline": ["POLY","e5",0,"",1,10,[57,54,"L",87,54],0]
    };

    // 2. 测试项目定义 (10项)

export const PROJECTS = [
        { id: 'create_via', type: 'Via', act: 'create', name: '创建过孔', params: ['坐标', '内径', '外径', '阻焊'] },
        { id: 'create_pad', type: 'Pad', act: 'create', name: '创建焊盘', params: ['坐标', '内径', '外径', '阻焊'] },
        { id: 'create_poly', type: 'Polyline', act: 'create', name: '创建折线', params: ['坐标', '线宽'] },
        { id: 'create_line', type: 'Line', act: 'create', name: '创建直线', params: ['坐标', '线宽'] },
        { id: 'create_arc', type: 'Arc', act: 'create', name: '创建弧线', params: ['坐标', '线宽', '圆弧角度'] },
        { id: 'get_via', type: 'Via', act: 'get', name: '获取过孔', params: ['坐标', '内径', '外径', '阻焊'] },
        { id: 'get_pad', type: 'Pad', act: 'get', name: '获取焊盘', params: ['坐标', '内径', '外径', '阻焊'] },
        { id: 'get_poly', type: 'Polyline', act: 'get', name: '获取折线', params: ['坐标', '线宽'] },
        { id: 'get_line', type: 'Line', act: 'get', name: '获取直线', params: ['坐标', '线宽'] },
        { id: 'get_arc', type: 'Arc', act: 'get', name: '获取弧线', params: ['坐标', '线宽', '圆弧角度'] }
    ];
