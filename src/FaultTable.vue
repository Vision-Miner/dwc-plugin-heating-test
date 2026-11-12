<template>
  <v-simple-table dense>
    <thead>
      <tr>
        <th>Heater</th>
        <th>Model</th>
        <th>Level</th>
        <th>P / T</th>
        <th>This curve</th>
        <th>Smallest margin</th>
        <th>Check live, min</th>
        <th>Check blind, min</th>
        <th>Dead in heat-up</th>
        <th>Half power in heat-up</th>
        <th>Dead in hold</th>
        <th>Half power in hold</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(row, index) in rows" :key="index">
        <td>{{ row.heater === 'H2' ? 'Bed' : 'Chamber' }}</td>
        <td>{{ row.model }}</td>
        <td>{{ row.level }}</td>
        <td>{{ row.P }} / {{ row.T }}</td>
        <td :class="row.fired ? 'error--text' : ''">{{ row.fired ? `would fault, ${row.fired.type}, ${(row.fired.time / 60).toFixed(1)} min` : 'no fault' }}</td>
        <td>{{ isFinite(row.minMargin) ? `${row.minMargin.toFixed(1)}x` : '-' }}</td>
        <td>{{ row.checkedMinutes.toFixed(1) }}</td>
        <td>{{ row.blindMinutes.toFixed(1) }}</td>
        <td :class="cell(row.heatUpDead)">{{ time(row.heatUpDead) }}</td>
        <td :class="cell(row.heatUpHalf)">{{ time(row.heatUpHalf) }}</td>
        <td :class="cell(row.holdDead)">{{ time(row.holdDead) }}</td>
        <td :class="cell(row.holdHalf)">{{ time(row.holdHalf) }}</td>
      </tr>
    </tbody>
  </v-simple-table>
</template>

<script>
'use strict'

export default {
    props: {
        rows: { type: Array, required: true }
    },
    methods: {
        isFinite(value) {
            return Number.isFinite(value)
        },
        time(minutes) {
            if (minutes === null) {
                return '-'
            }
            return minutes < 0 ? 'never' : `${minutes.toFixed(1)} min`
        },
        cell(minutes) {
            return minutes !== null && minutes < 0 ? 'warning--text' : ''
        }
    }
}
</script>
