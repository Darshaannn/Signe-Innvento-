const { app } = require('electron');
console.log('--- TEST START ---');
console.log('Electron version:', process.versions.electron);
console.log('App object type:', typeof app);
console.log('App object:', app ? 'Defined' : 'Undefined');
if (app && app.commandLine) {
    console.log('app.commandLine is available');
} else {
    console.log('app.commandLine is NOT available');
}
console.log('--- TEST END ---');
process.exit(0);
