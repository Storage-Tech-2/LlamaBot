const Bot = require('./src/Bot.js')
const secrets = require('./secrets.json')

process.on('unhandledRejection', error => {
	console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', err => {
	console.error('Synchronous error caught.', err);
});

const bot = new Bot()
bot.start(secrets).then(() => {
  console.log('Bot started')
}).catch((err) => {
  console.error('Error starting bot:', err)
})
