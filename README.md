# Vision Miner Heating Test (DWC plugin)

A page in Duet Web Control that reads the heating test's run folders from the card, or files chosen on the PC, and draws them: charts, per-step numbers, the mains voltmeter readings, a comparison with a second run, and a replay of the firmware's fault checks with what-if levels and models.

While a test records, the page opens on its run and follows it: every 15 s it downloads the newest samples file and whatever else grew. It never sends G-code. Its only write is a voltmeter reading typed on the page while a test records, into the file the test takes readings from. Export ZIP packs the selected run's folder from the card, with its files unchanged, for sending to support, as `<serial>_<date>_<time>_<plan>.zip`. Open files or ZIP reads a run from the PC: its CSV and voltmeter files, or a ZIP that holds them, such as an exported one.

- Data contract: `ABI.md` and `src/lib/abi.js`
- Build: `./build.sh`, which reuses the DWC 3.5.4 checkout of `../dwc-plugin-debug-tools`. Output: `dist/dwc-plugin-heating-test-<version>.zip`
- Install: DWC, System, Plugins, Install plugin, then enable it