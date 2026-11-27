<template>
  <v-container fluid>
    <v-card class="mb-3">
      <v-card-title>Heating Test</v-card-title>
      <v-card-text>
        <v-alert v-if="error" type="error" dense text>{{ error }}</v-alert>
        <v-alert v-if="liveError" type="warning" dense text>Live update failed: {{ liveError }}</v-alert>
        <v-alert v-if="waiting" type="info" dense text>The test is starting: its first rows show here once it has homed.</v-alert>
        <v-alert v-if="busy && !recording" type="info" dense text>
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
          <time-chart v-if="mainsSeries.length" title="Mains at the socket, from the voltmeter" unit="V" :height="200" :series="mainsSeries" :range="range" :marks="marks" class="mt-3" />
        </v-card-text>
      </v-card>

      <v-card v-if="voltmeterOpen || voltmeterRows.length" class="mb-3">
        <v-card-title class="subtitle-1">Mains voltmeter</v-card-title>
        <v-card-text>
          <v-row v-if="voltmeterOpen" dense align="center" class="mb-2">
            <v-col cols="12" md="3">
              <v-text-field v-model="voltmeterValue" label="Voltmeter reading now, V" dense hide-details :disabled="sending" @keyup.enter="sendVoltmeter" />
            </v-col>
            <v-col cols="12" md="9">
              <v-btn small class="mr-2" :disabled="sending" @click="sendVoltmeter">Save reading</v-btn>
              <span class="caption">{{ voltmeterStatus }}</span>
            </v-col>
          </v-row>
          <v-simple-table v-if="voltmeterRows.length" dense>
            <thead>
              <tr>
                <th>Minutes</th>
                <th>Step</th>
                <th>Mains, V</th>
                <th>Bed / chamber heater power</th>
                <th>As typed</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in voltmeterRows" :key="row.key">
                <td>{{ row.minutes }}</td>
                <td>{{ row.step }}</td>
                <td>{{ row.volts }}</td>
                <td>{{ row.power }}</td>
                <td>{{ row.typed }}</td>
                <td class="grey--text">{{ row.file }}</td>
              </tr>
            </tbody>
          </v-simple-table>
          <div class="caption mt-1">At a socket next to the printer. The time is when the test took the reading, within a second of the save.</div>
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
import { ABI_VERSION, EVENT, FILES, RUN_PREFIX, RUNS_DIR, VOLTMETER_INPUT } from './lib/abi.js'
import { parseEvents, parseHeader, parseSamples } from './lib/parse.js'
import { airCheck, findFaults, findPowerDips, findSteps, runKpi, runStatus, stepKpi, stepLabel, unexpectedGaps } from './lib/kpi.js'
import { FAN_NAMES, SENSOR_NAMES, headerMeaning, runTime, runTimeLabel } from './lib/labels.js'
import { addRunFile, addZipFiles, isRunFile, newTexts, samplesOf } from './lib/runfiles.js'
import { voltmeterReadings } from './lib/voltmeter.js'
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
    v12: '#ec407a',
    mains: '#7e57c2'
}

// A plausible mains reading at the socket, 110-120 V and 220-240 V classes with their sag and surge
const MAINS_LOW = 50
const MAINS_HIGH = 300

// Each look at a recording run downloads the newest samples file, at most 10 minutes of rows, and what else grew
const LIVE_SECONDS = 15

// Frozen so Vue does not walk the columns
function buildRun(name, texts) {
    const text = samplesOf(texts)
    if (text === undefined) {
        throw new Error('This run has no samples files')
    }
    const samples = parseSamples(text)
    const events = texts.events ? parseEvents(texts.events) : []
    const header = texts.header ? parseHeader(texts.header) : {}
    const voltmeterFiles = Object.assign({}, texts.voltmeter)
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
        powerDips: Object.freeze(findPowerDips(samples)),
        voltmeterFiles: Object.freeze(voltmeterFiles),
        readings: Object.freeze(voltmeterReadings(voltmeterFiles, events, samples))
    })
}

// The idle reading from header.csv at the start, then every reading the test took, in minutes
function mainsPoints(run, shift) {
    const x = []
    const y = []
    const idle = parseFloat(run.header.mains_v_idle)
    if (idle > 0) {
        x.push(shift)
        y.push(idle)
    }
    for (let i = 0; i < run.readings.length; i++) {
        const reading = run.readings[i]
        if (isFinite(reading.time) && isFinite(reading.volts)) {
            x.push(reading.time / 60 + shift)
            y.push(reading.volts)
        }
    }
    return { x: Float64Array.from(x), y: Float64Array.from(y) }
}

// The test logs into its folder from the header on, and Step.g starts the first samples file only after homing
function hasRows(texts) {
    const text = samplesOf(texts)
    return text !== undefined && text.split('\n').length > 2
}

function voltmeterTakes(events) {
    let count = 0
    for (let i = 0; i < events.length; i++) {
        if (events[i].code === EVENT.VOLTMETER) {
            count++
        }
    }
    return count
}

// <serial>_<date>_<time>_<plan>, with the folder name in place of a clock that was not set
function exportName(folder, header) {
    const clean = (text) => (text || '').replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '')
    const time = runTime(folder)
    return [clean(header.serial), time ? time.replace(' ', '_').replace(':', '-') : folder, clean(header.plan)].filter(Boolean).join('_')
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
            alignedStep: null,
            voltmeterFile: false,
            voltmeterValue: '',
            voltmeterStatus: '',
            sending: false,
            liveError: null,
            waiting: false
        }
    },
    computed: {
        busy() {
            const status = this.$store.state.machine.model.state.status
            return status === 'busy' || status === 'processing'
        },
        // The folder a test records into: its open log lies inside it
        runningFolder() {
            const logFile = this.$store.state.machine.model.state.logFile || ''
            const dir = `${RUNS_DIR}/`
            return logFile.indexOf(dir) === 0 ? logFile.substring(dir.length).split('/')[0] : null
        },
        // The selected folder is the one a test records into
        following() {
            return this.selected !== null && this.selected === this.runningFolder
        },
        // The run on screen is the printer's run that a test records into
        recording() {
            return !!this.run && this.runningFolder !== null && this.run.name === this.selected && this.selected === this.runningFolder
        },
        runEnded() {
            return this.run.events.some((event) => event.code === EVENT.RUN_END)
        },
        voltmeterOpen() {
            return this.recording && this.voltmeterFile && !this.runEnded
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
        mainsSeries() {
            const list = []
            const own = mainsPoints(this.run, 0)
            if (own.x.length) {
                list.push({ label: 'Mains at the socket', x: own.x, y: own.y, color: COLORS.mains, points: true })
            }
            if (this.reference) {
                const other = mainsPoints(this.reference, this.referenceShift)
                if (other.x.length) {
                    list.push({ label: 'ref Mains at the socket', x: other.x, y: other.y, color: COLORS.mains, dashed: true, points: true })
                }
            }
            return Object.freeze(list)
        },
        voltmeterRows() {
            const rows = []
            const idle = parseFloat(this.run.header.mains_v_idle)
            if (idle > 0) {
                rows.push({ key: 'idle', minutes: 'before heating', step: '', volts: fixed(idle, 1), power: '-', typed: '', file: FILES.header })
            }
            const c = this.run.samples.cols
            const percent = (value) => fixed(value * 100, 0, '%')
            for (let i = 0; i < this.run.readings.length; i++) {
                const reading = this.run.readings[i]
                rows.push({
                    key: reading.file,
                    minutes: fixed(reading.time / 60, 1),
                    step: isFinite(reading.step) ? `${reading.step}` : '',
                    volts: isFinite(reading.volts) ? fixed(reading.volts, 1) : 'unreadable',
                    power: reading.index >= 0 && c.H2_pwm && c.H3_pwm ? `${percent(c.H2_pwm[reading.index])} / ${percent(c.H3_pwm[reading.index])}` : '-',
                    typed: reading.text.split('\n')[0],
                    file: reading.file
                })
            }
            return rows
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
            if (parseInt(header.abi, 10) > ABI_VERSION) {
                lines.push(`Data format version ${header.abi} is newer than this plugin reads (${ABI_VERSION}): update the plugin.`)
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
                if (this.recording) {
                    const rows = parseInt(header.abi, 10) >= 3 ? `new rows every ${LIVE_SECONDS} s` : 'Refresh for new rows'
                    return { type: 'info', title: `The run is still in progress: ${rows}`, lines }
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
        // The same run, grown by a live look or loaded again, keeps its zoom, and a view that reaches the end follows it
        run(now, before) {
            if (now && before && now.name === before.name) {
                if (this.range[1] >= Math.ceil(before.samples.time[before.samples.n - 1] / 60)) {
                    this.range = [this.range[0], this.duration]
                }
                return
            }
            this.range = [0, this.duration]
            this.alignedStep = null
        },
        recording(now) {
            this.voltmeterFile = false
            this.voltmeterStatus = ''
            this.pending = null
            if (now) {
                this.checkVoltmeterFile()
            }
        },
        // The loop itself starts in showRun, once the followed run is on screen
        following(now, before) {
            clearTimeout(this.liveTimer)
            this.liveError = null
            // The test has let go of its log: one last look, for the rows and the RUN_END written since the previous one
            if (!now && before && this.source && this.source.folder === this.selected) {
                this.schedule(0)
            }
        },
        // A test started while the page is open and shows nothing
        runningFolder(now) {
            if (now && !this.selected && !this.run) {
                this.refresh()
            }
        }
    },
    created() {
        // Not reactive: the texts of the selected run as downloaded, and the live loop
        this.source = null
        this.liveTimer = null
        this.polling = false
        this.pending = null
    },
    mounted() {
        this.refresh()
    },
    beforeDestroy() {
        clearTimeout(this.liveTimer)
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
        // A run file's text, or null when it cannot be read
        async download(folder, name) {
            try {
                return await this.$store.dispatch('machine/download', {
                    filename: `${RUNS_DIR}/${folder}/${name}`,
                    type: 'text',
                    showProgress: false,
                    showSuccess: false,
                    showError: false
                })
            } catch (e) {
                return null
            }
        },
        // The run files whose size on the card differs from the last download: all of them the first time, and during a
        // live run the newest samples file and whatever else grew. True when anything changed.
        async downloadChanged(source) {
            const items = await this.$store.dispatch('machine/getFileList', `${RUNS_DIR}/${source.folder}`)
            let changed = false
            for (let i = 0; i < items.length; i++) {
                const item = items[i]
                if (item.isDirectory || !isRunFile(item.name) || source.sizes[item.name] === item.size) {
                    continue
                }
                // The single samples.csv of a run before version 3 grows to megabytes: never again while it records
                if (item.name === FILES.samples && source.sizes[item.name] !== undefined) {
                    continue
                }
                addRunFile(source.texts, item.name, await this.$store.dispatch('machine/download', {
                    filename: `${RUNS_DIR}/${source.folder}/${item.name}`,
                    type: 'text',
                    showProgress: item.name === FILES.samples,
                    showSuccess: false,
                    showError: false,
                    closeProgressOnSuccess: true
                }))
                source.sizes[item.name] = item.size
                changed = true
            }
            return changed
        },
        async downloadSource(folder) {
            const source = { folder, texts: newTexts(), sizes: {} }
            await this.downloadChanged(source)
            return source
        },
        showSource(source) {
            this.waiting = source.folder === this.runningFolder && !hasRows(source.texts)
            this.run = this.waiting ? null : buildRun(source.folder, source.texts)
        },
        schedule(ms) {
            clearTimeout(this.liveTimer)
            this.liveTimer = setTimeout(() => this.livePoll(), ms)
        },
        async livePoll() {
            const source = this.source
            if (!source || source.folder !== this.selected) {
                return
            }
            if (this.polling) {
                this.schedule(1000)
                return
            }
            this.polling = true
            // One more look after RUN_END, for what End.g writes after it
            const ended = !!this.run && this.runEnded
            try {
                if (await this.downloadChanged(source) && this.source === source) {
                    this.showSource(source)
                }
                // The test creates it once the heaters are at full power
                if (this.recording && !this.voltmeterFile) {
                    await this.checkVoltmeterFile()
                }
                this.liveError = null
            } catch (e) {
                this.liveError = e.message || `${e}`
            } finally {
                this.polling = false
            }
            if (this.pending && this.run && voltmeterTakes(this.run.events) > this.pending.before) {
                this.voltmeterStatus = `Taken: ${this.pending.volts} V`
                this.pending = null
            }
            if (!ended && this.following) {
                this.schedule(LIVE_SECONDS * 1000)
            }
        },
        async voltmeterFileExists() {
            const cut = VOLTMETER_INPUT.lastIndexOf('/')
            const name = VOLTMETER_INPUT.substring(cut + 1)
            const items = await this.$store.dispatch('machine/getFileList', VOLTMETER_INPUT.substring(0, cut))
            for (let i = 0; i < items.length; i++) {
                if (!items[i].isDirectory && items[i].name === name) {
                    return true
                }
            }
            return false
        },
        async checkVoltmeterFile() {
            try {
                this.voltmeterFile = await this.voltmeterFileExists()
            } catch (e) {
                this.voltmeterFile = false
            }
        },
        // The same write as a save in DWC's editor. The test takes the file within a row and writes a VOLTMETER event.
        async sendVoltmeter() {
            const volts = Number(this.voltmeterValue.trim().replace(',', '.'))
            if (!(volts >= MAINS_LOW && volts <= MAINS_HIGH)) {
                this.voltmeterStatus = `Type the reading in volts, ${MAINS_LOW} to ${MAINS_HIGH}`
                return
            }
            const folder = this.run.name
            this.sending = true
            try {
                // An upload creates a missing file, and outside a run nothing would take it out of the macro list
                if (!(await this.voltmeterFileExists())) {
                    this.voltmeterFile = false
                    this.voltmeterStatus = 'The test no longer takes readings'
                    return
                }
                // Counted on the card: readings saved in the editor since the run was loaded are already there
                const current = await this.download(folder, FILES.events)
                const before = current === null ? 0 : voltmeterTakes(parseEvents(current))
                await this.$store.dispatch('machine/upload', {
                    filename: VOLTMETER_INPUT,
                    content: new Blob([`${volts}\n`]),
                    showProgress: false,
                    showSuccess: false,
                    showError: false
                })
                this.voltmeterValue = ''
                this.voltmeterStatus = `Sent ${volts} V, waiting for the test to take it. Between steps it takes it on the next step's first row.`
                this.pending = { volts, before }
                this.schedule(3000)
            } catch (e) {
                this.error = e.message || `${e}`
            } finally {
                this.sending = false
            }
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
                if (!this.selected && !this.run && names.indexOf(this.runningFolder) >= 0) {
                    this.selected = this.runningFolder
                }
                if (this.selected) {
                    await this.showRun(this.selected)
                }
                if (this.recording) {
                    await this.checkVoltmeterFile()
                }
            })
        },
        async showRun(folder) {
            const source = await this.downloadSource(folder)
            this.source = source
            this.showSource(source)
            if (this.following) {
                this.schedule(LIVE_SECONDS * 1000)
            }
        },
        loadSelected() {
            return this.withLoading(async () => {
                if (this.selected) {
                    await this.showRun(this.selected)
                } else {
                    this.source = null
                    this.run = null
                    this.waiting = false
                }
            })
        },
        loadReference() {
            return this.withLoading(async () => {
                this.reference = this.referenceSelected ? buildRun(this.referenceSelected, (await this.downloadSource(this.referenceSelected)).texts) : null
            })
        },
        // The whole run folder, as it is on the card, for support
        exportZip() {
            const folder = this.selected
            return this.withLoading(async () => {
                const items = await this.$store.dispatch('machine/getFileList', `${RUNS_DIR}/${folder}`)
                const zip = new JSZip()
                let header = {}
                for (let i = 0; i < items.length; i++) {
                    if (!items[i].isDirectory) {
                        const blob = await this.$store.dispatch('machine/download', {
                            filename: `${RUNS_DIR}/${folder}/${items[i].name}`,
                            type: 'blob',
                            showProgress: true,
                            showSuccess: false,
                            showError: false,
                            closeProgressOnSuccess: true
                        })
                        zip.file(items[i].name, blob)
                        if (items[i].name === FILES.header) {
                            header = parseHeader(await blob.text())
                        }
                    }
                }
                saveAs(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `${exportName(folder, header)}.zip`)
            })
        },
        pick(target) {
            this.pickTarget = target
            this.$refs.files.value = ''
            this.$refs.files.click()
        },
        // Runs from other machines, and the older bench CSVs, live on the PC. The samples alone are enough.
        filesChosen(event) {
            const chosen = event.target.files
            return this.withLoading(async () => {
                const texts = newTexts()
                let name = 'files'
                for (let i = 0; i < chosen.length; i++) {
                    if (/\.zip$/i.test(chosen[i].name)) {
                        await addZipFiles(JSZip, texts, chosen[i])
                        name = chosen[i].name.replace(/\.zip$/i, '')
                    } else if (isRunFile(chosen[i].name)) {
                        addRunFile(texts, chosen[i].name, await chosen[i].text())
                        if (chosen[i].name === FILES.samples && chosen[i].webkitRelativePath) {
                            name = chosen[i].webkitRelativePath
                        }
                    }
                }
                if (samplesOf(texts) === undefined) {
                    throw new Error(`Choose ${FILES.samples} or the samples-<nnn>.csv files, or a ZIP that holds them`)
                }
                const loaded = buildRun(name, texts)
                if (this.pickTarget === 'reference') {
                    this.reference = loaded
                    this.referenceSelected = null
                } else {
                    this.source = null
                    this.waiting = false
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
