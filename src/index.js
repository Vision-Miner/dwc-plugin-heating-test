'use strict'

import { registerRoute } from '@/routes'
import HeatingTest from './HeatingTest.vue'

registerRoute(HeatingTest, {
    Plugins: {
        HeatingTest: {
            icon: 'mdi-chart-line',
            caption: 'Heating Test',
            translated: false,
            path: '/HeatingTest'
        }
    }
})
