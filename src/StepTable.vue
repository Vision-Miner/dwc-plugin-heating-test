<template>
  <v-simple-table dense>
    <thead>
      <tr>
        <th>#</th>
        <th>Configuration</th>
        <th>Min</th>
        <th>Start bed / air</th>
        <th>Bed reached, min</th>
        <th>Overshoot</th>
        <th>Bed heater power</th>
        <th>Chamber air (S3) 60 / 90 / 95 / 99, min</th>
        <th>Chamber air (S3) max</th>
        <th>Chamber air (S3) end, per 10 min</th>
        <th>Chamber heater power</th>
        <th>Heater element (S4) max</th>
        <th>Element (S4) over 165 / 170, min</th>
        <th>Air (S3) minus Left / Right Head</th>
        <th>HEPA fan (F7) rpm</th>
      </tr>
    </thead>
    <tbody>
      <template v-for="row in rows">
        <tr :key="row.key" :class="{ 'grey--text': row.reference }" style="cursor: pointer" @click="$emit('select', row.number)">
          <td>{{ row.reference ? '' : row.number }}</td>
          <td>{{ row.reference ? `ref: ${row.label}` : row.label }}</td>
          <td>{{ f(row.k.minutes, 0) }}</td>
          <td>{{ f(row.k.bedStart, 0) }} / {{ f(row.k.airStart, 0) }}</td>
          <td>{{ f(row.k.bedReached, 1) }}</td>
          <td>{{ f(row.k.bedOver, 1) }}</td>
          <td>{{ f(row.k.bedPwm, 2) }}</td>
          <td>{{ f(row.k.air[60], 1) }} / {{ f(row.k.air[90], 1) }} / {{ f(row.k.air[95], 1) }} / {{ f(row.k.air[99], 1) }}</td>
          <td>{{ f(row.k.airMax, 1) }}</td>
          <td>{{ f(row.k.airEnd, 1) }}, {{ f(row.k.airMove, 1) }}</td>
          <td>{{ f(row.k.chamberDuty, 2) }}</td>
          <td>{{ f(row.k.s4Max, 1) }}</td>
          <td>{{ f(row.k.s4Over165, 1) }} / {{ f(row.k.s4Over170, 1) }}</td>
          <td :title="row.k.nozzlesSettled ? 'Settled' : 'Nozzles still moving'">
            {{ f(row.k.airMinusLeft, 1) }} / {{ f(row.k.airMinusRight, 1) }}{{ row.k.nozzlesSettled ? '' : ' *' }}
          </td>
          <td>{{ f(row.k.hepaRpm, 0) }}</td>
        </tr>
      </template>
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
        f(value, digits) {
            return isFinite(value) ? Number(value).toFixed(digits) : '-'
        }
    }
}
</script>
