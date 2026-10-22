/**
 * @//module/ app/working-hours/reportTemplate
 * @//description/ 导出报告的完整 HTML（内联 echarts/fflate + 自校验数据 + 独立渲染脚本）
 * @//exports/ buildSecureReportHtml, buildLibTags
 * @//dependencies/ core/util
 * @//example/ const { buildSecureReportHtml } = await import('./reportTemplate.js')
 *            const html = buildSecureReportHtml({ fileName: '工时-项目A', libTags, data, hash })
 *
 * 模板里的脚本是**独立实现**（自带 escapeHtml / formatDuration / 自行校验 SHA-256），
 * 因为导出的 html 要能脱离扩展单独打开，不能依赖 WolfCommon。
 * 所以改格式函数时，这里的副本也要一起改。
 */

import { escapeHtml } from '../../core/util.js';

/**
 * 拼装内联库标签；任一库缺源码时整体回退 CDN（保持原有行为）
 *
 * @param {string} echartsCode echarts 源码（可为空串）
 * @param {string} fflateCode fflate 源码（可为空串）
 * @returns {string} script 标签串
 * @sideEffects 无（纯函数）
 */
export function buildLibTags(echartsCode, fflateCode) {
	if (echartsCode && fflateCode) {
		// 库源码里的 `</script` 已在调用方转义成 `</script`，避免提前闭合标签
		return `<script>${echartsCode}<\/script>\n\t<script>${fflateCode}<\/script>`;
	}
	return '<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"><\/script>\n\t<script src="https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js"><\/script>';
}

/**
 * 生成完整的导出报告 HTML
 *
 * @param {object} input 参数
 * @param {string} input.fileName 文件名（转义后用于标题）
 * @param {string} input.libTags 库标签（见 buildLibTags）
 * @param {string} input.data Base64 压缩数据
 * @param {string} input.hash Base64 校验和
 * @returns {string} HTML 全文
 * @sideEffects 无（纯函数）
 */
export function buildSecureReportHtml(input) {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>狼黑工具 - ${escapeHtml(input.fileName)}</title>
    ${input.libTags}
    <style>
        /* 整体背景改为暗色，使用 Flex 居中 */
        body { 
            margin: 0; padding: 0; 
            background-color: #0d0d0d; color: #cccccc; 
            font-family: sans-serif; overflow: hidden; user-select: none; 
            display: flex; justify-content: center; align-items: center; 
            height: 100vh; 
        }
        /* 固定尺寸的核心 UI 容器 */
        .export-container { 
            width: 860px; height: 600px; 
            background-color: #1e1e1e; padding: 15px 20px; 
            box-sizing: border-box; display: flex; flex-direction: column; 
            box-shadow: 0 10px 40px rgba(0,0,0,0.8); 
            border-radius: 8px; border: 1px solid #333; 
        }
        .header { text-align: center; margin-bottom: 12px; border-bottom: 1px solid #333; padding-bottom: 8px; flex-shrink: 0; }
        .title { font-size: 16px; color: #fff; font-weight: bold; margin-bottom: 4px; }
        /* 图表区自适应容器剩余高度 */
        #view-chart { display: flex; flex-direction: column; width: 100%; flex: 1; background: #1e1e1e; border: 1px solid #333; border-radius: 6px; overflow: hidden; position: relative; min-height: 0; }
        #heatmap-container { width: 100%; height: 155px; flex-shrink: 0; background-color: #1e1e1e; border-bottom: 1px solid #333; padding-top: 10px; box-sizing: border-box; }
        #chart-container { flex: 1; position: relative; background: #252526; min-height: 0; }
        #chart { width: 100%; height: 100%; }
        .legend-panel { position: absolute; top: 15px; right: 20px; background: rgba(37, 37, 38, 0.94); border: 1px solid #454545; border-radius: 4px; padding: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); z-index: 10; max-height: calc(100% - 20px); width: 220px; box-sizing: border-box; display: flex; flex-direction: column; }
        .legend-title { font-weight: bold; margin-bottom: 6px; font-size: 12px; padding-bottom: 4px; border-bottom: 1px solid #3c3c3c; cursor: pointer; display: flex; justify-content: space-between; align-items: center; color: #ffffff; }
        .legend-list { overflow-y: auto; max-height: 180px; padding-right: 2px; }
        .legend-item { display: flex; align-items: center; margin-bottom: 6px; cursor: pointer; transition: opacity 0.2s; }
        .legend-item.hidden { opacity: 0.25; text-decoration: line-through; }
        .color-block { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 8px; flex-shrink: 0; }
        .legend-detail { margin-top: 8px; padding-top: 6px; border-top: 1px dashed #3c3c3c; font-size: 11px; color: #aaaaaa; word-break: break-all; }
        .legend-panel.collapsed .legend-list, .legend-panel.collapsed .legend-detail { display: none; }
        .legend-panel.collapsed .legend-title { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }
        #error-banner { display: none; background: #902020; color: #fff; padding: 20px; text-align: center; border-radius: 8px; margin-top: 10vh; font-size: 16px; font-weight: bold; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: #424242; border-radius: 3px; }
    </style>
</head>
<body oncontextmenu="return false;">
    <div class="export-container">
        <div class="header"><div class="title" id="page-title">数据处理中...</div></div>
        
        <div id="view-chart">
            <div id="heatmap-container"></div>
            <div id="chart-container">
                <div id="error-banner"></div>
                <div class="legend-panel" id="custom-legend" style="display:none;">
                    <div class="legend-title" id="legend-title-main">统计摘要 <span id="legend-toggle-icon">▼</span></div>
                    <div class="legend-list" id="legend-list"></div>
                    <div class="legend-detail">图例点击控制显示/隐藏，鼠标悬浮查看详情</div>
                </div>
                <div id="chart"></div>
            </div>
        </div>
    </div>
    
    <script>
        (async function() {
            // 轻量防篡改数据：GZIP 压缩后的 Base64 数据 + SHA-256 校验和
            const _D = "${input.data}"; 
            const _H = "${input.hash}";
            
            let hiddenSeries = new Set(); let chartInstance = null; let heatmapInstance = null; let globalCoreData = null; 
            let currentClusterSize = 1; let slotDataMap = new Map(); let sortedUuids = [];

            // 注意：这一份是「导出报告」自带的内联脚本，导出文件必须能脱离本扩展独立运行，
            // 因此不能依赖 WolfCommon，保留独立实现（与本文件其它地方用的公共版本语义一致）。
            const escapeHtml = (u) => (u||'').toString().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
            const formatDuration = (sec) => { if (!sec) return '0:00:00'; const h = Math.floor(sec/3600); const m = Math.floor((sec%3600)/60); const s = Math.floor(sec%60); return h + ':' + m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0'); };
            const formatFullDateTime = (ts) => { const d = new Date(ts); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0'); };

            try {
                const fromB64 = (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0));
                const compressedBuffer = fromB64(_D);

                // 重新计算 SHA-256 校验和，检测数据是否被篡改
                const hashBuffer = await crypto.subtle.digest('SHA-256', compressedBuffer);
                const calcHash = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
                if (calcHash !== _H) throw new Error('integrity check failed');

                const decompressedBuffer = fflate.gunzipSync(compressedBuffer);

                globalCoreData = JSON.parse(new TextDecoder().decode(decompressedBuffer));

                globalCoreData.data.forEach(d => slotDataMap.set(d[0], { w: d[1], r: d[2] }));
                sortedUuids = Object.keys(globalCoreData.projectMeta);
            } catch(e) {
                document.getElementById('error-banner').style.display = 'block';
                document.getElementById('error-banner').innerText = '校验失败：数据异常或文件被篡改！';
                return;
            }
                
            document.getElementById('custom-legend').style.display = 'flex';
            document.getElementById('page-title').innerText = globalCoreData.pageTitle;

            // ================== 图例点击与悬浮逻辑 ==================
            document.getElementById('legend-title-main').addEventListener('click', () => {
                const dom = document.getElementById('custom-legend'); dom.classList.toggle('collapsed');
                document.getElementById('legend-toggle-icon').innerText = dom.classList.contains('collapsed') ? '▶' : '▼';
            });
            const legendListEl = document.getElementById('legend-list');
            
            legendListEl.addEventListener('click', (e) => {
                const item = e.target.closest('.legend-item'); if(!item) return;
                const sName = item.getAttribute('data-name');
                if(hiddenSeries.has(sName)) hiddenSeries.delete(sName); else hiddenSeries.add(sName);
                renderLogic();
            });

            legendListEl.addEventListener('mouseover', (e) => {
                const item = e.target.closest('.legend-item'); if(!item) return;
                const sName = item.getAttribute('data-name');
                const detailEl = document.querySelector('.legend-detail');
                
                if (sName === '工作时间' || sName === '空闲时间') {
                    let totalSec = 0;
                    slotDataMap.forEach(slot => {
                        if (sName === '工作时间') { for(let uid in slot.w) totalSec += slot.w[uid]; }
                        else { for(let uid in slot.r) totalSec += slot.r[uid]; }
                    });
                    detailEl.innerHTML = '<div style="color:#fff;">' + escapeHtml(sName) + '总和：<span style="color:#007acc; font-weight:bold;">' + formatDuration(totalSec) + '</span></div>';
                    return;
                }

                let targetUid = null;
                for(let uid of sortedUuids) { if(globalCoreData.projectMeta[uid].name === sName) { targetUid = uid; break; } }
                if (targetUid) {
                    let pWork = 0, pRest = 0;
                    slotDataMap.forEach(slot => {
                        if(slot.w[targetUid]) pWork += slot.w[targetUid];
                        if(slot.r[targetUid]) pRest += slot.r[targetUid];
                    });
                    detailEl.innerHTML = '<div style="color:#e0e0e0; font-weight:bold; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">'+escapeHtml(sName)+'</div><div style="margin-top:4px;">工作时间: <span style="color:#fff">'+formatDuration(pWork)+'</span><br/>空闲时间: <span style="color:#fff">'+formatDuration(pRest)+'</span></div>';
                }
            });

            legendListEl.addEventListener('mouseout', (e) => {
                const item = e.target.closest('.legend-item'); if(!item) return;
                document.querySelector('.legend-detail').innerHTML = '图例点击控制显示/隐藏，鼠标悬浮查看详情';
            });

            // ================== 热力图渲染 ==================
            if (globalCoreData.heatmapData && globalCoreData.heatmapData.length > 0) {
                heatmapInstance = echarts.init(document.getElementById('heatmap-container'), 'dark');
                
                // 修改: 动态判定热力图时间跨度，不足一年用空方块补齐
                let minDateTs = Infinity; 
                let maxDateTs = -Infinity;
                globalCoreData.heatmapData.forEach(d => {
                    const ts = new Date(d[0].replace(/-/g, '/') + " 00:00:00").getTime();
                    if(ts < minDateTs) minDateTs = ts;
                    if(ts > maxDateTs) maxDateTs = ts;
                });
                
                const ONE_YEAR = 364 * 24 * 3600 * 1000;
                // 若实际数据跨度不足一年，则强制倒推一年的时间作为起点
                if (maxDateTs - minDateTs < ONE_YEAR) {
                    minDateTs = maxDateTs - ONE_YEAR;
                }

                const minD = new Date(minDateTs);
                const maxD = new Date(maxDateTs);
                const formatStr = (d) => d.getFullYear() + '-' + (d.getMonth() + 1).toString().padStart(2, '0') + '-' + d.getDate().toString().padStart(2, '0');
                
                heatmapInstance.setOption({
                    backgroundColor: 'transparent',
                    tooltip: {
                        appendToBody: true, backgroundColor: 'rgba(37, 37, 38, 0.95)', borderColor: '#454545', borderWidth: 1, textStyle: { color: '#cccccc', fontSize: 12 },
                        formatter: function (p) {
                            return '<b style="font-size:13px; color:#fff;">'+p.value[0]+'</b><br/>'+
                                   '<div style="margin-top:6px; font-size:12px;"><span class="color-block" style="background:#39d353;"></span> 工作时间: <span style="float:right; font-weight:bold; margin-left: 15px; color:#fff;">'+formatDuration(p.value[1] || 0)+'</span></div>'+
                                   '<div style="margin-top:4px; font-size:12px;"><span class="color-block" style="background:#b0b0b0;"></span> 空闲时间: <span style="float:right; font-weight:bold; margin-left: 15px; color:#fff;">'+formatDuration(p.value[2] || 0)+'</span></div>';
                        }
                    },
                    visualMap: {
                        type: 'piecewise', show: false, dimension: 1, 
                        pieces: [ { min: 21601, color: '#56D364' }, { min: 14401, max: 21600, color: '#2EA043' }, { min: 7021, max: 14400, color: '#196C2E' }, { min: 1, max: 7200, color: '#033A16' } ],
                        outOfRange: { color: '#151B23' } 
                    },
                    calendar: {
                        top: 25, left: 45, right: 25, bottom: 15, 
                        range: [formatStr(minD), formatStr(maxD)],  // 注入计算后防拉伸的 Range
                        cellSize: ['auto', 14],
                        itemStyle: { color: '#151B23', borderWidth: 4, borderColor: '#1e1e1e', borderRadius: 2 },
                        yearLabel: { show: false }, dayLabel: { color: '#858585', nameMap: 'ZH', fontSize: 10 }, monthLabel: { color: '#858585', nameMap: 'ZH', fontSize: 10 }, splitLine: { show: false }
                    },
                    series: { type: 'heatmap', coordinateSystem: 'calendar', data: globalCoreData.heatmapData, itemStyle: { borderRadius: 2 } }
                });

                heatmapInstance.on('click', function(params) {
                    const targetTs = new Date(params.value[0].replace(/-/g, '/') + " 00:00:00").getTime();
                    const diffBase = targetTs - globalCoreData.baseTs;
                    let sIdx = Math.floor(diffBase / (15 * 60 * 1000));
                    let eIdx = sIdx + 95;
                    if (sIdx < 0) { eIdx -= sIdx; sIdx = 0; }
                    if (eIdx >= globalCoreData.totalSlots) { sIdx -= (eIdx - globalCoreData.totalSlots + 1); eIdx = globalCoreData.totalSlots - 1; }
                    if (sIdx < 0) sIdx = 0;
                    if (chartInstance) chartInstance.dispatchAction({ type: 'dataZoom', startValue: sIdx, endValue: eIdx });
                });
            } else {
                document.getElementById('heatmap-container').style.display = 'none';
            }

            // ================== 时间轴渲染 ==================
            chartInstance = echarts.init(document.getElementById('chart'), 'dark');
            const dummyData = new Float32Array(globalCoreData.totalSlots).fill(900);
            
            chartInstance.setOption({
                animation: false, backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(37,37,38,0.95)',
                    borderColor: '#454545', textStyle: { color: '#ccc' },
                    formatter: function(params) {
                        const ts = Number(params[0].axisValue);
                        const idx = Math.floor((ts - globalCoreData.baseTs) / (15 * 60 * 1000));
                        const blockStartIdx = Math.floor(idx / currentClusterSize) * currentClusterSize;
                        
                        let bWork = {}; let bRest = 0;
                        for(let k=0; k<currentClusterSize && (blockStartIdx+k)<globalCoreData.totalSlots; k++) {
                            const slot = slotDataMap.get(blockStartIdx+k);
                            if(slot) {
                                for(let uid in slot.w) bWork[uid] = (bWork[uid]||0) + slot.w[uid];
                                for(let uid in slot.r) { const pInfo = globalCoreData.projectMeta[uid]; if(!hiddenSeries.has(pInfo.name)) bRest += slot.r[uid]; }
                            }
                        }
                        const startTs = globalCoreData.baseTs + blockStartIdx * 15 * 60 * 1000;
                        const endD = new Date(startTs + currentClusterSize * 15 * 60 * 1000);
                        const title = formatFullDateTime(startTs) + ' ~ ' + endD.getHours().toString().padStart(2, '0') + ':' + endD.getMinutes().toString().padStart(2, '0');
                        
                        let html = '<b style="font-size:12px; color:#fff;">' + title + '</b><br/>'; let hasD = false;
                        if(!hiddenSeries.has('工作时间')) {
                            sortedUuids.forEach(uid => {
                                const pInfo = globalCoreData.projectMeta[uid];
                                if(!hiddenSeries.has(pInfo.name) && bWork[uid]>0) {
                                    html += '<div style="margin:4px 0;font-size:11px;"><span class="color-block" style="background:' + pInfo.color + '"></span>' + escapeHtml(pInfo.name) + ': <span style="float:right;font-weight:bold;margin-left:15px;color:#fff;">' + formatDuration(bWork[uid]) + '</span></div>';
                                    hasD = true;
                                }
                            });
                        }
                        if(bRest > 0 && !hiddenSeries.has('空闲时间')) {
                            html += '<div style="margin:4px 0;font-size:11px;"><span class="color-block" style="background:#b0b0b0"></span>空闲时间: <span style="float:right;font-weight:bold;margin-left:15px;color:#fff;">' + formatDuration(bRest) + '</span></div>'; hasD = true;
                        }
                        return hasD ? html : ('<b style="font-size:12px; color:#fff;">' + title + '</b><br/><span style="color:#666">无活动记录</span>');
                    }
                },
                grid: { left: 60, right: 20, bottom: 45, top: 20 },
                xAxis: { 
                    type: 'category', data: Array.from({length: globalCoreData.totalSlots}, (_, i) => globalCoreData.baseTs + i * 15 * 60 * 1000), 
                    axisLine: { lineStyle:{color:'#333'} }, 
                    axisLabel: { color: '#858585', hideOverlap: true, rotate: 30, formatter: function(value) {
                        const d = new Date(Number(value)); const hh = d.getHours().toString().padStart(2, '0'); const mm = d.getMinutes().toString().padStart(2, '0');
                        if (hh === '00' && mm === '00') return d.getFullYear() + '/' + (d.getMonth()+1) + '/' + d.getDate(); return hh + ':' + mm;
                    }}
                },
                yAxis: { type: 'value', max: 900, axisLabel: { color:'#858585', formatter: v=>formatDuration(v) }, splitLine: { lineStyle:{color:'#252526'} } },
                dataZoom: [{ type: 'inside', start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true, filterMode: 'none', minValueSpan: 23 }],
                series: [
                    { type: 'bar', data: Array.from(dummyData), itemStyle:{color:'rgba(0,0,0,0)'}, barGap:'-100%', large:true, progressive:0 },
                    { type: 'custom', clip:true, renderItem: function(params, api) {
                        const catIdx = api.value(0); const startY = api.value(1); const endY = api.value(2); const pid = api.value(3); const cSize = api.value(4) || 1;
                        const left = api.coord([catIdx, startY]); const right = api.coord([catIdx + cSize - 1, startY]); const bw = api.size([1, 0])[0];
                        const x = left[0] - bw/2; const w = (right[0] + bw/2) - x; const y = api.coord([catIdx, endY])[1]; const h = left[1] - y;
                        if(h<=0) return; let color = '#b0b0b0'; if(pid !== 'REST') color = globalCoreData.projectMeta[pid] ? globalCoreData.projectMeta[pid].color : '#007acc';
                        return { type: 'rect', shape: {x,y,width:w,height:h}, style: api.style({fill: color}) };
                    }, encode: {x:0, y:[1,2]}, data: [] }
                ]
            });
            chartInstance.on('dataZoom', () => renderLogic()); renderLogic();

            function renderLogic() {
                const dz = chartInstance.getOption().dataZoom[0];
                const startIdx = Math.max(0, Math.floor(dz.startValue !== undefined ? dz.startValue : 0));
                const endIdx = Math.min(globalCoreData.totalSlots - 1, Math.ceil(dz.endValue !== undefined ? dz.endValue : globalCoreData.totalSlots - 1));
                
                const diffHours = (endIdx - startIdx) * 15 / 60;
                currentClusterSize = Math.max(1, Math.ceil(diffHours / 48));
                const yMax = currentClusterSize * 900;
                let hourInt = Math.max(2, Math.ceil(diffHours / 24) * 2);

                let lgHtml = '';
                sortedUuids.forEach(uid => {
                    const pInfo = globalCoreData.projectMeta[uid];
                    lgHtml += '<div class="legend-item '+(hiddenSeries.has(pInfo.name)?'hidden':'')+'" data-name="'+escapeHtml(pInfo.name)+'"><span class="color-block" style="background:'+pInfo.color+';"></span><span style="font-size:11px; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">'+escapeHtml(pInfo.name)+'</span></div>';
                });
                lgHtml += '<div class="legend-item '+(hiddenSeries.has('工作时间')?'hidden':'')+'" data-name="工作时间"><span class="color-block" style="background: linear-gradient(135deg, #5470c6, #91cc75, #fac858);"></span><span style="font-size:11px;font-weight:bold;">工作时间</span></div>';
                lgHtml += '<div class="legend-item '+(hiddenSeries.has('空闲时间')?'hidden':'')+'" data-name="空闲时间"><span class="color-block" style="background:#b0b0b0;"></span><span style="font-size:11px;color:#aaa;">空闲时间</span></div>';
                document.getElementById('legend-list').innerHTML = lgHtml;

                const cData = []; let dynYMax = 0;
                for(let i=0; i<globalCoreData.totalSlots; i+=currentClusterSize) {
                    let mWork = {}; let mRest = {};
                    for(let k=0; k<currentClusterSize && (i+k)<globalCoreData.totalSlots; k++) {
                        const slot = slotDataMap.get(i+k);
                        if(slot) {
                            for(let uid in slot.w) mWork[uid] = (mWork[uid]||0) + slot.w[uid];
                            for(let uid in slot.r) mRest[uid] = (mRest[uid]||0) + slot.r[uid];
                        }
                    }

                    let yOffset = 0;
                    if(!hiddenSeries.has('工作时间')) {
                        sortedUuids.forEach(uid => {
                            const pInfo = globalCoreData.projectMeta[uid];
                            if(!hiddenSeries.has(pInfo.name) && mWork[uid]>0) {
                                let val = mWork[uid], nx = yOffset + val; if(nx>yMax) {val=yMax-yOffset; nx=yMax;}
                                cData.push([i, yOffset, nx, uid, currentClusterSize]); yOffset = nx;
                            }
                        });
                    }
                    if(i>=startIdx && i<=endIdx && yOffset > dynYMax) dynYMax = yOffset;

                    if(!hiddenSeries.has('空闲时间') && yOffset < yMax) {
                        let tr = 0;
                        sortedUuids.forEach(uid => { const pInfo = globalCoreData.projectMeta[uid]; if(!hiddenSeries.has(pInfo.name)) tr += (mRest[uid]||0); });
                        if(tr > 0) {
                            let val = tr, nx = yOffset + val; if(nx>yMax) {val=yMax-yOffset; nx=yMax;}
                            cData.push([i, yOffset, nx, 'REST', currentClusterSize]);
                            if(i>=startIdx && i<=endIdx && nx > dynYMax) dynYMax = nx;
                        }
                    }
                }
                dynYMax = Math.min(Math.ceil(dynYMax/60)*60, yMax);
                if(dynYMax<=0) dynYMax = Math.max(60, Math.floor(yMax/3/60)*60);
                
                chartInstance.setOption({
                    xAxis: { axisLabel: { interval: function(idx, val) { const d=new Date(Number(val)); if(d.getMinutes()!==0) return false; if(d.getHours()===0) return true; return d.getHours()%hourInt===0; }}},
                    yAxis: { max: dynYMax }, series: [{}, { data: cData }]
                });
            }
            window.addEventListener('resize', () => {
                if(chartInstance) chartInstance.resize();
                if(heatmapInstance) heatmapInstance.resize();
            });
        })();
    <\/script>
</body>
</html>`;
}
