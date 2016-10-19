'use strict';

var _mongoose = require('mongoose');

var _mongoose2 = _interopRequireDefault(_mongoose);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var conversationSchema = new _mongoose2.default.Schema({
  // Identifies the conversation
  conversationId: String,
  // Stores the bot's notions
  memory: Object,
  // Stores the states of actions is the conversation. Which are done of not
  actionStates: Object,
  // Stores whatever the user wants
  userData: Object,
  // Name of the last action processed by the bot
  lastAction: String
});

var Conversation = _mongoose2.default.model('Conversation', conversationSchema);

module.exports = Conversation;