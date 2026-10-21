// ==========================================
        // [1] 全局状态与基础配置
        // ==========================================
        const { escapeHtml } = window.WolfCommon;

        let CURRENT_UUID = null;
        let CURRENT_NAME = '未命名工程';
        let GLOBAL_TODAY_TS = 0;
        let SELECTED_DETAIL_UUID = null;

        const state = { activeTab: 'total' };
        const hiddenSeries = new Set();
        
        let globalTimeline = [];
        let globalProjectMeta = {};
        let pidColorMap = {};
        let sortedProjectIds = []; 
        let projectStats = {};    
        let tsMap = new Map();

        let myChart = null;
        let manageChart = null;
        let heatmapChart = null;
		let rhythmChart = null;
        let weeklyBarChart = null;
        let weeklyPieChart = null;

        let currentClusterSize = 1;
        let currentYMax = 900;
        let manageClusterSize = 1;
        let manageYMax = 900;

        const chartCache = {
            main: { lastClusterSize: -1, lastYMax: -1, lastHourInterval: -1, lastDynamicYMax: -1 },
            manage: { lastClusterSize: -1, lastYMax: -1, lastHourInterval: -1, lastDynamicYMax: -1 }
        };

        let currentSortField = ''; 
        let currentSortOrder = 'desc'; 
        let currentlySelectedManageUuid = null;

        // ==========================================
        // [2] 基础工具函数
        // ==========================================
        
        // XSS 转义统一走 WolfCommon.escapeHtml（& < > " ' 全转义，与其它页面同一实现）

        function formatDuration(seconds) {
            if (!seconds) return '00:00:00';
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = Math.floor(seconds % 60);
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }

        function formatTimeCN(hoursFloat) {
            if (isNaN(hoursFloat) || hoursFloat === null) return '0时0分';
            const totalMin = Math.round(hoursFloat * 60);
            const h = Math.floor(totalMin / 60);
            const m = totalMin % 60;
            return `${h}时${m}分`;
        }

        function formatFullDateTime(ts) {
            if (!ts || ts === Infinity || ts === -Infinity) return '无';
            const d = new Date(ts);
            return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        }

        // ==========================================
        // [3] 安全导出机制 (异步 Base64 提升性能)
        // ==========================================
        async function packPayload(jsonObject) {
			const jsonStr = JSON.stringify(jsonObject);
			const enc = new TextEncoder();
			const plainBuffer = enc.encode(jsonStr);

			// 将明文 Buffer 进行 GZIP 最高级别压缩（同时起到轻量混淆作用）
			const compressedBuffer = fflate.gzipSync(plainBuffer, { level: 9 });

			// 计算压缩数据的 SHA-256 校验和，用于打开时检测数据是否被篡改。
			// 说明：本机制仅为轻量防篡改（非安全加密），校验和随数据一同下发，
			// 目标是抵御普通用户的随手篡改，而非对抗专业技术手段。
			const hashBuffer = await crypto.subtle.digest('SHA-256', compressedBuffer);

			const toB64 = (buf) => {
				return new Promise((resolve) => {
					const blob = new Blob([buf]);
					const reader = new FileReader();
					reader.onload = () => resolve(reader.result.split(',')[1]);
					reader.readAsDataURL(blob);
				});
			};

			return {
				data: await toB64(compressedBuffer),
				hash: await toB64(new Uint8Array(hashBuffer))
			};
		}

        // 计算整天起止索引
        function getDayAlignedIndices(startTs, endTs) {
            if (startTs === Infinity || endTs === -Infinity) {
                return { startValue: tsMap.has(GLOBAL_TODAY_TS) ? tsMap.get(GLOBAL_TODAY_TS) : 0, endValue: tsMap.has(GLOBAL_TODAY_TS) ? tsMap.get(GLOBAL_TODAY_TS) + 95 : 95 };
            }
            const dStart = new Date(startTs);
            const dayStartTs = new Date(dStart.getFullYear(), dStart.getMonth(), dStart.getDate(), 0, 0, 0).getTime();
            const dEnd = new Date(endTs);
            const dayEndTs = new Date(dEnd.getFullYear(), dEnd.getMonth(), dEnd.getDate() + 1, 0, 0, 0).getTime(); 

            let sIdx = 0; let eIdx = globalTimeline.length - 1;
            if (tsMap.has(dayStartTs)) sIdx = tsMap.get(dayStartTs);
            else if (dayStartTs < globalTimeline[0]?.ts) sIdx = 0;

            if (tsMap.has(dayEndTs)) eIdx = tsMap.get(dayEndTs);
            else if (dayEndTs > globalTimeline[globalTimeline.length - 1]?.ts) eIdx = globalTimeline.length - 1;

            return { startValue: sIdx, endValue: eIdx };
        }

        // ==========================================
        // [4] 数据中心加载逻辑
        // ==========================================
        async function loadAllData() {
            try {
                const info = await eda.dmt_Project.getCurrentProjectInfo();
                if (info) {
                    CURRENT_UUID = info.uuid;
                    CURRENT_NAME = info.friendlyName || '未命名工程';
                }
            } catch (e) { console.log('当前未在有效的工程上下文中'); }

            let allConfigs = {};
            try {
                allConfigs = await eda.sys_Storage.getExtensionAllUserConfigs();
                if (!allConfigs) allConfigs = {};
            } catch (e) { console.error('扩展数据配置读取失败:', e); }

            globalTimeline = [];
            globalProjectMeta = {};
            projectStats = {};
            tsMap = new Map();

            let minDateTs = Infinity;
            let maxDateTs = -Infinity;

            for (const [dateKey, jsonString] of Object.entries(allConfigs)) {
                if (!dateKey.startsWith('STATS_')) continue;
                let dayData;
                try { dayData = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString; } catch(e) { continue; }
                if (!dayData) continue;

                if (dayData.meta) Object.assign(globalProjectMeta, dayData.meta);

                const parts = dateKey.split('_');
                const ts = new Date(`${parts[1]}/${parts[2]}/${parts[3]} 00:00:00`).getTime();
                if (ts < minDateTs) minDateTs = ts;
                if (ts > maxDateTs) maxDateTs = ts;
            }

            const now = new Date();
            const todayTs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
            GLOBAL_TODAY_TS = todayTs;

            if (minDateTs === Infinity) { minDateTs = todayTs; maxDateTs = todayTs; }
            if (todayTs < minDateTs) minDateTs = todayTs;
            if (todayTs > maxDateTs) maxDateTs = todayTs;

            let indexCounter = 0;
            for (let ts = minDateTs; ts <= maxDateTs; ts += 24 * 3600 * 1000) {
                for (let slot = 0; slot < 96; slot++) {
                    const slotTs = ts + slot * 15 * 60 * 1000;
                    globalTimeline.push({ ts: slotTs, work: {}, rest: {} });
                    tsMap.set(slotTs, indexCounter++);
                }
            }

            Object.keys(globalProjectMeta).forEach(pId => {
                projectStats[pId] = { name: globalProjectMeta[pId], uuid: pId, totalWork: 0, totalRest: 0, startTs: Infinity, endTs: -Infinity };
            });

            if (CURRENT_UUID && !projectStats[CURRENT_UUID]) {
                globalProjectMeta[CURRENT_UUID] = CURRENT_NAME;
                projectStats[CURRENT_UUID] = { name: CURRENT_NAME, uuid: CURRENT_UUID, totalWork: 0, totalRest: 0, startTs: Infinity, endTs: -Infinity };
            }

            for (const [dateKey, jsonString] of Object.entries(allConfigs)) {
                if (!dateKey.startsWith('STATS_')) continue;
                let dayData;
                try { dayData = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString; } catch(e) { continue; }
                if (!dayData || !dayData.slots) continue;

                const parts = dateKey.split('_');
                const baseTs = new Date(`${parts[1]}/${parts[2]}/${parts[3]} 00:00:00`).getTime();
                
                for (const [slotStr, projects] of Object.entries(dayData.slots)) {
                    const slotIndex = parseInt(slotStr, 10);
                    const currentSlotTs = baseTs + slotIndex * 15 * 60 * 1000;
                    const tlIndex = tsMap.get(currentSlotTs);
                    
                    if (tlIndex !== undefined) {
                        for (const [pId, timeArray] of Object.entries(projects)) {
                            const wTime = timeArray[0] || 0;
                            const rTime = timeArray[1] || 0;
                            
                            globalTimeline[tlIndex].work[pId] = wTime; 
                            globalTimeline[tlIndex].rest[pId] = rTime;

                            if (projectStats[pId]) {
                                projectStats[pId].totalWork += wTime;
                                projectStats[pId].totalRest += rTime;
                                if (wTime > 0 || rTime > 0) {
                                    if (currentSlotTs < projectStats[pId].startTs) projectStats[pId].startTs = currentSlotTs;
                                    if (currentSlotTs > projectStats[pId].endTs) projectStats[pId].endTs = currentSlotTs;
                                }
                            }
                        }
                    }
                }
            }

            sortedProjectIds = Object.keys(globalProjectMeta).sort((a, b) => projectStats[b].totalWork - projectStats[a].totalWork);
            const colorPalette = [
                '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc',
                '#16a34a', '#d946ef', '#f59e0b', '#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f43f5e', '#6366f1',
                '#84cc16', '#f97316', '#0ea5e9', '#64748b', '#fbbf24', '#22c55e'
            ];
            sortedProjectIds.forEach((pId, idx) => {
                pidColorMap[pId] = colorPalette[idx % colorPalette.length];
            });

            updateHeaderStats();
        }

        function getTodayWorkHours(targetUuid = null) {
            let totalSeconds = 0;
            const startIndex = tsMap.get(GLOBAL_TODAY_TS);
            if (startIndex === undefined) return 0;
            for (let i = startIndex; i < startIndex + 96 && i < globalTimeline.length; i++) {
                const slot = globalTimeline[i];
                for (const pid in slot.work) {
                    if (!targetUuid || pid === targetUuid) { totalSeconds += slot.work[pid]; }
                }
            }
            return totalSeconds / 3600;
        }

        function getProjectTitleString(uuid) {
            if (!uuid || !projectStats[uuid]) return '暂无数据';
            const p = projectStats[uuid];
            return `工程：${escapeHtml(p.name)} 、时间：${formatFullDateTime(p.startTs)} ~ ${formatFullDateTime(p.endTs)} 、工作：${formatDuration(p.totalWork)} 、空闲：${formatDuration(p.totalRest)}`;
        }

        // ==========================================
        // [5] UI 交互与图例控制
        // ==========================================
        function initLegendToggle() {
            document.getElementById('legend-title-main').addEventListener('click', function() {
                const dom = document.getElementById('custom-legend');
                dom.classList.toggle('collapsed');
                document.getElementById('legend-toggle-icon').innerText = dom.classList.contains('collapsed') ? '▶' : '▼';
            });
            document.getElementById('legend-title-manage').addEventListener('click', function() {
                const dom = document.getElementById('manage-custom-legend');
                dom.classList.toggle('collapsed');
                document.getElementById('m-legend-toggle-icon').innerText = dom.classList.contains('collapsed') ? '▶' : '▼';
            });
			document.getElementById('legend-title-rhythm').addEventListener('click', function() {
				const dom = document.getElementById('rhythm-custom-legend');
				dom.classList.toggle('collapsed');
				document.getElementById('r-legend-toggle-icon').innerText = dom.classList.contains('collapsed') ? '▶' : '▼';
			});
        }

        document.body.addEventListener('click', function(e) {
            const item = e.target.closest('.legend-item');
            if (!item) return;
            const seriesName = item.getAttribute('data-name');
            if (hiddenSeries.has(seriesName)) hiddenSeries.delete(seriesName);
            else hiddenSeries.add(seriesName);
            
            chartCache.main = { lastClusterSize: -1, lastYMax: -1, lastHourInterval: -1, lastDynamicYMax: -1 };
            chartCache.manage = { lastClusterSize: -1, lastYMax: -1, lastHourInterval: -1, lastDynamicYMax: -1 };
            
            // 修改全局 Click 监听器的底部分支
			if (state.activeTab === 'manage' && currentlySelectedManageUuid) {
				handleZoomOrPanCore(manageChart, 'manage', currentlySelectedManageUuid, false);
			} else if (state.activeTab === 'rhythm') {
				renderRhythmChart();
			} else {
				handleZoomOrPan();
				if (typeof renderHeatmap === 'function') renderHeatmap();
			}
        });

        document.body.addEventListener('mouseover', function(e) {
            const item = e.target.closest('.legend-item');
            if (!item) return;
            const panel = item.closest('.legend-panel');
            if (!panel) return;
            const detailEl = panel.querySelector('.legend-detail');
            if (!detailEl) return;

            const seriesName = item.getAttribute('data-name');
            
            if (seriesName === '工作时间' || seriesName === '空闲时间') {
                let totalSec = 0;
                if (state.activeTab === 'total') {
                    sortedProjectIds.forEach(uuid => {
                        const p = projectStats[uuid];
                        if (p) totalSec += (seriesName === '工作时间') ? p.totalWork : p.totalRest;
                    });
                } else if (state.activeTab === 'project' && SELECTED_DETAIL_UUID) {
                    const p = projectStats[SELECTED_DETAIL_UUID];
                    if (p) totalSec = (seriesName === '工作时间') ? p.totalWork : p.totalRest;
                } else if (state.activeTab === 'manage' && currentlySelectedManageUuid) {
                    const p = projectStats[currentlySelectedManageUuid];
                    if (p) totalSec = (seriesName === '工作时间') ? p.totalWork : p.totalRest;
                } else if (state.activeTab === 'rhythm') {
					if (rhythmChart && rhythmChart._aggWork && rhythmChart._aggRest) {
						const arr = seriesName === '工作时间' ? rhythmChart._aggWork : rhythmChart._aggRest;
						for (let i = 0; i < arr.length; i++) totalSec += arr[i];
					}
				}
                detailEl.innerHTML = `<div style="color:#fff;">${escapeHtml(seriesName)}总和：<span style="color:var(--vscode-link); font-weight:bold;">${formatDuration(totalSec)}</span></div>`;
                return;
            }

            let targetUuid = null;
            for (const uuid of sortedProjectIds) {
                if (globalProjectMeta[uuid] === seriesName) { targetUuid = uuid; break; }
            }

            if (targetUuid && projectStats[targetUuid]) {
                const p = projectStats[targetUuid];
                detailEl.innerHTML = `
                    <div style="color:#e0e0e0; font-weight:bold; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${escapeHtml(seriesName)}</div>
                    <div style="margin-top:4px;">
                        工作时间: <span style="color:#fff">${formatDuration(p.totalWork)}</span><br/>
                        空闲时间: <span style="color:#fff">${formatDuration(p.totalRest)}</span>
                    </div>`;
            }
        });

        document.body.addEventListener('mouseout', function(e) {
            const item = e.target.closest('.legend-item');
            if (!item) return;
            const panel = item.closest('.legend-panel');
            if (!panel) return;
            const detailEl = panel.querySelector('.legend-detail');
            if (detailEl) detailEl.innerHTML = '把鼠标悬浮在工程上查看详情';
        });

        // ==========================================
        // [6] 图表核心逻辑提取
        // ==========================================
        function bindRightDrag(chartInstance) {
            let isRightDragging = false;
            let rightDragStartX = 0;
            chartInstance.getZr().on('mousedown', function(e) {
                if (e.event.button === 2) { isRightDragging = true; rightDragStartX = e.offsetX; chartInstance.getZr().setCursorStyle('grabbing'); }
            });
            chartInstance.getZr().on('mousemove', function(e) {
                if (isRightDragging) {
                    const startPt = chartInstance.convertFromPixel({seriesIndex: 0}, [rightDragStartX, e.offsetY]);
                    const endPt = chartInstance.convertFromPixel({seriesIndex: 0}, [e.offsetX, e.offsetY]);
                    if (startPt && endPt) {
                        const deltaIndex = startPt[0] - endPt[0];
                        const currentDz = chartInstance.getOption().dataZoom[0];
                        let newStart = currentDz.startValue + deltaIndex;
                        let newEnd = currentDz.endValue + deltaIndex;
                        const maxIdx = globalTimeline.length - 1;
                        if (newStart < 0) { newEnd -= newStart; newStart = 0; }
                        if (newEnd > maxIdx) { newStart -= (newEnd - maxIdx); newEnd = maxIdx; }
                        chartInstance.dispatchAction({ type: 'dataZoom', startValue: newStart, endValue: newEnd });
                        rightDragStartX = e.offsetX;
                    }
                }
            });
            chartInstance.getZr().on('mouseup', function(e) {
                if (e.event.button === 2) { isRightDragging = false; chartInstance.getZr().setCursorStyle('default'); }
            });
        }

        function createChartOption(bounds, isManage, specificUuid) {
            const dummyData = new Float32Array(globalTimeline.length).fill(900);
            return {
                animation: false,
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'axis', axisPointer: { type: 'shadow' },
                    backgroundColor: 'rgba(37, 37, 38, 0.95)', borderColor: '#454545', borderWidth: 1,
                    textStyle: { color: '#cccccc', fontSize: 12 },
                    formatter: function(params) {
                        const ts = Number(params[0].axisValue);
                        const tlIndex = tsMap.get(ts);
                        const currentSize = isManage ? manageClusterSize : currentClusterSize;
                        const blockStartIdx = Math.floor(tlIndex / currentSize) * currentSize;
                        
                        const blockWork = {};
                        let blockRest = 0;
                        for (let k = 0; k < currentSize && (blockStartIdx + k) < globalTimeline.length; k++) {
                            const slot = globalTimeline[blockStartIdx + k];
                            for (const pid in slot.work) {
                                if (specificUuid && pid !== specificUuid) continue;
                                blockWork[pid] = (blockWork[pid] || 0) + slot.work[pid];
                            }
                            for (const pid in slot.rest) {
                                if (specificUuid && pid !== specificUuid) continue;
                                blockRest += slot.rest[pid];
                            }
                        }

                        const startTs = globalTimeline[blockStartIdx].ts;
                        const endTs = startTs + currentSize * 15 * 60 * 1000;
                        const title = `${formatFullDateTime(startTs)} ~ ${new Date(endTs).getHours().toString().padStart(2, '0')}:${new Date(endTs).getMinutes().toString().padStart(2, '0')}`;
                        
                        let tooltipHtml = `<b style="font-size:13px; color:#fff;">${title}</b><br/>`;
                        let hasData = false;

                        if (!hiddenSeries.has('工作时间')) {
                            const idsToIterate = isManage && specificUuid ? [specificUuid] : sortedProjectIds;
                            for (let i = idsToIterate.length - 1; i >= 0; i--) {
                                const pid = idsToIterate[i];
                                if (!isManage && state.activeTab === 'project' && pid !== CURRENT_UUID) continue;
                                const name = globalProjectMeta[pid];
                                if (hiddenSeries.has(name)) continue;
                                const val = blockWork[pid] || 0;
                                if (val > 0) {
                                    tooltipHtml += `<div style="margin: 4px 0; font-size:12px;"><span class="color-block" style="background:${pidColorMap[pid] || 'var(--vscode-link)'};"></span> ${escapeHtml(name)}: <span style="float:right; font-weight:bold; margin-left: 15px; color:#fff;">${formatDuration(val)}</span></div>`;
                                    hasData = true;
                                }
                            }
                        }

                        if (blockRest > 0 && !hiddenSeries.has('空闲时间')) {
                            tooltipHtml += `<div style="margin: 4px 0; font-size:12px;"><span class="color-block" style="background:var(--vscode-chart-rest);"></span> 空闲时间: <span style="float:right; font-weight:bold; margin-left: 15px; color:#fff;">${formatDuration(blockRest)}</span></div>`;
                            hasData = true;
                        }
                        return hasData ? tooltipHtml : `<b style="font-size:13px; color:#fff;">${title}</b><br/><span style="color:#666;">无活动记录</span>`;
                    }
                },
                legend: { show: false },
                grid: { left: 60, right: 20, bottom: 45, top: isManage ? 15 : 20 },
                xAxis: {
                    type: 'category', data: globalTimeline.map(item => item.ts),
                    axisLabel: {
                        hideOverlap: true, rotate: 30, color: '#858585', fontSize: 10,
                        formatter: function(value) {
                            const d = new Date(Number(value));
                            const hh = d.getHours().toString().padStart(2, '0');
                            const mm = d.getMinutes().toString().padStart(2, '0');
                            if (hh === '00' && mm === '00') return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
                            return `${hh}:${mm}`;
                        }
                    },
                    axisLine: { lineStyle: { color: '#333' } }
                },
                yAxis: { 
                    type: 'value', max: 900, 
                    axisLabel: { color: '#858585', fontSize: 10, formatter: value => formatDuration(value) },
                    splitLine: { lineStyle: { color: '#252526' } }
                },
                dataZoom: [{ 
                    type: 'inside', startValue: bounds.startValue, endValue: bounds.endValue, 
                    zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false, filterMode: 'none', minValueSpan: 23
                }],
                series: [
                    { type: 'bar', data: Array.from(dummyData), itemStyle: { color: 'rgba(0,0,0,0)' }, barGap: '-100%', large: true, progressive: 0, progressiveThreshold: 999999 },
                    {
                        type: 'custom', clip: true, progressive: 0, progressiveThreshold: 999999,
                        renderItem: function (params, api) {
                            const categoryIndex = api.value(0);
                            const startY = api.value(1);
                            const endY = api.value(2);
                            const pid = api.value(3);
                            const cSize = api.value(4) || 1;
                            const leftCoord = api.coord([categoryIndex, startY]);
                            const rightCoord = api.coord([categoryIndex + cSize - 1, startY]);
                            const bandWidth = api.size([1, 0])[0];
                            const x = leftCoord[0] - bandWidth / 2;
                            const width = (rightCoord[0] + bandWidth / 2) - x;
                            const y = api.coord([categoryIndex, endY])[1];
                            const height = leftCoord[1] - y;
                            if (height <= 0) return;
                            return { type: 'rect', shape: { x, y, width, height }, style: api.style({ fill: pid === 'REST' ? '#b0b0b0' : (pidColorMap[pid] || '#007acc') }) };
                        },
                        encode: { x: 0, y: [1, 2] }, data: []
                    }
                ]
            };
        }

        function renderHeatmap() {
            if (!heatmapChart) {
                const dom = document.getElementById('heatmap-container');
                if (!dom) return;
                heatmapChart = echarts.init(dom, 'dark');
                heatmapChart.on('click', function(params) {
                    const dateStr = params.value[0];
                    const targetTs = new Date(dateStr.replace(/-/g, '/') + " 00:00:00").getTime(); 
                    const bounds = getDayAlignedIndices(targetTs, targetTs);
                    if (myChart) {
                        myChart.dispatchAction({ type: 'dataZoom', startValue: bounds.startValue, endValue: bounds.endValue });
                        handleZoomOrPan();
                    }
                });
            }

            const filterUuid = state.activeTab === 'project' ? SELECTED_DETAIL_UUID : null;
            const dailyData = new Map();
            const now = new Date();
            const startTs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime() - 365 * 24 * 3600 * 1000;

            for (let i = 0; i < globalTimeline.length; i++) {
                const slot = globalTimeline[i];
                if (slot.ts < startTs) continue;
                
                const d = new Date(slot.ts);
                const dateStr = [d.getFullYear(), (d.getMonth() + 1).toString().padStart(2, '0'), d.getDate().toString().padStart(2, '0')].join('-');
                if (!dailyData.has(dateStr)) dailyData.set(dateStr, { work: 0, rest: 0 });
                const dayStat = dailyData.get(dateStr);
                
                for (const pid in slot.work) {
                    if (filterUuid && pid !== filterUuid) continue;
                    if (!hiddenSeries.has(globalProjectMeta[pid]) && !hiddenSeries.has('工作时间')) dayStat.work += slot.work[pid];
                }
                for (const pid in slot.rest) {
                    if (filterUuid && pid !== filterUuid) continue;
                    if (!hiddenSeries.has(globalProjectMeta[pid]) && !hiddenSeries.has('空闲时间')) dayStat.rest += slot.rest[pid];
                }
            }
            
            const result = [];
            dailyData.forEach((stat, dateStr) => result.push([dateStr, stat.work, stat.rest]));

            const endStr = [now.getFullYear(), (now.getMonth() + 1).toString().padStart(2, '0'), now.getDate().toString().padStart(2, '0')].join('-');
            const startD = new Date(startTs);
            const startStr = [startD.getFullYear(), (startD.getMonth() + 1).toString().padStart(2, '0'), startD.getDate().toString().padStart(2, '0')].join('-');

            heatmapChart.setOption({
                backgroundColor: 'transparent',
                tooltip: {
                    appendToBody: true, backgroundColor: 'rgba(37, 37, 38, 0.95)', borderColor: '#454545', borderWidth: 1, textStyle: { color: '#cccccc', fontSize: 12 },
                    formatter: function (p) {
                        return `<b style="font-size:13px; color:#fff;">${p.value[0]}</b><br/>
                                <div style="margin-top:6px; font-size:12px;"><span class="color-block" style="background:#39d353;"></span> 工作时间: <span style="float:right; font-weight:bold; margin-left: 15px; color:#fff;">${formatDuration(p.value[1] || 0)}</span></div>
                                <div style="margin-top:4px; font-size:12px;"><span class="color-block" style="background:#b0b0b0;"></span> 空闲时间: <span style="float:right; font-weight:bold; margin-left: 15px; color:#fff;">${formatDuration(p.value[2] || 0)}</span></div>`;
                    }
                },
                visualMap: {
                    type: 'piecewise', show: false, dimension: 1, 
                    pieces: [ { min: 21601, color: '#56D364' }, { min: 14401, max: 21600, color: '#2EA043' }, { min: 7021, max: 14400, color: '#196C2E' }, { min: 1, max: 7200, color: '#033A16' } ],
                    outOfRange: { color: '#151B23' } 
                },
                calendar: {
                    top: 25, left: 45, right: 25, bottom: 15, range: [startStr, endStr], cellSize: ['auto', 14],
                    itemStyle: { color: '#151B23', borderWidth: 4, borderColor: '#1e1e1e', borderRadius: 2 },
                    yearLabel: { show: false }, dayLabel: { color: '#858585', nameMap: 'ZH', fontSize: 10 }, monthLabel: { color: '#858585', nameMap: 'ZH', fontSize: 10 }, splitLine: { show: false }
                },
                series: { type: 'heatmap', coordinateSystem: 'calendar', data: result, itemStyle: { borderRadius: 2 } }
            });
        }

        function initChartCore() {
            initLegendToggle();
            myChart = echarts.init(document.getElementById('chart-container'), 'dark');
            const bounds = getDayAlignedIndices(GLOBAL_TODAY_TS, GLOBAL_TODAY_TS);
            
            myChart.setOption(createChartOption(bounds, false));
            bindRightDrag(myChart);

            let zoomTimer = null;
            myChart.on('dataZoom', () => {
                if (zoomTimer) clearTimeout(zoomTimer);
                zoomTimer = setTimeout(handleZoomOrPan, 120); 
            });
            handleZoomOrPan();
            renderHeatmap();
        }

		// ==========================================
		// 节律极坐标分析引擎
		// ==========================================
		let currentRhythmMode = 'time';
		let rhythmFirstInit = true;

		function setRhythmMode(mode) {
			currentRhythmMode = mode;
			document.getElementById('rhythm-mode-time').classList.toggle('active', mode === 'time');
			document.getElementById('rhythm-mode-project').classList.toggle('active', mode === 'project');
			renderRhythmChart();
		}

		function onQuickTimeChange() {
			document.querySelector('input[name="time-submode"][value="quick"]').checked = true;
			renderRhythmChart();
		}

		function onCustomDateChange() {
			document.querySelector('input[name="time-submode"][value="custom"]').checked = true;
			renderRhythmChart();
		}

		// A-Z 排序下拉菜单渲染 (复用已有数据)
		function updateRhythmProjectSelector() {
			const selector = document.getElementById('rhythm-project-select');
			if (!selector) return;
			const currentVal = selector.value;
			selector.innerHTML = '<option value="">-- 请选择工程 --</option>';
			
			Object.keys(globalProjectMeta).sort((a, b) => {
				return (globalProjectMeta[a] || '').localeCompare(globalProjectMeta[b] || '', 'zh');
			}).forEach(uuid => {
				const opt = document.createElement('option');
				opt.value = uuid;
				opt.innerText = globalProjectMeta[uuid];
				if (uuid === currentVal) opt.selected = true;
				selector.appendChild(opt);
			});
		}

		function renderRhythmChart() {
			if (!rhythmChart) {
				const dom = document.getElementById('rhythm-chart-container');
				if (!dom) return;
				rhythmChart = echarts.init(dom, 'dark');
			}

			// 1. 获取用户过滤条件
			let startTs = 0;
			let endTs = Infinity;
			const now = new Date();
			const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();

			if (currentRhythmMode === 'time') {
				const subModeEl = document.querySelector('input[name="time-submode"]:checked');
				const subMode = subModeEl ? subModeEl.value : 'quick';
				if (subMode === 'custom') {
					const customStart = document.getElementById('rhythm-start-date').value;
					const customEnd = document.getElementById('rhythm-end-date').value;
					if (customStart) startTs = new Date(customStart + "T00:00:00").getTime();
					if (customEnd) endTs = new Date(customEnd + "T23:59:59").getTime();
				} else {
					const presetEl = document.querySelector('input[name="rhythm-time-radio"]:checked');
					const preset = presetEl ? presetEl.value : 'all';
					if (preset === 'day') startTs = todayStart;
					else if (preset === 'week') startTs = todayStart - 6 * 24 * 3600 * 1000;
					else if (preset === 'month') startTs = todayStart - 29 * 24 * 3600 * 1000;
					else if (preset === 'year') startTs = todayStart - 364 * 24 * 3600 * 1000;
				}
			}

			const targetUuid = document.getElementById('rhythm-project-select').value;

			// 2. 数据合并压入 96 个时间切片
			const aggregatedWork = new Float64Array(96).fill(0);
			const aggregatedRest = new Float64Array(96).fill(0);

			for (let i = 0; i < globalTimeline.length; i++) {
				const slot = globalTimeline[i];
				if (currentRhythmMode === 'time' && (slot.ts < startTs || slot.ts > endTs)) continue;
				const d = new Date(slot.ts);
				const slotIndex = d.getHours() * 4 + Math.floor(d.getMinutes() / 15);
				let sWork = 0; let sRest = 0;
				
				if (currentRhythmMode === 'project') {
					if (targetUuid) {
						sWork = slot.work[targetUuid] || 0;
						sRest = slot.rest[targetUuid] || 0;
					}
				} else {
					for (const pid in slot.work) sWork += slot.work[pid];
					for (const pid in slot.rest) sRest += slot.rest[pid];
				}
				aggregatedWork[slotIndex] += sWork;
				aggregatedRest[slotIndex] += sRest;
			}

			// 挂载数据给鼠标悬浮汇总使用
			rhythmChart._aggWork = aggregatedWork;
			rhythmChart._aggRest = aggregatedRest;

			// 如果是首次渲染节律图表，默认将“空闲时间”加入隐藏集
			if (rhythmFirstInit) {
				hiddenSeries.add('空闲时间');
				rhythmFirstInit = false;
			}

			let showWork = !hiddenSeries.has('工作时间');
			let showRest = !hiddenSeries.has('空闲时间');

			// 动态绘制 HTML 列表，并根据隐藏状态追加 hidden 样式（出现横线）
			const rListDom = document.getElementById('r-legend-list');
			if (rListDom) {
				rListDom.innerHTML = `
					<div class="legend-item ${!showWork ? 'hidden' : ''}" data-name="工作时间">
						<span class="color-block" style="background: linear-gradient(135deg, #007acc, #3ba272);"></span>
						<span style="font-size:11px; font-weight:bold;">工作时间</span>
					</div>
					<div class="legend-item ${!showRest ? 'hidden' : ''}" data-name="空闲时间">
						<span class="color-block" style="background: var(--vscode-chart-rest);"></span>
						<span style="font-size:11px; color:#aaa;">空闲时间</span>
					</div>
				`;
			}

			// 只根据当前 "未被隐藏" 的图层计算雷达图的最大极坐标值，触发等比放大
			let maxTotal = 0; 
			for(let i=0; i<96; i++){
				let total = 0;
				if (showWork) total += aggregatedWork[i];
				if (showRest) total += aggregatedRest[i];
				if (total > maxTotal) maxTotal = total;
			}
			const axisMax = maxTotal > 0 ? (maxTotal / 0.96) : 100;

			// 3. 构建 96 个类目轴标签
			const categories = [];
			for (let h = 0; h < 24; h++) {
				for (let m = 0; m < 60; m += 15) {
					categories.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
				}
			}

			// 4. 极坐标 ECharts 配置
			const option = {
				backgroundColor: 'transparent',
				tooltip: {
					trigger: 'axis',
					axisPointer: { type: 'cross' },
					backgroundColor: 'rgba(37, 37, 38, 0.95)',
					borderColor: '#454545',
					textStyle: { color: '#cccccc', fontSize: 12 },
					formatter: function(params) {
						const startTime = params[0].name;
						const timeParts = startTime.split(':').map(Number);
						let endH = timeParts[0];
						let endM = timeParts[1] + 15;
						if (endM >= 60) { endM = 0; endH += 1; }
						const endTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
						
						let html = `<b style="font-size:13px; color:#fff;">${startTime} ~ ${endTime}</b><br/>`;
						let hasData = false;
						params.forEach(p => {
							if (p.value > 0) {
								const blockColor = typeof p.color === 'string' ? p.color : (p.color && p.color.colorStops ? p.color.colorStops[0].color : '#007acc');
								html += `<div style="margin: 4px 0; font-size:12px;"><span class="color-block" style="background:${blockColor};"></span> ${p.seriesName}: <span style="float:right; font-weight:bold; margin-left: 15px; color:#fff;">${formatDuration(p.value)}</span></div>`;
								hasData = true;
							}
						});
						return hasData ? html : html + `<span style="color:#666;">无活动记录</span>`;
					}
				},
				angleAxis: {
					type: 'category', data: categories, startAngle: 90, clockwise: true,
					axisLine: { lineStyle: { color: 'var(--vscode-border)' } },
					splitLine: { show: true, lineStyle: { color: 'var(--vscode-border)', type: 'solid' } },
					axisLabel: {
						interval: 3, color: '#CCCCCC', fontSize: 12, textShadowColor: 'rgba(0,0,0,0.8)', textShadowBlur: 3,
						formatter: function (value) { return value.endsWith(':00') ? value.split(':')[0] : ''; }
					},
					axisPointer: { label: { backgroundColor: '#1E1F20', color: '#D0DFDF' } }
				},
				radiusAxis: {
					max: axisMax, 
					axisLabel: { show: false, color: '#999999', fontSize: 10, formatter: v => v === 0 ? '' : formatDuration(v) },
					axisLine: { show: false }, splitLine: { lineStyle: { color: 'var(--vscode-border)', type: 'dashed' } },
					axisPointer: { label: { formatter: params => formatDuration(params.value) } }
				},
				polar: { center: ['50%', '50%'], radius: '76%' },
				series: [
					{
						type: 'bar',
						data: showWork ? Array.from(aggregatedWork) : new Float64Array(96).fill(0),
						coordinateSystem: 'polar',
						name: '工作时间', stack: 'time-stack', barCategoryGap: '0%', 
						itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#007acc' }, { offset: 1, color: '#3ba272' }]) }
					},
					{
						type: 'bar',
						data: showRest ? Array.from(aggregatedRest) : new Float64Array(96).fill(0),
						coordinateSystem: 'polar',
						name: '空闲时间', stack: 'time-stack', barCategoryGap: '0%', 
						itemStyle: { color: '#666666' } 
					}
				]
			};

			rhythmChart.setOption(option);
		}
		
        function initManageChart(selectedUuid, selectedName) {
            if (manageChart) { manageChart.dispose(); }
            const container = document.getElementById('manage-chart-container');
            if (!container) return;
            
            manageChart = echarts.init(container, 'dark');
            const pStat = projectStats[selectedUuid];
            const bounds = getDayAlignedIndices(pStat.startTs, pStat.endTs);
            
            chartCache.manage = { lastClusterSize: -1, lastYMax: -1, lastHourInterval: -1, lastDynamicYMax: -1 };

            manageChart.setOption(createChartOption(bounds, true, selectedUuid));
            bindRightDrag(manageChart);

            let zoomTimer = null;
            manageChart.on('dataZoom', () => {
                if (zoomTimer) clearTimeout(zoomTimer);
                zoomTimer = setTimeout(() => handleZoomOrPanCore(manageChart, 'manage', selectedUuid, false), 120); 
            });
            handleZoomOrPanCore(manageChart, 'manage', selectedUuid, false);
        }

        function buildLegendHtml(startIdx, endIdx, isMainView) {
            const visiblePIds = new Set();
            let hasRestTime = false;
            let targetUuid = isMainView ? (state.activeTab === 'project' ? SELECTED_DETAIL_UUID : null) : currentlySelectedManageUuid;

            for (let i = startIdx; i <= endIdx; i++) {
                for (const pid in globalTimeline[i].rest) {
                    if (targetUuid && pid !== targetUuid) continue;
                    if (globalTimeline[i].rest[pid] > 0) hasRestTime = true;
                }
                for (const pid in globalTimeline[i].work) {
                    if (targetUuid && pid !== targetUuid) continue;
                    if (globalTimeline[i].work[pid] > 0) visiblePIds.add(pid);
                }
            }

            let html = '';
            sortedProjectIds.forEach((pId) => {
                if (targetUuid && pId !== targetUuid) return;
                if (visiblePIds.has(pId)) {
                    const name = globalProjectMeta[pId];
                    const isHidden = hiddenSeries.has(name);
                    html += `<div class="legend-item ${isHidden ? 'hidden' : ''}" data-name="${escapeHtml(name)}">
                        <span class="color-block" style="background:${pidColorMap[pId]};"></span>
                        <span style="font-size:11px; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${escapeHtml(name)}</span>
                    </div>`;
                }
            });

            if (visiblePIds.size > 0) {
                const isWorkHidden = hiddenSeries.has('工作时间');
                html += `<div class="legend-item ${isWorkHidden ? 'hidden' : ''}" data-name="工作时间">
                    <span class="color-block" style="background: linear-gradient(135deg, #5470c6, #91cc75, #fac858);"></span>
                    <span style="font-size:11px; font-weight:bold;">工作时间</span>
                </div>`;
            }
            if (hasRestTime) {
                const isHidden = hiddenSeries.has('空闲时间');
                html += `<div class="legend-item ${isHidden ? 'hidden' : ''}" data-name="空闲时间">
                    <span class="color-block" style="background:var(--vscode-chart-rest);"></span><span style="font-size:11px; color:#aaa;">空闲时间</span>
                </div>`;
            }
            return html || '<div style="color:#666; font-size:11px;">当前区间无记录</div>';
        }

        function updateChartData(chartInstance, currentTab, filterUuid, clusterSize, yMax, hourInterval) {
            const customData = [];
            for (let i = 0; i < globalTimeline.length; i += clusterSize) {
                const mergedWork = {};
                const mergedRest = {};

                for (let k = 0; k < clusterSize && (i + k) < globalTimeline.length; k++) {
                    const slot = globalTimeline[i + k];
                    for (const pid in slot.work) {
                        if ((currentTab === 'project' || currentTab === 'manage') && pid !== filterUuid) continue;
                        mergedWork[pid] = (mergedWork[pid] || 0) + slot.work[pid];
                    }
                    for (const pid in slot.rest) {
                        if ((currentTab === 'project' || currentTab === 'manage') && pid !== filterUuid) continue;
                        mergedRest[pid] = (mergedRest[pid] || 0) + slot.rest[pid];
                    }
                }

                let yOffset = 0;
                if (!hiddenSeries.has('工作时间')) {
                    for (const pid of sortedProjectIds) {
                        if ((currentTab === 'project' || currentTab === 'manage') && pid !== filterUuid) continue;
                        const name = globalProjectMeta[pid];
                        if (hiddenSeries.has(name)) continue;
                        let val = mergedWork[pid] || 0;
                        if (val > 0) {
                            if (yOffset >= yMax) break;
                            let nextOffset = yOffset + val;
                            if (nextOffset > yMax) { val = yMax - yOffset; nextOffset = yMax; } 
                            customData.push([i, yOffset, nextOffset, pid, clusterSize]);
                            yOffset = nextOffset;
                        }
                    }
                }
                
                if (!hiddenSeries.has('空闲时间') && yOffset < yMax) {
                    let totalRestVal = 0;
                    for (const pid in mergedRest) {
                        const name = globalProjectMeta[pid];
                        if (!hiddenSeries.has(name)) totalRestVal += mergedRest[pid]; 
                    }
                    if (totalRestVal > 0) {
                        let val = totalRestVal;
                        let nextOffset = yOffset + val;
                        if (nextOffset > yMax) { val = yMax - yOffset; nextOffset = yMax; } 
                        customData.push([i, yOffset, nextOffset, 'REST', clusterSize]);
                    }
                }
            }
            
            chartInstance.setOption({
                xAxis: { axisLabel: { interval: function(index, value) {
                    const d = new Date(Number(value));
                    if (d.getMinutes() !== 0) return false;
                    if (d.getHours() === 0) return true;
                    return d.getHours() % hourInterval === 0;
                }}},
                series: [ {}, { data: customData } ]
            });
        }

        function handleZoomOrPanCore(chartInstance, currentTab, filterUuid, isMain) {
            if (!chartInstance) return;
            const currentOption = chartInstance.getOption();
            if (!currentOption.dataZoom || !currentOption.dataZoom[0]) return;
            
            const dz = currentOption.dataZoom[0];
            const totalSlots = globalTimeline.length;
            let startIdx = 0, endIdx = totalSlots - 1;

            if (dz.startValue !== undefined) {
                startIdx = Math.max(0, Math.floor(dz.startValue));
                endIdx = Math.min(totalSlots - 1, Math.ceil(dz.endValue));
            }

            const exactDiffHours = (globalTimeline[endIdx].ts - globalTimeline[startIdx].ts) / (3600 * 1000);
            const safeDiffHours = Math.round(exactDiffHours * 10) / 10; 

            let multiplier = Math.max(1, Math.ceil(safeDiffHours / 48));
            let clusterSize = multiplier; 
            let dataYMax = multiplier * 900; 
            let hourInterval = Math.max(2, Math.ceil(safeDiffHours / 24) * 2);

            if (isMain) {
                currentClusterSize = clusterSize;
                currentYMax = dataYMax;
                document.getElementById('legend-list').innerHTML = buildLegendHtml(startIdx, endIdx, true);
            } else {
                manageClusterSize = clusterSize;
                manageYMax = dataYMax;
                document.getElementById('m-legend-list').innerHTML = buildLegendHtml(startIdx, endIdx, false);
            }

            let visibleMax = 0;
            const blockStartIdx = Math.floor(startIdx / clusterSize) * clusterSize;
            for (let i = blockStartIdx; i <= endIdx; i += clusterSize) {
                let blockTotal = 0;
                for (let k = 0; k < clusterSize && (i + k) < globalTimeline.length; k++) {
                    const slot = globalTimeline[i + k];
                    if (!hiddenSeries.has('工作时间')) {
                        for (const pid in slot.work) {
                            if ((currentTab === 'project' || currentTab === 'manage') && pid !== filterUuid) continue;
                            if (!hiddenSeries.has(globalProjectMeta[pid])) blockTotal += slot.work[pid];
                        }
                    }
                    if (!hiddenSeries.has('空闲时间')) {
                        for (const pid in slot.rest) {
                            if ((currentTab === 'project' || currentTab === 'manage') && pid !== filterUuid) continue;
                            if (!hiddenSeries.has(globalProjectMeta[pid])) blockTotal += slot.rest[pid];
                        }
                    }
                }
                if (blockTotal > visibleMax) visibleMax = blockTotal;
            }

            let dynamicYMax = Math.min(visibleMax, dataYMax);
            dynamicYMax = Math.ceil(dynamicYMax / 60) * 60;
            if (dynamicYMax <= 0) dynamicYMax = Math.max(60, Math.floor(dataYMax / 3 / 60) * 60); 
            if (dynamicYMax > dataYMax) dynamicYMax = dataYMax;

            const cacheKey = isMain ? 'main' : 'manage';
            const cache = chartCache[cacheKey];

            if (clusterSize !== cache.lastClusterSize || dataYMax !== cache.lastYMax || hourInterval !== cache.lastHourInterval) {
                updateChartData(chartInstance, currentTab, filterUuid, clusterSize, dataYMax, hourInterval);
                cache.lastClusterSize = clusterSize;
                cache.lastYMax = dataYMax;
                cache.lastHourInterval = hourInterval;
            }

            if (dynamicYMax !== cache.lastDynamicYMax) {
                chartInstance.setOption({ yAxis: { max: dynamicYMax } });
                cache.lastDynamicYMax = dynamicYMax;
            }
        }

        function handleZoomOrPan() {
            const filterUuid = state.activeTab === 'project' ? SELECTED_DETAIL_UUID : null;
            handleZoomOrPanCore(myChart, state.activeTab, filterUuid, true);
        }

        // ==========================================
        // [7] 视图渲染管理与交互
        // ==========================================
        function sortTable(field) {
            if (currentSortField === field) {
                currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
            } else {
                currentSortField = field; currentSortOrder = 'desc';
            }
            renderManageTable();
        }

        function renderManageTable() {
            const tbody = document.getElementById('project-table-body');
            tbody.innerHTML = '';
            
            ['name', 'start', 'end', 'work', 'rest'].forEach(f => {
                const el = document.getElementById(`sort-${f}`);
                if(el) {
                    if (currentSortField === f) { el.innerText = currentSortOrder === 'desc' ? ' ▼' : ' ▲'; el.style.color = 'var(--vscode-link)'; } 
                    else { el.innerText = ''; }
                }
            });

            let list = Object.values(projectStats);
            if (currentSortField) {
                list.sort((a, b) => {
                    let valA, valB;
                    if (currentSortField === 'name') { valA = a.name; valB = b.name; return currentSortOrder === 'desc' ? valB.localeCompare(valA) : valA.localeCompare(valB); } 
                    else if (currentSortField === 'start') { valA = a.startTs; valB = b.startTs; } 
                    else if (currentSortField === 'end') { valA = a.endTs; valB = b.endTs; } 
                    else if (currentSortField === 'work') { valA = a.totalWork; valB = b.totalWork; } 
                    else if (currentSortField === 'rest') { valA = a.totalRest; valB = b.totalRest; }
                    return currentSortOrder === 'desc' ? valB - valA : valA - valB;
                });
            }

            if (!currentlySelectedManageUuid && list.length > 0) currentlySelectedManageUuid = list[0].uuid;

            list.forEach(item => {
                const tr = document.createElement('tr');
                tr.style.cursor = 'pointer';
                if (currentlySelectedManageUuid === item.uuid) tr.style.background = 'var(--vscode-active)';
                
                tr.onclick = () => {
                    currentlySelectedManageUuid = item.uuid;
                    document.querySelectorAll('#project-table-body tr').forEach(r => r.style.background = '');
                    tr.style.background = 'var(--vscode-active)';
                    document.getElementById('manage-chart-title').innerText = getProjectTitleString(item.uuid);
                    initManageChart(item.uuid, item.name);
                };
                
                // 防御式渲染：利用 escapeHtml 防止名字内的标签注入
                tr.innerHTML = `
                    <td title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</td>
                    <td>${formatFullDateTime(item.startTs)}</td>
                    <td>${formatFullDateTime(item.endTs)}</td>
                    <td style="text-align: center;">${formatDuration(item.totalWork)}</td>
                    <td style="text-align: center;">${formatDuration(item.totalRest)}</td>
                    <td style="text-align: center;" onclick="event.stopPropagation();">
                        <button class="small-btn export" onclick="exportProjectChart('${item.uuid}')">导出</button>
                    </td>
                    <td style="text-align: center;" onclick="event.stopPropagation();">
                        <button class="small-btn del" onclick="confirmDeleteProject('${item.uuid}')">删除</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            if (currentlySelectedManageUuid) {
                const activeItem = list.find(i => i.uuid === currentlySelectedManageUuid);
                if (activeItem) {
                    document.getElementById('manage-chart-title').innerText = getProjectTitleString(activeItem.uuid);
                    initManageChart(activeItem.uuid, activeItem.name);
                }
            } else {
                if (manageChart) { manageChart.dispose(); manageChart = null; }
                document.getElementById('manage-chart-title').innerText = '当前暂无工程数据';
            }
        }

		// 提取热力图聚合数据辅助函数 (供导出模块使用)
        function getHeatmapDataForExport(filterUuid = null) {
            const dailyData = new Map();
            for (let i = 0; i < globalTimeline.length; i++) {
                const slot = globalTimeline[i];
                const d = new Date(slot.ts);
                const dateStr = [d.getFullYear(), (d.getMonth() + 1).toString().padStart(2, '0'), d.getDate().toString().padStart(2, '0')].join('-');
                
                let sWork = 0; let sRest = 0;
                for (const pid in slot.work) {
                    if (filterUuid && pid !== filterUuid) continue;
                    sWork += slot.work[pid];
                }
                for (const pid in slot.rest) {
                    if (filterUuid && pid !== filterUuid) continue;
                    sRest += slot.rest[pid];
                }
                if (sWork > 0 || sRest > 0) {
                    if (!dailyData.has(dateStr)) dailyData.set(dateStr, { work: 0, rest: 0 });
                    const dayStat = dailyData.get(dateStr);
                    dayStat.work += sWork;
                    dayStat.rest += sRest;
                }
            }
            const result = [];
            dailyData.forEach((stat, dateStr) => result.push([dateStr, stat.work, stat.rest]));
            return result;
        }

        // ==========================================
        // [8] 安全导出模块
        // ==========================================
        async function exportProjectChart(uuid) {
            const pStat = projectStats[uuid];
            if (!pStat || pStat.startTs === Infinity) {
                if(window.eda && eda.sys_Message) eda.sys_Message.showToastMessage('当前工程暂无可导出数据', 'warning');
                return;
            }

            const bounds = getDayAlignedIndices(pStat.startTs, pStat.endTs);
            const baseTs = globalTimeline[bounds.startValue].ts;
            const totalSlots = bounds.endValue - bounds.startValue + 1;
            
            const timeData = [];
            for (let i = bounds.startValue; i <= bounds.endValue; i++) {
                const w = globalTimeline[i].work[uuid] || 0;
                const r = globalTimeline[i].rest[uuid] || 0;
                if (w > 0 || r > 0) { timeData.push([i - bounds.startValue, { [uuid]: w }, { [uuid]: r }]); }
            }

            const payloadObj = {
                pageTitle: getProjectTitleString(uuid),
                baseTs: baseTs, totalSlots: totalSlots,
                projectMeta: { [uuid]: { name: pStat.name, color: pidColorMap[uuid] || '#007acc' } },
                data: timeData,
                heatmapData: getHeatmapDataForExport(uuid) // <-- 注入热力图数据
            };

            await triggerSecureExport(payloadObj, `工程耗时图_${pStat.name.replace(/[\/\\:\*\?"<>\|]/g, '_')}`);
        }

        async function exportTotalChart() {
            if (globalTimeline.length === 0) {
                if(window.eda && eda.sys_Message) eda.sys_Message.showToastMessage('当前暂无可导出数据', 'warning');
                return;
            }

            let minIdx = -1, maxIdx = -1;
            for(let i=0; i<globalTimeline.length; i++) {
                if(Object.keys(globalTimeline[i].work).length > 0 || Object.keys(globalTimeline[i].rest).length > 0) {
                    if(minIdx === -1) minIdx = i; maxIdx = i;
                }
            }
            if(minIdx === -1) {
                if(window.eda && eda.sys_Message) eda.sys_Message.showToastMessage('当前记录全为空，无法导出', 'warning'); return;
            }

            const baseTs = globalTimeline[minIdx].ts;
            const endTs = globalTimeline[maxIdx].ts + 15 * 60 * 1000;
            const totalSlots = maxIdx - minIdx + 1;
            
            const timeData = [];
            let rangeWork = 0, rangeRest = 0;
            for(let i=minIdx; i<=maxIdx; i++) {
                let wObj = {}, rObj = {}; let hasData = false;
                for(let uid in globalTimeline[i].work) { wObj[uid] = globalTimeline[i].work[uid]; hasData = true; rangeWork += wObj[uid]; }
                for(let uid in globalTimeline[i].rest) { rObj[uid] = globalTimeline[i].rest[uid]; hasData = true; rangeRest += rObj[uid]; }
                if(hasData) timeData.push([ i - minIdx, wObj, rObj ]);
            }

            let pMeta = {};
            sortedProjectIds.forEach(uid => { pMeta[uid] = { name: globalProjectMeta[uid], color: pidColorMap[uid] }; });

            const payloadObj = {
                pageTitle: '全部工程时间总趋势 、时间：' + formatFullDateTime(baseTs) + ' ~ ' + formatFullDateTime(endTs) + ' 、工作：' + formatDuration(rangeWork) + ' 、空闲：' + formatDuration(rangeRest),
                baseTs: baseTs, totalSlots: totalSlots,
                projectMeta: pMeta, data: timeData,
                heatmapData: getHeatmapDataForExport(null) // <-- 注入全局热力图数据
            };

            await triggerSecureExport(payloadObj, `总趋势耗时图`);
        }

        function exportAllDataJson() {
            if (globalTimeline.length === 0) {
                if(window.eda && eda.sys_Message) eda.sys_Message.showToastMessage('当前暂无可导出数据', 'warning');
                return;
            }
            try {
                const filteredTimeline = globalTimeline.filter(slot => Object.keys(slot.work).length > 0 || Object.keys(slot.rest).length > 0);
                if (filteredTimeline.length === 0) {
                    if(window.eda && eda.sys_Message) eda.sys_Message.showToastMessage('所有时间片均为空，无有效数据导出', 'warning'); return;
                }
                const payload = { exportTime: new Date().toLocaleString(), projectMeta: globalProjectMeta, stats: projectStats, timeline: filteredTimeline };
                
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url;
                const d = new Date();
                a.download = `全部工程耗时数据备份_${d.getFullYear()}${(d.getMonth()+1).toString().padStart(2,'0')}${d.getDate().toString().padStart(2,'0')}.json`;
                
                document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                if(window.eda && eda.sys_Message) eda.sys_Message.showToastMessage('全部数据 JSON 导出成功', 'success');
            } catch (e) {
                console.error(e);
                if(window.eda && eda.sys_Message) eda.sys_Message.showToastMessage('导出失败: ' + e.message, 'error');
            }
        }

        /**
         * 读取扩展内置的第三方库源码，用于内联进导出文件
         *
         * 导出报告必须能脱离网络打开（经常是发给别人看），原先从 jsdelivr 加载
         * echarts/fflate，离线时图表全空。这里优先内联本地文件，取不到才回退 CDN。
         */
        async function loadLibForInline(fileName) {
            try {
                const res = await fetch(`/iframe/js/${fileName}`);
                if (!res.ok) return '';
                const code = await res.text();
                // 库源码里若出现 </script 会提前闭合标签，转义后再内联
                return code.replace(/<\/script/gi, '<\\/script');
            } catch (e) {
                return '';
            }
        }

        async function triggerSecureExport(payloadObj, fileNameBase) {
            let securePack;
            try { securePack = await packPayload(payloadObj); } 
            catch (e) {
                if(window.eda && eda.sys_Message) eda.sys_Message.showToastMessage('数据打包失败', 'error'); return;
            }

            // 内联本地库；任一取不到就整体回退 CDN（保持原有行为）
            const [echartsCode, fflateCode] = await Promise.all([loadLibForInline('echarts.min.js'), loadLibForInline('fflate.js')]);
            const libTags = echartsCode && fflateCode
                ? `<script>${echartsCode}<\/script>\n\t<script>${fflateCode}<\/script>`
                : '<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"><\/script>\n\t<script src="https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js"><\/script>';

            const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>狼黑工具 - ${escapeHtml(fileNameBase)}</title>
    ${libTags}
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
            const _D = "${securePack.data}"; 
            const _H = "${securePack.hash}";
            
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

            const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `${fileNameBase}.html`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
            if(window.eda && eda.sys_Message) eda.sys_Message.showToastMessage('图表导出成功', 'success');
        }
		
        // ==========================================
        // [9] 危险擦除操作 (精准清洗)
        // ==========================================
        function clearAllDataConfirm() {
            if(!window.eda || !eda.sys_Dialog) return;
            eda.sys_Dialog.showConfirmationMessage(
                '警告：此操作不可逆，将彻底删除所有本地记录的工程耗时数据。\n确认要清除全部数据吗？', '确认强制清除', '确认清除', '取消',
                async (mainButtonClicked) => {
                    if (mainButtonClicked) {
                        const mask = document.getElementById('loading-mask');
                        mask.style.display = 'flex'; mask.innerText = '正在强制擦除时间切片记录...';
                        try {
                            let allConfigs = await eda.sys_Storage.getExtensionAllUserConfigs();
                            for (const key in allConfigs) {
                                if (key.startsWith('STATS_')) await eda.sys_Storage.setExtensionUserConfig(key, "");
                            }
                            if(window.eda && eda.sys_Message) eda.sys_Message.showToastMessage('全部记录已被安全擦除', 'success');
                            await loadAllData(); SELECTED_DETAIL_UUID = null; currentlySelectedManageUuid = null; switchTab('total');
                        } catch (e) {
                            if(window.eda && eda.sys_Message) eda.sys_Message.showToastMessage('清除产生未知错误: ' + e.message, 'error');
                        }
                        mask.style.display = 'none';
                    }
                }
            );
        }

        function confirmDeleteProject(uuid, name) {
            // 名字不通过 onclick 传入（避免引号破坏 JS 字符串），统一从元数据里取
            name = name || globalProjectMeta[uuid] || '未命名工程';
            eda.sys_Dialog.showConfirmationMessage(
                `确认彻底删除 “${name}” 的全部时间记录？\n(此操作无法恢复)`, '确认清除时间片记录', '确认删除', '取消',
                async (mainButtonClicked) => { if (mainButtonClicked) await deleteProjectData(uuid); }
            );
        }

        async function deleteProjectData(uuid) {
            const mask = document.getElementById('loading-mask');
            mask.style.display = 'flex'; mask.innerText = '正在执行本地存储清洗...';
            try {
                let allConfigs = await eda.sys_Storage.getExtensionAllUserConfigs();
                if (!allConfigs) allConfigs = {};

                for (const dateKey in allConfigs) {
                    if (!dateKey.startsWith('STATS_')) continue;
                    let dayData;
                    try { dayData = typeof allConfigs[dateKey] === 'string' ? JSON.parse(allConfigs[dateKey]) : allConfigs[dateKey]; } catch(e) { continue; }
                    if (!dayData) continue;
                    let isModified = false;
                    if (dayData.slots) {
                        for (const slotId in dayData.slots) {
                            if (dayData.slots[slotId] && dayData.slots[slotId][uuid]) {
                                delete dayData.slots[slotId][uuid]; isModified = true;
                                if (Object.keys(dayData.slots[slotId]).length === 0) delete dayData.slots[slotId];
                            }
                        }
                    }
                    if (dayData.meta && dayData.meta[uuid]) { delete dayData.meta[uuid]; isModified = true; }
                    if (isModified) await eda.sys_Storage.setExtensionUserConfig(dateKey, JSON.stringify(dayData));
                }

                eda.sys_Message.showToastMessage('底层驱动数据同步擦除成功', 'success');
                await loadAllData();
                
                if (currentlySelectedManageUuid === uuid) {
                    currentlySelectedManageUuid = null;
                    if (manageChart) { manageChart.dispose(); manageChart = null; }
                    document.getElementById('manage-chart-title').innerText = '请点击上方工程行查看对应工程时间轴';
                    document.getElementById('manage-custom-legend').classList.add('collapsed');
                }
                
                if (SELECTED_DETAIL_UUID === uuid) {
                    SELECTED_DETAIL_UUID = null;
                    if (state.activeTab === 'project') { updateProjectSelector(); onProjectSelectorChange(); }
                }

                renderManageTable();
                if (manageChart && currentlySelectedManageUuid) initManageChart(currentlySelectedManageUuid, globalProjectMeta[currentlySelectedManageUuid] || '');
                mask.style.display = 'none';
            } catch (e) {
                mask.innerText = '擦除产生未知错误: ' + e.message; mask.onclick = () => (mask.style.display = 'none');
            }
        }

        // ==========================================
        // [10] 小工具模块 (消息提醒管理)
        // ==========================================
        const ReminderApp = {
            KEY: 'USER_CONFIG_REMINDERS',
            data: {
                durationRules: [],
                intervalRules: [],
                welcomeEnabled: true,
                idleEnabled: true,
                welcomeText: "距离上次打开EDA经过了<time>",
                idleText: "距离上次离开经过了<time>",
                idleThresholdMin: 10,
                lastHb: 0
            },

            init: async function () {
                try {
                    const str = await eda.sys_Storage.getExtensionUserConfig(this.KEY);
                    if (str) {
                        const parsed = JSON.parse(str);
                        if (Array.isArray(parsed)) {
                            this.data.durationRules = parsed;
                        } else {
                            this.data = Object.assign(this.data, parsed);
                        }
                    }
                } catch (e) {}

                document.getElementById('welcome-enabled').checked = !!this.data.welcomeEnabled;
                document.getElementById('idle-enabled').checked = !!this.data.idleEnabled;
                document.getElementById('welcome-text-input').value = this.data.welcomeText || "";
                document.getElementById('idle-text-input').value = this.data.idleText || "";
                document.getElementById('idle-min-input').value = this.data.idleThresholdMin || 10;

                this.render();
            },

            formatMin: function(m) {
                const h = Math.floor(m / 60);
                const min = m % 60;
                if (h > 0) return `${h}:${min.toString().padStart(2, '0')}:00`;
                return `${min.toString().padStart(2, '0')}:00`;
            },

            parseMin: function(str) {
                if (!str) return 0;
                str = str.toString().trim();
                if (/^\d+$/.test(str)) return parseInt(str);
                const p = str.split(':').filter(x => x !== "").map(Number);
                if (p.length >= 3) return (isNaN(p[0])?0:p[0])*60 + (isNaN(p[1])?0:p[1]);
                if (p.length === 2) return (isNaN(p[0])?0:p[0]);
                return isNaN(parseInt(str)) ? 0 : parseInt(str);
            },

            render: function () {
                this.renderList('duration', 'list-duration');
                this.renderList('interval', 'list-interval');
            },

            renderList: function(type, containerId) {
                const container = document.getElementById(containerId);
                container.innerHTML = '';
                const rules = type === 'duration' ? this.data.durationRules : this.data.intervalRules;

                if (rules.length === 0) {
                    container.innerHTML = '<div style="text-align:center; color:#666; padding:10px; font-size:11px;">暂无规则</div>';
                    return;
                }

                rules.forEach((item, idx) => {
                    const div = document.createElement('div');
                    div.className = 'reminder-item';
                    div.style.padding = '4px 8px';
                    const color = type === 'duration' ? 'var(--vscode-link)' : 'var(--vscode-success-fill)';
                    div.innerHTML = `
                        <input class="list-input" style="width:55px; color:${color}; font-weight:bold; font-family:Consolas;"
                               value="${this.formatMin(item.m)}" onchange="ReminderApp.updateRule('${type}', ${idx}, 'm', this.value)">
                        <input class="list-input" style="flex:1; margin:0 5px;" value="${escapeHtml(item.msg)}"
                               onchange="ReminderApp.updateRule('${type}', ${idx}, 'msg', this.value)">
                        <div class="stepper" style="height:22px; margin-right:5px;" title="提醒次数：触发时显示几条提醒">
                            <button onclick="ReminderApp.stepRule('${type}', ${idx}, -1)">-</button>
                            <input type="number" value="${item.count || 1}" readonly>
                            <button onclick="ReminderApp.stepRule('${type}', ${idx}, 1)">+</button>
                        </div>
                        <button class="small-btn del" style="padding:0 4px;" onclick="ReminderApp.remove('${type}', ${idx})">×</button>`;
                    container.appendChild(div);
                });
            },

            add: async function (type) {
                const prefix = type === 'duration' ? 'dur' : 'int';
                const mVal = document.getElementById(`add-${prefix}-m`).value;
                const msg = document.getElementById(`add-${prefix}-msg`).value.trim();
                const count = parseInt(document.getElementById(`add-${prefix}-c`).value) || 1;

                const m = this.parseMin(mVal);
                if (!m || m <= 0) { eda.sys_Message.showToastMessage('时间无效', 'error'); return; }
                if (!msg) { eda.sys_Message.showToastMessage('内容为空', 'error'); return; }

                const rules = type === 'duration' ? this.data.durationRules : this.data.intervalRules;
                rules.push({ m, msg, count });
                rules.sort((a, b) => a.m - b.m);

                document.getElementById(`add-${prefix}-m`).value = '';
                document.getElementById(`add-${prefix}-msg`).value = '';
                document.getElementById(`add-${prefix}-c`).value = '1';
                await this.save();
            },

            updateRule: async function(type, idx, field, val) {
                const rules = type === 'duration' ? this.data.durationRules : this.data.intervalRules;
                if (!rules[idx]) return;
                if (field === 'm') rules[idx].m = this.parseMin(val);
                else if (field === 'msg') rules[idx].msg = val;
                await this.save();
            },

            stepRule: async function(type, idx, delta) {
                const rules = type === 'duration' ? this.data.durationRules : this.data.intervalRules;
                if (!rules[idx]) return;
                rules[idx].count = Math.max(1, (rules[idx].count || 1) + delta);
                await this.save();
            },

            remove: function (type, index) {
                eda.sys_Dialog.showConfirmationMessage('确定要删除这条提醒规则吗？', '确认删除', '确认', '取消', async (confirmed) => {
                    if (confirmed) {
                        const rules = type === 'duration' ? this.data.durationRules : this.data.intervalRules;
                        rules.splice(index, 1);
                        await this.save();
                    }
                });
            },

            save: async function () {
                this.data.welcomeEnabled = document.getElementById('welcome-enabled').checked;
                this.data.idleEnabled = document.getElementById('idle-enabled').checked;
                this.data.welcomeText = document.getElementById('welcome-text-input').value;
                this.data.idleText = document.getElementById('idle-text-input').value;
                this.data.idleThresholdMin = parseInt(document.getElementById('idle-min-input').value) || 10;

                try {
                    await eda.sys_Storage.setExtensionUserConfig(this.KEY, JSON.stringify(this.data));
                    this.render();
                    eda.sys_Message.showToastMessage('自动保存成功', 'success');
                } catch (e) {
                    eda.sys_Message.showToastMessage('保存失败:' + e.message, 'error');
                }
            },

            toggleDebug: async function() {
                const key = 'WORKING_HOURS_DEBUG_ENABLED';
                const raw = await eda.sys_Storage.getExtensionUserConfig(key);
                const isDebug = raw === 'true';
                await eda.sys_Storage.setExtensionUserConfig(key, (!isDebug).toString());
                eda.sys_Message.showToastMessage(`Debug模式已${!isDebug ? '开启' : '关闭'}，请查看控制台日志`, 'info');
            }
        };

        // ==========================================
        // [11] 页面路由与生命周期管理
        // ==========================================
        function updateHeaderStats() {
            const titleEl = document.getElementById('page-title'); const scopeEl = document.getElementById('headerScope'); const valEl = document.getElementById('headerVal');
            
            if (state.activeTab === 'total') { titleEl.innerText = '全部工程时间总趋势'; scopeEl.innerText = '今日总计已工作:'; valEl.innerText = formatTimeCN(getTodayWorkHours(null)); } 
            else if (state.activeTab === 'project') { titleEl.innerText = SELECTED_DETAIL_UUID ? getProjectTitleString(SELECTED_DETAIL_UUID) : '请选择工程'; scopeEl.innerText = ''; valEl.innerText = ''; } 
            else if (state.activeTab === 'manage') { titleEl.innerText = '工程耗时管理'; scopeEl.innerText = '本地记录工程项目总数:'; valEl.innerText = `${Object.keys(projectStats).length} 个`; } 
            else if (state.activeTab === 'reminder') { titleEl.innerText = '时限触发器规则设定'; scopeEl.innerText = '今日总计已工作:'; valEl.innerText = formatTimeCN(getTodayWorkHours(null)); } 
            else if (state.activeTab === 'more') { titleEl.innerText = '更多选项'; scopeEl.innerText = ''; valEl.innerText = ''; }
			else if (state.activeTab === 'rhythm') { titleEl.innerText = '节律分析 (活动钟)'; scopeEl.innerText = ''; valEl.innerText = ''; }
            else if (state.activeTab === 'weekly') { titleEl.innerText = '工程开发周报'; scopeEl.innerText = ''; valEl.innerText = ''; }
        }

        async function switchTab(tab) {
            state.activeTab = tab;
            if (tab === 'project') {
                try {
                    const info = await eda.dmt_Project.getCurrentProjectInfo();
                    if (info && info.uuid) {
                        CURRENT_UUID = info.uuid; CURRENT_NAME = info.friendlyName || '未命名工程';
                        if (!globalProjectMeta[CURRENT_UUID]) {
                            globalProjectMeta[CURRENT_UUID] = CURRENT_NAME;
                            projectStats[CURRENT_UUID] = { name: CURRENT_NAME, uuid: CURRENT_UUID, totalWork: 0, totalRest: 0, startTs: Infinity, endTs: -Infinity };
                        }
                    }
                } catch (e) {}
                if (!SELECTED_DETAIL_UUID) SELECTED_DETAIL_UUID = CURRENT_UUID;
                updateProjectSelector();
            }

            document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
            if(window.event && window.event.currentTarget) window.event.currentTarget.classList.add('active');
            else {
                const items = document.querySelectorAll('.sidebar-item');
                // 修改后（把 rhythm 换到 reminder 前面）：
				const idx = ['total', 'project', 'weekly', 'manage', 'rhythm', 'reminder', 'more'].indexOf(tab);
                if(items[idx]) items[idx].classList.add('active');
            }
            
            document.querySelectorAll('.view-container').forEach(el => el.classList.add('hidden'));
			if (tab === 'rhythm') {
				document.getElementById('view-rhythm').classList.remove('hidden');
				updateRhythmProjectSelector();
				// 首次进入强制渲染一次
				setTimeout(() => renderRhythmChart(), 50); 
				if (rhythmChart) rhythmChart.resize();
			}
            document.getElementById('project-empty-tip').classList.add('hidden');
            
            const selector = document.getElementById('project-selector');
            if (selector) selector.style.display = (tab === 'project') ? 'inline-block' : 'none';
            updateHeaderStats();

            if (tab === 'total' || tab === 'project') {
                if (tab === 'project' && !SELECTED_DETAIL_UUID) {
                    const emptyTip = document.getElementById('project-empty-tip');
                    emptyTip.innerHTML = `<div style="margin-bottom:8px; font-weight: bold; color:#e0e0e0;">当前未打开工程</div><div style="font-size:11px; color:#666;">当前视图不包含任何数据。请在顶部下拉菜单中选择一个项目。</div>`;
                    emptyTip.classList.remove('hidden');
                } else {
                    document.getElementById('view-chart').classList.remove('hidden');
                    chartCache.main = { lastClusterSize: -1, lastYMax: -1, lastHourInterval: -1, lastDynamicYMax: -1 };
                    
                    if (myChart) {
                        myChart.resize();
                        let bounds;
                        if (tab === 'project' && SELECTED_DETAIL_UUID && projectStats[SELECTED_DETAIL_UUID] && projectStats[SELECTED_DETAIL_UUID].startTs !== Infinity) {
                            bounds = getDayAlignedIndices(projectStats[SELECTED_DETAIL_UUID].startTs, projectStats[SELECTED_DETAIL_UUID].endTs);
                        } else bounds = getDayAlignedIndices(GLOBAL_TODAY_TS, GLOBAL_TODAY_TS);
                        myChart.dispatchAction({ type: 'dataZoom', startValue: bounds.startValue, endValue: bounds.endValue });
                        handleZoomOrPan();
                        if (typeof renderHeatmap === 'function') renderHeatmap();
                    }
                }
            } else if (tab === 'weekly') {
                document.getElementById('view-weekly').classList.remove('hidden');
                setTimeout(() => renderWeeklyReport(), 50);
            } else if (tab === 'manage') {
                document.getElementById('view-manage').classList.remove('hidden'); renderManageTable();
                if (manageChart) manageChart.resize();
            } else if (tab === 'reminder') {
                document.getElementById('view-reminder').classList.remove('hidden'); ReminderApp.render();
            } else if (tab === 'more') {
                document.getElementById('view-more').classList.remove('hidden');
            }
        }

        function updateProjectSelector() {
            const selector = document.getElementById('project-selector'); if (!selector) return;
            selector.innerHTML = '';
            
            if (!SELECTED_DETAIL_UUID) {
                const opt = document.createElement('option'); opt.value = ''; opt.innerText = '-- 请选择工程 --'; selector.appendChild(opt);
            }
            
            Object.keys(globalProjectMeta).sort((a, b) => (globalProjectMeta[a] || '').localeCompare(globalProjectMeta[b] || '', 'zh')).forEach(uuid => {
                const opt = document.createElement('option');
                opt.value = uuid; opt.innerText = globalProjectMeta[uuid];
                if (uuid === SELECTED_DETAIL_UUID) opt.selected = true;
                selector.appendChild(opt);
            });
			// 同步更新节律面板的工程下拉单
			const rhythmSelector = document.getElementById('rhythm-project-select');
			if (rhythmSelector) rhythmSelector.innerHTML = selector.innerHTML;
        }

        function onProjectSelectorChange() {
            const selector = document.getElementById('project-selector'); if (!selector) return;
            SELECTED_DETAIL_UUID = selector.value || null; updateHeaderStats();
            chartCache.main = { lastClusterSize: -1, lastYMax: -1, lastHourInterval: -1, lastDynamicYMax: -1 };
            
            if (!SELECTED_DETAIL_UUID) {
                document.getElementById('view-chart').classList.add('hidden');
                document.getElementById('project-empty-tip').innerHTML = `<div style="margin-bottom:8px; font-weight: bold; color:#e0e0e0;">当前未打开工程</div><div style="font-size:11px; color:#666;">当前视图不包含任何数据。请在顶部下拉菜单中选择一个项目。</div>`;
                document.getElementById('project-empty-tip').classList.remove('hidden');
            } else {
                document.getElementById('project-empty-tip').classList.add('hidden'); document.getElementById('view-chart').classList.remove('hidden');
                if (myChart) {
                    myChart.resize();
                    let bounds = (SELECTED_DETAIL_UUID && projectStats[SELECTED_DETAIL_UUID] && projectStats[SELECTED_DETAIL_UUID].startTs !== Infinity) 
                               ? getDayAlignedIndices(projectStats[SELECTED_DETAIL_UUID].startTs, projectStats[SELECTED_DETAIL_UUID].endTs) 
                               : getDayAlignedIndices(GLOBAL_TODAY_TS, GLOBAL_TODAY_TS);
                    myChart.dispatchAction({ type: 'dataZoom', startValue: bounds.startValue, endValue: bounds.endValue });
                    handleZoomOrPan(); if (typeof renderHeatmap === 'function') renderHeatmap();
                }
            }
        }

        // ==========================================
        // [12] 周报引擎
        // ==========================================
        let currentWeeklyOffset = 0; // 0 是本周, -1 是上周

        function changeWeek(delta) {
            currentWeeklyOffset += delta;
            renderWeeklyReport();
        }

        function getWeekInfo(offset) {
            const now = new Date();
            // 找到本周一
            const day = now.getDay() || 7;
            const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);

            // 根据偏移计算目标周一
            const targetMonday = new Date(monday.getTime() + offset * 7 * 24 * 3600 * 1000);
            const targetSunday = new Date(targetMonday.getTime() + 6 * 24 * 3600 * 1000);

            // 获取周数
            const startOfYear = new Date(targetMonday.getFullYear(), 0, 1);
            const weekNum = Math.ceil((((targetMonday - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7);

            return {
                monday: targetMonday.getTime(),
                sunday: targetSunday.getTime(),
                rangeText: `${targetMonday.getFullYear()} 第 ${weekNum} 周 (${targetMonday.getMonth()+1}.${targetMonday.getDate()} - ${targetSunday.getMonth()+1}.${targetSunday.getDate()})`
            };
        }

        function renderWeeklyReport() {
            if (!weeklyBarChart) weeklyBarChart = echarts.init(document.getElementById('weekly-bar-chart'), 'dark');
            if (!weeklyPieChart) weeklyPieChart = echarts.init(document.getElementById('weekly-pie-chart'), 'dark');

            const info = getWeekInfo(currentWeeklyOffset);
            document.getElementById('weekly-range-text').innerText = info.rangeText;

            const weekData = Array.from({length: 7}, () => ({ work: {}, totalWork: 0 }));
            const projectTotals = {};
            let totalSeconds = 0;

            for (let i = 0; i < globalTimeline.length; i++) {
                const slot = globalTimeline[i];
                if (slot.ts >= info.monday && slot.ts < info.monday + 7 * 24 * 3600 * 1000) {
                    const dayIdx = Math.floor((slot.ts - info.monday) / (24 * 3600 * 1000));
                    if (dayIdx >= 0 && dayIdx < 7) {
                        for (const pid in slot.work) {
                            const sec = slot.work[pid];
                            weekData[dayIdx].work[pid] = (weekData[dayIdx].work[pid] || 0) + sec;
                            weekData[dayIdx].totalWork += sec;
                            projectTotals[pid] = (projectTotals[pid] || 0) + sec;
                            totalSeconds += sec;
                        }
                    }
                }
            }

            // 更新汇总卡片
            document.getElementById('weekly-total-work').innerText = formatDuration(totalSeconds);
            document.getElementById('weekly-avg-work').innerText = formatDuration(Math.round(totalSeconds / 7));

            let topPid = '--';
            let maxSec = 0;
            for (const pid in projectTotals) {
                if (projectTotals[pid] > maxSec) { maxSec = projectTotals[pid]; topPid = globalProjectMeta[pid] || pid; }
            }
            document.getElementById('weekly-top-project').innerText = topPid;

            // 每日柱状图
            const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
            const barSeries = sortedProjectIds.map(pid => {
                return {
                    name: globalProjectMeta[pid],
                    type: 'bar',
                    stack: 'total',
                    data: weekData.map(d => (d.work[pid] || 0)),
                    itemStyle: { color: pidColorMap[pid] }
                };
            }).filter(s => s.data.some(v => v > 0));

            weeklyBarChart.setOption({
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'axis',
                    backgroundColor: 'rgba(37, 37, 38, 0.95)',
                    borderColor: '#454545',
                    borderWidth: 1,
                    textStyle: { color: '#cccccc', fontSize: 12 },
                    formatter: params => {
                        let h = `<b style="color:#fff;">${params[0].name}</b><br/>`;
                        params.forEach(p => { if(p.value > 0) h += `${p.marker} ${p.seriesName}: <span style="float:right; font-weight:bold; margin-left:15px; color:#fff;">${formatDuration(p.value)}</span><br/>`; });
                        return h;
                    }
                },
                grid: { top: 30, left: 70, right: 10, bottom: 30 },
                xAxis: { type: 'category', data: days, axisLabel: { color: '#858585' } },
                yAxis: { type: 'value', axisLabel: { color: '#858585', formatter: value => formatDuration(value) }, splitLine: { lineStyle: { color: '#333' } } },
                series: barSeries
            }, true);

            // 项目占比饼图
            const pieData = Object.keys(projectTotals).map(pid => ({
                name: globalProjectMeta[pid] || pid,
                value: projectTotals[pid],
                itemStyle: { color: pidColorMap[pid] }
            })).sort((a, b) => b.value - a.value);

            weeklyPieChart.setOption({
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'item',
                    backgroundColor: 'rgba(37, 37, 38, 0.95)',
                    borderColor: '#454545',
                    borderWidth: 1,
                    textStyle: { color: '#cccccc', fontSize: 12 },
                    formatter: params => {
                        return `<b style="color:#fff;">${params.name}</b><br/>
                                时间: <span style="float:right; font-weight:bold; margin-left:15px; color:#fff;">${formatDuration(params.value)}</span><br/>
                                占比: <span style="float:right; font-weight:bold; margin-left:15px; color:#fff;">${params.percent}%</span>`;
                    }
                },
                series: [{
                    type: 'pie', radius: ['35%', '60%'], center: ['50%', '55%'],
                    avoidLabelOverlap: true,
                    data: pieData,
                    label: { show: false },
                    labelLine: { show: false },
                    emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } }
                }]
            }, true);
        }

        async function exportWeeklyReport() {
            const body = document.getElementById('weekly-report-body');
            // 简单的截图导出方案：利用 html2canvas 或手动拼凑
            // 由于插件环境限制，我们使用 ECharts 自带的 getDataURL 并手动组合
            const barImg = weeklyBarChart.getDataURL({ type: 'png', backgroundColor: '#252526' });
            const pieImg = weeklyPieChart.getDataURL({ type: 'png', backgroundColor: '#252526' });

            // 创建一个隐藏的画布来合成周报
            const canvas = document.createElement('canvas');
            canvas.width = 800;
            canvas.height = 600;
            const ctx = canvas.getContext('2d');

            // 背景
            ctx.fillStyle = '#1e1e1e';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // 标题
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 24px Arial';
            ctx.fillText('工程开发周报', 30, 50);

            ctx.font = '16px Arial';
            ctx.fillStyle = '#858585';
            ctx.fillText(document.getElementById('weekly-range-text').innerText, 30, 85);

            // 统计卡片
            ctx.fillStyle = '#252526';
            ctx.fillRect(30, 110, 230, 80);
            ctx.fillRect(285, 110, 230, 80);
            ctx.fillRect(540, 110, 230, 80);

            ctx.fillStyle = '#858585'; ctx.font = '12px Arial';
            ctx.fillText('本周总投入', 40, 135); ctx.fillText('日均工时', 295, 135); ctx.fillText('最专注工程', 550, 135);

            ctx.fillStyle = '#007acc'; ctx.font = 'bold 20px Arial';
            ctx.fillText(document.getElementById('weekly-total-work').innerText, 40, 170);
            ctx.fillText(document.getElementById('weekly-avg-work').innerText, 295, 170);
            ctx.font = 'bold 14px Arial';
            ctx.fillText(document.getElementById('weekly-top-project').innerText, 550, 170);

            // 绘制图表
            const imgBar = new Image();
            imgBar.src = barImg;
            imgBar.onload = () => {
                ctx.drawImage(imgBar, 30, 210, 450, 360);
                const imgPie = new Image();
                imgPie.src = pieImg;
                imgPie.onload = () => {
                    ctx.drawImage(imgPie, 490, 210, 280, 360);

                    // 导出
                    const finalUrl = canvas.toDataURL('image/png');
                    const a = document.createElement('a');
                    a.href = finalUrl;
                    a.download = `周报_${document.getElementById('weekly-range-text').innerText}.png`;
                    a.click();
                };
            };
        }

        window.addEventListener('resize', () => { 
			if (myChart) myChart.resize(); 
			if (manageChart) manageChart.resize(); 
			if (heatmapChart) heatmapChart.resize(); 
			if (rhythmChart) rhythmChart.resize();
            if (weeklyBarChart) weeklyBarChart.resize();
            if (weeklyPieChart) weeklyPieChart.resize();
		});


		(async function main() {
			try {
				// === 核心修复：延迟 50 毫秒执行 ===
				// 让 JavaScript 喘口气，把主线程交还给浏览器，让它先把 Loading 动画渲染到屏幕上！
				await new Promise(resolve => setTimeout(resolve, 50));
				
				await loadAllData(); 
				initChartCore(); 
				await ReminderApp.init();
				
				document.getElementById('loading-mask').style.display = 'none'; 
				switchTab('total');
			} catch (e) {
				document.getElementById('loading-mask').innerText = '内核渲染矩阵加载失败: ' + e.message; 
				console.error(e);
			}
		})();
