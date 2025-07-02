const Bot = require('./src/Bot.js')
const secrets = require('./secrets.json')

process.on('unhandledRejection', error => {
	console.error('Unhandled promise rejection:', error);
});

const bot = new Bot()
bot.start(secrets).then(() => {
  console.log('Bot started')
}).catch((err) => {
  console.error('Error starting bot:', err)
})
