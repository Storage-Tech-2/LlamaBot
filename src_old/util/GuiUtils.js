const fs = require('fs/promises')
const Path = require('path')
const buttonsPath = Path.join(__dirname, '../buttons')
const menusPath = Path.join(__dirname, '../menus')
const modalsPath = Path.join(__dirname, '../modals')
module.exports = class GUIUtils {
  static async getItemsFromPath (path) {
    const items = new Map()
    const itemFiles = (await fs.readdir(path)).filter(file => file.endsWith('.js'))

    for (const file of itemFiles) {
      const item = require(Path.join(path, file))
      if (items.has(item.getName())) {
        throw new Error('Duplicate item ' + item.getName())
      }
      items.set(item.getName(), item)
    }
    return items
  }

  static async getButtons () {
    return this.getItemsFromPath(buttonsPath)
  }

  static async getMenus () {
    return this.getItemsFromPath(menusPath)
  }

  static async getModals () {
    return this.getItemsFromPath(modalsPath)
  }
}
