import { app } from 'electron'
import { runScreenshotTest } from '../src/core/rpa/tests/test-screenshot'
import { runReplyTest } from '../src/core/rpa/tests/test-reply'
import { runSwitchTest } from '../src/core/rpa/tests/test-switch'
import { checkAndRequestPermissions } from '../src/main/permission'

app.whenReady().then(async () => {
  try {
    await checkAndRequestPermissions()

    const action = process.env.TEST_MODE
    console.log(`\n\n--- 🚀 Running isolated atom CLI test: ${action} ---\n\n`)
    
    if (action === 'screenshot') await runScreenshotTest()
    else if (action === 'reply') await runReplyTest()
    else if (action === 'switch') await runSwitchTest()
    else console.error(`Unknown test mode: ${action}`)

  } catch (err) {
    console.error(err)
  } finally {
    console.log('\n\n--- 🏁 CLI Test Finished ---\n\n')
    app.quit()
  }
})
