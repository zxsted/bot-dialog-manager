'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _utils = require('./utils');

var _utils2 = _interopRequireDefault(_utils);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Action = function () {
  function Action() {
    _classCallCheck(this, Action);

    this.notions = [];
    this.dependencies = [];
    this.defaultValidator = function (entity) {
      return entity;
    };
  }

  _createClass(Action, [{
    key: 'name',
    value: function name() {
      return this.constructor.name;
    }

    // Basic validation of the actions's structure:
    // It should have an intent, an array of dependencies and notions

  }, {
    key: 'validate',
    value: function validate() {
      var _this = this;

      if (typeof this.intent !== 'string') {
        return false;
      }

      if (!Array.isArray(this.dependencies) || !Array.isArray(this.notions)) {
        return false;
      }

      var dependenciesValidity = this.dependencies.every(function (dep) {
        if (_typeof(dep.isMissing) !== 'object') {
          return false;
        }

        if (!Array.isArray(dep.actions)) {
          return false;
        }

        return dep.actions.every(function (a) {
          return typeof a === 'string';
        });
      });

      if (!dependenciesValidity) {
        return false;
      }

      var notionsValidity = this.notions.every(function (n) {
        if (_typeof(n.isMissing) !== 'object') {
          return false;
        }

        if (!Array.isArray(n.entities)) {
          return false;
        }

        return n.entities.every(function (e) {
          return (typeof e === 'undefined' ? 'undefined' : _typeof(e)) === 'object' && typeof e.entity === 'string' && typeof e.alias === 'string';
        });
      });

      if (!notionsValidity) {
        return false;
      }

      var requiresItself = this.dependencies.some(function (dependency) {
        return dependency.actions.some(function (a) {
          return a === _this.name();
        });
      });

      if (this.dependencies.length > 0 && requiresItself) {
        return false;
      }

      return true;
    }

    // Returns all actions required by the current action

  }, {
    key: 'allDependencies',
    value: function allDependencies() {
      return _lodash2.default.flatten(this.dependencies.map(function (d) {
        return d.actions;
      }));
    }

    // Returns all entities contained in notions of the current action

  }, {
    key: 'allNotions',
    value: function allNotions() {
      return _lodash2.default.flatten(this.notions.map(function (c) {
        return c.entities;
      }));
    }

    /* returns true if all the dependencies of the current action are complete
     * Parameters:
     * actions: all actions of the bot
     * conversation: a conversation model
     */

  }, {
    key: 'dependenciesAreComplete',
    value: function dependenciesAreComplete(actions, conversation) {
      return this.dependencies.every(function (dependency) {
        return dependency.actions.some(function (a) {
          var requiredAction = actions[a];
          if (!requiredAction) {
            throw new Error('Action ' + a + ' not found');
          }
          return requiredAction.isDone(conversation);
        });
      });
    }

    // Returns true if all the notions are complete

  }, {
    key: 'notionsAreComplete',
    value: function notionsAreComplete(memory) {
      return this.notions.every(function (notion) {
        return notion.entities.some(function (e) {
          return memory[e.alias];
        });
      });
    }

    // An action is actionable when all dependencies are complete

  }, {
    key: 'isActionable',
    value: function isActionable(actions, conversation) {
      return this.dependenciesAreComplete(actions, conversation);
    }

    // An action is done when all dependencies and notions are complete

  }, {
    key: 'isComplete',
    value: function isComplete(actions, conversation) {
      return this.dependenciesAreComplete(actions, conversation) && this.notionsAreComplete(conversation.memory);
    }
  }, {
    key: 'isDone',
    value: function isDone(conversation) {
      return conversation.actionStates[this.name()] === true;
    }

    // Returns all notions that are not completed
    // A notion is complete when at least one entity is filled in memory

  }, {
    key: 'getMissingEntities',
    value: function getMissingEntities(memory) {
      return this.notions.filter(function (c) {
        return c.entities.some(function (e) {
          return memory[e.alias];
        }) === false;
      });
    }

    // Returns all dependencies that are not completed
    // A dedendency is complete when at least one prerequisite is done

  }, {
    key: 'getMissingDependencies',
    value: function getMissingDependencies(actions, conversation) {
      return this.dependencies.filter(function (d) {
        return d.actions.map(function (a) {
          return actions[a];
        }).every(function (a) {
          return !a.isDone(conversation);
        });
      });
    }

    /* process returns the reply of the action dependencig on the conversation state
     * Parameters:
     * conversation: a conversation model
     * actions: all actions in the bot
     * recastResponse: the recast text analysis for the current input
     */

  }, {
    key: 'process',
    value: function process(conversation, actions, recastResponse) {
      var _this2 = this;

      return new Promise(function (resolve, reject) {
        // Check if the action has all it needs
        if (_this2.isComplete(actions, conversation)) {
          // We expect to have a 'reply' method defined
          if (_this2.reply) {
            return Promise.resolve(_this2.reply(conversation, recastResponse)).then(resolve).catch(reject);
          }
          return reject(new Error('No reply found'));
        }
        // The action asks for a missing notion
        return resolve(_utils2.default.getRandom(_this2.getMissingEntities(conversation.memory)).isMissing);
      });
    }
  }]);

  return Action;
}();

module.exports = Action;