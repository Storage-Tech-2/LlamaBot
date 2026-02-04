import { Bot } from "./Bot.js";

process.on('unhandledRejection', error => {
	console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', err => {
	console.error('Synchronous error caught.', err);
});


const bot = new Bot();
bot.start();