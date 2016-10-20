import _ from 'lodash'
import axios from 'axios'
import mongoose from 'mongoose'

import Conversation from './conversation'
import utils from './utils'

mongoose.Promise = global.Promise

class Bot {
  constructor (opts) {
    this.actions = {}
    this.token = opts && opts.token
    this.language = opts && opts.language
    this.fallbackReplies = opts && opts.fallbackReplies
  }

  // Opens a connection to mongodb for the storage of conversations
  useDatabase (conf) {
    this.useDb = true
    let db = 'mongodb://'
    if (conf.username) {
      db = `${db}${conf.username}:${conf.password}@`
    }
    db = `${db}${conf.hostname}:${conf.port}/${conf.name}`
    if (!conf.ssl) {
      db = `{db}?ssl=${conf.ssl}`
    }

    mongoose.connect(db, (err) => {
      if (err) { throw err }
    })
  }

  // Sets the replies of the bot when it doesn't understand the user
  setFallbackReplies (replies) {
    this.fallbackReplies = replies
  }

  /* Register an action to the bot
   * Actions are stored in a object mapping names to instances
   * Parameters:
   * Action: a class that will be instanciated and stored in the bot. This class must inherit Action's class from bot-dialog-manager
   */
  registerAction (Action) {
    let newAction = null

    try {
      newAction = new Action()
    } catch (e) {
      throw new Error(`${Action} parameter should be a class`)
    }

    if (this.actions[newAction.name()]) {
      throw new Error(`${newAction.name()} is already registered`)
    }

    if (!newAction.validate()) {
      throw new Error(`Invalid action: ${newAction.name()}`)
    }

    this.actions[newAction.name()] = newAction
  }

  /* Registers an array of actions to the bot
   * Registers an array of actions.
   * see registerAction
   */
  registerActions (Actions) {
    if (Array.isArray(Actions)) {
      Actions.forEach(action => { this.registerAction(action) })
    } else {
      throw new Error(`${Actions} should be an array of actions`)
    }
  }

  /* Returns the action corresponding to `name`
   * Parameters:
   * name: the name of the action
   */
  findActionByName (name) {
    return this.actions[name]
  }

  /* Marks an action as done in the conversation's states
   * Parameters:
   * action: An Action instance or an Action's name
   * conversation: A Conversation model
   */
  markActionAsDone (action, conversation) {
    if (typeof action === 'string') {
      conversation.actionStates[action] = true
    } else {
      conversation.actionStates[action.name()] = true
    }
  }

  /* initialize should resolve the conversation linked to the conversationId
   * The conversation should be found or created in db, or directly instanciated
   * Parameters:
   * conversationId: String to identify the conversation. This can come from the messaging service for example.
   */
  initialize (conversationId) {
    return new Promise((resolve, reject) => {
      if (!this.useDb) {
        return resolve(new Conversation({
          conversationId,
          userData: {},
          memory: {},
          actionStates: {},
        }))
      }
      Conversation.findOne({ conversationId }).then(res => {
        if (res) {
          return resolve(res)
        }
        Conversation.create({
          conversationId,
          userData: {},
          memory: {},
          actionStates: {},
        }).then(resolve).catch(reject)
        return true
      }).catch(err => reject(err))
      return true
    })
  }

  /* expandVariables takes a string and returns
   * The reply with variables replaced by their respective values
   * If the notion is a string, its value is if used for replacement.
   * If it's an object we can access fields of this object to replace the placeholder
   * If no field is present we use the 'raw' field returned by Recast.AI API
   * All these examples are valid variable placeholders:
   * - {{name.raw}}
   * - {{ name  }}
   * - {{ location.formatted }}
   * Parameters:
   * reply: The reply string
   * memory: Object containing the bot's notions
   */
  expandVariables (reply, memory) {
    const replacer = (match, v, f) => {
      if (!memory[v]) { return '' }

      const variable = memory[v]
      const field = f || 'raw'

      if (typeof variable === 'string') {
        return variable
      }

      if (!variable[field]) { return '' }
      return variable[field]
    }
    return reply.replace(/{{\s*([a-zA-Z0-9\-_]+)\.?([a-zA-Z0-9\-_]+)?\s*}}/g, replacer)
  }

  /* Takes a reply and returns the expanded reply if it's a string
   * reply: Can be any object comming from an action. It will be evaluated if it's a  string.
   *        It can take any value to handle the different formats of messagin platform replies.
   * memory: Object containing the bot's notions
   */
  evaluateReply (reply, memory) {
    if (typeof reply === 'string') {
      return this.expandVariables(reply, memory)
    }

    return reply
  }

  /* Calls Recast.AI API
   * Parameters:
   * text: the user's input
   * token: Recast.AI API authentication token
   * language: (optional) If provided, this will force the process of the input in this language
   */
  callToRecast (text, token, language) {
    const data = { text }

    // Force the process in the language parameter if provided
    if (language) {
      data.language = language
    }

    return axios({
      method: 'post',
      headers: { Authorization: `Token ${token}` },
      url: 'https://api.recast.ai/v2/request',
      data,
    })
  }

  /* Main method of the bot: This method do the following steps:
   * Initialize the conversation
   * Call Recast API for language comprehension
   * Choose the action to process depending on the input
   * Resolve dependencies between actions
   * Process the action to get a reply
   * Resolve the reply
   * Parameters:
   * input: the user's input
   * conversationId: String to identify the conversation. This can come from the messaging service for example.
   * opts: (optional) Object containing options for the request(token and language)
   */
  reply (input, conversationId, opts) {
    const tok = (opts && opts.token) || this.token
    const language = (opts && opts.language) || this.language
    return new Promise((resolve, reject) => {
      if (!tok) {
        return reject('No token provided')
      }

      // Find or create the conversation
      this.initialize(conversationId).then(conversation => {
        if (!conversation.memory) { conversation.memory = {} }
        if (!conversation.userData) { conversation.userData = {} }
        if (!conversation.actionStates) { conversation.actionStates = {} }

        // Call Recast.AI API for language understanding
        this.callToRecast(input, tok, language).then(res => {
          const results = res.data.results
          let act = null

          // Try to find a action to process using context
          if (results.intents.length === 0) {
            act = this.searchActionWithoutIntent(conversation, results.entities)

            // Use fallback replies if we can't
            if (!act && this.fallbackReplies) {
              return resolve(this.evaluateReply(this.pickReplies([this.fallbackReplies], results.language)))
            }
            if (!act) {
              return reject('No response set when no intent is matched')
            }
          }

          // Find an action corresponding to the current intent
          let action = act || this.retrieveAction(conversation, results.intents[0].slug)

          if (!action) {
            return reject(new Error(`No action found for intent ${results.intents[0].slug}`))
          }
          const replies = []

          let message = null
          let lastAction = null
          // Loop through the dependencies while the action has incomplete dependencies
          while (!action.isActionable(this.actions, conversation)) {
            const deps = action.getMissingDependencies(this.actions, conversation)

            const dep = utils.getRandom(deps)

            // Transition message between actions
            message = dep.isMissing

            // If we have a OR relation, we let the user decide what he wants
            if (dep.actions.length > 1) {
              lastAction = action.name()
              action = null
              break
            }

            action = this.actions[dep.actions[0]]
          }

          if (action) { lastAction = action.name() }
          // Save the action we will process
          conversation.lastAction = lastAction

          if (message) { replies.push(message) }

          this.updateMemory(results.entities, conversation, action).then(msg => {
            // Maybe a validator rejected the it's input
            if (msg) { replies.push(msg) }

            if (action) {
              // Process the curent action
              action.process(conversation, this.actions, results)
                .then(resp => {
                  let p = Promise.resolve()
                  if (action.isComplete(this.actions, conversation)) {
                    // Mark the action as done in the conversation states
                    conversation.actionStates[action.name()] = true

                    // Reset the conversation if the action is the end of the conversation
                    if (action.endConversation) {
                      conversation.memory = {}
                      conversation.actionStates = {}
                      conversation.userData = {}
                      conversation.lastAction = null
                    } else if (action.next) {
                      // Contiunue the conversation flow if the action has a next
                      p = this.actions[action.next].process(conversation, this.actions, results)
                    }
                  }
                  // TODO: refactor the code duplication
                  // Process the next action or nothing
                  p.then(nextResp => {
                    this.saveConversation(conversation, () => {
                      replies.push(resp)
                      if (nextResp) { replies.push(nextResp) }

                      // Choose and expand all replies
                      const resps = this.pickReplies(replies, results.language)
                      return resolve(resps.map(r => this.evaluateReply(r, conversation.memory)))
                    })
                  }).catch(nextResp => {
                    this.saveConversation(conversation, () => {
                      replies.push(resp)
                      if (nextResp) { replies.push(nextResp) }

                      // Choose and expand all replies
                      const resps = this.pickReplies(replies, results.language)
                      return resolve(resps.map(r => this.evaluateReply(r, conversation.memory)))
                    })
                  })
                }).catch(resp => {
                  this.saveConversation(conversation, () => {
                    replies.push(resp)

                    // Choose and expand all replies
                    const resps = this.pickReplies(replies, results.language)
                    return resolve(resps.map(r => this.evaluateReply(r, conversation.memory)))
                  })
                })
            } else {
              // We blocked on a OR dependency, just save and resolve the reply
              this.saveConversation(conversation, () => {
                const resps = this.pickReplies(replies, results.language)
                return resolve(resps.map(r => this.evaluateReply(r, conversation.memory)))
              })
            }
            return true
          }).catch(reject)
          return true
        }).catch(reject)
      }).catch(reject)

      return true
    })
  }

  // Picks a random reply amongst the array of the reply object in parameter for the corresponding language
  /* pickReplies choose random replies in the actions replies
   * Parameters:
   * responses: An array of replies. Each reply should either an array of strings, or a object mapping languages to strings or array
   * languages: the isocode of the processd language
   *
   * all these objects are valid replies:
   * - ['Hello {{name}}!']
   * - { en: 'Hello!', fr: ['Salut', 'Bonjour {{name}}'] }
   * - { en: ['Hello'], fr: ['Salut'] }
   */
  pickReplies (responses, language) {
    return responses.map(r => {
      if (Array.isArray(r)) { return utils.getRandom(r) }

      const resps = r[language] || r.en

      if (Array.isArray(resps)) { return utils.getRandom(resps) }

      return resps
    })
  }

  /* Updates memory with input's entities
   * Priority: 1) notion of the current action
   *           2) any notion that is alone in the bot
   * Parameters:
   * entities: an object containing all entities deteceted in the sentence and enriched
   * conversation: a conversation model
   * action: the current action we are processing
   */
  updateMemory (entities, conversation, action) {
    let actionNotions = null

    if (action) {
      actionNotions = _.flatten(action.notions.map(c => c.entities))
    }

    return new Promise(resolve => {
      const promises = []

      // loop through the entities map
      _.forOwn(entities, (entitiesArray, name) => {
        // search for a notion of the current action
        const actionNotion
          = (actionNotions && actionNotions.find(k => k.entity === name)) || null
        // For each entity in the input we look for the corresponding notion and fill it
        // if the validator's promise resolves
        entitiesArray.forEach(entity => {
          if (actionNotion) {
            // Uses the action's validator or a default one
            const validator = actionNotion.validator || (e => e)

            promises.push(new Promise((resolv, rejec) => {
              // This promise resolves the value resolved by the validator or the complete entity
              // This allows the validator to make some processing or formatting
              Promise.resolve(validator(entity, conversation.memory))
                .then(res => resolv({ name: actionNotion.alias, value: res || entity }))
                .catch(err => rejec(err))
            }))
          } else {
            // search for a notion of any action in the conversation
            const globalNotions = _.flatten(_.values(this.actions)
              .map(a => a.allNotions()))
              .filter(k => k.entity === name && !conversation.memory[k.alias])

            if (globalNotions.length === 1) {
              // Same as above
              const validator = globalNotions[0].validator || (e => e)

              promises.push(new Promise((resolv, rejec) => {
                Promise.resolve(validator(entity, conversation.memory))
                  .then(res => resolv({ name: globalNotions[0].alias, value: res || entity }))
                  .catch(err => rejec(err))
              }))
            }
          }
        })
      })

      if (promises.length === 0) {
        return resolve()
      }

      const e = []
      // Let all the validators do their job
      // We cathc all promises to avoid the reject of promise.all
      Promise.all(promises.map(p => p.catch(err => { e.push(err) }))).then(res => {
        // Update the memory for all resolved validators
        res.filter(el => el).forEach(entity => {
          const { name, value } = entity
          conversation.memory[name] = value
        })

        // Eventually return a message from a validator that rejected the input
        if (e.length > 0) {
          return resolve(e[e.length - 1])
        }

        return resolve()
      })
      return true
    })
  }

  // Returns all the actions that require the `action` parameter
  nextOf (action) {
    return _.values(this.actions).filter(a => a.allDependencies().indexOf(action.name()) !== -1)
  }

  /* Try to choose an action to process without matching intent using the context of the conversation
   * Parameters:
   * conversation: a conversation model
   * entities: entities extracted and enriched by Recast
   */
  searchActionWithoutIntent (conversation, entities) {
    const last = this.actions[conversation.lastAction]
    if (!last) { return null }

    // Choose the last processed action if it matches the requirements
    if (this.shouldChooseAction(last, conversation, entities)) {
      return last
    }

    const nexts = this.nextOf(last)

    if (nexts.length !== 1) { return null }

    // Choose the next otherwise if it matches
    if (this.shouldChooseAction(nexts[0], conversation, entities)) {
      return nexts[0]
    }

    return null
  }

  /* Returns true if the `action` parameter should be processed for this input
   * We choose the action if there is a single missing notion
   * Parameters:
   * action: the action to choose or not
   * conversation: a conversation model
   * entities: entities extracted in the current user input
   */
  shouldChooseAction (action, conversation, entities) {
    let shouldChoose = false

    _.forOwn(entities, (values, key) => {
      // Find the notions corresponding to the entity
      const notion = action.allNotions().find(c => c.entity === key)
      // The action is chosen if there is only one empty notion
      if (values.length === 1 && notion && !conversation.memory[notion.alias]) {
        shouldChoose = true
      }
    })
    return shouldChoose
  }

  /* Returns the action to process for the detected intent
   * Parameters:
   * conversation: a conversation model
   * intent: the intent detected for the current user input
   */
  retrieveAction (conversation, intent) {
    // Actions corresponding to the action
    const matchingActions = _.values(this.actions).filter(a => a.intent === intent)
    // Last action processed
    const lastAction = this.actions[conversation.lastAction]
    let action = null

    if (matchingActions.length === 0) {
      return null
    } else if (matchingActions.length === 1) {
      return matchingActions[0]
    }

    // If several actions match the intent
    if (lastAction) {
      if (lastAction.isDone(conversation)) {
        // Looks for an action following lastAction if it's done
        action = matchingActions.find(a => this.nextOf(lastAction).indexOf(a) !== -1)
      } else {
        // Looks if lastAction is amongst all the matching actions
        action = matchingActions.find(a => a.name() === lastAction.name())
      }
    }

    // If we didnt find any acion, we try to choose the closest action from the beginning of the conversation
    return action || this.findActionByLevel(conversation, intent) || matchingActions[0]
  }

  /* Search for an incomplete action the closest of the beginning of the conversation
   * Parameters:
   * conversation: a conversation model
   * intent: the intent detected for the current user input
   */
  findActionByLevel (conversation, intent) {
    // Actions that are required by others
    const requiredActions = new Set(_.flatten(_.values(this.actions).map(a => a.allDependencies())))
    // Actions that are not required by others (standalone actions or leafs)
    const leafs = _.keys(this.actions).filter(a => !requiredActions.has(a))
    let queue = leafs.map(a => this.actions[a])
    const buffer = []
    let level = 0

    // We loop through all the levels of the graph and store all the actions matching `intent` with their positions in the graph
    while (queue.length > 0) {
      queue.filter(a => a.intent === intent).forEach(action => {
        if (!action.isDone(conversation)) {
          buffer.push({ level, action })
        }
      })

      // All actions that are required by the current level
      const sublevel = _.flatten(queue.map(a => a.allDependencies().map(ac => this.actions[ac])))

      queue = sublevel
      level += 1
    }

    if (buffer.length === 0) { return null }

    // We sort all actions by their level to find the deepest action
    const sorted = buffer.sort((a, b) => a.level - b.level)

    // Returns the deeper action not completed in the conversation graph
    return sorted[sorted.length - 1].action
  }

  saveConversation (conversation, cb) {
    if (this.useDb) {
      conversation.markModified('userData')
      conversation.markModified('actionStates')
      conversation.markModified('memory')
      conversation.markModified('lastAction')
      conversation.save(err => {
        if (cb) {
          return cb(err)
        }
      })
    } else if (cb) {
      return cb()
    }
  }
}

module.exports = Bot
