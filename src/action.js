import _ from 'lodash'

import utils from './utils'

class Action {
  constructor () {
    this.notions = []
    this.dependencies = []
    this.defaultValidator = (entity) => entity
  }

  name () {
    return this.constructor.name
  }

  // Basic validation of the actions's structure:
  // It should have an intent, an array of dependencies and notions
  validate () {
    if (typeof this.intent !== 'string') {
      return false
    }

    if (!Array.isArray(this.dependencies) || !Array.isArray(this.notions)) {
      return false
    }

    const dependenciesValidity = this.dependencies.every(dep => {
      if (typeof dep.isMissing !== 'object') {
        return false
      }

      if (!Array.isArray(dep.actions)) {
        return false
      }

      return dep.actions.every(a => typeof a === 'string')
    })

    if (!dependenciesValidity) {
      return false
    }

    const notionsValidity = this.notions.every(n => {
      if (typeof n.isMissing !== 'object') {
        return false
      }

      if (!Array.isArray(n.entities)) {
        return false
      }

      return n.entities.every(e => typeof e === 'object' && typeof e.entity === 'string' && typeof e.alias === 'string')
    })

    if (!notionsValidity) {
      return false
    }

    const requiresItself = this.dependencies.some(dependency => dependency.actions.some(a => a === this.name()))

    if (this.dependencies.length > 0 && requiresItself) {
      return false
    }

    return true
  }

  // Returns all actions required by the current action
  allDependencies () {
    return _.flatten(this.dependencies.map(d => d.actions))
  }

  // Returns all entities contained in notions of the current action
  allNotions () {
    return _.flatten(this.notions.map(c => c.entities))
  }

  /* returns true if all the dependencies of the current action are complete
   * Parameters:
   * actions: all actions of the bot
   * conversation: a conversation model
   */
  dependenciesAreComplete (actions, conversation) {
    return this.dependencies.every(dependency => dependency.actions.some(a => {
      const requiredAction = actions[a]
      if (!requiredAction) {
        throw new Error(`Action ${a} not found`)
      }
      return requiredAction.isDone(conversation)
    }))
  }

  // Returns true if all the notions are complete
  notionsAreComplete (memory) {
    return this.notions.every(notion => notion.entities.some(e => memory[e.alias]))
  }

  // An action is actionable when all dependencies are complete
  isActionable (actions, conversation) {
    return this.dependenciesAreComplete(actions, conversation)
  }

  // An action is done when all dependencies and notions are complete
  isComplete (actions, conversation) {
    return this.dependenciesAreComplete(actions, conversation)
      && this.notionsAreComplete(conversation.memory)
  }

  isDone (conversation) {
    return conversation.actionStates[this.name()] === true
  }

  // Returns all notions that are not completed
  // A notion is complete when at least one entity is filled in memory
  getMissingEntities (memory) {
    return this.notions.filter(c => c.entities.some(e => memory[e.alias]) === false)
  }

  // Returns all dependencies that are not completed
  // A dedendency is complete when at least one prerequisite is done
  getMissingDependencies (actions, conversation) {
    return this.dependencies
      .filter(d => d.actions.map(a => actions[a]).every(a => !a.isDone(conversation)))
  }

  /* process returns the reply of the action dependencig on the conversation state
   * Parameters:
   * conversation: a conversation model
   * actions: all actions in the bot
   * recastResponse: the recast text analysis for the current input
   */
  process (conversation, actions, recastResponse) {
    return new Promise((resolve, reject) => {
      // Check if the action has all it needs
      if (this.isComplete(actions, conversation)) {
        // We expect to have a 'reply' method defined
        if (this.reply) {
          return Promise.resolve(this.reply(conversation, recastResponse))
            .then(resolve).catch(reject)
        }
        return reject(new Error('No reply found'))
      }
      // The action asks for a missing notion
      return resolve(utils.getRandom(this.getMissingEntities(conversation.memory)).isMissing)
    })
  }
}

module.exports = Action
