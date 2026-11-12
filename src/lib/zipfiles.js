// Run files out of a ZIP, wherever they sit inside it. JSZip is passed in so this also runs under node.
export async function textsFromZip(JSZip, data, wanted) {
    const zip = await JSZip.loadAsync(data)
    const texts = {}
    const names = Object.keys(zip.files)
    const keys = Object.keys(wanted)
    for (let i = 0; i < names.length; i++) {
        const entry = zip.files[names[i]]
        const base = names[i].substring(names[i].lastIndexOf('/') + 1)
        for (let k = 0; k < keys.length; k++) {
            if (!entry.dir && base === wanted[keys[k]] && texts[keys[k]] === undefined) {
                texts[keys[k]] = await entry.async('string')
            }
        }
    }
    return texts
}
