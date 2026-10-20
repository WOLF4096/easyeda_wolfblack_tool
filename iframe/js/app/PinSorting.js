let currentSelectedPins = [];

        // 1. 定时任务：每隔 200ms 更新选中引脚数量
        setInterval(async () => {
            if (typeof eda === 'undefined' || !eda.sch_SelectControl) return;
            
            try {
                const primitives = await eda.sch_SelectControl.getAllSelectedPrimitives();
                // 仅筛选类型为 Pin 的图元
                currentSelectedPins = primitives.filter(p => p.primitiveType === 'Pin');
                document.getElementById('pin-count').innerText = currentSelectedPins.length;
            } catch (error) {
                console.error("获取引脚失败:", error);
            }
        }, 200);

        // 2. 核心排序及修改逻辑
        async function applySort(orderType) {
            if (currentSelectedPins.length === 0) return;

            // 获取UI参数
            const targetProp = document.querySelector('input[name="sortTarget"]:checked').value;
            const spacing = parseFloat(document.getElementById('spacing').value) || 10;
            const useSplitSort = document.getElementById('splitSort').checked;
            const useEndSort = document.getElementById('endSort').checked;

            // 【末尾排序】仅用于排序的临时变换：只影响比较用的副本，不会写回引脚名称/编号
            // - 勾了拆分排序：先按“字母段/数字段”切分，再颠倒段序，段内字符保持原值
            //   如 DQ10 → [DQ, 10] → "10DQ"，DQ6 → "6DQ"，保证 DQ6 排在 DQ10 之前
            //   （若整串逐字符颠倒会变成 "01QD"，数字被反写成 1，从而 DQ10 错误地排在 DQ6 前面）
            // - 未勾拆分排序：整串逐字符颠倒，如 UDQS → SQDU
            const transformKey = s => {
                if (!useSplitSort) return s.split('').reverse().join('');
                const chunks = s.match(/\d+|\D+/g);
                return chunks ? chunks.reverse().join('') : s;
            };

            // 拷贝一份数组用于排序
            let pinsToSort = [...currentSelectedPins];

            // 构造 Intl.Collator 用于【拆分排序】(支持数字和字母自然分离)
            const collator = new Intl.Collator(undefined, { 
                numeric: useSplitSort, 
                sensitivity: 'base' 
            });

            // 排序逻辑
            pinsToSort.sort((a, b) => {
                const rawA = (a[targetProp] || "").toString();
                const rawB = (b[targetProp] || "").toString();

                // 末尾排序：按颠倒后的关键字比较（原值不改动）
                const valA = useEndSort ? transformKey(rawA) : rawA;
                const valB = useEndSort ? transformKey(rawB) : rawB;
                
                const cmpResult = useSplitSort ? collator.compare(valA, valB) : valA.localeCompare(valB);
                return orderType === 'asc' ? cmpResult : -cmpResult;
            });

            // 获取参考原点：X取最小（最靠左），Y取最大（最靠上，JLCEDA坐标Y轴向上）
            let minX = Infinity;
            let maxY = -Infinity;
            for (const pin of currentSelectedPins) {
                if (pin.x < minX) minX = pin.x;
                if (pin.y > maxY) maxY = pin.y;
            }

            // 获取参考朝向：只允许四个方向，归一化到 180/270 两个角度
            // 归一化：0/180 → 180 度，90/270 → 270 度（规避 EDA 的旋转翻转 bug）
            // 朝向一致时第一个引脚归一化后的朝向即整体朝向；不一致时同样继承第一个引脚，
            // 因此统一取排序后第一个引脚的归一化结果即可
            const normalizeRotation = r => {
                const deg = ((Number(r) || 0) % 360 + 360) % 360;  // 归到 [0, 360)
                return (deg === 90 || deg === 270) ? 270 : 180;
            };
            const baseRotation = normalizeRotation(pinsToSort[0].rotation);
            
            // 判断布局方式:
            // 0度/180度 -> 横向朝向 -> 竖向排布 (X固定)
            // 90度/270度 -> 竖向朝向 -> 横向排布 (Y固定)
            const isVerticalStacking = (baseRotation % 180 === 0); 

            // 开始应用新坐标和参数
            for (let i = 0; i < pinsToSort.length; i++) {
                const pin = pinsToSort[i];
                
                // 坐标计算：
                // 如果是竖排，从最上方(maxY)开始，往下排（递减Y）
                // 如果是横排，从最左方(minX)开始，往右排（递增X）
                const targetX = isVerticalStacking ? minX : minX + i * spacing;
                const targetY = isVerticalStacking ? maxY - i * spacing : maxY;

                // 优化：如果已经对齐且方向正确，则不执行 API 调用修改
                if (pin.x === targetX && pin.y === targetY && pin.rotation === baseRotation) {
                    continue; 
                }

                // 构造完整的修改对象：严格全盘继承图元对象返回值，防止属性留空导致系统分配未知参数引起翻转
                const modifyProperty = { ...pin }; 
                modifyProperty.x = targetX;
                modifyProperty.y = targetY;
                modifyProperty.rotation = baseRotation; // 应用对齐方向

                try {
                    await eda.sch_PrimitivePin.modify(pin.primitiveId, modifyProperty);
                } catch (error) {
                    console.error(`更新引脚 ${pin.primitiveId} 失败:`, error);
                }
            }
        }

        // 绑定按钮事件
        document.getElementById('btn-asc').addEventListener('click', () => applySort('asc'));
        document.getElementById('btn-desc').addEventListener('click', () => applySort('desc'));
