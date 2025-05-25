const got = require('got')
const URL = 'http://localhost:8000/generate'
const PromptTemplates = {
  extraction: 'extraction_prompt.txt',
  modification: 'modification_prompt.txt'
}
const fs = require('fs/promises')
const path = require('path')

module.exports = class LLMUtils {
  static async getLLMResponse (prompt) {
    try {
      const response = await got.post(URL, {
        json: {
          mode: 'extraction',
          input_text: prompt
        },
        timeout: 30000 // 30 seconds
      }).json()

      return response.result
    } catch (error) {
      console.error('Error fetching LLM response:', error)
      throw error
    }
  }

  static async promptFromTemplate (template, data) {
    // template path: ../prompts/
    const templatePath = path.join(__dirname, '../prompts', PromptTemplates[template])
    try {
      const templateContent = await fs.readFile(templatePath, 'utf-8')
      let prompt = templateContent

      for (const [key, value] of Object.entries(data)) {
        prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), value)
      }

      return prompt
    } catch (error) {
      console.error('Error reading prompt template:', error)
      throw error
    }
  }
}
