import { FILES, SAMPLES_PART, VOLTMETER_FILE } from './abi.js'
import { joinSamples } from './parse.js'

// The texts of one run: the single files under the keys of FILES, samples parts and voltmeter files by name
export function newTexts() {
    return { parts: {}, voltmeter: {} }
}

export function isRunFile(name) {
    if (SAMPLES_PART.test(name) || VOLTMETER_FILE.test(name)) {
        return true
    }
    const keys = Object.keys(FILES)
    for (let k = 0; k < keys.length; k++) {
        if (FILES[keys[k]] === name) {
            return true
        }
    }
    return false
}

export function addRunFile(texts, name, text) {
    if (SAMPLES_PART.test(name)) {
        texts.parts[name] = text
    } else if (VOLTMETER_FILE.test(name)) {
        texts.voltmeter[name] = text
    } else {
        const keys = Object.keys(FILES)
        for (let k = 0; k < keys.length; k++) {
            if (FILES[keys[k]] === name) {
                texts[keys[k]] = text
            }
        }
    }
}

// The run's samples as one text, undefined without any
export function samplesOf(texts) {
    const names = Object.keys(texts.parts).sort()
    if (names.length === 0) {
        return texts.samples
    }
    const parts = []
    for (let i = 0; i < names.length; i++) {
        parts.push(texts.parts[names[i]])
    }
    return joinSamples(parts)
}

// Run files out of a ZIP, wherever they sit inside it. JSZip is passed in so this also runs under node.
export async function addZipFiles(JSZip, texts, data) {
    const zip = await JSZip.loadAsync(data)
    const names = Object.keys(zip.files)
    for (let i = 0; i < names.length; i++) {
        const base = names[i].substring(names[i].lastIndexOf('/') + 1)
        if (!zip.files[names[i]].dir && isRunFile(base)) {
            addRunFile(texts, base, await zip.files[names[i]].async('string'))
        }
    }
}
