const fs = require('fs/promises')
const Path = require('path')
const Submission = require('./Submission.js')

module.exports = class SubmissionsManager {
  constructor (storagePath) {
    this.submissions = new Map()
    this.storagePath = storagePath
  }

  async makeSubmission (forumThreadId) {
    const folderPath = Path.join(this.storagePath, forumThreadId)
    await fs.mkdir(folderPath, { recursive: true })

    const submission = new Submission(forumThreadId, folderPath)
    this.submissions.set(forumThreadId, submission)

    return submission
  }

  async getSubmission (forumThreadId) {
    if (this.submissions.has(forumThreadId)) {
      const submission = this.submissions.get(forumThreadId)
      submission.lastAccessed = Date.now()
      return submission
    }

    // Check file system
    const folderPath = Path.join(this.storagePath, forumThreadId)
    // check if folder exists
    try {
      await fs.access(folderPath)
    } catch (e) {
      return null
    }

    // Load submission from path
    try {
      const submission = await Submission.fromPath(folderPath)
      submission.lastAccessed = Date.now()
      this.submissions.set(forumThreadId, submission)

      if (this.submissions.size > 5) {
        // Remove the oldest submission
        const oldestSubmission = Array.from(this.submissions.values()).filter(v => v.canJunk()).reduce((oldest, current) => {
          return current.lastAccessed < oldest.lastAccessed ? current : oldest
        })
        await oldestSubmission.save()
        this.submissions.delete(oldestSubmission.forumThreadId)
      }
      return submission
    } catch (e) {
      console.error('Error loading submission:', e)
      return null
    }
  }

  async purgeOldSubmissions () {
    const now = Date.now()
    const threshold = 1000 * 60 * 60 * 24 // 1 day

    const submissionsToDelete = []
    for (const [forumThreadId, submission] of this.submissions.entries()) {
      if (now - submission.lastAccessed > threshold && submission.canJunk()) {
        submissionsToDelete.push(forumThreadId)
      }
    }

    for (const forumThreadId of submissionsToDelete) {
      const submission = this.submissions.get(forumThreadId)
      if (submission) {
        await submission.save()
        this.submissions.delete(forumThreadId)
      }
    }
  }
}
