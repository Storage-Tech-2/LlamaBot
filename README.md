## LlamaBot: Automatic Archive Assistant
Helps manages submissions for discord based archives. The bot currently has the following features:

* Guided submissions process with interactive elements helps create consistent, standardized posts
* Local LLM writing assistant creates the initial post and aids with editing it
* Automatic image reprocessing and litematic info extraction
* Seperate Endorser and Editor roles direct what gets archived and what needs further review
* Github integration: Archives are backed up on a Github repository in a machine readable format
* Thank you points: Keeps track of when people say "thanks" to another and rewards helpers with a special role

## Choosing colors
http://storagetech2.org/debug/colorpicker/

## Requirements
* Node.js
* Python
* Java
* Git

## Setup
1. Clone the repository
2. Put your Discord bot token and xAI keys in `secrets.json`
3. Put the GitHub app private key in `key.pem`
4. Run `npm install` to install dependencies
5. Run `npm run dev` to start the bot in development mode, or `npm run start` for production mode.

