import test from 'ava'
import _ from 'lodash'
import sinon from 'sinon'
import 'sinon-as-promised'
import 'sinon-mongoose'

import Bot from '../src/bot'
import Action from '../src/action'
import Conversation from '../src/conversation'

class Greetings extends Action {
  constructor() {
    super()
    this.intent = 'greetings'
  }
}

class Order extends Action {
  constructor() {
    super()
    this.intent = 'order'
    this.dependencies = [{ actions: ['Greetings'], isMissing: { en: [] } }]
  }
}

test('Bot#initialize', async t => {
  sinon.mock(Conversation)
       .expects('findOne')
       .withArgs({ conversationId: 'abcd' })
       .resolves(new Conversation({
         conversationId: 'abcd',
         userData: {},
         actionStates: {},
         memory: {},
       }))
  const b = new Bot()
  b.useDb = true
  b.initialize('abcd').then(res => {
    t.truthy(res)
  }).catch(t.fail)
})

test('Bot#registerAction', t => {
  class Invalid extends Action {
    constructor() {
      super()
      this.notions = [{ entity: 'datetime', alias: 'departure' }]
    }
  }

  const bot = new Bot()
  let error = null
  try {
    bot.registerAction(Invalid)
  } catch (e) {
    error = e
  }
  t.true(error !== null)
  t.true(error.message === 'Invalid action: Invalid')
  t.is(_.keys(bot.actions).length, 0)

  error = null
  try {
    bot.registerAction(Greetings)
  } catch (e) {
    error = e
  }
  t.is(error, null)
  t.is(_.keys(bot.actions).length, 1)

  error = null
  try {
    bot.registerAction(Greetings)
  } catch (e) {
    error = e
  }

  t.truthy(error)
  t.is(error.message, 'Greetings is already registered')
})

test('Bot#findActionByName', t => {
  const bot = new Bot()
  bot.registerActions([Greetings, Order])
  t.true(typeof bot.findActionByName('Greetings') === 'object')
  t.true(bot.findActionByName('Greetings').name() === 'Greetings')
  t.true(typeof bot.findActionByName('Order') === 'object')
  t.true(bot.findActionByName('Order').name() === 'Order')
  t.is(bot.findActionByName('Other'), undefined)
})

test('Bot#markActionAsDone', t => {
  const conversation = {
    memory: {},
    actionStates: {},
    userData: {},
  }
  const bot = new Bot()
  bot.registerActions([Greetings, Order])
  const order = bot.findActionByName('Order')

  // With name
  t.false(conversation.actionStates.Greetings === true)
  bot.markActionAsDone('Greetings', conversation)
  t.true(conversation.actionStates.Greetings)

  // With instance
  t.false(conversation.actionStates.Order === true)
  bot.markActionAsDone(order, conversation)
  t.true(conversation.actionStates.Order)
})

test('Bot#updateMemory', async t => {
  const conversation = {
    memory: {},
    actionStates: {},
    userData: {},
  }

  class Greeting extends Action {
    constructor() {
      super()
      this.intent = 'greetings'
      this.notions = [
        {
          isMissing: { en: ['How should I call you?'] },
          entities: [{ entity: 'person', alias: 'name' }],
        },
      ]
    }
  }

  class Delivery extends Action {
    constructor() {
      super()
      this.intent = 'delivery'
      this.notions = [
        {
          isMissing: { en: ['Where do you want to be delivered?'] },
          entities: [{ entity: 'datetime', alias: 'delivery-date' }],
        },
      ]
      this.dependencies = [{
        isMissing: {},
        actions: ['Greeting'],
      }]
    }
  }

  class Orderr extends Action {
    constructor() {
      super()
      this.intent = 'order'
      this.dependencies = [{
        isMissing: {},
        actions: ['Greetings'],
      }]
      this.notions = [{
        isMissing: { en: ['What product would you like?'] },
        entities: [{ entity: 'number', alias: 'product' }],
      }, {
        isMissing: { en: ['Where do you want to be delivered?'] },
        entities: [{ entity: 'datetime', alias: 'date' }],
      }]
    }
  }

  class Goodbyes extends Action {
    constructor() {
      super()
      this.intent = 'goodbye'
      this.dependencies = [{
        isMissing: { en: ['I need to know what you want before...'] },
        actions: ['Order'],
      }, {
        isMissing: { en: ['Sorry but I need more informations'] },
        actions: ['Delivery'],
      }]
    }
  }

  const bot = new Bot()
  bot.registerActions([Greeting, Orderr, Delivery, Goodbyes])

  // It should update the notion of the main action
  let mainAction = bot.actions.Orderr
  let entities = {
    datetime: [{
      raw: 'tomorrow at 9pm',
      formatted: 'Saturday, 01 October 2016 at 09:00:00 PM',
      accuracy: 'day,hour',
      chronology: 'future',
      time: '2016-10-01T21:00:00',
      confidence: 0.99,
    }],
  }
  await bot.updateMemory(entities, conversation, mainAction)
  t.true(typeof conversation.memory.date === 'object')
  t.true(typeof conversation.memory['delivery-date'] === 'undefined')

  // It should update without action
  entities = {
    number: [{
      raw: 'one',
      value: 1,
    }],
  }
  conversation.memory = {}
  await bot.updateMemory(entities, conversation)
  t.true(typeof conversation.memory.product === 'object')

  // It should not update if there are several notions of the same entity
  mainAction = bot.actions.Greeting
  entities = {
    datetime: [{
      raw: 'tomorrow at 9pm',
      formatted: 'Saturday, 01 October 2016 at 09:00:00 PM',
      accuracy: 'day,hour',
      chronology: 'future',
      time: '2016-10-01T21:00:00',
      confidence: 0.99,
    }],
  }
  conversation.memory = {}

  await bot.updateMemory(entities, conversation, mainAction)
  t.true(typeof conversation.memory.date === 'undefined')
  t.true(typeof conversation.memory.product === 'undefined')
  t.true(typeof conversation.memory['delivery-date'] === 'undefined')

  // It should update several notions
  mainAction = bot.actions.Orderr
  entities = {
    person: [{
      raw: 'Jean Valjean',
      value: 'Jean Valjean',
    }],
    datetime: [{
      raw: 'tomorrow at 9pm',
      formatted: 'Saturday, 01 October 2016 at 09:00:00 PM',
      accuracy: 'day,hour',
      chronology: 'future',
      time: '2016-10-01T21:00:00',
      confidence: 0.99,
    }],
  }
  conversation.memory = {}

  await bot.updateMemory(entities, conversation, mainAction)
  t.true(typeof conversation.memory.date === 'object')
  t.true(typeof conversation.memory.name === 'object')
  t.true(typeof conversation.memory.product === 'undefined')
  t.true(typeof conversation.memory['delivery-date'] === 'undefined')

  // It should do nothing when no entities
  mainAction = bot.actions.Orderr
  entities = {}
  conversation.memory = {}

  await bot.updateMemory(entities, conversation, mainAction)
  t.true(typeof conversation.memory.date === 'undefined')
  t.true(typeof conversation.memory.name === 'undefined')
  t.true(typeof conversation.memory.product === 'undefined')
  t.true(typeof conversation.memory['delivery-date'] === 'undefined')


  // It should update even when error
  class Bad extends Action {
    constructor() {
      super()
      this.intent = 'bad'
      this.notions = [
        {
          isMissing: {},
          entities: [{
            entity: 'color',
            alias: 'color',
            validator: () => new Promise((resolve, reject) => reject({ en: ['I don\'t care!'] })),
          }],
        },
      ]
    }
  }
  bot.registerAction(Bad)
  mainAction = bot.actions.Orderr
  entities = {
    color: [{ raw: 'red', hex: '#FF0000', rgb: 'rgb(255,0,0)' }],
    person: [{ raw: 'Jean Valjean', value: 'Jean Valjean' }],
  }
  conversation.memory = {}

  bot.updateMemory(entities, conversation, mainAction).then(msg => {
    t.deepEqual(msg, { en: ['I don\'t care!'] })
    t.true(typeof conversation.memory.date === 'undefined')
    t.true(typeof conversation.memory.color === 'undefined')
    // name should have been updated
    t.true(typeof conversation.memory.name === 'object')
    t.true(typeof conversation.memory.product === 'undefined')
    t.true(typeof conversation.memory['delivery-date'] === 'undefined')
  }).catch(t.fail)
})

test('Bot#expandVariables', t => {
  const memory = {
    name: {
      raw: 'Jean',
      value: 'jean',
    },
  }
  const b = new Bot()
  t.is(b.expandVariables('Hello {{name}}', memory), 'Hello Jean')
  t.is(b.expandVariables('Hello {{name.value}}', memory), 'Hello jean')
  t.is(b.expandVariables('Hello {{  name.value }}', memory), 'Hello jean')
  t.is(b.expandVariables('Hello { {name.value}}', memory), 'Hello { {name.value}}')
  t.is(b.expandVariables('Hello {{foo}}', memory), 'Hello ')
  t.is(b.expandVariables('Hello {{foo.raw}}', memory), 'Hello ')
  t.is(b.expandVariables('Hello {{name.bar}}', memory), 'Hello ')
  t.is(b.expandVariables('Hello {{name.}}', memory), 'Hello Jean')
  t.is(b.expandVariables('Hello {{.value}}', memory), 'Hello {{.value}}')
})

test('Bot#retrieveAction', t => {
  /**
   *                               ____Happy
   *                              /
   *            ____ Account ____|
   *           /                  \____NotHappy
   * Greet ---|
   *           \____ NoAccount
   */
  class Greet extends Action {
    constructor() {
      super()
      this.intent = 'greetings'
    }
  }

  class Account extends Action {
    constructor() {
      super()
      this.intent = 'yes'
      this.dependencies = [{ actions: ['Greet'], isMissing: {} }]
    }
  }

  class NoAccount extends Action {
    constructor() {
      super()
      this.intent = 'no'
      this.dependencies = [{ actions: ['Greet'], isMissing: {} }]
    }
  }

  class Happy extends Action {
    constructor() {
      super()
      this.intent = 'yes'
      this.dependencies = [{ actions: ['Account'], isMissing: {} }]
    }
  }

  class NotHappy extends Action {
    constructor() {
      super()
      this.intent = 'no'
      this.dependencies = [{ actions: ['Account'], isMissing: {} }]
    }
  }

  const b = new Bot()
  b.registerActions([Greet, Account, NoAccount, Happy, NotHappy])
  const conversation = {
    lastAction: null,
    actionStates: {},
    memory: {},
  }

  let a = b.retrieveAction(conversation, 'greetings')
  t.true(a instanceof Greet)

  conversation.lastAction = 'Greetings'
  b.markActionAsDone('Greetings', conversation)
  a = b.retrieveAction(conversation, 'yes')
  t.true(a instanceof Account)

  conversation.lastAction = 'Account'
  b.markActionAsDone('Account', conversation)
  a = b.retrieveAction(conversation, 'no')
  t.true(a instanceof NotHappy)
})

test('Action#findctionByLevel', t => {

  /**
   *                               ____Happy
   *                              /
   *            ____ Account ____|
   *           /                  \____NotHappy
   * Greet ---|
   *           \____ NoAccount
   */
  class Greet extends Action {
    constructor() {
      super()
      this.intent = 'greetings'
    }
  }

  class Account extends Action {
    constructor() {
      super()
      this.intent = 'yes'
      this.dependencies = [{ actions: ['Greet'], isMissing: {} }]
    }
  }

  class NoAccount extends Action {
    constructor() {
      super()
      this.intent = 'no'
      this.dependencies = [{ actions: ['Greet'], isMissing: {} }]
    }
  }

  class Happy extends Action {
    constructor() {
      super()
      this.intent = 'yes'
      this.dependencies = [{ actions: ['Account'], isMissing: {} }]
    }
  }

  class NotHappy extends Action {
    constructor() {
      super()
      this.intent = 'no'
      this.dependencies = [{ actions: ['Account'], isMissing: {} }]
    }
  }

  const b = new Bot()
  b.registerActions([Greet, Account, NoAccount, Happy, NotHappy])
  const conversation = {
    lastAction: null,
    actionStates: {},
    memory: {},
  }

  let a = b.findActionByLevel(conversation, 'yes')
  t.truthy(a)
  t.is(a.name(), 'Account')

  conversation.actionStates.Account = true
   a = b.findActionByLevel(conversation, 'yes')
  t.truthy(a)
  t.is(a.name(), 'Happy')
})
