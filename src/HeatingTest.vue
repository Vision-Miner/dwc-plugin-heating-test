<template>
  <v-container fluid>
    <v-card class="mb-3">
      <v-card-title>Heating Test</v-card-title>
      <v-card-text>
        <v-alert v-if="error" type="error" dense text>{{ error }}</v-alert>
        <v-alert v-if="busy" type="info" dense text>
          The printer is busy. If a test is running, a download slows its logging; the last rows may be missing.
        </v-alert>

        <v-row dense align="center">
          <v-col cols="12" md="4">
            <v-select v-model="selected" :items="folderItems" label="Run on the printer" dense hide-details :loading="loading" @change="loadSelected" />
          </v-col>
          <v-col cols="12" md="4">
            <v-select v-model="referenceSelected" :items="folderItems" label="Compare with run on the printer" dense hide-details clearable @change="loadReference" />
          </v-col>
          <v-col cols="12" md="4">
            <v-btn small class="mr-2" :disabled="loading" @click="refresh">Refresh</v-btn>
            <v-btn small class="mr-2" :disabled="loading" @click="pick('main')">Open files or ZIP</v-btn>
            <v-btn small class="mr-2" :disabled="loading" @click="pick('reference')">Compare with files</v-btn>
            <v-btn small :disabled="loading || !selected" @click="exportZip">Export ZIP</v-btn>
            <input ref="files" type="file" accept=".csv,.txt,.zip" multiple hidden @change="filesChosen">
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <template v-if="run">
      <v-alert :type="verdict.type" text>
        <div class="font-weight-bold">{{ verdict.title }}</div>
        <div v-for="(line, index) in verdict.lines" :key="index">{{ line }}</div>
      </v-alert>

      <v-card class="mb-3">
        <v-card-text>
          <v-range-slider v-model="range" :min="0" :max="duration" :step="1" thumb-label hide-details label="Minutes" class="mb-2" />
          <div class="text-right">
            <v-btn x-small text @click="range = [0, duration]">Whole run</v-btn>
          </div>
          <time-chart title="Temperature" unit="C" :height="360" :series="temperatureSeries" :range="range" :marks="marks" />
          <time-chart title="Heaters and fans" :height="240" :series="powerSeries" :range="range" :marks="marks" class="mt-3" />
          <time-chart title="Voltages" unit="V" :height="200" :series="voltageSeries" :range="range" :marks="marks" class="mt-3" />
        </v-card-text>
      </v-card>

      <v-card class="mb-3">
        <v-card-title class="subtitle-1">Steps</v-card-title>
        <v-card-text>
          <step-table :rows="stepRows" @select="selectStep" />
          <div class="caption mt-1">* the nozzles were still moving at the end of this step. Click a row to zoom. Air readings depend on the HEPA setting: compare only the same step of the same plan.</div>
        </v-card-text>
      </v-card>

      <v-card class="mb-3">
        <v-card-title class="subtitle-1">Whole run</v-card-title>
        <v-card-text>
          <p class="caption">
            Chamber air (S3) reads differently from machine to machine. Check it against the heads before comparing air between machines:
            in the half-HEPA hold S3 minus the heads was -7.4 C on Markiz, -7.6 C on 138 and +3.0 C on 3162.
          </p>
          <v-simple-table dense>
            <thead>
              <tr>
                <th />
                <th>{{ run.name }}</th>
                <th v-if="reference">{{ reference.name }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in runRows" :key="row.name">
                <td>{{ row.name }}</td>
                <td>{{ row.value }}</td>
                <td v-if="reference">{{ row.reference }}</td>
              </tr>
            </tbody>
          </v-simple-table>
        </v-card-text>
      </v-card>

      <v-card class="mb-3">
        <v-card-title class="subtitle-1">Current fault model on this run, and what-if</v-card-title>
        <v-card-text>
          <p class="caption">
            Replay of the firmware's checks on the recorded curves. The EXP3HC's logic is assumed to match the main board's.
            Failure columns are simulated from this run's heat loss: an estimate of how long the firmware would take to notice, from the moment of failure.
          </p>
          <fault-table :rows="faultRows" />
        </v-card-text>
      </v-card>

      <v-card class="mb-3">
        <v-card-title class="subtitle-1">Events</v-card-title>
        <v-card-text>
          <v-simple-table v-if="run.events.length" dense>
            <tbody>
              <tr v-for="(event, index) in run.events" :key="index" :class="eventClass(event)">
                <td>{{ event.step }}</td>
                <td>{{ event.code }}</td>
                <td>{{ event.detail }}</td>
              </tr>
            </tbody>
          </v-simple-table>
          <div v-else>No events.csv in this run.</div>
        </v-card-text>
      </v-card>

      <v-card v-if="headerRows.length" class="mb-3">
        <v-card-title class="subtitle-1">Machine and settings</v-card-title>
        <v-card-text>
          <v-simple-table dense>
            <thead>
              <tr>
                <th>Setting</th>
                <th>Value</th>
                <th>Field</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in headerRows" :key="row.key">
                <td>{{ row.meaning }}</td>
                <td>{{ row.value }}</td>
                <td class="grey--text">{{ row.key }}</td>
              </tr>
            </tbody>
          </v-simple-table>
        </v-card-text>
      </v-card>
    </template>
  </v-container>
</template>

<script>
'use strict'

import JSZip from 'jszip'
import saveAs from 'file-saver'
import { ABI_VERSION, EVENT, FILES, RUN_PREFIX, RUNS_DIR } from './lib/abi.js'
import { parseEvents, parseHeader, parseSamples } from './lib/parse.js'
import { airCheck, findFaults, findPowerDips, findSteps, runKpi, runStatus, stepKpi, stepLabel, unexpectedGaps } from './lib/kpi.js'
import { FAN_NAMES, SENSOR_NAMES, headerMeaning, runTimeLabel } from './lib/labels.js'
import { textsFromZip } from './lib/zipfiles.js'
import { whatIf } from './lib/faultModel.js'
import FaultTable from './FaultTable.vue'
import StepTable from './StepTable.vue'
import TimeChart from './TimeChart.vue'

const COLORS = {
    bed: '#ef5350',
    air: '#42a5f5',
    element: '#ffa726',
    left: '#66bb6a',
    right: '#ab47bc',
    bedTarget: '#ef9a9a',
    airTarget: '#90caf9',
    fan: '#26a69a',
    hepa: '#8d6e63',
    vin: '#5c6bc0',
    v12: '#ec407a'
}

// Frozen so Vue does not walk the columns
function buildRun(name, texts) {
    const samples = parseSamples(texts.samples)
    const events = texts.events ? parseEvents(texts.events) : []
    const header = texts.header ? parseHeader(texts.header) : {}
    const steps = findSteps(samples, events)
    const kpi = runKpi(samples)
    const stepKpis = []
    for (let i = 0; i < steps.length; i++) {
        stepKpis.push(stepKpi(samples, steps[i]))
    }
    const room = kpi.cold ? kpi.cold.air : NaN
    const bedLoss = kpi.cooling ? kpi.cooling.bedPerMinute : NaN
    const faults = whatIf(samples, texts.header ? header : null, bedLoss, NaN, room)
    return Object.freeze({
        name,
        samples: Object.freeze(samples),
        events: Object.freeze(events),
        header: Object.freeze(header),
        summary: texts.summary || '',
        steps: Object.freeze(steps),
        stepKpis: Object.freeze(stepKpis),
        kpi: Object.freeze(kpi),
        faults: Object.freeze(faults),
        heaterFaults: Object.freeze(findFaults(samples)),
        gapsShown: Object.freeze(unexpectedGaps(samples, steps)),
        airCheck: airCheck(steps, stepKpis),
        powerDips: Object.freeze(findPowerDips(samples))
    })
}

function minutes(time) {
    const out = new Float64Array(time.length)
    for (let i = 0; i < time.length; i++) {
        out[i] = time[i] / 60
    }
    return out
}

function fixed(value, digits, suffix) {
    return isFinite(value) ? `${Number(value).toFixed(digits)}${suffix || ''}` : '-'
}

export default {
    components: { FaultTable, StepTable, TimeChart },
    data() {
        return {
            folders: [],
            selected: null,
            referenceSelected: null,
            run: null,
            reference: null,
            range: [0, 1],
            loading: false,
            error: null,
            pickTarget: 'main',
            alignedStep: null
        }
    },
    computed: {
        busy() {
            const status = this.$store.state.machine.model.state.status
            return status === 'busy' || status === 'processing'
        },
        folderItems() {
            const items = []
            for (let i = 0; i < this.folders.length; i++) {
                items.push({ text: `${this.folders[i]} (${runTimeLabel(this.folders[i])})`, value: this.folders[i] })
            }
            return items
        },
        duration() {
            return this.run ? Math.ceil(this.run.samples.time[this.run.samples.n - 1] / 60) : 1
        },
        // Reference curves start with the selected step, or with the run
        referenceShift() {
            if (!this.reference || this.alignedStep === null) {
                return 0
            }
            const own = this.run.steps.find((step) => step.number === this.alignedStep)
            const other = this.reference.steps.find((step) => step.number === this.alignedStep)
            return own && other ? (this.run.samples.time[own.from] - this.reference.samples.time[other.from]) / 60 : 0
        },
        ownX() {
            return this.run ? minutes(this.run.samples.time) : null
        },
        referenceX() {
            if (!this.reference) {
                return null
            }
            const x = new Float64Array(this.reference.samples.time.length)
            const time = this.reference.samples.time
            for (let i = 0; i < x.length; i++) {
                x[i] = time[i] / 60 + this.referenceShift
            }
            return x
        },
        temperatureSeries() {
            const c = this.run.samples.cols
            const x = this.ownX
            const list = [
                { label: SENSOR_NAMES.S2, x, y: c.S2, color: COLORS.bed },
                { label: 'Bed target', x, y: c.H2_act, color: COLORS.bedTarget, dashed: true },
                { label: SENSOR_NAMES.S3, x, y: c.S3, color: COLORS.air },
                { label: 'Chamber target', x, y: c.H3_act, color: COLORS.airTarget, dashed: true },
                { label: SENSOR_NAMES.S4, x, y: c.S4, color: COLORS.element },
                { label: SENSOR_NAMES.S0, x, y: c.S0, color: COLORS.left },
                { label: SENSOR_NAMES.S1, x, y: c.S1, color: COLORS.right }
            ]
            if (this.reference) {
                const r = this.reference.samples.cols
                const rx = this.referenceX
                list.push({ label: `ref ${SENSOR_NAMES.S2}`, x: rx, y: r.S2, color: COLORS.bed, dashed: true })
                list.push({ label: `ref ${SENSOR_NAMES.S3}`, x: rx, y: r.S3, color: COLORS.air, dashed: true })
                list.push({ label: `ref ${SENSOR_NAMES.S4}`, x: rx, y: r.S4, color: COLORS.element, dashed: true })
            }
            return Object.freeze(list)
        },
        powerSeries() {
            const c = this.run.samples.cols
            const x = this.ownX
            const list = [
                { label: 'Bed heater power', x, y: c.H2_pwm, color: COLORS.bed },
                { label: 'Chamber heater power', x, y: c.H3_pwm, color: COLORS.air },
                { label: FAN_NAMES.F4, x, y: c.F4_act, color: COLORS.element },
                { label: FAN_NAMES.F7, x, y: c.F7_act, color: COLORS.hepa }
            ]
            const others = ['F0_act', 'F1_act', 'F2_act', 'F3_act', 'F6_act']
            for (let i = 0; i < others.length; i++) {
                if (c[others[i]]) {
                    list.push({ label: FAN_NAMES[others[i].replace('_act', '')], x, y: c[others[i]], color: COLORS.fan, hidden: true })
                }
            }
            if (this.reference) {
                const r = this.reference.samples.cols
                const rx = this.referenceX
                list.push({ label: 'ref Bed heater power', x: rx, y: r.H2_pwm, color: COLORS.bed, dashed: true })
                list.push({ label: 'ref Chamber heater power', x: rx, y: r.H3_pwm, color: COLORS.air, dashed: true })
            }
            return Object.freeze(list)
        },
        voltageSeries() {
            const c = this.run.samples.cols
            const x = this.ownX
            const list = [
                { label: '24 V', x, y: c.vin0, color: COLORS.vin },
                { label: '12 V', x, y: c.v12_0, color: COLORS.v12 }
            ]
            if (c.vin0_min) {
                list.push({ label: '24 V latched min', x, y: c.vin0_min, color: COLORS.vin, dashed: true })
            }
            if (c.v12_min) {
                list.push({ label: '12 V latched min', x, y: c.v12_min, color: COLORS.v12, dashed: true })
            }
            if (c.vin1) {
                list.push({ label: 'EXP3HC 24 V', x, y: c.vin1, color: COLORS.fan, hidden: true })
            }
            return Object.freeze(list)
        },
        marks() {
            const out = []
            const time = this.run.samples.time
            for (let i = 0; i < this.run.steps.length; i++) {
                const step = this.run.steps[i]
                out.push({ at: time[step.from] / 60, label: `${step.number}` })
            }
            for (let i = 0; i < this.run.heaterFaults.length; i++) {
                const fault = this.run.heaterFaults[i]
                out.push({ at: fault.time / 60, label: `H${fault.heater} fault`, color: '#f44336' })
            }
            for (let i = 0; i < this.run.samples.reboots.length; i++) {
                out.push({ at: this.run.samples.reboots[i] / 60, label: 'reboot', color: '#ff9800' })
            }
            for (let i = 0; i < this.run.powerDips.length; i++) {
                out.push({ at: this.run.powerDips[i].time / 60, label: 'supply dip', color: '#ff9800' })
            }
            return out
        },
        stepRows() {
            const rows = []
            for (let i = 0; i < this.run.steps.length; i++) {
                const step = this.run.steps[i]
                rows.push({ key: `own${i}`, number: step.number, label: stepLabel(step), k: this.run.stepKpis[i], reference: false })
                if (this.reference) {
                    const other = this.reference.steps.findIndex((item) => item.number === step.number)
                    if (other >= 0) {
                        rows.push({
                            key: `ref${i}`,
                            number: step.number,
                            label: stepLabel(this.reference.steps[other]),
                            k: this.reference.stepKpis[other],
                            reference: true
                        })
                    }
                }
            }
            return rows
        },
        runRows() {
            const own = this.runValues(this.run)
            const other = this.reference ? this.runValues(this.reference) : null
            const rows = []
            for (let i = 0; i < own.length; i++) {
                rows.push({ name: own[i][0], value: own[i][1], reference: other ? other[i][1] : '' })
            }
            return rows
        },
        faultRows() {
            return this.run.faults.bed.concat(this.run.faults.chamber)
        },
        headerRows() {
            const rows = []
            const keys = Object.keys(this.run.header)
            for (let i = 0; i < keys.length; i++) {
                rows.push({ key: keys[i], meaning: headerMeaning(keys[i]) || keys[i], value: this.run.header[keys[i]] })
            }
            return rows
        },
        verdict() {
            const faults = this.run.heaterFaults
            const lines = []
            const header = this.run.header
            const identity = [header.plan, header.serial, header.board0_id].filter(Boolean)
            if (identity.length) {
                lines.push(identity.join(', '))
            }
            if (header.abi && parseInt(header.abi, 10) !== ABI_VERSION) {
                lines.push(`Data contract version ${header.abi}, this plugin reads ${ABI_VERSION}.`)
            }

            // Say what "no fault" covered: the chamber is checked only while it is cold
            const live = (rows) => (rows.length ? rows[0].checkedMinutes : 0)
            lines.push(`The firmware's heating check was live for ${live(this.run.faults.bed).toFixed(0)} min on the bed and ${live(this.run.faults.chamber).toFixed(0)} min on the chamber.`)

            const stops = this.run.events.filter((event) => event.code === EVENT.STOP)
            for (let i = 0; i < stops.length; i++) {
                lines.push(`Stopped: ${stops[i].detail}`)
            }
            const dips = this.run.powerDips
            for (let i = 0; i < dips.length; i++) {
                lines.push(`Supply dip at ${(dips[i].time / 60).toFixed(1)} min: 24 V fell to ${dips[i].vin.toFixed(1)} V, 12 V to ${dips[i].v12.toFixed(1)} V.`)
            }
            const notes = this.run.events.filter((event) => event.code === EVENT.NOT_REACHED || (event.code === EVENT.WARN && event.detail.indexOf('Supply dip') !== 0))
            for (let i = 0; i < notes.length; i++) {
                lines.push(`Step ${notes[i].step}: ${notes[i].code === EVENT.NOT_REACHED ? 'not reached: ' : ''}${notes[i].detail}`)
            }
            for (let i = 0; i < this.run.samples.reboots.length; i++) {
                lines.push(`Reboot at ${(this.run.samples.reboots[i] / 60).toFixed(1)} min.`)
            }
            for (let i = 0; i < this.run.gapsShown.length; i++) {
                const gap = this.run.gapsShown[i]
                lines.push(`Logging gap of ${gap.seconds.toFixed(0)} s at ${(gap.time / 60).toFixed(1)} min.`)
            }

            if (faults.length) {
                return { type: 'error', title: `Heater fault: ${faults.map((fault) => `H${fault.heater} at ${(fault.time / 60).toFixed(1)} min`).join(', ')}`, lines }
            }
            if (stops.length) {
                return { type: 'warning', title: 'The run stopped early', lines }
            }
            const status = runStatus(this.run.events, dips)
            if (!status.ended) {
                // The open log of a running test lies inside its own folder
                const logFile = this.$store.state.machine.model.state.logFile || ''
                if (logFile.indexOf(`/${this.run.name}/`) >= 0) {
                    return { type: 'info', title: 'The run is still in progress', lines }
                }
                const where = status.lastStep >= 0 ? `in step ${status.lastStep}` : 'before the first step'
                return { type: 'warning', title: `Run did not finish: it stopped ${where}, so this says nothing about the rest`, lines }
            }
            if (status.reasons.length) {
                return { type: 'warning', title: `No heater fault in ${this.run.steps.length} steps, but: ${status.reasons.join(', ')}`, lines }
            }
            return { type: 'success', title: `No heater fault in ${this.run.steps.length} steps`, lines }
        }
    },
    watch: {
        run() {
            this.range = [0, this.duration]
            this.alignedStep = null
        }
    },
    mounted() {
        this.refresh()
    },
    methods: {
        runValues(run) {
            const kpi = run.kpi
            const values = [
                ['Hours', fixed(kpi.hours, 2)],
                ['Cold spread of sensors, C', kpi.cold ? fixed(kpi.cold.spread, 2) : '-'],
                ['Chamber air (S3) minus the other sensors, cold, C', kpi.cold ? fixed(kpi.cold.airOffset, 2) : '-'],
                [`Chamber air (S3) minus the heads, half-HEPA hold${run.airCheck ? ` (step ${run.airCheck.step})` : ''}, C`, run.airCheck ? fixed(run.airCheck.value, 1) : '-'],
                ['Chamber air (S3) 60 to 90, min', fixed(kpi.air60To90, 1)],
                ['Chamber air (S3) 60 to 95, min', fixed(kpi.air60To95, 1)],
                ['Chamber heater element (S4) max, C', fixed(kpi.s4Max, 1)],
                ['Lowest 24 V latched', isFinite(kpi.vinMin.vin0) ? fixed(kpi.vinMin.vin0, 1) : '-'],
                ['Lowest 12 V latched', isFinite(kpi.vinMin.v12) ? fixed(kpi.vinMin.v12, 1) : '-'],
                ['Bed heat loss, per min', kpi.cooling ? fixed(kpi.cooling.bedPerMinute, 3) : '-'],
                ['Air cooling, C per min', kpi.cooling ? fixed(kpi.cooling.airRate, 2) : '-'],
                ['Logging gaps', `${kpi.gaps}`],
                ['Reboots', `${kpi.reboots}`]
            ]
            for (let b = 0; b < kpi.bedRates.length; b++) {
                const bin = kpi.bedRates[b]
                values.push([`Bed rate ${bin.low}-${bin.high} C, C/s`, fixed(bin.rate, 3)])
            }
            return values
        },
        async download(folder, name, required) {
            try {
                return await this.$store.dispatch('machine/download', {
                    filename: `${RUNS_DIR}/${folder}/${name}`,
                    type: 'text',
                    showProgress: required,
                    showSuccess: false,
                    showError: false,
                    closeProgressOnSuccess: true
                })
            } catch (e) {
                if (required) {
                    throw e
                }
                return null
            }
        },
        async downloadRun(folder) {
            const texts = { samples: await this.download(folder, FILES.samples, true) }
            texts.events = await this.download(folder, FILES.events, false)
            texts.header = await this.download(folder, FILES.header, false)
            texts.summary = await this.download(folder, FILES.summary, false)
            return buildRun(folder, texts)
        },
        async withLoading(job) {
            this.loading = true
            this.error = null
            try {
                await job()
            } catch (e) {
                this.error = e.message || `${e}`
            } finally {
                this.loading = false
            }
        },
        refresh() {
            return this.withLoading(async () => {
                let items = []
                try {
                    items = await this.$store.dispatch('machine/getFileList', RUNS_DIR)
                } catch (e) {
                    this.folders = []
                    return
                }
                const names = []
                for (let i = 0; i < items.length; i++) {
                    if (items[i].isDirectory && items[i].name.indexOf(RUN_PREFIX) === 0) {
                        names.push(items[i].name)
                    }
                }
                names.sort().reverse()
                this.folders = names
                if (this.selected) {
                    this.run = await this.downloadRun(this.selected)
                }
            })
        },
        loadSelected() {
            return this.withLoading(async () => {
                this.run = this.selected ? await this.downloadRun(this.selected) : null
            })
        },
        loadReference() {
            return this.withLoading(async () => {
                this.reference = this.referenceSelected ? await this.downloadRun(this.referenceSelected) : null
            })
        },
        // The whole run folder, as it is on the card, for support
        exportZip() {
            const folder = this.selected
            return this.withLoading(async () => {
                const items = await this.$store.dispatch('machine/getFileList', `${RUNS_DIR}/${folder}`)
                const zip = new JSZip()
                for (let i = 0; i < items.length; i++) {
                    if (!items[i].isDirectory) {
                        zip.file(items[i].name, await this.$store.dispatch('machine/download', {
                            filename: `${RUNS_DIR}/${folder}/${items[i].name}`,
                            type: 'blob',
                            showProgress: true,
                            showSuccess: false,
                            showError: false,
                            closeProgressOnSuccess: true
                        }))
                    }
                }
                saveAs(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `${folder}.zip`)
            })
        },
        pick(target) {
            this.pickTarget = target
            this.$refs.files.value = ''
            this.$refs.files.click()
        },
        // Runs from other machines, and the older bench CSVs, live on the PC. samples.csv alone is enough.
        filesChosen(event) {
            const chosen = event.target.files
            return this.withLoading(async () => {
                const texts = {}
                let name = 'files'
                for (let i = 0; i < chosen.length; i++) {
                    if (/\.zip$/i.test(chosen[i].name)) {
                        const fromZip = await textsFromZip(JSZip, chosen[i], FILES)
                        Object.assign(texts, fromZip)
                        name = chosen[i].name.replace(/\.zip$/i, '')
                        continue
                    }
                    const text = await chosen[i].text()
                    const keys = Object.keys(FILES)
                    for (let k = 0; k < keys.length; k++) {
                        if (chosen[i].name === FILES[keys[k]]) {
                            texts[keys[k]] = text
                        }
                    }
                    if (chosen[i].name === FILES.samples && chosen[i].webkitRelativePath) {
                        name = chosen[i].webkitRelativePath
                    }
                }
                if (!texts.samples) {
                    throw new Error(`Choose ${FILES.samples}, or a ZIP that holds it`)
                }
                const loaded = buildRun(name, texts)
                if (this.pickTarget === 'reference') {
                    this.reference = loaded
                    this.referenceSelected = null
                } else {
                    this.run = loaded
                    this.selected = null
                }
            })
        },
        selectStep(number) {
            const step = this.run.steps.find((item) => item.number === number)
            if (step) {
                const time = this.run.samples.time
                this.range = [Math.floor(time[step.from] / 60), Math.ceil(time[step.to - 1] / 60)]
                this.alignedStep = number
            }
        },
        eventClass(event) {
            if (event.code === EVENT.FAULT) {
                return 'error--text'
            }
            return event.code === EVENT.STOP || event.code === EVENT.NOT_REACHED || event.code === EVENT.WARN ? 'warning--text' : ''
        }
    }
}
</script>
