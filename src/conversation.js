import mongoose from 'mongoose'

const conversationSchema = new mongoose.Schema({
  // Identifies the conversation
  conversationId: String,
  // Stores the bot's notions
  memory: Object,
  // Stores the states of actions is the conversation. Which are done of not
  actionStates: Object,
  // Stores whatever the user wants
  userData: Object,
  // Name of the last action processed by the bot
  lastAction: String,
})

const Conversation = mongoose.model('Conversation', conversationSchema)

module.exports = Conversation
