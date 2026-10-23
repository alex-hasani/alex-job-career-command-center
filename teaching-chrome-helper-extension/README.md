# Alex Job Teaching Browser Helper

This is the source template for the separate Teaching Chrome helper. The Teaching dashboard exports a ZIP with a per-user configuration file. Extract that ZIP and load its folder as an unpacked extension in the same Chrome profile as the IT helper.

The Teaching helper uses its own browser-agent channel. It does not reuse the IT helper installation, job database, document folder, or application queue.

After updating the installed Teaching helper, reload it at `chrome://extensions`. Test a non-submitting form preparation before relying on it for an application.
