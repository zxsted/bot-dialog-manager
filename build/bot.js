'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _axios = require('axios');

var _axios2 = _interopRequireDefault(_axios);

var _mongoose = require('mongoose');

var _mongoose2 = _interopRequireDefault(_mongoose);

var _conversation = require('./conversation');

var _conversation2 = _interopRequireDefault(_conversation);

var _utils = require('./utils');

var _utils2 = _interopRequireDefault(_utils);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

_mongoose2.default.Promise = global.Promise;

var Bot = function () {
  function Bot(opts) {
    _classCallCheck(this, Bot);

    this.actions = {};
    this.token = opts && opts.token;
    this.language = opts && opts.language;
    this.fallbackReplies = opts && opts.fallbackReplies;
  }

  // Opens a connection to mongodb for the storage of conversations


  _createClass(Bot, [{
    key: 'useDatabase',
    value: function useDatabase(conf) {
      this.useDb = true;
      var db = 'mongodb://';
      if (conf.username) {
        db = '' + db + conf.username + ':' + conf.password + '@';
      }
      db = '' + db + conf.hostname + ':' + conf.port + '/' + conf.name;
      if (!conf.ssl) {
        db = '{db}?ssl=' + conf.ssl;
      }

      _mongoose2.default.connect(db, function (err) {
        if (err) {
          throw err;
        }
      });
    }

    // Sets the replies of the bot when it doesn't understand the user

  }, {
    key: 'setFallbackReplies',
    value: function setFallbackReplies(replies) {
      this.fallbackReplies = replies;
    }

    /* Register an action to the bot
     * Actions are stored in a object mapping names to instances
     * Parameters:
     * Action: a class that will be instanciated and stored in the bot. This class must inherit Action's class from bot-dialog-manager
     */

  }, {
    key: 'registerAction',
    value: function registerAction(Action) {
      var newAction = null;

      try {
        newAction = new Action();
      } catch (e) {
        throw new Error(Action + ' parameter should be a class');
      }

      if (this.actions[newAction.name()]) {
        throw new Error(newAction.name() + ' is already registered');
      }

      if (!newAction.validate()) {
        throw new Error('Invalid action: ' + newAction.name());
      }

      this.actions[newAction.name()] = newAction;
    }

    /* Registers an array of actions to the bot
     * Registers an array of actions.
     * see registerAction
     */

  }, {
    key: 'registerActions',
    value: function registerActions(Actions) {
      var _this = this;

      if (Array.isArray(Actions)) {
        Actions.forEach(function (action) {
          _this.registerAction(action);
        });
      } else {
        throw new Error(Actions + ' should be an array of actions');
      }
    }

    /* Returns the action corresponding to `name`
     * Parameters:
     * name: the name of the action
     */

  }, {
    key: 'findActionByName',
    value: function findActionByName(name) {
      return this.actions[name];
    }

    /* Marks an action as done in the conversation's states
     * Parameters:
     * action: An Action instance or an Action's name
     * conversation: A Conversation model
     */

  }, {
    key: 'markActionAsDone',
    value: function markActionAsDone(action, conversation) {
      if (typeof action === 'string') {
        conversation.actionStates[action] = true;
      } else {
        conversation.actionStates[action.name()] = true;
      }
    }

    /* initialize should resolve the conversation linked to the conversationId
     * The conversation should be found or created in db, or directly instanciated
     * Parameters:
     * conversationId: String to identify the conversation. This can come from the messaging service for example.
     */

  }, {
    key: 'initialize',
    value: function initialize(conversationId) {
      var _this2 = this;

      return new Promise(function (resolve, reject) {
        if (!_this2.useDb) {
          return resolve(new _conversation2.default({
            conversationId: conversationId,
            userData: {},
            memory: {},
            actionStates: {}
          }));
        }
        _conversation2.default.findOne({ conversationId: conversationId }).then(function (res) {
          if (res) {
            return resolve(res);
          }
          _conversation2.default.create({
            conversationId: conversationId,
            userData: {},
            memory: {},
            actionStates: {}
          }).then(resolve).catch(reject);
          return true;
        }).catch(function (err) {
          return reject(err);
        });
        return true;
      });
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

  }, {
    key: 'expandVariables',
    value: function expandVariables(reply, memory) {
      var replacer = function replacer(match, v, f) {
        if (!memory[v]) {
          return '';
        }

        var variable = memory[v];
        var field = f || 'raw';

        if (typeof variable === 'string') {
          return variable;
        }

        if (!variable[field]) {
          return '';
        }
        return variable[field];
      };
      return reply.replace(/{{\s*([a-zA-Z0-9\-_]+)\.?([a-zA-Z0-9\-_]+)?\s*}}/g, replacer);
    }

    /* Takes a reply and returns the expanded reply if it's a string
     * reply: Can be any object comming from an action. It will be evaluated if it's a  string.
     *        It can take any value to handle the different formats of messagin platform replies.
     * memory: Object containing the bot's notions
     */

  }, {
    key: 'evaluateReply',
    value: function evaluateReply(reply, memory) {
      if (typeof reply === 'string') {
        return this.expandVariables(reply, memory);
      }

      return reply;
    }

    /* Calls Recast.AI API
     * Parameters:
     * text: the user's input
     * token: Recast.AI API authentication token
     * language: (optional) If provided, this will force the process of the input in this language
     */

  }, {
    key: 'callToRecast',
    value: function callToRecast(text, token, language) {
      var data = { text: text };

      // Force the process in the language parameter if provided
      if (language) {
        data.language = language;
      }

      return (0, _axios2.default)({
        method: 'post',
        headers: { Authorization: 'Token ' + token },
        url: 'https://api.recast.ai/v2/request',
        data: data
      });
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

  }, {
    key: 'reply',
    value: function reply(input, conversationId, opts) {
      var _this3 = this;

      var tok = opts && opts.token || this.token;
      var language = opts && opts.language || this.language;
      return new Promise(function (resolve, reject) {
        if (!tok) {
          return reject('No token provided');
        }

        // Find or create the conversation
        _this3.initialize(conversationId).then(function (conversation) {
          if (!conversation.memory) {
            conversation.memory = {};
          }
          if (!conversation.userData) {
            conversation.userData = {};
          }
          if (!conversation.actionStates) {
            conversation.actionStates = {};
          }

          // Call Recast.AI API for language understanding
          _this3.callToRecast(input, tok, language).then(function (res) {
            var results = res.data.results;
            var act = null;

            // Try to find a action to process using context
            if (results.intents.length === 0) {
              act = _this3.searchActionWithoutIntent(conversation, results.entities);

              // Use fallback replies if we can't
              if (!act && _this3.fallbackReplies) {
                return resolve(_this3.evaluateReply(_this3.pickReplies([_this3.fallbackReplies], results.language)));
              }
              if (!act) {
                return reject('No response set when no intent is matched');
              }
            }

            // Find an action corresponding to the current intent
            var action = act || _this3.retrieveAction(conversation, results.intents[0].slug);

            if (!action) {
              return reject(new Error('No action found for intent ' + results.intents[0].slug));
            }
            var replies = [];

            var message = null;
            var lastAction = null;
            // Loop through the dependencies while the action has incomplete dependencies
            while (!action.isActionable(_this3.actions, conversation)) {
              var deps = action.getMissingDependencies(_this3.actions, conversation);

              var dep = _utils2.default.getRandom(deps);

              // Transition message between actions
              message = dep.isMissing;

              // If we have a OR relation, we let the user decide what he wants
              if (dep.actions.length > 1) {
                lastAction = action.name();
                action = null;
                break;
              }

              action = _this3.actions[dep.actions[0]];
            }

            if (action) {
              lastAction = action.name();
            }
            // Save the action we will process
            conversation.lastAction = lastAction;

            if (message) {
              replies.push(message);
            }

            _this3.updateMemory(results.entities, conversation, action).then(function (msg) {
              // Maybe a validator rejected the it's input
              if (msg) {
                replies.push(msg);
              }

              if (action) {
                // Process the curent action
                action.process(conversation, _this3.actions, results).then(function (resp) {
                  var p = Promise.resolve();
                  if (action.isComplete(_this3.actions, conversation)) {
                    // Mark the action as done in the conversation states
                    conversation.actionStates[action.name()] = true;

                    // Reset the conversation if the action is the end of the conversation
                    if (action.endConversation) {
                      conversation.memory = {};
                      conversation.actionStates = {};
                      conversation.userData = {};
                      conversation.lastAction = null;
                    } else if (action.next) {
                      // Contiunue the conversation flow if the action has a next
                      p = _this3.actions[action.next].process(conversation, _this3.actions, results);
                    }
                  }
                  // TODO: refactor the code duplication
                  // Process the next action or nothing
                  p.then(function (nextResp) {
                    _this3.saveConversation(conversation, function () {
                      replies.push(resp);
                      if (nextResp) {
                        replies.push(nextResp);
                      }

                      // Choose and expand all replies
                      var resps = _this3.pickReplies(replies, results.language);
                      return resolve(resps.map(function (r) {
                        return _this3.evaluateReply(r, conversation.memory);
                      }));
                    });
                  }).catch(function (nextResp) {
                    _this3.saveConversation(conversation, function () {
                      replies.push(resp);
                      if (nextResp) {
                        replies.push(nextResp);
                      }

                      // Choose and expand all replies
                      var resps = _this3.pickReplies(replies, results.language);
                      return resolve(resps.map(function (r) {
                        return _this3.evaluateReply(r, conversation.memory);
                      }));
                    });
                  });
                }).catch(function (resp) {
                  _this3.saveConversation(conversation, function () {
                    replies.push(resp);

                    // Choose and expand all replies
                    var resps = _this3.pickReplies(replies, results.language);
                    return resolve(resps.map(function (r) {
                      return _this3.evaluateReply(r, conversation.memory);
                    }));
                  });
                });
              } else {
                // We blocked on a OR dependency, just save and resolve the reply
                _this3.saveConversation(conversation, function () {
                  var resps = _this3.pickReplies(replies, results.language);
                  return resolve(resps.map(function (r) {
                    return _this3.evaluateReply(r, conversation.memory);
                  }));
                });
              }
              return true;
            }).catch(reject);
            return true;
          }).catch(reject);
        }).catch(reject);

        return true;
      });
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

  }, {
    key: 'pickReplies',
    value: function pickReplies(responses, language) {
      return responses.map(function (r) {
        if (Array.isArray(r)) {
          return _utils2.default.getRandom(r);
        }

        var resps = r[language] || r.en;

        if (Array.isArray(resps)) {
          return _utils2.default.getRandom(resps);
        }

        return resps;
      });
    }

    /* Updates memory with input's entities
     * Priority: 1) notion of the current action
     *           2) any notion that is alone in the bot
     * Parameters:
     * entities: an object containing all entities deteceted in the sentence and enriched
     * conversation: a conversation model
     * action: the current action we are processing
     */

  }, {
    key: 'updateMemory',
    value: function updateMemory(entities, conversation, action) {
      var _this4 = this;

      var actionNotions = null;

      if (action) {
        actionNotions = _lodash2.default.flatten(action.notions.map(function (c) {
          return c.entities;
        }));
      }

      return new Promise(function (resolve) {
        var promises = [];

        // loop through the entities map
        _lodash2.default.forOwn(entities, function (entitiesArray, name) {
          // search for a notion of the current action
          var actionNotion = actionNotions && actionNotions.find(function (k) {
            return k.entity === name;
          }) || null;
          // For each entity in the input we look for the corresponding notion and fill it
          // if the validator's promise resolves
          entitiesArray.forEach(function (entity) {
            if (actionNotion) {
              (function () {
                // Uses the action's validator or a default one
                var validator = actionNotion.validator || function (e) {
                  return e;
                };

                promises.push(new Promise(function (resolv, rejec) {
                  // This promise resolves the value resolved by the validator or the complete entity
                  // This allows the validator to make some processing or formatting
                  Promise.resolve(validator(entity, conversation.memory)).then(function (res) {
                    return resolv({ name: actionNotion.alias, value: res || entity });
                  }).catch(function (err) {
                    return rejec(err);
                  });
                }));
              })();
            } else {
              (function () {
                // search for a notion of any action in the conversation
                var globalNotions = _lodash2.default.flatten(_lodash2.default.values(_this4.actions).map(function (a) {
                  return a.allNotions();
                })).filter(function (k) {
                  return k.entity === name && !conversation.memory[k.alias];
                });

                if (globalNotions.length === 1) {
                  (function () {
                    // Same as above
                    var validator = globalNotions[0].validator || function (e) {
                      return e;
                    };

                    promises.push(new Promise(function (resolv, rejec) {
                      Promise.resolve(validator(entity, conversation.memory)).then(function (res) {
                        return resolv({ name: globalNotions[0].alias, value: res || entity });
                      }).catch(function (err) {
                        return rejec(err);
                      });
                    }));
                  })();
                }
              })();
            }
          });
        });

        if (promises.length === 0) {
          return resolve();
        }

        var e = [];
        // Let all the validators do their job
        // We cathc all promises to avoid the reject of promise.all
        Promise.all(promises.map(function (p) {
          return p.catch(function (err) {
            e.push(err);
          });
        })).then(function (res) {
          // Update the memory for all resolved validators
          res.filter(function (el) {
            return el;
          }).forEach(function (entity) {
            var name = entity.name;
            var value = entity.value;

            conversation.memory[name] = value;
          });

          // Eventually return a message from a validator that rejected the input
          if (e.length > 0) {
            return resolve(e[e.length - 1]);
          }

          return resolve();
        });
        return true;
      });
    }

    // Returns all the actions that require the `action` parameter

  }, {
    key: 'nextOf',
    value: function nextOf(action) {
      return _lodash2.default.values(this.actions).filter(function (a) {
        return a.allDependencies().indexOf(action.name()) !== -1;
      });
    }

    /* Try to choose an action to process without matching intent using the context of the conversation
     * Parameters:
     * conversation: a conversation model
     * entities: entities extracted and enriched by Recast
     */

  }, {
    key: 'searchActionWithoutIntent',
    value: function searchActionWithoutIntent(conversation, entities) {
      var last = this.actions[conversation.lastAction];
      if (!last) {
        return null;
      }

      // Choose the last processed action if it matches the requirements
      if (this.shouldChooseAction(last, conversation, entities)) {
        return last;
      }

      var nexts = this.nextOf(last);

      if (nexts.length !== 1) {
        return null;
      }

      // Choose the next otherwise if it matches
      if (this.shouldChooseAction(nexts[0], conversation, entities)) {
        return nexts[0];
      }

      return null;
    }

    /* Returns true if the `action` parameter should be processed for this input
     * We choose the action if there is a single missing notion
     * Parameters:
     * action: the action to choose or not
     * conversation: a conversation model
     * entities: entities extracted in the current user input
     */

  }, {
    key: 'shouldChooseAction',
    value: function shouldChooseAction(action, conversation, entities) {
      var shouldChoose = false;

      _lodash2.default.forOwn(entities, function (values, key) {
        // Find the notions corresponding to the entity
        var notion = action.allNotions().find(function (c) {
          return c.entity === key;
        });
        // The action is chosen if there is only one empty notion
        if (values.length === 1 && notion && !conversation.memory[notion.alias]) {
          shouldChoose = true;
        }
      });
      return shouldChoose;
    }

    /* Returns the action to process for the detected intent
     * Parameters:
     * conversation: a conversation model
     * intent: the intent detected for the current user input
     */

  }, {
    key: 'retrieveAction',
    value: function retrieveAction(conversation, intent) {
      var _this5 = this;

      // Actions corresponding to the action
      var matchingActions = _lodash2.default.values(this.actions).filter(function (a) {
        return a.intent === intent;
      });
      // Last action processed
      var lastAction = this.actions[conversation.lastAction];
      var action = null;

      if (matchingActions.length === 0) {
        return null;
      } else if (matchingActions.length === 1) {
        return matchingActions[0];
      }

      // If several actions match the intent
      if (lastAction) {
        if (lastAction.isDone(conversation)) {
          // Looks for an action following lastAction if it's done
          action = matchingActions.find(function (a) {
            return _this5.nextOf(lastAction).indexOf(a) !== -1;
          });
        } else {
          // Looks if lastAction is amongst all the matching actions
          action = matchingActions.find(function (a) {
            return a.name() === lastAction.name();
          });
        }
      }

      // If we didnt find any acion, we try to choose the closest action from the beginning of the conversation
      return action || this.findActionByLevel(conversation, intent) || matchingActions[0];
    }

    /* Search for an incomplete action the closest of the beginning of the conversation
     * Parameters:
     * conversation: a conversation model
     * intent: the intent detected for the current user input
     */

  }, {
    key: 'findActionByLevel',
    value: function findActionByLevel(conversation, intent) {
      var _this6 = this;

      // Actions that are required by others
      var requiredActions = new Set(_lodash2.default.flatten(_lodash2.default.values(this.actions).map(function (a) {
        return a.allDependencies();
      })));
      // Actions that are not required by others (standalone actions or leafs)
      var leafs = _lodash2.default.keys(this.actions).filter(function (a) {
        return !requiredActions.has(a);
      });
      var queue = leafs.map(function (a) {
        return _this6.actions[a];
      });
      var buffer = [];
      var level = 0;

      // We loop through all the levels of the graph and store all the actions matching `intent` with their positions in the graph
      while (queue.length > 0) {
        queue.filter(function (a) {
          return a.intent === intent;
        }).forEach(function (action) {
          if (!action.isDone(conversation)) {
            buffer.push({ level: level, action: action });
          }
        });

        // All actions that are required by the current level
        var sublevel = _lodash2.default.flatten(queue.map(function (a) {
          return a.allDependencies().map(function (ac) {
            return _this6.actions[ac];
          });
        }));

        queue = sublevel;
        level += 1;
      }

      if (buffer.length === 0) {
        return null;
      }

      // We sort all actions by their level to find the deepest action
      var sorted = buffer.sort(function (a, b) {
        return a.level - b.level;
      });

      // Returns the deeper action not completed in the conversation graph
      return sorted[sorted.length - 1].action;
    }
  }, {
    key: 'saveConversation',
    value: function saveConversation(conversation, cb) {
      if (this.useDb) {
        conversation.markModified('userData');
        conversation.markModified('actionStates');
        conversation.markModified('memory');
        conversation.markModified('lastAction');
        conversation.save(function (err) {
          if (cb) {
            return cb(err);
          }
        });
      } else if (cb) {
        return cb();
      }
    }
  }]);

  return Bot;
}();

module.exports = Bot;