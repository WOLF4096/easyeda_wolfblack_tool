/**
 * 性能监控工具
 *
 * 用于统计「从PCB创建导线」等批量操作的耗时与成功率，
 * 提供开始/结束计时与逐条计数能力。
 *
 * 开发者：WOLF4096
 * 辅助开发：DeepSeek-V4.1-Flash
 * 本工具为非官方第三方开源扩展，与嘉立创 / EasyEDA 官方无隶属关系
 */
export class PerformanceMonitor {
    constructor() {
        this.startTime = 0;
        this.endTime = 0;
        this.totalWires = 0;
        this.successWires = 0;
    }

    start() {
        this.startTime = performance.now();
        this.totalWires = 0;
        this.successWires = 0;
        console.log(`性能监控开始: ${new Date().toLocaleTimeString()}`);
    }

    end() {
        this.endTime = performance.now();
        const totalTime = (this.endTime - this.startTime) / 1000;
        const avgTimePerWire = totalTime > 0 && this.successWires > 0 ? (totalTime * 1000) / this.successWires : 0;

        console.log(`性能统计:
成功放置导线数量: ${this.successWires}
总耗时: ${totalTime.toFixed(2)}s
平均一条导线耗时: ${avgTimePerWire.toFixed(2)}ms`);

        return {
            totalWires: this.totalWires,
            successWires: this.successWires,
            totalTime: totalTime,
            avgTimePerWire: avgTimePerWire,
        };
    }

    addWire(success = true) {
        this.totalWires++;
        if (success) {
            this.successWires++;
        }
    }
}
