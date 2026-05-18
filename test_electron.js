// Minimal test to check if Electron loads properly
const electron = require("electron");
console.log("typeof electron:", typeof electron);
console.log("process.type:", process.type);
console.log("process.versions.electron:", process.versions.electron);

if (typeof electron === "string") {
    console.error("ERROR: require('electron') returned a string (path), not the API module.");
    console.error("This means Electron is NOT running as the main process.");
    console.error("Returned path:", electron);
    process.exit(1);
}

const { app } = electron;
console.log("app exists:", !!app);
app.on("ready", () => {
    console.log("App is ready!");
    app.quit();
});

Checked command statu