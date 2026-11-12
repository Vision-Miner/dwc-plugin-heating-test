<template>
  <div :style="{ height: height + 'px', position: 'relative' }">
    <canvas ref="canvas" />
  </div>
</template>

<script>
'use strict'

import Chart from 'chart.js'

const BUCKETS = 700

// Min and max per pixel-sized bucket keep spikes visible with a few thousand points
function decimate(x, y, from, to) {
    const points = []
    const size = Math.max(Math.floor((to - from) / BUCKETS), 1)
    for (let start = from; start < to; start += size) {
        const end = Math.min(start + size, to)
        let low = -1
        let high = -1
        for (let i = start; i < end; i++) {
            if (isFinite(y[i])) {
                if (low < 0 || y[i] < y[low]) {
                    low = i
                }
                if (high < 0 || y[i] > y[high]) {
                    high = i
                }
            }
        }
        if (low >= 0) {
            const first = Math.min(low, high)
            const second = Math.max(low, high)
            points.push({ x: x[first], y: y[first] })
            if (second !== first) {
                points.push({ x: x[second], y: y[second] })
            }
        }
    }
    return points
}

export default {
    props: {
        title: { type: String, required: true },
        unit: { type: String, default: '' },
        height: { type: Number, default: 300 },
        // [{ label, x (minutes), y, color, dashed, hidden }], with typed arrays
        series: { type: Array, required: true },
        // [from, to] in minutes
        range: { type: Array, required: true },
        // [{ at (minutes), label, color }]
        marks: { type: Array, default: () => [] }
    },
    watch: {
        series() {
            this.rebuild()
        },
        range() {
            this.refresh()
        },
        marks() {
            this.refresh()
        },
        '$vuetify.theme.isDark'() {
            this.rebuild()
        }
    },
    mounted() {
        this.rebuild()
    },
    beforeDestroy() {
        if (this.chart) {
            this.chart.destroy()
            this.chart = null
        }
    },
    methods: {
        window(x) {
            let from = 0
            while (from < x.length && x[from] < this.range[0]) {
                from++
            }
            let to = from
            while (to < x.length && x[to] <= this.range[1]) {
                to++
            }
            return [from, to]
        },
        points(item) {
            const [from, to] = this.window(item.x)
            return decimate(item.x, item.y, from, to)
        },
        rebuild() {
            if (this.chart) {
                this.chart.destroy()
            }
            const text = this.$vuetify.theme.isDark ? '#ddd' : '#333'
            const grid = this.$vuetify.theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'
            const self = this
            this.chart = new Chart(this.$refs.canvas, {
                type: 'scatter',
                data: { datasets: this.datasets() },
                options: {
                    animation: { duration: 0 },
                    hover: { animationDuration: 0 },
                    responsiveAnimationDuration: 0,
                    maintainAspectRatio: false,
                    title: { display: true, text: this.title, fontColor: text },
                    legend: { labels: { fontColor: text, boxWidth: 14 } },
                    elements: { point: { radius: 0, hitRadius: 6 }, line: { tension: 0 } },
                    tooltips: {
                        mode: 'nearest',
                        intersect: false,
                        callbacks: {
                            label(item, data) {
                                const name = data.datasets[item.datasetIndex].label
                                return `${name}: ${Number(item.yLabel).toFixed(2)} ${self.unit} at ${Number(item.xLabel).toFixed(1)} min`
                            }
                        }
                    },
                    scales: {
                        xAxes: [{
                            type: 'linear',
                            ticks: { min: this.range[0], max: this.range[1], fontColor: text },
                            scaleLabel: { display: true, labelString: 'minutes', fontColor: text },
                            gridLines: { color: grid }
                        }],
                        yAxes: [{
                            ticks: { fontColor: text },
                            scaleLabel: { display: !!this.unit, labelString: this.unit, fontColor: text },
                            gridLines: { color: grid }
                        }]
                    }
                },
                plugins: [{
                    afterDraw(chart) {
                        self.drawMarks(chart, text)
                    }
                }]
            })
        },
        datasets() {
            const out = []
            for (let i = 0; i < this.series.length; i++) {
                const item = this.series[i]
                out.push({
                    label: item.label,
                    data: this.points(item),
                    showLine: true,
                    fill: false,
                    borderWidth: item.dashed ? 1 : 1.5,
                    borderDash: item.dashed ? [5, 4] : [],
                    borderColor: item.color,
                    backgroundColor: item.color,
                    hidden: !!item.hidden
                })
            }
            return out
        },
        refresh() {
            if (!this.chart) {
                return
            }
            for (let i = 0; i < this.series.length; i++) {
                this.chart.data.datasets[i].data = this.points(this.series[i])
            }
            const ticks = this.chart.options.scales.xAxes[0].ticks
            ticks.min = this.range[0]
            ticks.max = this.range[1]
            this.chart.update(0)
        },
        drawMarks(chart, text) {
            const scale = chart.scales['x-axis-1']
            const area = chart.chartArea
            const ctx = chart.ctx
            ctx.save()
            ctx.font = '11px sans-serif'
            ctx.textBaseline = 'top'
            for (let i = 0; i < this.marks.length; i++) {
                const mark = this.marks[i]
                if (mark.at < this.range[0] || mark.at > this.range[1]) {
                    continue
                }
                const x = scale.getPixelForValue(mark.at)
                ctx.strokeStyle = mark.color || text
                ctx.fillStyle = mark.color || text
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.moveTo(x, area.top)
                ctx.lineTo(x, area.bottom)
                ctx.stroke()
                ctx.fillText(mark.label, x + 3, area.top + 2)
            }
            ctx.restore()
        }
    }
}
</script>
