const { app } = require('electron')
const path = require('path')

app.whenReady().then(async () => {
  try {
    const action = process.argv[2]
    // Require the built module from out/main
    const rpa = require(path.join(__dirname, '../out/main/index.js'))

    // As index.js initializes the main app window, we might need a separate built entry for tests or just do it after require
    console.log('[Test Runner] Running action:', action)
  } catch (err) {
    console.error(err)
  }
  app.quit()
})
