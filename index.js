const Bot = require('./src/Bot.js')
const secrets = require('./secrets.json')

const bot = new Bot()
bot.start(secrets).then(() => {
  console.log('Bot started')
}).catch((err) => {
  console.error('Error starting bot:', err)
})
